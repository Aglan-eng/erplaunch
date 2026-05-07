/**
 * Phase 44.1 — end-to-end coverage for the role-aware
 * GET /engagements visibility filter.
 *
 * Seeds a firm with three engagements at different stages plus
 * eight users covering each role shape, then asserts what each
 * user gets back from the list endpoint:
 *
 *   APP_ADMIN          → all 3
 *   SALES_MANAGER      → all 3
 *   SUPPORT_LEAD       → all 3
 *   INTERNAL_ACCOUNTANT → all 3
 *   SALES_REP on engP  → just engP (PROSPECT)
 *   PROJECT_MANAGER on engB → just engB (BUILD)
 *   SUPPORT_ENGINEER on engS → just engS (SLA_ACTIVE)
 *   no-roles user      → empty
 *   SALES_REP whose engagement moved to BUILD → empty (stage filter)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { engagementRoutes } from '../../src/routes/engagements.js';
import {
  getDb,
  bootstrapFirmAdmin,
  grantFirmRole,
  grantEngagementRole,
} from '../../src/db/index.js';
import type { FirmRole, EngagementRole } from '../../src/types/roles.js';

const JWT_SECRET = 'visibility-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-visibility-test-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  engP: string; // PROSPECT
  engB: string; // BUILD
  engS: string; // SLA_ACTIVE
  tokens: {
    appAdmin: string;
    salesManager: string;
    supportLead: string;
    accountant: string;
    salesRep: string;        // assigned to engP
    salesRepStale: string;   // assigned to engB (sees nothing — sales filter)
    pm: string;              // assigned to engB
    supportEng: string;      // assigned to engS
    noRoles: string;
  };
}

async function seedVisibilityFixture(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Vis Firm', `vis-${createId()}`, 'STARTER', now],
  });

  const engP = createId();
  const engB = createId();
  const engS = createId();
  for (const [id, status] of [[engP, 'PROSPECT'], [engB, 'BUILD'], [engS, 'SLA_ACTIVE']] as const) {
    await db.execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
      args: [id, firmId, `Eng ${status}`, status, now, now],
    });
  }

  async function makeUser(opts: { email: string; firm?: FirmRole; eng?: Array<{ engId: string; role: EngagementRole }> }): Promise<string> {
    const userId = createId();
    const passwordHash = await bcrypt.hash('x', 4);
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
      args: [userId, firmId, opts.email, opts.email, passwordHash, 'CONSULTANT'],
    });
    if (opts.firm) {
      await grantFirmRole({ firmId, userId, role: opts.firm, actorUserId: userId });
    }
    for (const e of opts.eng ?? []) {
      await grantEngagementRole({
        engagementId: e.engId,
        userId,
        role: e.role,
        assignedModules: null,
        actorUserId: userId,
      });
    }
    return app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: opts.email, email: opts.email });
  }

  // App admin via bootstrap (also gets visibility=ALL).
  const adminUserId = createId();
  const passwordHash = await bcrypt.hash('x', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
    args: [adminUserId, firmId, 'admin@vis.example', 'admin', passwordHash, 'CONSULTANT'],
  });
  await bootstrapFirmAdmin({ firmId, userId: adminUserId });
  const appAdmin = app.jwt.sign({ userId: adminUserId, firmId, role: 'CONSULTANT', name: 'admin', email: 'admin@vis.example' });

  return {
    firmId, engP, engB, engS,
    tokens: {
      appAdmin,
      salesManager: await makeUser({ email: 'sm@vis.example', firm: 'SALES_MANAGER' }),
      supportLead: await makeUser({ email: 'sl@vis.example', firm: 'SUPPORT_LEAD' }),
      accountant: await makeUser({ email: 'acc@vis.example', firm: 'INTERNAL_ACCOUNTANT' }),
      salesRep: await makeUser({ email: 'sr@vis.example', eng: [{ engId: engP, role: 'SALES_REP' }] }),
      // Sales rep on a deal that's now in BUILD — the sales-filter
      // should hide it from their list.
      salesRepStale: await makeUser({ email: 'sr-stale@vis.example', eng: [{ engId: engB, role: 'SALES_REP' }] }),
      pm: await makeUser({ email: 'pm@vis.example', eng: [{ engId: engB, role: 'PROJECT_MANAGER' }] }),
      supportEng: await makeUser({ email: 'se@vis.example', eng: [{ engId: engS, role: 'SUPPORT_ENGINEER' }] }),
      noRoles: await makeUser({ email: 'nobody@vis.example' }),
    },
  };
}

async function listEngagementIds(token: string): Promise<string[]> {
  const r = await app.inject({
    method: 'GET',
    url: '/api/v1/engagements',
    headers: { authorization: `Bearer ${token}` },
  });
  const body = r.json() as { data: Array<{ id: string }> };
  return body.data.map((e) => e.id).sort();
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
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── Firm-level roles see everything ─────────────────────────────────────────

describe('GET /engagements visibility — firm-level roles', () => {
  it('APP_ADMIN sees all 3 engagements', async () => {
    const f = await seedVisibilityFixture();
    expect(await listEngagementIds(f.tokens.appAdmin)).toEqual([f.engB, f.engP, f.engS].sort());
  });

  it('SALES_MANAGER sees all 3 engagements', async () => {
    const f = await seedVisibilityFixture();
    expect(await listEngagementIds(f.tokens.salesManager)).toEqual([f.engB, f.engP, f.engS].sort());
  });

  it('SUPPORT_LEAD sees all 3 engagements', async () => {
    const f = await seedVisibilityFixture();
    expect(await listEngagementIds(f.tokens.supportLead)).toEqual([f.engB, f.engP, f.engS].sort());
  });

  it('INTERNAL_ACCOUNTANT sees all 3 engagements', async () => {
    const f = await seedVisibilityFixture();
    expect(await listEngagementIds(f.tokens.accountant)).toEqual([f.engB, f.engP, f.engS].sort());
  });
});

// ─── Engagement-level scoping ────────────────────────────────────────────────

describe('GET /engagements visibility — engagement-level scoping', () => {
  it('SALES_REP on a PROSPECT deal sees only that deal', async () => {
    const f = await seedVisibilityFixture();
    expect(await listEngagementIds(f.tokens.salesRep)).toEqual([f.engP]);
  });

  it('SALES_REP on a deal that moved to BUILD sees nothing (stage filter)', async () => {
    const f = await seedVisibilityFixture();
    expect(await listEngagementIds(f.tokens.salesRepStale)).toEqual([]);
  });

  it('PROJECT_MANAGER on the BUILD engagement sees only that engagement', async () => {
    const f = await seedVisibilityFixture();
    expect(await listEngagementIds(f.tokens.pm)).toEqual([f.engB]);
  });

  it('SUPPORT_ENGINEER on the SLA_ACTIVE engagement sees only that engagement', async () => {
    const f = await seedVisibilityFixture();
    expect(await listEngagementIds(f.tokens.supportEng)).toEqual([f.engS]);
  });
});

// ─── No roles ────────────────────────────────────────────────────────────────

describe('GET /engagements visibility — no roles', () => {
  it('returns an empty list for a user with no roles at all', async () => {
    const f = await seedVisibilityFixture();
    expect(await listEngagementIds(f.tokens.noRoles)).toEqual([]);
  });
});
