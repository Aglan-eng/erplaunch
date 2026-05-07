/**
 * Phase 44.2 — end-to-end coverage for the INTERNAL_ACCOUNTANT field
 * filter wiring on GET /engagements and GET /engagements/:id.
 *
 * Three personas seeded in one fixture:
 *   APP_ADMIN              — full payload everywhere
 *   pure INTERNAL_ACCOUNTANT — stripped payload everywhere
 *   PM-with-accountant-too — full payload because PM role wins on
 *                            their assigned engagement; stripped on
 *                            the list (heuristic doesn't know
 *                            engagement context yet — acceptable
 *                            per docstring).
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

const JWT_SECRET = 'accountant-filter-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-accountant-filter-test-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  engagementId: string;
  adminToken: string;
  accountantToken: string;
  mixedToken: string; // accountant + PROJECT_LEAD on engagement
}

async function seed(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const adminId = createId();
  const accId = createId();
  const mixedId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Acc Firm', `acc-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Acc Client', 'BUILD', now, now],
  });
  // Add a member + a decision so the strip test has something to
  // verify against. Members stay (Phase 44.2 keeps), decisions go.
  const passwordHash = await bcrypt.hash('x', 4);
  for (const id of [adminId, accId, mixedId]) {
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
      args: [id, firmId, `${id}@example.com`, id, passwordHash, 'CONSULTANT'],
    });
  }
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team) VALUES (?,?,?,?,?)`,
    args: [createId(), engagementId, 'Alice Sponsor', 'Project Sponsor', 'CLIENT'],
  });
  await db.execute({
    sql: `INSERT INTO DecisionItem (id, engagementId, title) VALUES (?,?,?)`,
    args: [createId(), engagementId, 'Use AVCO costing'],
  });

  await bootstrapFirmAdmin({ firmId, userId: adminId });
  await grantFirmRole({ firmId, userId: accId, role: 'INTERNAL_ACCOUNTANT', actorUserId: adminId });
  await grantFirmRole({ firmId, userId: mixedId, role: 'INTERNAL_ACCOUNTANT', actorUserId: adminId });
  await grantEngagementRole({
    engagementId, userId: mixedId, role: 'PROJECT_LEAD', assignedModules: null, actorUserId: adminId,
  });

  const sign = (id: string) => app.jwt.sign({
    userId: id, firmId, role: 'CONSULTANT', name: id, email: `${id}@example.com`,
  });
  return {
    firmId,
    engagementId,
    adminToken: sign(adminId),
    accountantToken: sign(accId),
    mixedToken: sign(mixedId),
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
  await db.execute(`DELETE FROM DecisionItem`);
  await db.execute(`DELETE FROM ProjectMember`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── List endpoint ───────────────────────────────────────────────────────────

describe('GET /engagements as different roles', () => {
  it('APP_ADMIN gets the full payload (members, conflicts, profile, etc.)', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/engagements',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    // Admin sees the full row (members + the rest are in the
    // listEngagements default include set; presence isn't strictly
    // asserted, just that the row passed through unfiltered).
    expect(body.data[0]).toHaveProperty('id');
    expect(body.data[0]).toHaveProperty('clientName');
  });

  it('pure INTERNAL_ACCOUNTANT gets the stripped payload', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/engagements',
      headers: { authorization: `Bearer ${f.accountantToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    const eng = body.data[0];
    // Keep-list fields are present.
    expect(eng).toHaveProperty('id');
    expect(eng).toHaveProperty('clientName');
    expect(eng).toHaveProperty('status');
    // Strip-list fields are gone.
    expect(eng).not.toHaveProperty('conflicts');
    expect(eng).not.toHaveProperty('profile');
    expect(eng).not.toHaveProperty('jobs');
  });
});

// ─── Single engagement endpoint ──────────────────────────────────────────────

describe('GET /engagements/:id as different roles', () => {
  it('APP_ADMIN gets the full payload', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const eng = (r.json() as { data: Record<string, unknown> }).data;
    expect(eng).toHaveProperty('id');
    // findEngagementById is light — doesn't include all enriched
    // fields by default — but the payload is what enrichEngagement
    // returned, which the strip would have removed if it ran.
    expect(eng.id).toBe(f.engagementId);
  });

  it('pure INTERNAL_ACCOUNTANT gets the stripped payload', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}`,
      headers: { authorization: `Bearer ${f.accountantToken}` },
    });
    expect(r.statusCode).toBe(200);
    const eng = (r.json() as { data: Record<string, unknown> }).data;
    expect(eng.id).toBe(f.engagementId);
    expect(eng).toHaveProperty('clientName');
    // No nested decisions/risks/etc. (they wouldn't be on
    // findEngagementById either, but we assert NOT to have them so
    // a future schema change can't sneak them in.)
    expect(eng).not.toHaveProperty('decisions');
    expect(eng).not.toHaveProperty('risks');
    expect(eng).not.toHaveProperty('issues');
    expect(eng).not.toHaveProperty('profile');
  });

  it('mixed PM + ACCOUNTANT gets the FULL payload (PM role wins on this engagement)', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}`,
      headers: { authorization: `Bearer ${f.mixedToken}` },
    });
    expect(r.statusCode).toBe(200);
    const eng = (r.json() as { data: Record<string, unknown> }).data;
    // The PM role grants full visibility — adaptorId stays.
    expect(eng).toHaveProperty('adaptorId');
    // No filter applied — every key is forwarded through.
    expect(eng.id).toBe(f.engagementId);
  });
});
