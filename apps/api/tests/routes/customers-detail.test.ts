/**
 * Phase 52.4 — `/api/v1/customers/:id*` route tests.
 *
 * Covers:
 *   GET   /:id           — full detail shape incl. healthBreakdown
 *                          components, owner refs, stage history.
 *                          404 on cross-firm.
 *   GET   /:id/activity  — pagination, type-filter, firm scope.
 *   PATCH /:id           — updates every editable field, blocks
 *                          cross-firm owner assignment, writes a
 *                          CUSTOMER_EDITED activity row.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { customersRoutes } from '../../src/routes/customers.js';
import { getDb, insertCustomer } from '../../src/db/index.js';
import { ensureCustomerDetailColumns } from '../../src/db/customerDetail.js';

const JWT_SECRET = 'customers-detail-test-secret';

let cleanup: () => void;
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });
  await f.register(customersRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface UserFixture {
  firmId: string;
  userId: string;
  token: string;
}

async function seedUser(opts: { firmId?: string; name?: string } = {}): Promise<UserFixture> {
  const db = getDb();
  const firmId = opts.firmId ?? createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT OR IGNORE INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
    args: [firmId, 'Test Firm', `tf-${firmId}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      userId,
      firmId,
      `${userId}@example.com`,
      opts.name ?? `User ${userId.slice(0, 6)}`,
      'x',
      'CONSULTANT',
      now,
    ],
  });
  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'CONSULTANT',
    name: opts.name ?? `User ${userId.slice(0, 6)}`,
    email: `${userId}@example.com`,
  });
  return { firmId, userId, token };
}

async function seedCustomerWithEngagement(opts: {
  firmId: string;
  stage?: string;
  name?: string;
  salesOwnerUserId?: string | null;
  projectLeadUserId?: string | null;
}): Promise<string> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [id, opts.firmId, opts.name ?? `Customer ${id.slice(0, 6)}`, 'PROSPECT', now, now],
  });
  await insertCustomer({
    id,
    firmId: opts.firmId,
    name: opts.name ?? `Customer ${id.slice(0, 6)}`,
    currentStage: (opts.stage ?? 'PROPOSAL') as
      | 'PROPOSAL'
      | 'BUILD'
      | 'LEAD'
      | 'LIVE_SLA',
    sourceEngagementId: id,
    salesOwnerUserId: opts.salesOwnerUserId ?? null,
    projectLeadUserId: opts.projectLeadUserId ?? null,
  });
  return id;
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildApp();
  // Add the Phase 52.4 contact columns up-front so the tests can
  // exercise the PATCH path without each one triggering an ALTER.
  await ensureCustomerDetailColumns();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM GeneratedDocument`);
  await db.execute(`DELETE FROM ProjectMember`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM Customer`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── GET /api/v1/customers/:id ─────────────────────────────────────────────

describe('GET /api/v1/customers/:id', () => {
  it('returns the full detail shape', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'PROPOSAL',
      name: 'Acme',
      salesOwnerUserId: u.userId,
    });

    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${cid}`,
      cookies: { token: u.token },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { customer: Record<string, unknown> };
    const c = body.customer;
    expect(c.id).toBe(cid);
    expect(c.name).toBe('Acme');
    expect(c.currentStage).toBe('PROPOSAL');
    // CustomerSummary fields
    expect(typeof c.healthScore).toBe('number');
    expect(['red', 'yellow', 'green']).toContain(c.healthBand);
    // CustomerDetail extras
    expect(c).toHaveProperty('customerAddress');
    expect(c).toHaveProperty('primaryContactName');
    expect(c).toHaveProperty('healthBreakdown');
    expect(c).toHaveProperty('stageHistory');
    // Owner refs
    expect((c.salesOwner as { id: string } | null)?.id).toBe(u.userId);
    expect(c.projectLeadOwner).toBeNull();
    expect(c.csmOwner).toBeNull();
    expect(c.arOwner).toBeNull();
  });

  it('healthBreakdown components reconcile to the headline score', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({ firmId: u.firmId });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${cid}`,
      cookies: { token: u.token },
    });
    const b = (r.json() as { customer: { healthBreakdown: Record<string, number> } }).customer
      .healthBreakdown as unknown as {
      score: number;
      questionnaireCompletion: number;
      blockersComponent: number;
      overdueComponent: number;
      pendingDecisionsComponent: number;
    };
    const sum =
      b.questionnaireCompletion +
      b.blockersComponent +
      b.overdueComponent +
      b.pendingDecisionsComponent;
    // The 4 sub-components are each rounded to 1 decimal, then the
    // headline score is the round of their floating-point sum — so
    // |Σ − score| ≤ 1 covers the legal drift.
    expect(Math.abs(sum - b.score)).toBeLessThanOrEqual(1);
  });

  it('returns 404 on cross-firm read (no existence leak)', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const cid = await seedCustomerWithEngagement({ firmId: a.firmId });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${cid}`,
      cookies: { token: b.token },
    });
    expect(r.statusCode).toBe(404);
  });

  it('returns 401 unauthenticated', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/customers/anything' });
    expect(r.statusCode).toBe(401);
  });

  it('returns stage history rows when transitions have happened', async () => {
    const u = await seedUser({ name: 'Hesham' });
    const cid = await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'PROPOSAL',
      salesOwnerUserId: u.userId,
    });
    // Drive a stage transition through the existing PATCH endpoint
    // so the audit row is written via the canonical path.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'NEGOTIATION', reason: 'Verbal yes' },
    });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${cid}`,
      cookies: { token: u.token },
    });
    const history = (
      r.json() as { customer: { stageHistory: Array<Record<string, unknown>> } }
    ).customer.stageHistory;
    expect(history.length).toBeGreaterThanOrEqual(1);
    const last = history[history.length - 1]!;
    expect(last.fromStage).toBe('PROPOSAL');
    expect(last.toStage).toBe('NEGOTIATION');
    expect(last.actorName).toBe('Hesham');
    expect(last.reason).toBe('Verbal yes');
    expect(last.isRollback).toBe(false);
  });
});

// ─── GET /api/v1/customers/:id/activity ────────────────────────────────────

describe('GET /api/v1/customers/:id/activity', () => {
  it('returns activity rows sorted desc by createdAt', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'PROPOSAL' });
    // Drive two stage transitions so we have a couple of rows.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'NEGOTIATION' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'WON' },
    });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${cid}/activity`,
      cookies: { token: u.token },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      activities: Array<{ action: string; createdAt: string; toStage: string | null; summary: string }>;
    };
    expect(body.activities.length).toBeGreaterThanOrEqual(2);
    // Desc-sorted: row 0 is the latest.
    const stageRows = body.activities.filter((a) => a.action === 'STAGE_TRANSITION');
    expect(stageRows[0]!.toStage).toBe('WON');
    expect(stageRows[1]!.toStage).toBe('NEGOTIATION');
    // Every row carries a human-readable summary.
    for (const row of body.activities) {
      expect(typeof row.summary).toBe('string');
      expect(row.summary.length).toBeGreaterThan(0);
    }
  });

  it('filters by action type via ?types=', async () => {
    const u = await seedUser();
    const pm = await seedUser({ firmId: u.firmId });
    // Both sales + PM owners populated so the Phase 52.3.1
    // strengthened `effectiveOwnerUserId` resolves to DIFFERENT
    // users on WON (sales = u) vs DISCOVERY (projectLead = pm),
    // triggering an OWNER_HANDOFF row on the transition.
    const cid = await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'WON',
      salesOwnerUserId: u.userId,
      projectLeadUserId: pm.userId,
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'DISCOVERY' },
    });
    const both = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${cid}/activity`,
      cookies: { token: u.token },
    });
    const allActions = (both.json() as { activities: Array<{ action: string }> }).activities.map(
      (a) => a.action,
    );
    expect(allActions).toContain('STAGE_TRANSITION');
    expect(allActions).toContain('OWNER_HANDOFF');

    const filtered = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${cid}/activity?types=OWNER_HANDOFF`,
      cookies: { token: u.token },
    });
    const filteredActions = (
      filtered.json() as { activities: Array<{ action: string }> }
    ).activities.map((a) => a.action);
    expect(filteredActions.every((a) => a === 'OWNER_HANDOFF')).toBe(true);
  });

  it('respects limit + offset', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'LEAD' });
    // Drive 4 stage transitions to give us enough rows to page through.
    const stages = ['QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON'] as const;
    for (const s of stages) {
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/customers/${cid}/stage`,
        cookies: { token: u.token },
        payload: { toStage: s },
      });
    }
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${cid}/activity?limit=2&offset=1`,
      cookies: { token: u.token },
    });
    const body = r.json() as { activities: unknown[]; limit: number; offset: number };
    expect(body.activities).toHaveLength(2);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
  });

  it('404 on cross-firm', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const cid = await seedCustomerWithEngagement({ firmId: a.firmId });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${cid}/activity`,
      cookies: { token: b.token },
    });
    expect(r.statusCode).toBe(404);
  });
});

// ─── PATCH /api/v1/customers/:id ───────────────────────────────────────────

describe('PATCH /api/v1/customers/:id', () => {
  it('updates contact + address fields and returns the new detail', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({ firmId: u.firmId, name: 'Old Name' });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}`,
      cookies: { token: u.token },
      payload: {
        customerName: 'New Name',
        customerAddress: '12 Industry Way, Dubai',
        primaryContactName: 'Lina Said',
        primaryContactEmail: 'lina@example.com',
        primaryContactPhone: '+971-50-1234567',
        arr: 25000,
      },
    });
    expect(r.statusCode).toBe(200);
    const c = (r.json() as { customer: Record<string, unknown> }).customer;
    expect(c.name).toBe('New Name');
    expect(c.customerAddress).toBe('12 Industry Way, Dubai');
    expect(c.primaryContactName).toBe('Lina Said');
    expect(c.primaryContactEmail).toBe('lina@example.com');
    expect(c.primaryContactPhone).toBe('+971-50-1234567');
    expect(c.arr).toBe(25_000);
  });

  it('blocks cross-firm owner assignment with 400', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const cid = await seedCustomerWithEngagement({ firmId: a.firmId });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}`,
      cookies: { token: a.token },
      // b.userId belongs to a different firm — must be rejected.
      payload: { salesOwnerUserId: b.userId },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('CROSS_FIRM_OWNER');
  });

  it('accepts same-firm owner assignment to each of the four columns', async () => {
    const u = await seedUser();
    const sales = await seedUser({ firmId: u.firmId });
    const pm = await seedUser({ firmId: u.firmId });
    const csm = await seedUser({ firmId: u.firmId });
    const ar = await seedUser({ firmId: u.firmId });
    const cid = await seedCustomerWithEngagement({ firmId: u.firmId });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}`,
      cookies: { token: u.token },
      payload: {
        salesOwnerUserId: sales.userId,
        projectLeadUserId: pm.userId,
        csmUserId: csm.userId,
        arOwnerUserId: ar.userId,
      },
    });
    expect(r.statusCode).toBe(200);
    const c = (r.json() as { customer: { salesOwner: { id: string } | null; projectLeadOwner: { id: string } | null; csmOwner: { id: string } | null; arOwner: { id: string } | null } }).customer;
    expect(c.salesOwner?.id).toBe(sales.userId);
    expect(c.projectLeadOwner?.id).toBe(pm.userId);
    expect(c.csmOwner?.id).toBe(csm.userId);
    expect(c.arOwner?.id).toBe(ar.userId);
  });

  it('writes a CUSTOMER_EDITED activity row capturing what changed', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({ firmId: u.firmId, name: 'Before' });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}`,
      cookies: { token: u.token },
      payload: { customerName: 'After', primaryContactEmail: 'updated@example.com' },
    });
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT details, actorUserId FROM ActivityLog WHERE customerId = ? AND action = 'CUSTOMER_EDITED'`,
      args: [cid],
    });
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0] as unknown as { details: string; actorUserId: string };
    expect(row.actorUserId).toBe(u.userId);
    const parsed = JSON.parse(row.details) as { changes: Record<string, unknown> };
    expect(parsed.changes).toHaveProperty('name');
    expect(parsed.changes).toHaveProperty('primaryContactEmail');
  });

  it('rejects invalid email shape with 400', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({ firmId: u.firmId });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}`,
      cookies: { token: u.token },
      payload: { primaryContactEmail: 'not-an-email' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('404 on cross-firm PATCH', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const cid = await seedCustomerWithEngagement({ firmId: a.firmId });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}`,
      cookies: { token: b.token },
      payload: { customerName: 'Hijacked' },
    });
    expect(r.statusCode).toBe(404);
  });
});
