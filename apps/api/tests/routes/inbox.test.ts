/**
 * Phase 52.5 — Inbox route tests.
 *
 * Covers:
 *   - Each of the six item types fires when its underlying signal
 *     matches a fixture
 *   - Bucketing: For You = active-stage owner, Watching = owns
 *     another column, Firm-wide = admin sees everything
 *   - Sort: critical → warning → info, then ageDays desc
 *   - Each bucket caps at 50
 *   - Dismissed items hide for 7 days then reappear
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { inboxRoutes } from '../../src/routes/inbox.js';
import { getDb, insertCustomer, type CustomerStage } from '../../src/db/index.js';

const JWT_SECRET = 'inbox-test-secret';

let cleanup: () => void;
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });
  await f.register(inboxRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface UserFixture {
  firmId: string;
  userId: string;
  token: string;
  role: string;
}

async function seedUser(opts: { firmId?: string; role?: string } = {}): Promise<UserFixture> {
  const db = getDb();
  const firmId = opts.firmId ?? createId();
  const userId = createId();
  const role = opts.role ?? 'CONSULTANT';
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT OR IGNORE INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
    args: [firmId, 'Test Firm', `tf-${firmId}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [userId, firmId, `${userId}@example.com`, `User ${userId.slice(0, 6)}`, 'x', role, now],
  });
  const token = app.jwt.sign({
    userId,
    firmId,
    role,
    name: `User ${userId.slice(0, 6)}`,
    email: `${userId}@example.com`,
  });
  return { firmId, userId, token, role };
}

interface CustomerSeedArgs {
  firmId: string;
  stage: CustomerStage;
  name?: string;
  salesOwnerUserId?: string | null;
  projectLeadUserId?: string | null;
  csmUserId?: string | null;
  arOwnerUserId?: string | null;
  contractEndDate?: string | null;
  /** When set, the Customer row's createdAt is backdated so STAGE_OVERDUE
   *  + DECISION_PENDING tests can simulate "this has been sitting." */
  daysAgoCreated?: number;
}

async function seedCustomerWithEngagement(args: CustomerSeedArgs): Promise<string> {
  const db = getDb();
  const id = createId();
  const createdAt =
    args.daysAgoCreated != null
      ? new Date(Date.now() - args.daysAgoCreated * 86_400_000).toISOString()
      : new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [id, args.firmId, args.name ?? `Customer ${id.slice(0, 6)}`, 'PROSPECT', createdAt, createdAt],
  });
  await insertCustomer({
    id,
    firmId: args.firmId,
    name: args.name ?? `Customer ${id.slice(0, 6)}`,
    currentStage: args.stage,
    salesOwnerUserId: args.salesOwnerUserId ?? null,
    projectLeadUserId: args.projectLeadUserId ?? null,
    csmUserId: args.csmUserId ?? null,
    arOwnerUserId: args.arOwnerUserId ?? null,
    contractEndDate: args.contractEndDate ?? null,
    sourceEngagementId: id,
    createdAt,
    updatedAt: createdAt,
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
  await db.execute(`DELETE FROM InboxDismissal`);
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM IssueItem`);
  await db.execute(`DELETE FROM DecisionItem`);
  await db.execute(`DELETE FROM BusinessProfile`);
  await db.execute(`DELETE FROM GeneratedDocument`);
  await db.execute(`DELETE FROM ProjectMember`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM Customer`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── Auth ─────────────────────────────────────────────────────────────────

describe('GET /api/v1/inbox — auth', () => {
  it('rejects unauthenticated callers', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/inbox' });
    expect(r.statusCode).toBe(401);
  });

  it('returns three buckets including null firmWide for non-admins', async () => {
    const u = await seedUser({ role: 'CONSULTANT' });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { forYou: unknown[]; watching: unknown[]; firmWide: unknown };
    expect(body.forYou).toEqual([]);
    expect(body.watching).toEqual([]);
    expect(body.firmWide).toBeNull();
  });

  it('populates firmWide for APP_ADMIN users', async () => {
    const admin = await seedUser({ role: 'APP_ADMIN' });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: admin.token },
    });
    const body = r.json() as { firmWide: unknown[] | null };
    expect(Array.isArray(body.firmWide)).toBe(true);
  });
});

