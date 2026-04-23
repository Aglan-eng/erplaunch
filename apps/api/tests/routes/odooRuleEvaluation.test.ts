import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { engagementRoutes } from '../../src/routes/engagements.js';
import { registerBuiltinAdaptor, getAdaptorRegistry, AdaptorRegistry } from '@ofoq/adaptor-registry';
import odooAdaptor from '@ofoq/adaptor-odoo';
import { getDb, createEngagement } from '../../src/db/index.js';

const JWT_SECRET = 'test-odoo-rule-eval-secret';

let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

async function seedFirmAndToken(): Promise<{ firmId: string; token: string }> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const slug = `firm-${createId().slice(0, 8)}`;
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Rule Test Firm', slug, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Tester', 'not-used', 'CONSULTANT', now],
  });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Tester', email: `${userId}@example.com` });
  return { firmId, token };
}

function authHeaders(token: string): Record<string, string> {
  return { cookie: `token=${token}`, 'content-type': 'application/json' };
}

async function createOdooEngagement(firmId: string, clientName: string): Promise<string> {
  const eng = await createEngagement({ firmId, clientName, adaptorId: 'odoo' });
  if (!eng) throw new Error('engagement create failed');
  return eng.id as string;
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  // Register the Odoo adaptor into the process registry if it isn't already
  // (other test suites may have registered it; the registry refuses
  // duplicates so guard with has()).
  try {
    const reg = getAdaptorRegistry();
    if (!reg.has('odoo')) registerBuiltinAdaptor(odooAdaptor);
  } catch {
    // fallback: use a fresh registry — unlikely in practice, but safe
    const reg = new AdaptorRegistry();
    reg.register(odooAdaptor);
  }
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

describe('Odoo engagement — PUT /license triggers adaptor rule evaluation', () => {
  it('licensing Studio on COMMUNITY fires odoo.studio-is-enterprise-only', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Studio Conflict Co');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'COMMUNITY', modules: ['ENTERPRISE_STUDIO'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const ids = body.data.conflicts.map((c) => c.id);
    expect(ids).toContain('odoo.studio-is-enterprise-only');
    const r = body.data.conflicts.find((c) => c.id === 'odoo.studio-is-enterprise-only');
    expect(r?.severity).toBe('BLOCK');
  });

  it('ENTERPRISE + full module set on a new engagement yields only data-completeness warnings', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Clean Scoping Co');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: ['MRP', 'QUALITY', 'ENTERPRISE_STUDIO'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    // Without answers the fiscal-year-start DATA_WARNING fires, but no
    // LICENSE_GAP BLOCKs should be present.
    const blocks = body.data.conflicts.filter((c) => c.severity === 'BLOCK');
    expect(blocks).toEqual([]);
  });
});

describe('Odoo engagement — PATCH /profile fires answer-driven rules', () => {
  it('enabling MRP without the MRP module fires a BLOCK conflict', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'MRP Gap Co');

    // License has no MRP module
    await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });

    // Turn on MRP in the answers
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: { 'odoo.mrp.enabled': true, 'odoo.company.fiscalYearStart': '01-01' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const ids = body.data.conflicts.map((c) => c.id);
    expect(ids).toContain('odoo.mrp.requires-mrp-module');
    expect(body.data.conflicts.find((c) => c.id === 'odoo.mrp.requires-mrp-module')?.severity).toBe('BLOCK');
  });

  it('resolving the license gap (add MRP module) clears the conflict on next save', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Fix-Me Co');

    // Initial state: MRP enabled but no module → conflict
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token), payload: { edition: 'ENTERPRISE', modules: [] },
    });
    await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: { 'odoo.mrp.enabled': true, 'odoo.company.fiscalYearStart': '01-01' } },
    });

    // Fix it: provision the MRP module
    const fixed = await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token), payload: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    const body = fixed.json() as { data: { conflicts: Array<{ id: string }> } };
    const ids = body.data.conflicts.map((c) => c.id);
    expect(ids).not.toContain('odoo.mrp.requires-mrp-module');
  });

  it('MRP sub-setting without parent emits a WARN', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Parentless MRP Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token), payload: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.mrp.enabled': false,
        'odoo.mrp.workCenters': true,
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.mrp.sub-settings-without-parent');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });
});
