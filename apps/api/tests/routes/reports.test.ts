/**
 * Phase 52.6 — Reports route tests.
 *
 * One describe block per dashboard. Each covers:
 *   - 200 happy-path with the documented shape
 *   - firm scoping (cross-firm rows hidden)
 *   - The marquee assertion for that dashboard (conversion math,
 *     slip detection, red-list ordering, monthly grouping,
 *     overload threshold).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { reportsRoutes } from '../../src/routes/reports.js';
import { getDb, insertCustomer, type CustomerStage } from '../../src/db/index.js';

const JWT_SECRET = 'reports-test-secret';

let cleanup: () => void;
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });
  await f.register(reportsRoutes, { prefix: '/api/v1' });
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
    args: [userId, firmId, `${userId}@example.com`, opts.name ?? `User ${userId.slice(0, 6)}`, 'x', 'CONSULTANT', now],
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

interface SeedCustomerArgs {
  firmId: string;
  stage: CustomerStage;
  name?: string;
  daysAgoCreated?: number;
  salesOwnerUserId?: string | null;
  projectLeadUserId?: string | null;
  csmUserId?: string | null;
  arOwnerUserId?: string | null;
  dealValue?: number | null;
  contractEndDate?: string | null;
  health?: number | null;
}

async function seedCustomerWithEngagement(args: SeedCustomerArgs): Promise<string> {
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
    dealValue: args.dealValue ?? null,
    contractEndDate: args.contractEndDate ?? null,
    sourceEngagementId: id,
    createdAt,
    updatedAt: createdAt,
  });
  if (args.health != null) {
    await db.execute({
      sql: `UPDATE Customer SET health = ? WHERE id = ?`,
      args: [args.health, id],
    });
  }
  return id;
}

async function seedStageTransition(args: {
  firmId: string;
  customerId: string;
  fromStage: CustomerStage;
  toStage: CustomerStage;
  daysAgo: number;
}): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO ActivityLog
            (id, engagementId, customerId, firmId, action, details, fromStage, toStage, isRollback, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `act_${createId()}`,
      args.customerId,
      args.customerId,
      args.firmId,
      'STAGE_TRANSITION',
      JSON.stringify({ from: args.fromStage, to: args.toStage }),
      args.fromStage,
      args.toStage,
      0,
      new Date(Date.now() - args.daysAgo * 86_400_000).toISOString(),
    ],
  });
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

// ─── /pipeline ─────────────────────────────────────────────────────────────

describe('GET /api/v1/reports/pipeline', () => {
  it('rejects unauthenticated', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/reports/pipeline' });
    expect(r.statusCode).toBe(401);
  });

  it('returns the documented shape', async () => {
    const u = await seedUser();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/pipeline',
      cookies: { token: u.token },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body).toHaveProperty('funnel');
    expect(body).toHaveProperty('conversionRates');
    expect(body).toHaveProperty('avgDaysInStage');
    expect(body).toHaveProperty('stalledCount');
  });

  it('funnel reflects pre-Won customer counts', async () => {
    const u = await seedUser();
    await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'LEAD' });
    await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'LEAD' });
    await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'PROPOSAL' });
    await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'BUILD' }); // post-Won, excluded
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/pipeline',
      cookies: { token: u.token },
    });
    const body = r.json() as {
      funnel: Array<{ stage: string; count: number }>;
    };
    const lead = body.funnel.find((s) => s.stage === 'LEAD');
    const proposal = body.funnel.find((s) => s.stage === 'PROPOSAL');
    expect(lead?.count).toBe(2);
    expect(proposal?.count).toBe(1);
  });

  it('conversion math: LEAD→QUALIFIED rate from transition history', async () => {
    const u = await seedUser();
    // Two customers in the cohort: both entered LEAD recently; one
    // advanced to QUALIFIED.
    const c1 = await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'QUALIFIED' });
    const c2 = await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'LEAD' });
    await seedStageTransition({
      firmId: u.firmId,
      customerId: c1,
      fromStage: 'QUALIFIED',
      toStage: 'LEAD', // backwards — pushes c1 INTO LEAD cohort
      daysAgo: 20,
    });
    await seedStageTransition({
      firmId: u.firmId,
      customerId: c2,
      fromStage: 'QUALIFIED',
      toStage: 'LEAD',
      daysAgo: 15,
    });
    await seedStageTransition({
      firmId: u.firmId,
      customerId: c1,
      fromStage: 'LEAD',
      toStage: 'QUALIFIED',
      daysAgo: 5,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/pipeline',
      cookies: { token: u.token },
    });
    const body = r.json() as { conversionRates: Array<{ from: string; to: string; ratePct: number }> };
    const conv = body.conversionRates.find((c) => c.from === 'LEAD' && c.to === 'QUALIFIED');
    expect(conv).toBeDefined();
    expect(conv?.ratePct).toBe(50); // 1 of 2 in LEAD cohort advanced
  });

  it('stalledCount counts customers past STAGE_TARGET_DAYS', async () => {
    const u = await seedUser();
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LEAD', // target = 14
      daysAgoCreated: 60,
    });
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LEAD',
      daysAgoCreated: 5,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/pipeline',
      cookies: { token: u.token },
    });
    const body = r.json() as { stalledCount: number };
    expect(body.stalledCount).toBe(1);
  });

  it('firm scopes — other firm pre-Won customers are excluded', async () => {
    const a = await seedUser();
    const b = await seedUser();
    await seedCustomerWithEngagement({ firmId: a.firmId, stage: 'LEAD' });
    await seedCustomerWithEngagement({ firmId: b.firmId, stage: 'LEAD' });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/pipeline',
      cookies: { token: a.token },
    });
    const body = r.json() as { funnel: Array<{ stage: string; count: number }> };
    expect(body.funnel.find((s) => s.stage === 'LEAD')?.count).toBe(1);
  });
});

// ─── /delivery ─────────────────────────────────────────────────────────────

describe('GET /api/v1/reports/delivery', () => {
  it('returns shape + active count', async () => {
    const u = await seedUser();
    await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'BUILD' });
    await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'UAT' });
    await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'LEAD' }); // excluded
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/delivery',
      cookies: { token: u.token },
    });
    const body = r.json() as { activeProjects: number; byStage: unknown };
    expect(body.activeProjects).toBe(2);
    expect(Array.isArray(body.byStage)).toBe(true);
  });

  it('slipping detection respects STAGE_TARGET_DAYS', async () => {
    const u = await seedUser();
    const pm = await seedUser({ firmId: u.firmId });
    // BUILD target = 60 days
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'BUILD',
      daysAgoCreated: 90,
      projectLeadUserId: pm.userId,
      name: 'Slipping Co',
    });
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'BUILD',
      daysAgoCreated: 10,
      name: 'On Track Co',
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/delivery',
      cookies: { token: u.token },
    });
    const body = r.json() as {
      slippingList: Array<{ customerName: string; daysOverdue: number; projectLeadName: string | null }>;
      byStage: Array<{ stage: string; slipping: number; onTrack: number }>;
    };
    expect(body.slippingList).toHaveLength(1);
    expect(body.slippingList[0]!.customerName).toBe('Slipping Co');
    expect(body.slippingList[0]!.daysOverdue).toBe(30);
    const build = body.byStage.find((s) => s.stage === 'BUILD');
    expect(build?.slipping).toBe(1);
    expect(build?.onTrack).toBe(1);
  });

  it('forecasts go-live dates for non-GOLIVE customers', async () => {
    const u = await seedUser();
    await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'DISCOVERY', daysAgoCreated: 5 });
    await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'GOLIVE', daysAgoCreated: 1 });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/delivery',
      cookies: { token: u.token },
    });
    const body = r.json() as {
      forecastedGoLives: Array<{ customerName: string; estimatedGoLiveDate: string }>;
    };
    // GOLIVE customers excluded.
    expect(body.forecastedGoLives).toHaveLength(1);
    expect(body.forecastedGoLives[0]!.estimatedGoLiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── /health ───────────────────────────────────────────────────────────────

describe('GET /api/v1/reports/health', () => {
  it('returns shape', async () => {
    const u = await seedUser();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/health',
      cookies: { token: u.token },
    });
    const body = r.json() as Record<string, unknown>;
    expect(body).toHaveProperty('totalManagedCustomers');
    expect(body).toHaveProperty('distribution');
    expect(body).toHaveProperty('redCustomers');
    expect(body).toHaveProperty('churnRiskScore');
    expect(body).toHaveProperty('byStage');
  });

  it('red list ordered by lowest health score ascending', async () => {
    const u = await seedUser();
    const csm = await seedUser({ firmId: u.firmId });
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LIVE_SLA',
      csmUserId: csm.userId,
      health: 25,
      name: 'Slightly Red',
    });
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LIVE_SLA',
      csmUserId: csm.userId,
      health: 10,
      name: 'Very Red',
    });
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LIVE_SLA',
      csmUserId: csm.userId,
      health: 80, // green — excluded
      name: 'Green',
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/health',
      cookies: { token: u.token },
    });
    const body = r.json() as {
      redCustomers: Array<{ customerName: string; healthScore: number }>;
      distribution: { red: number; yellow: number; green: number };
    };
    expect(body.redCustomers).toHaveLength(2);
    expect(body.redCustomers[0]!.customerName).toBe('Very Red');
    expect(body.redCustomers[0]!.healthScore).toBe(10);
    expect(body.distribution.red).toBe(2);
    expect(body.distribution.green).toBe(1);
  });

  it('churnRiskScore = % red over total managed', async () => {
    const u = await seedUser();
    await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'LIVE_SLA', health: 10 });
    await seedCustomerWithEngagement({ firmId: u.firmId, stage: 'LIVE_SLA', health: 90 });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/health',
      cookies: { token: u.token },
    });
    const body = r.json() as { churnRiskScore: number };
    expect(body.churnRiskScore).toBe(50);
  });
});

// ─── /renewals ─────────────────────────────────────────────────────────────

describe('GET /api/v1/reports/renewals', () => {
  it('returns shape', async () => {
    const u = await seedUser();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/renewals',
      cookies: { token: u.token },
    });
    const body = r.json() as Record<string, unknown>;
    expect(body).toHaveProperty('next90Days');
    expect(body).toHaveProperty('totalArrAtRisk');
    expect(body).toHaveProperty('byMonth');
    expect(body).toHaveProperty('riskBreakdown');
  });

  it('byMonth groups customers by YYYY-MM ascending', async () => {
    const u = await seedUser();
    const m1 = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
    const m2 = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
    const m3 = new Date(Date.now() + 80 * 86_400_000).toISOString().slice(0, 10);
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LIVE_SLA',
      contractEndDate: m1,
    });
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LIVE_SLA',
      contractEndDate: m2,
    });
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LIVE_SLA',
      contractEndDate: m3,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/renewals',
      cookies: { token: u.token },
    });
    const body = r.json() as { byMonth: Array<{ monthLabel: string; count: number }> };
    expect(body.byMonth.length).toBeGreaterThanOrEqual(1);
    // Labels strictly ascending
    for (let i = 1; i < body.byMonth.length; i++) {
      expect(body.byMonth[i]!.monthLabel >= body.byMonth[i - 1]!.monthLabel).toBe(true);
    }
  });

  it('excludes renewals beyond the 90-day window', async () => {
    const u = await seedUser();
    const farOut = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'LIVE_SLA',
      contractEndDate: farOut,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/renewals',
      cookies: { token: u.token },
    });
    const body = r.json() as { next90Days: unknown[] };
    expect(body.next90Days).toHaveLength(0);
  });
});

// ─── /utilization ──────────────────────────────────────────────────────────

describe('GET /api/v1/reports/utilization', () => {
  it('returns shape', async () => {
    const u = await seedUser();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/utilization',
      cookies: { token: u.token },
    });
    const body = r.json() as Record<string, unknown>;
    expect(body).toHaveProperty('byUser');
    expect(body).toHaveProperty('overloadedUsers');
    expect(body).toHaveProperty('unbalancedRoles');
  });

  it('overloaded threshold fires at > 15 active assignments', async () => {
    const u = await seedUser();
    const heavy = await seedUser({ firmId: u.firmId, name: 'Heavy' });
    // 16 customers assigned to `heavy` as sales owner in pre-Won
    // stages — should land as overloaded.
    for (let i = 0; i < 16; i++) {
      await seedCustomerWithEngagement({
        firmId: u.firmId,
        stage: 'PROPOSAL',
        salesOwnerUserId: heavy.userId,
      });
    }
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/utilization',
      cookies: { token: u.token },
    });
    const body = r.json() as {
      byUser: Array<{ userName: string; totalActive: number; isOverloaded: boolean }>;
      overloadedUsers: number;
    };
    const heavyRow = body.byUser.find((u) => u.userName === 'Heavy');
    expect(heavyRow).toBeDefined();
    expect(heavyRow?.totalActive).toBe(16);
    expect(heavyRow?.isOverloaded).toBe(true);
    expect(body.overloadedUsers).toBeGreaterThanOrEqual(1);
  });

  it('counts only the role-appropriate stage for each owner column', async () => {
    const u = await seedUser({ name: 'OwnerU' });
    // Assign `u` as sales owner on a BUILD customer — that's the PM's
    // turf, so salesCount should be 0, not 1.
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'BUILD',
      salesOwnerUserId: u.userId,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/utilization',
      cookies: { token: u.token },
    });
    const body = r.json() as {
      byUser: Array<{ userName: string; salesCount: number; projectLeadCount: number }>;
    };
    const row = body.byUser.find((b) => b.userName === 'OwnerU');
    expect(row?.salesCount).toBe(0);
    expect(row?.projectLeadCount).toBe(0); // they're salesOwner not projectLead on this row
  });

  it('unbalancedRoles flags the most-skewed role', async () => {
    const u = await seedUser();
    const heavy = await seedUser({ firmId: u.firmId, name: 'Heavy' });
    const light = await seedUser({ firmId: u.firmId, name: 'Light' });
    // 4 sales-stage customers on `heavy`, 1 on `light`
    for (let i = 0; i < 4; i++) {
      await seedCustomerWithEngagement({
        firmId: u.firmId,
        stage: 'PROPOSAL',
        salesOwnerUserId: heavy.userId,
      });
    }
    await seedCustomerWithEngagement({
      firmId: u.firmId,
      stage: 'PROPOSAL',
      salesOwnerUserId: light.userId,
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/utilization',
      cookies: { token: u.token },
    });
    const body = r.json() as {
      unbalancedRoles: { role: string; topUser: string; bottomUser: string; ratio: number } | null;
    };
    expect(body.unbalancedRoles).not.toBeNull();
    expect(body.unbalancedRoles!.role).toBe('sales');
    expect(body.unbalancedRoles!.topUser).toBe('Heavy');
    expect(body.unbalancedRoles!.bottomUser).toBe('Light');
    expect(body.unbalancedRoles!.ratio).toBeCloseTo(4);
  });
});
