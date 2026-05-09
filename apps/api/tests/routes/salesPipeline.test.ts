/**
 * Phase 46.1 — integration tests for the sales pipeline routes.
 *
 * Exercises:
 *   - GET /sales/pipeline returns sales-stage engagements only
 *   - APP_ADMIN sees all firm prospects; SALES_REP sees only theirs
 *   - non-sales user gets 403
 *   - POST /sales/prospects creates with leadSource + estimatedValue
 *     + grants the SALES_REP role + writes a PROSPECT_CREATED activity
 *   - Bad leadSource value → 400
 *   - PATCH /sales/prospects/:id/stage transitions PROSPECT → PROPOSED
 *     and refuses post-funnel engagements
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { salesPipelineRoutes } from '../../src/routes/salesPipeline.js';
import {
  getDb,
  bootstrapFirmAdmin,
  grantFirmRole,
} from '../../src/db/index.js';

const JWT_SECRET = 'sales-pipeline-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-sales-pipeline-test',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(salesPipelineRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  adminUserId: string;
  managerUserId: string;
  repUserId: string;
  outsiderUserId: string;
  adminToken: string;
  managerToken: string;
  repToken: string;
  outsiderToken: string;
}

async function seed(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const adminUserId = createId();
  const managerUserId = createId();
  const repUserId = createId();
  const outsiderUserId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Sales Firm', `sales-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('x', 4);
  for (const id of [adminUserId, managerUserId, repUserId, outsiderUserId]) {
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
  // repUserId becomes SALES_REP per-engagement via the POST /sales/prospects
  // path during the tests; outsiderUserId stays role-less.

  const sign = (id: string) =>
    app.jwt.sign({ userId: id, firmId, role: 'CONSULTANT', name: id, email: `${id}@example.com` });
  return {
    firmId,
    adminUserId,
    managerUserId,
    repUserId,
    outsiderUserId,
    adminToken: sign(adminUserId),
    managerToken: sign(managerUserId),
    repToken: sign(repUserId),
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
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM RoleAuditLog`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM FirmRole`);
  await db.execute(`DELETE FROM LicenseProfile`);
  await db.execute(`DELETE FROM BusinessProfile`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── POST /sales/prospects ──────────────────────────────────────────────────

describe('POST /sales/prospects', () => {
  it('creates a PROSPECT engagement with the supplied fields', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/prospects',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: {
        clientName: 'Acme Co',
        leadSource: 'REFERRAL',
        estimatedValue: 75_000,
        estimatedCloseDate: '2026-09-01',
        salesRepUserId: f.repUserId,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as {
      data: {
        id: string;
        status: string;
        leadSource: string;
        estimatedValue: number;
        salesRepUserId: string;
      };
    };
    expect(body.data.status).toBe('PROSPECT');
    expect(body.data.leadSource).toBe('REFERRAL');
    expect(body.data.estimatedValue).toBe(75_000);
    expect(body.data.salesRepUserId).toBe(f.repUserId);

    // The sales rep should now hold the engagement-level SALES_REP role.
    const roles = await getDb().execute({
      sql: `SELECT role FROM EngagementRole WHERE engagementId = ? AND userId = ?`,
      args: [body.data.id, f.repUserId],
    });
    expect(roles.rows).toHaveLength(1);
    expect((roles.rows[0] as unknown as { role: string }).role).toBe('SALES_REP');

    // Activity entry written.
    const log = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ?`,
      args: [body.data.id],
    });
    expect(log.rows).toHaveLength(1);
    expect((log.rows[0] as unknown as { action: string }).action).toBe('PROSPECT_CREATED');
  });

  it('rejects an unknown leadSource with 400', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/prospects',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { clientName: 'Acme Co', leadSource: 'TIKTOK' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('requires clientName', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/prospects',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { leadSource: 'WEBSITE' },
    });
    expect(r.statusCode).toBe(400);
  });
});

// ─── GET /sales/pipeline ────────────────────────────────────────────────────

describe('GET /sales/pipeline', () => {
  it('returns only PROSPECT/PROPOSED/CONTRACTED/WON/LOST engagements', async () => {
    const f = await seed();
    // Create one of each via direct SQL to stay isolated from POST tests.
    const db = getDb();
    const now = new Date().toISOString();
    for (const [id, status] of [
      [createId(), 'PROSPECT'],
      [createId(), 'PROPOSED'],
      [createId(), 'CONTRACTED'],
      [createId(), 'WON'],
      [createId(), 'LOST'],
      [createId(), 'BUILD'], // out of pipeline scope
    ] as const) {
      await db.execute({
        sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
        args: [id, f.firmId, `Co-${status}`, status, now, now],
      });
    }
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/pipeline',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<{ status: string; column: string }> };
    expect(body.data).toHaveLength(5);
    expect(new Set(body.data.map((d) => d.status))).toEqual(
      new Set(['PROSPECT', 'PROPOSED', 'CONTRACTED', 'WON', 'LOST']),
    );
    // Every row carries a derived column key.
    for (const d of body.data) {
      expect(d.column).toBeTruthy();
    }
  });

  it('SALES_MANAGER (firm-level) sees every prospect in the firm', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/prospects',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { clientName: 'Acme Co' },
    });
    expect(r.statusCode).toBe(201);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/pipeline',
      headers: { authorization: `Bearer ${f.managerToken}` },
    });
    const body = list.json() as { data: Array<{ clientName: string }> };
    expect(body.data.map((d) => d.clientName)).toContain('Acme Co');
  });

  it('SALES_REP sees only the deals they own', async () => {
    const f = await seed();
    // Two prospects: rep owns one, the other is unassigned.
    await app.inject({
      method: 'POST',
      url: '/api/v1/sales/prospects',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { clientName: 'Mine', salesRepUserId: f.repUserId },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/sales/prospects',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { clientName: 'Theirs' },
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/pipeline',
      headers: { authorization: `Bearer ${f.repToken}` },
    });
    const body = r.json() as { data: Array<{ clientName: string }> };
    expect(body.data.map((d) => d.clientName)).toEqual(['Mine']);
  });

  it('a user with no sales role gets 403', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/pipeline',
      headers: { authorization: `Bearer ${f.outsiderToken}` },
    });
    expect(r.statusCode).toBe(403);
    expect((r.json() as { error: { code: string } }).error.code).toBe('NOT_A_SALES_USER');
  });
});

// ─── PATCH /sales/prospects/:id/stage ───────────────────────────────────────

describe('PATCH /sales/prospects/:id/stage', () => {
  it('moves PROSPECT → PROPOSED', async () => {
    const f = await seed();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/prospects',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { clientName: 'Move Me' },
    });
    const id = (create.json() as { data: { id: string } }).data.id;
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/prospects/${id}/stage`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'PROPOSED' },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { data: { status: string } }).data.status).toBe('PROPOSED');
  });

  it('marks an engagement WON', async () => {
    const f = await seed();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/prospects',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { clientName: 'Big Win' },
    });
    const id = (create.json() as { data: { id: string } }).data.id;
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/prospects/${id}/stage`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'WON' },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { data: { status: string } }).data.status).toBe('WON');
  });

  it('rejects stages outside the sales funnel', async () => {
    const f = await seed();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/prospects',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { clientName: 'Not Allowed' },
    });
    const id = (create.json() as { data: { id: string } }).data.id;
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/prospects/${id}/stage`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'BUILD' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('refuses to touch an engagement that has already moved past CONTRACTED', async () => {
    const f = await seed();
    const id = createId();
    const now = new Date().toISOString();
    await getDb().execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
      args: [id, f.firmId, 'Already Building', 'BUILD', now, now],
    });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/prospects/${id}/stage`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'WON' },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('NOT_IN_SALES_FUNNEL');
  });
});
