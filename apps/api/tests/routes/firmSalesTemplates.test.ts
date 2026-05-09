/**
 * Phase 46.8.6 — integration tests for /firm/sales-templates routes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { firmSalesTemplatesRoutes } from '../../src/routes/firmSalesTemplates.js';
import { getDb, bootstrapFirmAdmin, grantFirmRole } from '../../src/db/index.js';

const JWT_SECRET = 'firm-sales-templates-test';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-firm-sales-test',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(firmSalesTemplatesRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  adminUserId: string;
  managerUserId: string;
  outsiderUserId: string;
  adminToken: string;
  managerToken: string;
  outsiderToken: string;
}

async function seed(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const adminUserId = createId();
  const managerUserId = createId();
  const outsiderUserId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Templates Firm', `tpl-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('x', 4);
  for (const id of [adminUserId, managerUserId, outsiderUserId]) {
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
      args: [id, firmId, `${id}@example.com`, id, passwordHash, 'CONSULTANT'],
    });
  }
  await bootstrapFirmAdmin({ firmId, userId: adminUserId });
  await grantFirmRole({
    firmId,
    userId: managerUserId,
    role: 'SALES_MANAGER',
    actorUserId: adminUserId,
  });
  const sign = (id: string) =>
    app.jwt.sign({ userId: id, firmId, role: 'CONSULTANT', name: id, email: `${id}@example.com` });
  return {
    firmId,
    adminUserId,
    managerUserId,
    outsiderUserId,
    adminToken: sign(adminUserId),
    managerToken: sign(managerUserId),
    outsiderToken: sign(outsiderUserId),
  };
}

beforeAll(async () => {
  ({ cleanup } = await setupTestDb());
  app = await buildTestApp();
});
afterAll(async () => {
  await app.close();
  cleanup();
});
beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM RoleAuditLog`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM FirmRole`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

describe('GET /firm/sales-templates', () => {
  it('returns the canonical default shape for a firm with no overrides', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/sales-templates',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      data: {
        perModulePricing: Record<string, number>;
        defaultPerUserPrice: number | null;
        geographyMultipliers: Record<string, number>;
        whyUsTemplate: string | null;
        coverLetterTemplate: string | null;
        sowTermsTemplate: string | null;
      };
    };
    expect(body.data.perModulePricing).toEqual({});
    expect(body.data.defaultPerUserPrice).toBeNull();
    expect(body.data.geographyMultipliers).toEqual({});
    expect(body.data.whyUsTemplate).toBeNull();
    expect(body.data.coverLetterTemplate).toBeNull();
    expect(body.data.sowTermsTemplate).toBeNull();
  });

  it('403s a SALES_MANAGER (templates are admin-only)', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/sales-templates',
      headers: { authorization: `Bearer ${f.managerToken}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it('403s a no-role user', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/sales-templates',
      headers: { authorization: `Bearer ${f.outsiderToken}` },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('PATCH /firm/sales-templates', () => {
  it('updates per-module pricing + default + geography', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/sales-templates',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: {
        perModulePricing: { 'gl-ar-ap': 1500, inventory: 1800 },
        defaultPerUserPrice: 1100,
        geographyMultipliers: { US: 1.0, UK: 0.9, IN: 0.4 },
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      data: {
        perModulePricing: Record<string, number>;
        defaultPerUserPrice: number | null;
        geographyMultipliers: Record<string, number>;
      };
    };
    expect(body.data.perModulePricing['gl-ar-ap']).toBe(1500);
    expect(body.data.defaultPerUserPrice).toBe(1100);
    expect(body.data.geographyMultipliers['UK']).toBe(0.9);
  });

  it('persists markdown templates round-trip', async () => {
    const f = await seed();
    const tmpl = 'Dear {{decisionMaker}}, custom body.';
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/sales-templates',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { coverLetterTemplate: tmpl, whyUsTemplate: '## Why Us\n\nBecause.' },
    });
    const get = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/sales-templates',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const body = get.json() as { data: { coverLetterTemplate: string; whyUsTemplate: string } };
    expect(body.data.coverLetterTemplate).toBe(tmpl);
    expect(body.data.whyUsTemplate).toContain('Because.');
  });

  it('rejects negative pricing with 400', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/sales-templates',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { perModulePricing: { inventory: -50 } },
    });
    expect(r.statusCode).toBe(400);
  });

  it('partial PATCH does not clobber other fields', async () => {
    const f = await seed();
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/sales-templates',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { defaultPerUserPrice: 1500 },
    });
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/sales-templates',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { whyUsTemplate: 'whyus body' },
    });
    const get = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/sales-templates',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const body = get.json() as { data: { defaultPerUserPrice: number; whyUsTemplate: string } };
    expect(body.data.defaultPerUserPrice).toBe(1500);
    expect(body.data.whyUsTemplate).toBe('whyus body');
  });

  it('403s a non-admin user', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/sales-templates',
      headers: { authorization: `Bearer ${f.outsiderToken}` },
      payload: { defaultPerUserPrice: 9999 },
    });
    expect(r.statusCode).toBe(403);
  });
});
