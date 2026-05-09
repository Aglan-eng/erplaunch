/**
 * Phase 46.7 — integration tests for sales report routes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { salesReportsRoutes } from '../../src/routes/salesReports.js';
import { salesPipelineRoutes } from '../../src/routes/salesPipeline.js';
import {
  getDb,
  bootstrapFirmAdmin,
  grantFirmRole,
  upsertLossDetail,
} from '../../src/db/index.js';

const JWT_SECRET = 'sales-reports-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-sr-test',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(salesReportsRoutes, { prefix: '/api/v1' });
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
    args: [firmId, 'SR Firm', `sr-${createId()}`, 'STARTER', now],
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

async function seedEng(
  firmId: string,
  override: {
    status?: string;
    estimatedValue?: number;
    wonAt?: string;
    lostAt?: string;
    salesCycleDays?: number;
    salesRepUserId?: string;
    lossReason?: string;
  } = {},
): Promise<string> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, estimatedValue, wonAt, lostAt, salesCycleDays, salesRepUserId, lostReason, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      firmId,
      `Co-${createId().slice(0, 4)}`,
      override.status ?? 'PROSPECT',
      override.estimatedValue ?? null,
      override.wonAt ?? null,
      override.lostAt ?? null,
      override.salesCycleDays ?? null,
      override.salesRepUserId ?? null,
      override.lossReason ?? null,
      now,
      now,
    ],
  });
  return id;
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
  await db.execute(`DELETE FROM EngagementLossDetail`);
  await db.execute(`DELETE FROM RoleAuditLog`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM FirmRole`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── Funnel ─────────────────────────────────────────────────────────────────

describe('GET /sales/reports/funnel', () => {
  it('returns the 5-stage funnel with counts + values', async () => {
    const f = await seed();
    await seedEng(f.firmId, { status: 'PROSPECT', estimatedValue: 25_000 });
    await seedEng(f.firmId, { status: 'PROPOSED', estimatedValue: 50_000 });
    await seedEng(f.firmId, { status: 'BUILD', wonAt: '2026-03-01', estimatedValue: 100_000 });
    await seedEng(f.firmId, { status: 'LOST', lostAt: '2026-04-01', estimatedValue: 30_000 });

    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/reports/funnel',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      data: {
        stages: Array<{ stage: string; count: number; totalEstimatedValue: number }>;
        winRate: number;
      };
    };
    expect(body.data.stages.find((s) => s.stage === 'PROSPECT')?.count).toBe(1);
    expect(body.data.stages.find((s) => s.stage === 'WON')?.count).toBe(1);
    expect(body.data.stages.find((s) => s.stage === 'WON')?.totalEstimatedValue).toBe(100_000);
    expect(body.data.winRate).toBe(0.5);
  });

  it('403s a SALES_REP', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/reports/funnel',
      headers: { authorization: `Bearer ${f.repToken}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it('403s a no-role user', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/reports/funnel',
      headers: { authorization: `Bearer ${f.outsiderToken}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it('SALES_MANAGER is allowed', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/reports/funnel',
      headers: { authorization: `Bearer ${f.managerToken}` },
    });
    expect(r.statusCode).toBe(200);
  });
});

// ─── Leaderboard ────────────────────────────────────────────────────────────

describe('GET /sales/reports/leaderboard', () => {
  it('aggregates per sales rep with revenue + win rate', async () => {
    const f = await seed();
    await seedEng(f.firmId, {
      salesRepUserId: f.repUserId,
      wonAt: '2026-03-01',
      estimatedValue: 200_000,
      salesCycleDays: 60,
    });
    await seedEng(f.firmId, {
      salesRepUserId: f.repUserId,
      wonAt: '2026-04-01',
      estimatedValue: 100_000,
      salesCycleDays: 45,
    });
    await seedEng(f.firmId, {
      salesRepUserId: f.repUserId,
      lostAt: '2026-04-15',
      status: 'LOST',
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/reports/leaderboard',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const body = r.json() as { data: Array<{ salesRepUserId: string; revenueClosed: number; winRate: number }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].salesRepUserId).toBe(f.repUserId);
    expect(body.data[0].revenueClosed).toBe(300_000);
    expect(body.data[0].winRate).toBeCloseTo(2 / 3);
  });
});

// ─── Loss reasons ───────────────────────────────────────────────────────────

describe('GET /sales/reports/loss-reasons', () => {
  it('returns breakdown + recent losses joined to clientName', async () => {
    const f = await seed();
    const e1 = await seedEng(f.firmId, { status: 'LOST', lostAt: '2026-03-01', estimatedValue: 50_000 });
    const e2 = await seedEng(f.firmId, { status: 'LOST', lostAt: '2026-03-15', estimatedValue: 75_000 });
    await upsertLossDetail({ engagementId: e1, lossReason: 'PRICE', notes: 'too expensive' });
    await upsertLossDetail({ engagementId: e2, lossReason: 'PRICE' });

    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/reports/loss-reasons',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      data: {
        breakdown: { total: number; byReason: Record<string, { count: number; totalEstimatedValue: number }> };
        recentLosses: Array<{ lossReason: string; clientName: string; estimatedValue: number | null }>;
      };
    };
    expect(body.data.breakdown.total).toBe(2);
    expect(body.data.breakdown.byReason['PRICE'].count).toBe(2);
    expect(body.data.breakdown.byReason['PRICE'].totalEstimatedValue).toBe(125_000);
    expect(body.data.recentLosses[0].clientName).toBeTruthy();
  });
});

// ─── Time-to-close ──────────────────────────────────────────────────────────

describe('GET /sales/reports/time-to-close', () => {
  it('returns median + p90 + histogram', async () => {
    const f = await seed();
    for (const d of [15, 35, 70, 120]) {
      await seedEng(f.firmId, { wonAt: '2026-03-01', salesCycleDays: d, status: 'BUILD' });
    }
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/reports/time-to-close',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      data: {
        median: number;
        p90: number;
        histogram: Array<{ bucket: string; count: number }>;
      };
    };
    expect(body.data.median).toBeGreaterThan(0);
    expect(body.data.p90).toBeGreaterThanOrEqual(body.data.median);
    const counts = Object.fromEntries(body.data.histogram.map((b) => [b.bucket, b.count]));
    expect(counts['0-30d']).toBe(1);
    expect(counts['31-60d']).toBe(1);
    expect(counts['61-90d']).toBe(1);
    expect(counts['91-180d']).toBe(1);
  });
});

// ─── Phase 46.8.7 — Export PDF ─────────────────────────────────────────────

describe('POST /sales/reports/export-pdf', () => {
  it('streams a PDF with PDF magic bytes', async () => {
    const f = await seed();
    await seedEng(f.firmId, { wonAt: '2026-03-01', estimatedValue: 100_000, salesCycleDays: 60 });
    await seedEng(f.firmId, { status: 'LOST', lostAt: '2026-04-01' });
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/reports/export-pdf',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    const cd = r.headers['content-disposition'] as string;
    expect(cd).toContain('attachment');
    expect(cd).toContain('Sales_Performance_');
    const body = r.rawPayload;
    expect(body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(2000);
  });

  it('still produces a valid PDF for an empty firm', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/reports/export-pdf',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('403s a SALES_REP', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/reports/export-pdf',
      headers: { authorization: `Bearer ${f.repToken}` },
    });
    expect(r.statusCode).toBe(403);
  });
});

// ─── Loss-detail capture (PATCH /sales/prospects/:id/loss-detail) ──────────

describe('PATCH /sales/prospects/:id/loss-detail', () => {
  it('persists the loss reason + competitor + notes', async () => {
    const f = await seed();
    const id = await seedEng(f.firmId, { status: 'LOST', lostAt: '2026-04-01' });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/prospects/${id}/loss-detail`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { lossReason: 'LOST_TO_COMPETITOR', competitorName: 'BigCorp ERP' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      data: { lossReason: string; competitorName: string };
    };
    expect(body.data.lossReason).toBe('LOST_TO_COMPETITOR');
    expect(body.data.competitorName).toBe('BigCorp ERP');
  });

  it('rejects an unknown loss reason', async () => {
    const f = await seed();
    const id = await seedEng(f.firmId, { status: 'LOST' });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/prospects/${id}/loss-detail`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { lossReason: 'WEATHER' },
    });
    expect(r.statusCode).toBe(400);
  });
});

// ─── Stage transition stamps lostAt + emits PROSPECT_LOST ──────────────────

describe('Stage → LOST stamps lostAt + emits PROSPECT_LOST', () => {
  it('sets lostAt + writes PROSPECT_LOST activity', async () => {
    const f = await seed();
    const id = await seedEng(f.firmId, { status: 'CONTRACTED' });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/prospects/${id}/stage`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'LOST' },
    });
    expect(r.statusCode).toBe(200);
    const row = await getDb().execute({
      sql: `SELECT lostAt FROM Engagement WHERE id = ?`,
      args: [id],
    });
    expect((row.rows[0] as unknown as { lostAt: string }).lostAt).toBeTruthy();
    const log = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ?`,
      args: [id],
    });
    const actions = log.rows.map((r2) => (r2 as unknown as { action: string }).action);
    expect(actions).toContain('PROSPECT_LOST');
  });
});
