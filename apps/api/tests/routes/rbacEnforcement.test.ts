/**
 * Phase 43.2 — end-to-end coverage for the requirePermission middleware.
 *
 * Walks four scenarios against the real decisions / risks routes:
 *   1. APP_ADMIN: allowed everywhere (200 / 201 responses).
 *   2. CLIENT_REVIEWER: GET decisions allowed (READ), POST denied (403).
 *   3. INTERNAL_ACCOUNTANT: GET decisions denied (no READ on DECISIONS).
 *   4. No roles at all: every gated route 403s.
 *
 * Each test seeds its own user + engagement via direct SQL and signs
 * a JWT, then injects the request through Fastify so the full
 * preHandler chain runs.
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
import {
  getDb,
  grantFirmRole,
  grantEngagementRole,
} from '../../src/db/index.js';
import type { Role } from '../../src/types/roles.js';

const JWT_SECRET = 'rbac-enforcement-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(decisionRoutes, { prefix: '/api/v1' });
  await f.register(riskRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  userId: string;
  engagementId: string;
  token: string;
}

async function seedUser(opts?: {
  firmRoles?: Role[];
  engagementRoles?: Role[];
  stage?: string;
}): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const engagementId = createId();
  const now = new Date().toISOString();
  const stage = opts?.stage ?? 'BUILD';
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'RBAC Firm', `rbac-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Test User', passwordHash, 'CONSULTANT', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'RBAC Client', stage, now, now],
  });
  for (const r of opts?.firmRoles ?? []) {
    await grantFirmRole({ firmId, userId, role: r as 'APP_ADMIN', actorUserId: userId });
  }
  for (const r of opts?.engagementRoles ?? []) {
    await grantEngagementRole({
      engagementId,
      userId,
      role: r as 'PROJECT_MANAGER',
      assignedModules: null,
      actorUserId: userId,
    });
  }
  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'CONSULTANT',
    name: 'Test User',
    email: `${userId}@example.com`,
  });
  return { firmId, userId, engagementId, token };
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
  // Wipe the four RBAC tables between tests so unique-constraint
  // pile-ups don't trip the next seed.
  const db = getDb();
  await db.execute(`DELETE FROM RoleAuditLog`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM FirmRole`);
});

// ─── APP_ADMIN ───────────────────────────────────────────────────────────────

describe('rbac middleware — APP_ADMIN', () => {
  it('passes WRITE on decisions (POST 201)', async () => {
    const f = await seedUser({ firmRoles: ['APP_ADMIN'] });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { title: 'Use AVCO costing' },
    });
    expect(r.statusCode).toBe(201);
  });

  it('passes READ on decisions (GET 200)', async () => {
    const f = await seedUser({ firmRoles: ['APP_ADMIN'] });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(r.statusCode).toBe(200);
  });
});

// ─── No roles at all ─────────────────────────────────────────────────────────

describe('rbac middleware — user with no roles', () => {
  it('returns 403 on POST /decisions (write blocked)', async () => {
    const f = await seedUser();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { title: 'Use AVCO costing' },
    });
    expect(r.statusCode).toBe(403);
    const body = r.json() as { error: { code: string; message: string; requiredRole: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('decisions');
    expect(body.error.requiredRole).toBe('PROJECT_LEAD');
  });

  it('returns 403 on GET /decisions (read blocked too — no role grants any read)', async () => {
    const f = await seedUser();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it('returns 403 on POST /risks too', async () => {
    const f = await seedUser();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/risks`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { title: 'GL mapping risk' },
    });
    expect(r.statusCode).toBe(403);
  });
});

// ─── CLIENT_REVIEWER (engagement role) ───────────────────────────────────────

describe('rbac middleware — CLIENT_REVIEWER (read-only)', () => {
  it('passes GET on decisions (READ allowed)', async () => {
    const f = await seedUser({ engagementRoles: ['CLIENT_REVIEWER'] });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it('returns 403 on POST decisions (WRITE denied)', async () => {
    const f = await seedUser({ engagementRoles: ['CLIENT_REVIEWER'] });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { title: 'Should fail' },
    });
    expect(r.statusCode).toBe(403);
  });
});

// ─── PROJECT_LEAD on this engagement ─────────────────────────────────────────

describe('rbac middleware — PROJECT_LEAD on assigned engagement', () => {
  it('passes WRITE on decisions during BUILD stage', async () => {
    const f = await seedUser({ engagementRoles: ['PROJECT_LEAD'], stage: 'BUILD' });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { title: 'Use AVCO costing' },
    });
    expect(r.statusCode).toBe(201);
  });

  it('drops to READ-only at CLOSEOUT — POST 403, GET 200', async () => {
    const f = await seedUser({ engagementRoles: ['PROJECT_LEAD'], stage: 'CLOSEOUT' });
    const post = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { title: 'Should fail' },
    });
    expect(post.statusCode).toBe(403);
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(get.statusCode).toBe(200);
  });
});

// ─── INTERNAL_ACCOUNTANT (firm-level) ────────────────────────────────────────

describe('rbac middleware — INTERNAL_ACCOUNTANT', () => {
  it('returns 403 on GET /decisions (no READ on DECISIONS)', async () => {
    const f = await seedUser({ firmRoles: ['INTERNAL_ACCOUNTANT'] });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/decisions`,
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it('returns 403 on GET /risks too', async () => {
    const f = await seedUser({ firmRoles: ['INTERNAL_ACCOUNTANT'] });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/risks`,
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(r.statusCode).toBe(403);
  });
});
