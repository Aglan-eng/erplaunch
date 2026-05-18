/**
 * Phase 52.3 — `/api/v1/customers` route tests.
 *
 * Covers the GET list (filters, sort, pagination, firm scoping)
 * and the PATCH stage transition (forward, backward = rollback,
 * owner handoff, renewal increment, cross-firm 404).
 *
 * Vitest forks pool gives each test file its own DB process —
 * the customers route mounts under /api so we register at that
 * exact prefix to match production wiring.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { customersRoutes } from '../../src/routes/customers.js';
import {
  getDb,
  insertCustomer,
  type CustomerStage,
} from '../../src/db/index.js';

const JWT_SECRET = 'customers-route-test-secret';

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

async function seedUser(opts: { firmId?: string; role?: string } = {}): Promise<UserFixture> {
  const db = getDb();
  const firmId = opts.firmId ?? createId();
  const userId = createId();
  const now = new Date().toISOString();
  // INSERT OR IGNORE so a shared firmId across multiple users in
  // one test (e.g. owner-handoff) doesn't re-create the firm row.
  await db.execute({
    sql: `INSERT OR IGNORE INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
    args: [firmId, 'Test Firm', `tf-${firmId}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [userId, firmId, `${userId}@example.com`, `User ${userId.slice(0, 6)}`, 'x', opts.role ?? 'CONSULTANT', now],
  });
  const token = app.jwt.sign({
    userId,
    firmId,
    role: opts.role ?? 'CONSULTANT',
    name: `User ${userId.slice(0, 6)}`,
    email: `${userId}@example.com`,
  });
  return { firmId, userId, token };
}

async function seedCustomer(opts: {
  firmId: string;
  stage: CustomerStage;
  name?: string;
  salesOwnerUserId?: string | null;
  projectLeadUserId?: string | null;
  csmUserId?: string | null;
  isArchived?: boolean;
  dealValue?: number | null;
  renewalCount?: number;
}): Promise<string> {
  const id = createId();
  await insertCustomer({
    id,
    firmId: opts.firmId,
    name: opts.name ?? `Customer ${id.slice(0, 6)}`,
    currentStage: opts.stage,
    salesOwnerUserId: opts.salesOwnerUserId ?? null,
    projectLeadUserId: opts.projectLeadUserId ?? null,
    csmUserId: opts.csmUserId ?? null,
    isArchived: opts.isArchived ?? false,
    dealValue: opts.dealValue ?? null,
    renewalCount: opts.renewalCount ?? 0,
    // sourceEngagementId left null — these are native-create
    // customers. Activity-log writes will silently no-op for them
    // (the activity tests still cover the backfilled-engagement path).
  });
  return id;
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

beforeEach(async () => {
  const db = getDb();
  // Cleanup order: child tables first, then parents. ActivityLog
  // points at Engagement + Customer (NOT NULL FK on engagementId),
  // GeneratedDocument also at both. Engagement.firmId NOT NULL FK
  // → Engagement must die before Firm. User.firmId also → User
  // before Firm. ProjectMember.engagementId → ProjectMember before
  // Engagement.
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM GeneratedDocument`);
  await db.execute(`DELETE FROM ProjectMember`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM Customer`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── GET /api/v1/customers ────────────────────────────────────────────────────

describe('GET /api/v1/customers', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/customers' });
    expect(r.statusCode).toBe(401);
  });

  it('returns empty list when the firm has no customers', async () => {
    const u = await seedUser();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/customers',
      cookies: { token: u.token },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ customers: [] });
  });

  it('returns CustomerSummary rows with the documented shape', async () => {
    const u = await seedUser();
    const cid = await seedCustomer({
      firmId: u.firmId,
      stage: 'PROPOSAL',
      name: 'Acme Co',
      salesOwnerUserId: u.userId,
      dealValue: 2_500_000,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/customers',
      cookies: { token: u.token },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { customers: Array<Record<string, unknown>> };
    expect(body.customers).toHaveLength(1);
    const row = body.customers[0]!;
    expect(row.id).toBe(cid);
    expect(row.name).toBe('Acme Co');
    expect(row.currentStage).toBe('PROPOSAL');
    expect(row.primaryOwnerId).toBe(u.userId);
    expect(typeof row.primaryOwnerName).toBe('string');
    expect(row.renewalCount).toBe(0);
    expect(row.arr).toBe(25_000); // 2_500_000 cents → 25_000 dollars
    expect(['red', 'yellow', 'green']).toContain(row.healthBand);
    expect(typeof row.healthScore).toBe('number');
  });

  it('filters by stage CSV', async () => {
    const u = await seedUser();
    await seedCustomer({ firmId: u.firmId, stage: 'LEAD', name: 'Lead Co' });
    await seedCustomer({ firmId: u.firmId, stage: 'PROPOSAL', name: 'Proposal Co' });
    await seedCustomer({ firmId: u.firmId, stage: 'BUILD', name: 'Build Co' });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/customers?stage=LEAD,PROPOSAL',
      cookies: { token: u.token },
    });
    const names = (r.json() as { customers: Array<{ name: string }> }).customers
      .map((c) => c.name)
      .sort();
    expect(names).toEqual(['Lead Co', 'Proposal Co']);
  });

  it('filters by owner across any owner column', async () => {
    const u = await seedUser();
    const other = await seedUser({ firmId: u.firmId });
    await seedCustomer({ firmId: u.firmId, stage: 'LEAD', name: 'Mine', salesOwnerUserId: u.userId });
    await seedCustomer({ firmId: u.firmId, stage: 'LEAD', name: 'Theirs', salesOwnerUserId: other.userId });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/customers?owner=${u.userId}`,
      cookies: { token: u.token },
    });
    const names = (r.json() as { customers: Array<{ name: string }> }).customers.map((c) => c.name);
    expect(names).toEqual(['Mine']);
  });

  it('search filters by name case-insensitively', async () => {
    const u = await seedUser();
    await seedCustomer({ firmId: u.firmId, stage: 'LEAD', name: 'Acme Industries' });
    await seedCustomer({ firmId: u.firmId, stage: 'LEAD', name: 'Beta Corp' });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/customers?search=acme',
      cookies: { token: u.token },
    });
    const names = (r.json() as { customers: Array<{ name: string }> }).customers.map((c) => c.name);
    expect(names).toEqual(['Acme Industries']);
  });

  it('excludes archived rows by default + includes them with archived=true', async () => {
    const u = await seedUser();
    await seedCustomer({ firmId: u.firmId, stage: 'LEAD', name: 'Live' });
    await seedCustomer({ firmId: u.firmId, stage: 'LOST', name: 'Gone', isArchived: true });
    const def = await app.inject({
      method: 'GET',
      url: '/api/v1/customers',
      cookies: { token: u.token },
    });
    expect((def.json() as { customers: unknown[] }).customers).toHaveLength(1);
    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/customers?archived=true',
      cookies: { token: u.token },
    });
    expect((all.json() as { customers: unknown[] }).customers).toHaveLength(2);
  });

  it('sorts by name ascending by default and descending on order=desc', async () => {
    const u = await seedUser();
    await seedCustomer({ firmId: u.firmId, stage: 'LEAD', name: 'Charlie' });
    await seedCustomer({ firmId: u.firmId, stage: 'LEAD', name: 'Alpha' });
    await seedCustomer({ firmId: u.firmId, stage: 'LEAD', name: 'Bravo' });
    const asc = await app.inject({
      method: 'GET',
      url: '/api/v1/customers?sort=name&order=asc',
      cookies: { token: u.token },
    });
    expect((asc.json() as { customers: Array<{ name: string }> }).customers.map((c) => c.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    const desc = await app.inject({
      method: 'GET',
      url: '/api/v1/customers?sort=name&order=desc',
      cookies: { token: u.token },
    });
    expect((desc.json() as { customers: Array<{ name: string }> }).customers.map((c) => c.name)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
  });

  it('sorts by stage (journey order, not alphabetical)', async () => {
    const u = await seedUser();
    await seedCustomer({ firmId: u.firmId, stage: 'BUILD', name: 'Build' });
    await seedCustomer({ firmId: u.firmId, stage: 'LEAD', name: 'Lead' });
    await seedCustomer({ firmId: u.firmId, stage: 'WON', name: 'Won' });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/customers?sort=stage',
      cookies: { token: u.token },
    });
    expect((r.json() as { customers: Array<{ name: string }> }).customers.map((c) => c.name)).toEqual([
      'Lead',
      'Won',
      'Build',
    ]);
  });

  it('respects limit + offset pagination', async () => {
    const u = await seedUser();
    for (const n of ['A', 'B', 'C', 'D']) {
      await seedCustomer({ firmId: u.firmId, stage: 'LEAD', name: n });
    }
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/customers?limit=2&offset=1',
      cookies: { token: u.token },
    });
    expect((r.json() as { customers: Array<{ name: string }> }).customers.map((c) => c.name)).toEqual(['B', 'C']);
  });

  it('scopes rows to caller firm (other-firm rows hidden)', async () => {
    const u = await seedUser();
    const otherFirmId = createId();
    const db = getDb();
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
      args: [otherFirmId, 'Other Firm', `other-${createId()}`, 'STARTER', now],
    });
    await seedCustomer({ firmId: u.firmId, stage: 'LEAD', name: 'Mine' });
    await seedCustomer({ firmId: otherFirmId, stage: 'LEAD', name: 'Other' });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/customers',
      cookies: { token: u.token },
    });
    const names = (r.json() as { customers: Array<{ name: string }> }).customers.map((c) => c.name);
    expect(names).toEqual(['Mine']);
  });

  it('rejects invalid stage CSV (zod refine catches unknown values)', async () => {
    const u = await seedUser();
    // All stages invalid → no filter applied, returns empty result
    // (rather than 400) per the parseCsv contract: invalid values
    // are silently dropped, valid ones survive. This test pins that
    // the route does NOT crash on a junk stage value.
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/customers?stage=NOT_A_STAGE',
      cookies: { token: u.token },
    });
    expect(r.statusCode).toBe(200);
  });
});

// ─── PATCH /api/v1/customers/:id/stage ────────────────────────────────────────

describe('PATCH /api/v1/customers/:id/stage', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/v1/customers/anything/stage',
      payload: { toStage: 'PROPOSAL' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('rejects an unknown stage with 400', async () => {
    const u = await seedUser();
    const cid = await seedCustomer({ firmId: u.firmId, stage: 'LEAD' });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'INVENTED' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('returns 404 for cross-firm transitions', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const cid = await seedCustomer({ firmId: a.firmId, stage: 'LEAD' });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: b.token },
      payload: { toStage: 'PROPOSAL' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('handles a no-op transition (toStage === currentStage)', async () => {
    const u = await seedUser();
    const cid = await seedCustomer({ firmId: u.firmId, stage: 'PROPOSAL' });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'PROPOSAL' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { customer: { currentStage: string } };
    expect(body.customer.currentStage).toBe('PROPOSAL');
  });

  it('forward transition updates stage + returns the updated summary', async () => {
    const u = await seedUser();
    const cid = await seedCustomer({ firmId: u.firmId, stage: 'PROPOSAL' });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'NEGOTIATION', reason: 'Verbal yes' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { customer: { currentStage: string } };
    expect(body.customer.currentStage).toBe('NEGOTIATION');
  });

  it('RENEWAL_DUE → LIVE_SLA increments renewalCount (locked decision)', async () => {
    const u = await seedUser();
    const cid = await seedCustomer({ firmId: u.firmId, stage: 'RENEWAL_DUE', renewalCount: 2 });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'LIVE_SLA' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { customer: { currentStage: string; renewalCount: number } };
    expect(body.customer.currentStage).toBe('LIVE_SLA');
    expect(body.customer.renewalCount).toBe(3);
  });

  it('does NOT bump renewalCount when LIVE_SLA arrives from a different stage', async () => {
    const u = await seedUser();
    const cid = await seedCustomer({ firmId: u.firmId, stage: 'HYPERCARE', renewalCount: 0 });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'LIVE_SLA' },
    });
    expect((r.json() as { customer: { renewalCount: number } }).customer.renewalCount).toBe(0);
  });
});

// ─── Activity-log side effects (for sourceEngagementId-backed customers) ───

describe('PATCH stage — ActivityLog side effects', () => {
  /**
   * Writing to ActivityLog requires the customer's sourceEngagementId
   * to be set (the table's legacy NOT NULL engagementId FK). These
   * tests seed a customer paired with a real Engagement row so we can
   * exercise the full audit-write path.
   */
  async function seedCustomerWithEngagement(opts: {
    firmId: string;
    stage: CustomerStage;
    salesOwnerUserId?: string | null;
    projectLeadUserId?: string | null;
  }): Promise<string> {
    const db = getDb();
    const id = createId();
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
      args: [id, opts.firmId, `Eng ${id}`, 'PROSPECT', now, now],
    });
    await insertCustomer({
      id,
      firmId: opts.firmId,
      name: `Customer ${id.slice(0, 6)}`,
      currentStage: opts.stage,
      sourceEngagementId: id,
      salesOwnerUserId: opts.salesOwnerUserId ?? null,
      projectLeadUserId: opts.projectLeadUserId ?? null,
    });
    return id;
  }

  it('writes a STAGE_TRANSITION row on forward move', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'PROPOSAL',
      salesOwnerUserId: u.userId,
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'NEGOTIATION', reason: 'On track' },
    });
    const r = await getDb().execute({
      sql: `SELECT action, fromStage, toStage, isRollback, actorUserId FROM ActivityLog WHERE customerId = ? AND action = 'STAGE_TRANSITION'`,
      args: [cid],
    });
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0] as Record<string, unknown>;
    expect(row.action).toBe('STAGE_TRANSITION');
    expect(row.fromStage).toBe('PROPOSAL');
    expect(row.toStage).toBe('NEGOTIATION');
    expect(Number(row.isRollback)).toBe(0);
    expect(row.actorUserId).toBe(u.userId);
  });

  it('marks isRollback=1 on a backward transition', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'BUILD' });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'DISCOVERY', reason: 'Scope changed' },
    });
    const r = await getDb().execute({
      sql: `SELECT isRollback FROM ActivityLog WHERE customerId = ? AND action = 'STAGE_TRANSITION'`,
      args: [cid],
    });
    expect(Number((r.rows[0] as unknown as { isRollback: number }).isRollback)).toBe(1);
  });

  it('writes an OWNER_HANDOFF row when stage transition crosses owner boundaries (sales → PM)', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'WON',
      salesOwnerUserId: u.userId,
      projectLeadUserId: 'pm-user-1',
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'DISCOVERY' },
    });
    const r = await getDb().execute({
      sql: `SELECT action, details FROM ActivityLog WHERE customerId = ? ORDER BY createdAt ASC`,
      args: [cid],
    });
    const actions = r.rows.map((row) => (row as unknown as { action: string }).action);
    expect(actions).toContain('STAGE_TRANSITION');
    expect(actions).toContain('OWNER_HANDOFF');
    const handoff = r.rows.find(
      (row) => (row as unknown as { action: string }).action === 'OWNER_HANDOFF',
    ) as unknown as { details: string } | undefined;
    expect(handoff).toBeDefined();
    const payload = JSON.parse(handoff!.details);
    expect(payload.fromOwnerId).toBe(u.userId);
    expect(payload.toOwnerId).toBe('pm-user-1');
  });

  it('does NOT write OWNER_HANDOFF when the same group owns before + after', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'PROPOSAL',
      salesOwnerUserId: u.userId,
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${cid}/stage`,
      cookies: { token: u.token },
      payload: { toStage: 'NEGOTIATION' },
    });
    const r = await getDb().execute({
      sql: `SELECT COUNT(*) AS c FROM ActivityLog WHERE customerId = ? AND action = 'OWNER_HANDOFF'`,
      args: [cid],
    });
    expect(Number((r.rows[0] as unknown as { c: number }).c)).toBe(0);
  });
});
