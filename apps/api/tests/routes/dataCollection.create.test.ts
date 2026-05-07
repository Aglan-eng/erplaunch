import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { dataCollectionRoutes } from '../../src/routes/dataCollection.js';
import { activityRoutes } from '../../src/routes/activity.js';
import { getDb, createEngagement, bootstrapFirmAdmin } from '../../src/db/index.js';

const JWT_SECRET = 'test-data-collection-create-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal', secret: 'test-portal-dc-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(multipart, { limits: { fileSize: 11 * 1024 * 1024 } });
  await f.register(activityRoutes, { prefix: '/api/v1' });
  await f.register(dataCollectionRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface SeedFixture { firmId: string; userId: string; engagementId: string; token: string }

async function seed(): Promise<SeedFixture> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'DC Firm', `dc-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Tester', passwordHash, 'CONSULTANT', now],
  });
  const eng = await createEngagement({ firmId, clientName: 'Acme DC Client' });
  const engagementId = (eng as { id: string }).id;
  // Phase 44.3 — RBAC gate.
  await bootstrapFirmAdmin({ firmId, userId });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Tester', email: `${userId}@example.com` });
  return { firmId, userId, engagementId, token };
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildTestApp();
});
afterAll(async () => { await app.close(); cleanup(); });
beforeEach(async () => { await getDb().execute(`DELETE FROM ActivityLog`); });

describe('POST /api/v1/engagements/:id/data-collection — top-level create', () => {
  it('requires authentication', async () => {
    const { engagementId } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/data-collection`,
      payload: { title: 'Chart of Accounts', area: 'Finance' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a data request with sensible defaults', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/data-collection`,
      cookies: { token },
      payload: {
        title: 'Chart of Accounts export',
        description: 'Export from legacy system as CSV.',
        area: 'Finance',
        assignedTo: 'CLIENT',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { name: string; description?: string; category: string; status: string; assignedTo?: string } };
    expect(body.data.name).toBe('Chart of Accounts export');
    expect(body.data.description).toBe('Export from legacy system as CSV.');
    expect(body.data.category).toBe('Finance');
    expect(body.data.status).toBe('PENDING');
    expect(body.data.assignedTo).toBe('CLIENT');
  });

  it('rejects missing title with 400', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/data-collection`,
      cookies: { token },
      payload: { area: 'Finance' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing area with 400', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/data-collection`,
      cookies: { token },
      payload: { title: 'Some doc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('writes a DATA_REQUEST_CREATED activity entry', async () => {
    const { engagementId, token } = await seed();
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/data-collection`,
      cookies: { token },
      payload: { title: 'Vendor master', area: 'Procurement' },
    });
    const r = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ? ORDER BY createdAt DESC`,
      args: [engagementId],
    });
    const actions = (r.rows as Array<Record<string, unknown>>).map((row) => row.action as string);
    expect(actions).toContain('DATA_REQUEST_CREATED');
  });

  it('cross-firm POST returns 404', async () => {
    const a = await seed();
    const b = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${a.engagementId}/data-collection`,
      cookies: { token: b.token },
      payload: { title: 'sneaky', area: 'Finance' },
    });
    expect(res.statusCode).toBe(404);
  });
});