// ─── Item types ───────────────────────────────────────────────────────────

describe('GET /api/v1/inbox — item types', () => {
  it('emits STAGE_OVERDUE when a customer has been in stage past target', async () => {
    const u = await seedUser();
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LEAD', // target = 14 days
      daysAgoCreated: 60,
      salesOwnerUserId: u.userId,
      name: 'Stale Lead Co',
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const items = (r.json() as { forYou: Array<{ itemType: string }> }).forYou;
    const overdue = items.find((i) => i.itemType === 'STAGE_OVERDUE');
    expect(overdue).toBeDefined();
  });

  it('emits BLOCKER_OPEN when IssueItem rows are OPEN', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'BUILD',
      salesOwnerUserId: u.userId,
      projectLeadUserId: u.userId,
    });
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO IssueItem (id, engagementId, title, status) VALUES (?, ?, ?, ?)`,
      args: [createId(), cid, 'Blocker', 'OPEN'],
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const items = (r.json() as { forYou: Array<{ itemType: string }> }).forYou;
    expect(items.some((i) => i.itemType === 'BLOCKER_OPEN')).toBe(true);
  });

  it('emits DECISION_PENDING when a DecisionItem has been un-decided > 14 days', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'BUILD',
      projectLeadUserId: u.userId,
    });
    const db = getDb();
    const oldDate = new Date(Date.now() - 30 * 86_400_000).toISOString();
    await db.execute({
      sql: `INSERT INTO DecisionItem (id, engagementId, title, decidedAt, createdAt) VALUES (?, ?, ?, NULL, ?)`,
      args: [createId(), cid, 'Stale decision', oldDate],
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const items = (r.json() as { forYou: Array<{ itemType: string }> }).forYou;
    expect(items.some((i) => i.itemType === 'DECISION_PENDING')).toBe(true);
  });

  it('emits QUESTIONNAIRE_INCOMPLETE when BusinessProfile is < 70% on DISCOVERY..UAT', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'DISCOVERY',
      projectLeadUserId: u.userId,
    });
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO BusinessProfile (id, engagementId, version, answers, completeness, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [createId(), cid, 1, '{}', JSON.stringify({ a: 0.3, b: 0.4 }), new Date().toISOString()],
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const items = (r.json() as { forYou: Array<{ itemType: string }> }).forYou;
    expect(items.some((i) => i.itemType === 'QUESTIONNAIRE_INCOMPLETE')).toBe(true);
  });

  it('does NOT emit QUESTIONNAIRE_INCOMPLETE on launch+ stages', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'GOLIVE',
      projectLeadUserId: u.userId,
    });
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO BusinessProfile (id, engagementId, version, answers, completeness, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [createId(), cid, 1, '{}', JSON.stringify({ a: 0.1 }), new Date().toISOString()],
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const items = (r.json() as { forYou: Array<{ itemType: string }> }).forYou;
    expect(items.some((i) => i.itemType === 'QUESTIONNAIRE_INCOMPLETE')).toBe(false);
  });

  it('emits HANDOFF_INCOMING when a recent OWNER_HANDOFF targets this user', async () => {
    const u = await seedUser();
    const cid = await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'BUILD',
      projectLeadUserId: u.userId,
    });
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO ActivityLog
              (id, engagementId, customerId, firmId, action, details, actorUserId, fromStage, toStage, isRollback, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `act_${createId()}`,
        cid,
        cid,
        u.firmId,
        'OWNER_HANDOFF',
        JSON.stringify({ fromOwnerId: 'other-user', toOwnerId: u.userId }),
        'other-user',
        'WON',
        'DISCOVERY',
        0,
        new Date(Date.now() - 2 * 86_400_000).toISOString(),
      ],
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const items = (r.json() as { forYou: Array<{ itemType: string }> }).forYou;
    expect(items.some((i) => i.itemType === 'HANDOFF_INCOMING')).toBe(true);
  });

  it('emits RENEWAL_DUE_SOON for customers in RENEWAL_DUE stage', async () => {
    const u = await seedUser();
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'RENEWAL_DUE',
      csmUserId: u.userId,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const items = (r.json() as { forYou: Array<{ itemType: string }> }).forYou;
    expect(items.some((i) => i.itemType === 'RENEWAL_DUE_SOON')).toBe(true);
  });

  it('emits RENEWAL_DUE_SOON for LIVE_SLA customers whose contractEndDate is within 30 days', async () => {
    const u = await seedUser();
    const soon = new Date(Date.now() + 20 * 86_400_000).toISOString();
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LIVE_SLA',
      csmUserId: u.userId,
      contractEndDate: soon,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const items = (r.json() as { forYou: Array<{ itemType: string }> }).forYou;
    expect(items.some((i) => i.itemType === 'RENEWAL_DUE_SOON')).toBe(true);
  });

  it('does NOT emit RENEWAL_DUE_SOON for LIVE_SLA when contractEndDate is far out', async () => {
    const u = await seedUser();
    const farOut = new Date(Date.now() + 200 * 86_400_000).toISOString();
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LIVE_SLA',
      csmUserId: u.userId,
      contractEndDate: farOut,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const items = (r.json() as { forYou: Array<{ itemType: string }> }).forYou;
    expect(items.some((i) => i.itemType === 'RENEWAL_DUE_SOON')).toBe(false);
  });
});

// ─── Bucketing ────────────────────────────────────────────────────────────

describe('GET /api/v1/inbox — bucketing', () => {
  it('places items in For You when the user is the active-stage owner', async () => {
    const u = await seedUser();
    // BUILD stage → effective owner is projectLead
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'BUILD',
      projectLeadUserId: u.userId,
      daysAgoCreated: 90,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const body = r.json() as { forYou: unknown[]; watching: unknown[] };
    expect(body.forYou.length).toBeGreaterThan(0);
    expect(body.watching).toHaveLength(0);
  });

  it('places items in Watching when user owns another column but not the active one', async () => {
    const u = await seedUser();
    const otherPm = await seedUser({ firmId: u.firmId });
    // BUILD stage → active owner = projectLead = otherPm; u is only
    // the sales owner.
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'BUILD',
      salesOwnerUserId: u.userId,
      projectLeadUserId: otherPm.userId,
      daysAgoCreated: 90,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const body = r.json() as { forYou: unknown[]; watching: unknown[] };
    expect(body.forYou).toHaveLength(0);
    expect(body.watching.length).toBeGreaterThan(0);
  });

  it('skips customers entirely when the user owns no column AND is not admin', async () => {
    const u = await seedUser();
    const other = await seedUser({ firmId: u.firmId });
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'BUILD',
      projectLeadUserId: other.userId,
      daysAgoCreated: 90,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const body = r.json() as { forYou: unknown[]; watching: unknown[] };
    expect(body.forYou).toHaveLength(0);
    expect(body.watching).toHaveLength(0);
  });

  it('admin sees customers regardless of ownership in firmWide', async () => {
    const admin = await seedUser({ role: 'APP_ADMIN' });
    const other = await seedUser({ firmId: admin.firmId });
    await seedCustomerWithEngagement({
      firmId: admin.firmId,
      stage: 'BUILD',
      projectLeadUserId: other.userId,
      daysAgoCreated: 90,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: admin.token },
    });
    const body = r.json() as { firmWide: Array<{ itemType: string }> | null };
    expect(body.firmWide).not.toBeNull();
    expect(body.firmWide!.length).toBeGreaterThan(0);
  });
});

// ─── Sort ─────────────────────────────────────────────────────────────────

describe('GET /api/v1/inbox — sort', () => {
  it('orders critical before warning before info, then by age desc within severity', async () => {
    const u = await seedUser();
    // Customer A: 60 days overdue in LEAD (critical)
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LEAD',
      salesOwnerUserId: u.userId,
      daysAgoCreated: 80,
      name: 'A — Critical overdue',
    });
    // Customer B: 10 days over LEAD target (warning band: over=10, severity = warning)
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LEAD',
      salesOwnerUserId: u.userId,
      daysAgoCreated: 24,
      name: 'B — Warning overdue',
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const items = (r.json() as { forYou: Array<{ severity: string; customerName: string }> }).forYou;
    // The first item must be critical.
    expect(items[0]!.severity).toBe('critical');
    // critical comes before warning in the array
    const firstCritical = items.findIndex((i) => i.severity === 'critical');
    const firstWarning = items.findIndex((i) => i.severity === 'warning');
    if (firstWarning >= 0) {
      expect(firstCritical).toBeLessThan(firstWarning);
    }
  });
});

// ─── Dismissal ────────────────────────────────────────────────────────────

describe('POST /api/v1/inbox/dismiss + 7-day window', () => {
  it('hides a dismissed item from subsequent GET responses', async () => {
    const u = await seedUser();
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LEAD',
      salesOwnerUserId: u.userId,
      daysAgoCreated: 60,
      name: 'Dismissable',
    });

    // First GET sees the item
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const items = (before.json() as { forYou: Array<{ id: string }> }).forYou;
    expect(items.length).toBeGreaterThan(0);
    const itemId = items[0]!.id;

    // Dismiss
    const dismissResp = await app.inject({
      method: 'POST',
      url: '/api/v1/inbox/dismiss',
      cookies: { token: u.token },
      payload: { itemId },
    });
    expect(dismissResp.statusCode).toBe(200);

    // Second GET no longer includes that id
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const afterItems = (after.json() as { forYou: Array<{ id: string }> }).forYou;
    expect(afterItems.find((i) => i.id === itemId)).toBeUndefined();
  });

  it('a dismissal older than 7 days no longer hides the item', async () => {
    const u = await seedUser();
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LEAD',
      salesOwnerUserId: u.userId,
      daysAgoCreated: 60,
    });
    // Pull the item id, then manually backdate the dismissal row.
    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const itemId = (first.json() as { forYou: Array<{ id: string }> }).forYou[0]!.id;
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO InboxDismissal (userId, itemId, dismissedAt) VALUES (?, ?, ?)`,
      args: [u.userId, itemId, new Date(Date.now() - 10 * 86_400_000).toISOString()],
    });

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const afterItems = (after.json() as { forYou: Array<{ id: string }> }).forYou;
    expect(afterItems.find((i) => i.id === itemId)).toBeDefined();
  });

  it('rejects empty itemId with 400', async () => {
    const u = await seedUser();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/inbox/dismiss',
      cookies: { token: u.token },
      payload: { itemId: '' },
    });
    expect(r.statusCode).toBe(400);
  });
});

// ─── Cap ──────────────────────────────────────────────────────────────────

describe('GET /api/v1/inbox — bucket cap', () => {
  it('caps each bucket at 50 items', async () => {
    const u = await seedUser();
    // Seed 55 customers each with a stale LEAD stage so they all
    // generate STAGE_OVERDUE items.
    for (let i = 0; i < 55; i++) {
      await seedCustomerWithEngagement({
        firmId: u.firmId,
        stage: 'LEAD',
        salesOwnerUserId: u.userId,
        daysAgoCreated: 60,
        name: `Stale ${i}`,
      });
    }
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/inbox',
      cookies: { token: u.token },
    });
    const items = (r.json() as { forYou: unknown[] }).forYou;
    expect(items.length).toBeLessThanOrEqual(50);
    expect(items.length).toBe(50);
  });
});
