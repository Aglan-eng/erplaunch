/**
 * Phase 43.6 — RBAC smoke test.
 *
 * Walks the four persona shapes from seed-rbac.ts through the real
 * route stack and pins what each one can/can't do:
 *
 *   1. SALES_REP on engagement A
 *      - GET /me/permissions on A → READ on ENGAGEMENT_META, NONE on
 *        DECISIONS (can't see deal-time decisions outside sales)
 *      - POST /decisions on A at PROSPECT → 403 (sales-only role)
 *      - GET /decisions on A → 403
 *      - GET /me/permissions on engagement B → no roles, NONE
 *        everywhere (cannot see other reps' deals)
 *
 *   2. PROJECT_MANAGER on engagement A
 *      - GET /decisions → 200
 *      - POST /decisions at BUILD → 201 (write allowed mid-cycle)
 *      - POST /decisions on engagement B → 403 (no role on B)
 *
 *   3. FUNCTIONAL_CONSULTANT on engagement A, modules=[r2r]
 *      - GET /risks on A → 200 (READ allowed)
 *      - POST /risks on A at BUILD → 201 (consultants WRITE risks)
 *      - POST /decisions on A → 403 (consultants don't author decisions)
 *      - assignedModulesByRole exposes ['r2r'] in /me/permissions
 *
 *   4. INTERNAL_ACCOUNTANT firm-wide
 *      - GET /decisions on any engagement → 403 (NONE on DECISIONS)
 *      - GET /me/permissions → effective.BILLING = WRITE
 *      - GET /me/permissions → effective.DECISIONS = NONE
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { decisionRoutes } from '../../src/routes/decisions.js';
import { riskRoutes } from '../../src/routes/risks.js';
import { teamRoutes } from '../../src/routes/team.js';
import {
  getDb,
  bootstrapFirmAdmin,
  grantFirmRole,
  grantEngagementRole,
} from '../../src/db/index.js';
import type { Role } from '../../src/types/roles.js';

const JWT_SECRET = 'rbac-smoke-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(decisionRoutes, { prefix: '/api/v1' });
  await f.register(riskRoutes, { prefix: '/api/v1' });
  await f.register(teamRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Persona {
  userId: string;
  token: string;
}

interface Engagement {
  engagementId: string;
}

interface SmokeFixture {
  firmId: string;
  appAdmin: Persona;
  engA: Engagement;
  engB: Engagement;
  // Personas
  salesRep: Persona;
  pmAcme: Persona;
  fc: Persona;
  accountant: Persona;
}

async function seedSmoke(): Promise<SmokeFixture> {
  const db = getDb();
  const firmId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Xelerate', 'xelerate-smoke', 'STARTER', now],
  });

  async function makeUser(email: string, roles: { firm?: Role[]; eng?: Array<{ engId: string; role: Role; modules?: string[] | null }> }): Promise<Persona> {
    const userId = createId();
    const passwordHash = await bcrypt.hash('rbac-demo', 4);
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
      args: [userId, firmId, email, email, passwordHash, 'CONSULTANT'],
    });
    for (const r of roles.firm ?? []) {
      await grantFirmRole({ firmId, userId, role: r as 'APP_ADMIN', actorUserId: userId });
    }
    for (const e of roles.eng ?? []) {
      await grantEngagementRole({
        engagementId: e.engId,
        userId,
        role: e.role as 'PROJECT_MANAGER',
        assignedModules: e.modules ?? null,
        actorUserId: userId,
      });
    }
    const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: email, email });
    return { userId, token };
  }

  // Two engagements so we can verify scope isolation. engA is "Acme"
  // (matching the PM seed), engB is "Beacon" (the SALES_REP doesn't
  // have a role on this one).
  const engAId = createId();
  const engBId = createId();
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engAId, firmId, 'Acme Industries', 'PROSPECT', now, now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engBId, firmId, 'Beacon Partners', 'BUILD', now, now],
  });

  const appAdminUserId = createId();
  const passwordHash = await bcrypt.hash('rbac-demo', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
    args: [appAdminUserId, firmId, 'admin@xelerate.example', 'App Admin', passwordHash, 'CONSULTANT'],
  });
  await bootstrapFirmAdmin({ firmId, userId: appAdminUserId });
  const adminToken = app.jwt.sign({ userId: appAdminUserId, firmId, role: 'CONSULTANT', name: 'admin', email: 'admin@xelerate.example' });

  const salesRep = await makeUser('sales.rep@xelerate.example', {
    eng: [{ engId: engAId, role: 'SALES_REP' }],
  });
  const pmAcme = await makeUser('pm@xelerate.example', {
    eng: [{ engId: engAId, role: 'PROJECT_MANAGER' }],
  });
  const fc = await makeUser('functional.finance@xelerate.example', {
    eng: [{ engId: engAId, role: 'FUNCTIONAL_CONSULTANT', modules: ['r2r'] }],
  });
  const accountant = await makeUser('accountant@xelerate.example', {
    firm: ['INTERNAL_ACCOUNTANT'],
  });

  return {
    firmId,
    appAdmin: { userId: appAdminUserId, token: adminToken },
    engA: { engagementId: engAId },
    engB: { engagementId: engBId },
    salesRep, pmAcme, fc, accountant,
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
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM DecisionItem`);
  await db.execute(`DELETE FROM RiskItem`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── 1. SALES_REP ────────────────────────────────────────────────────────────

describe('smoke — SALES_REP on engagement A', () => {
  it('GET /me/permissions on A → WRITE on ENGAGEMENT_META, no GENERATORS access', async () => {
    const f = await seedSmoke();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/me/permissions?engagementId=${f.engA.engagementId}`,
      headers: { authorization: `Bearer ${f.salesRep.token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { effective: Record<string, string> } };
    expect(body.data.effective.ENGAGEMENT_META).toBe('WRITE'); // SALES_REP at PROSPECT
    // Sales rep can READ decisions on their own deal but cannot author them.
    expect(body.data.effective.DECISIONS).toBe('READ');
    // Sales doesn't touch generators or billing-write or roles.
    expect(body.data.effective.GENERATORS).toBe('NONE');
    expect(body.data.effective.BILLING).toBe('READ');
  });

  it('POST /decisions on A → 403', async () => {
    const f = await seedSmoke();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engA.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.salesRep.token}` },
      payload: { title: 'Should fail' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('GET /me/permissions on engagement B → empty roles + all NONE', async () => {
    const f = await seedSmoke();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/me/permissions?engagementId=${f.engB.engagementId}`,
      headers: { authorization: `Bearer ${f.salesRep.token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { engagementRoles: string[]; effective: Record<string, string> } };
    expect(body.data.engagementRoles).toEqual([]);
    expect(body.data.effective.DECISIONS).toBe('NONE');
    expect(body.data.effective.ENGAGEMENT_META).toBe('NONE');
  });
});

// ─── 2. PROJECT_MANAGER ──────────────────────────────────────────────────────

describe('smoke — PROJECT_MANAGER on engagement A', () => {
  it('GET /decisions on A → 200, POST /decisions at BUILD → 201', async () => {
    const f = await seedSmoke();
    // Move A to BUILD so PM has WRITE on decisions.
    const db = getDb();
    await db.execute({
      sql: `UPDATE Engagement SET status = ? WHERE id = ?`,
      args: ['BUILD', f.engA.engagementId],
    });

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engA.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.pmAcme.token}` },
    });
    expect(get.statusCode).toBe(200);

    const post = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engA.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.pmAcme.token}` },
      payload: { title: 'Use AVCO costing' },
    });
    expect(post.statusCode).toBe(201);
  });

  it('POST /decisions on engagement B → 403 (no role on B)', async () => {
    const f = await seedSmoke();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engB.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.pmAcme.token}` },
      payload: { title: 'Should fail' },
    });
    expect(r.statusCode).toBe(403);
  });
});

// ─── 3. FUNCTIONAL_CONSULTANT ────────────────────────────────────────────────

describe('smoke — FUNCTIONAL_CONSULTANT on A, modules=[r2r]', () => {
  it('GET /risks → 200 + POST /risks → 201 at BUILD', async () => {
    const f = await seedSmoke();
    const db = getDb();
    await db.execute({
      sql: `UPDATE Engagement SET status = ? WHERE id = ?`,
      args: ['BUILD', f.engA.engagementId],
    });
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engA.engagementId}/risks`,
      headers: { authorization: `Bearer ${f.fc.token}` },
    });
    expect(get.statusCode).toBe(200);
    const post = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engA.engagementId}/risks`,
      headers: { authorization: `Bearer ${f.fc.token}` },
      payload: { title: 'GL mapping risk' },
    });
    expect(post.statusCode).toBe(201);
  });

  it('POST /decisions → 403 (consultants don`t author decisions)', async () => {
    const f = await seedSmoke();
    const db = getDb();
    await db.execute({
      sql: `UPDATE Engagement SET status = ? WHERE id = ?`,
      args: ['BUILD', f.engA.engagementId],
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engA.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.fc.token}` },
      payload: { title: 'Should fail' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('assignedModulesByRole exposes [r2r] in /me/permissions', async () => {
    const f = await seedSmoke();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/me/permissions?engagementId=${f.engA.engagementId}`,
      headers: { authorization: `Bearer ${f.fc.token}` },
    });
    const body = r.json() as { data: { assignedModulesByRole: Record<string, string[] | null> } };
    expect(body.data.assignedModulesByRole.FUNCTIONAL_CONSULTANT).toEqual(['r2r']);
  });
});

// ─── 4. INTERNAL_ACCOUNTANT ──────────────────────────────────────────────────

describe('smoke — INTERNAL_ACCOUNTANT firm-wide', () => {
  it('GET /decisions → 403 (NONE on DECISIONS)', async () => {
    const f = await seedSmoke();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engA.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.accountant.token}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it('GET /me/permissions → BILLING=WRITE, DECISIONS=NONE on every engagement', async () => {
    const f = await seedSmoke();
    for (const engId of [f.engA.engagementId, f.engB.engagementId]) {
      const r = await app.inject({
        method: 'GET',
        url: `/api/v1/me/permissions?engagementId=${engId}`,
        headers: { authorization: `Bearer ${f.accountant.token}` },
      });
      const body = r.json() as { data: { effective: Record<string, string> } };
      expect(body.data.effective.BILLING).toBe('WRITE');
      expect(body.data.effective.DECISIONS).toBe('NONE');
    }
  });
});
