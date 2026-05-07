/**
 * Phase 43.4 — coverage for the Settings → Team API.
 *
 * Each test seeds a firm + an APP_ADMIN user (via bootstrapFirmAdmin)
 * and a second non-admin user, then exercises the endpoints with
 * each token to confirm:
 *   - APP_ADMIN can list, grant, revoke roles + see the audit log
 *   - non-admin (no roles) is 403'd from every team endpoint
 *   - validation: invalid role values are 400, scope mismatches are 400
 *   - per-engagement assignedModules are persisted and surfaced
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { teamRoutes } from '../../src/routes/team.js';
import {
  getDb,
  bootstrapFirmAdmin,
} from '../../src/db/index.js';

const JWT_SECRET = 'team-api-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(teamRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  adminUserId: string;
  adminToken: string;
  otherUserId: string;
  otherToken: string;
  engagementId: string;
}

async function seed(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const adminUserId = createId();
  const otherUserId = createId();
  const engagementId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Team Firm', `team-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [adminUserId, firmId, `admin-${adminUserId}@example.com`, 'Admin', passwordHash, 'CONSULTANT', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [otherUserId, firmId, `other-${otherUserId}@example.com`, 'Other', passwordHash, 'CONSULTANT', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Team Client', 'BUILD', now, now],
  });
  await bootstrapFirmAdmin({ firmId, userId: adminUserId });

  const adminToken = app.jwt.sign({
    userId: adminUserId, firmId, role: 'CONSULTANT', name: 'Admin', email: 'admin@example.com',
  });
  const otherToken = app.jwt.sign({
    userId: otherUserId, firmId, role: 'CONSULTANT', name: 'Other', email: 'other@example.com',
  });
  return { firmId, adminUserId, adminToken, otherUserId, otherToken, engagementId };
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
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── GET /firm/team ──────────────────────────────────────────────────────────

describe('GET /firm/team', () => {
  it('lists firm users + their firm-level roles for an APP_ADMIN', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/team',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<{ id: string; email: string; firmRoles: string[] }> };
    expect(body.data).toHaveLength(2);
    const admin = body.data.find((u) => u.id === f.adminUserId);
    expect(admin?.firmRoles).toContain('APP_ADMIN');
    const other = body.data.find((u) => u.id === f.otherUserId);
    expect(other?.firmRoles).toEqual([]);
  });

  it('returns 403 to a non-admin user', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/team',
      headers: { authorization: `Bearer ${f.otherToken}` },
    });
    expect(r.statusCode).toBe(403);
  });
});

// ─── POST /firm/roles ────────────────────────────────────────────────────────

describe('POST /firm/roles', () => {
  it('grants a firm-level role for APP_ADMIN', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/firm/roles',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { userId: f.otherUserId, role: 'INTERNAL_ACCOUNTANT' },
    });
    expect(r.statusCode).toBe(201);
    // Verify it landed.
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/team',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const team = (list.json() as { data: Array<{ id: string; firmRoles: string[] }> }).data;
    const other = team.find((u) => u.id === f.otherUserId);
    expect(other?.firmRoles).toContain('INTERNAL_ACCOUNTANT');
  });

  it('rejects a per-engagement role being granted as a firm role', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/firm/roles',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { userId: f.otherUserId, role: 'PROJECT_MANAGER' },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('INVALID_ROLE');
  });

  it('returns 403 for a non-admin user', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/firm/roles',
      headers: { authorization: `Bearer ${f.otherToken}` },
      payload: { userId: f.adminUserId, role: 'SALES_MANAGER' },
    });
    expect(r.statusCode).toBe(403);
  });
});

// ─── DELETE /firm/roles ──────────────────────────────────────────────────────

describe('DELETE /firm/roles', () => {
  it('revokes a firm-level role + records the audit entry', async () => {
    const f = await seed();
    await app.inject({
      method: 'POST',
      url: '/api/v1/firm/roles',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { userId: f.otherUserId, role: 'SUPPORT_LEAD' },
    });
    const r = await app.inject({
      method: 'DELETE',
      url: '/api/v1/firm/roles',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { userId: f.otherUserId, role: 'SUPPORT_LEAD' },
    });
    expect(r.statusCode).toBe(200);
    const audit = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/role-audit-log',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const log = (audit.json() as { data: Array<{ action: string; role: string }> }).data;
    expect(log.some((l) => l.action === 'ROLE_REVOKED' && l.role === 'SUPPORT_LEAD')).toBe(true);
  });
});

// ─── Engagement-level role surface ───────────────────────────────────────────

describe('engagement role assignment', () => {
  it('grants a PROJECT_MANAGER on the engagement and surfaces it in GET', async () => {
    const f = await seed();
    const grant = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/roles`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { userId: f.otherUserId, role: 'PROJECT_MANAGER' },
    });
    expect(grant.statusCode).toBe(201);
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/roles`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: Array<{ userId: string; role: string }> }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: f.otherUserId, role: 'PROJECT_MANAGER' });
  });

  it('persists assignedModules for module-scoped roles (FUNCTIONAL_CONSULTANT)', async () => {
    const f = await seed();
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/roles`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { userId: f.otherUserId, role: 'FUNCTIONAL_CONSULTANT', assignedModules: ['r2r', 'p2p'] },
    });
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/roles`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const rows = (list.json() as { data: Array<{ userId: string; role: string; assignedModules: string[] | null }> }).data;
    expect(rows[0].assignedModules).toEqual(['r2r', 'p2p']);
  });

  it('rejects a firm-level role on the engagement endpoint', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/roles`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { userId: f.otherUserId, role: 'APP_ADMIN' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('returns 403 for non-admin attempts to grant', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/roles`,
      headers: { authorization: `Bearer ${f.otherToken}` },
      payload: { userId: f.adminUserId, role: 'PROJECT_MANAGER' },
    });
    expect(r.statusCode).toBe(403);
  });
});

// ─── Audit log ───────────────────────────────────────────────────────────────

describe('GET /firm/role-audit-log', () => {
  it('returns recent grant/revoke entries for APP_ADMIN', async () => {
    const f = await seed();
    // The bootstrap itself wrote a ROLE_GRANTED entry — start from there.
    await app.inject({
      method: 'POST',
      url: '/api/v1/firm/roles',
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { userId: f.otherUserId, role: 'INTERNAL_ACCOUNTANT' },
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/role-audit-log',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const log = (r.json() as { data: Array<{ action: string; role: string }> }).data;
    expect(log.some((l) => l.action === 'ROLE_GRANTED' && l.role === 'APP_ADMIN')).toBe(true);
    expect(log.some((l) => l.action === 'ROLE_GRANTED' && l.role === 'INTERNAL_ACCOUNTANT')).toBe(true);
  });
});
