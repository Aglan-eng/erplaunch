/**
 * Phase 45.1 — integration tests for the Closeout checklist routes.
 *
 * Exercises:
 *   - GET returns 9 rows in canonical order, all NOT_STARTED right
 *     after the GOLIVE → CLOSEOUT transition runs createCloseoutChecklist.
 *   - PATCH accepts valid status + notes + writes activity entry.
 *   - PATCH stamps completedBy / completedAt when status flips to DONE
 *     and clears them when flipping away.
 *   - PATCH 400s on unknown key + invalid status.
 *   - RBAC: a no-role user is 403'd.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { engagementRoutes } from '../../src/routes/engagements.js';
import { closeoutRoutes, __resetCloseoutChecklistRateLimit } from '../../src/routes/closeout.js';
import {
  getDb,
  bootstrapFirmAdmin,
  createCloseoutChecklist,
} from '../../src/db/index.js';

const JWT_SECRET = 'closeout-checklist-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-closeout-test-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.register(closeoutRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  engagementId: string;
  adminToken: string;
  noRoleToken: string;
}

async function seed(stage = 'CLOSEOUT'): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const adminId = createId();
  const noRoleId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Closeout Firm', `closeout-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Closeout Client', stage, now, now],
  });
  const passwordHash = await bcrypt.hash('x', 4);
  for (const id of [adminId, noRoleId]) {
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
      args: [id, firmId, `${id}@example.com`, id, passwordHash, 'CONSULTANT'],
    });
  }
  await bootstrapFirmAdmin({ firmId, userId: adminId });
  // Pre-create the checklist so tests can hit GET / PATCH directly
  // without going through the /advance flow each time.
  await createCloseoutChecklist(engagementId);

  const sign = (id: string) =>
    app.jwt.sign({ userId: id, firmId, role: 'CONSULTANT', name: id, email: `${id}@example.com` });
  return {
    firmId,
    engagementId,
    adminToken: sign(adminId),
    noRoleToken: sign(noRoleId),
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
  await db.execute(`DELETE FROM CloseoutChecklistItem`);
  await db.execute(`DELETE FROM ActivityLog`);
  // Phase 45.3 — entering CLOSEOUT now spawns a HANDOFF_PACKAGE job +
  // a HANDOFF ConversationThread. GenerationJob's engagementId FK is
  // not CASCADE, so we have to tear those down before the engagement
  // delete or it errors with SQLITE_CONSTRAINT_FOREIGNKEY. Message +
  // ConversationThread cascade automatically.
  await db.execute(`DELETE FROM Message`);
  await db.execute(`DELETE FROM ConversationThread`);
  await db.execute(`DELETE FROM GenerationJob`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
  __resetCloseoutChecklistRateLimit();
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /engagements/:id/closeout-checklist', () => {
  it('returns 9 rows in canonical order, all NOT_STARTED', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<{ key: string; status: string }> };
    expect(body.data).toHaveLength(9);
    expect(body.data.map((i) => i.key)).toEqual([
      'KNOWLEDGE_TRANSFER',
      'SYSTEM_CATALOG_REVIEWED',
      'INTEGRATION_LIST_CONFIRMED',
      'SUPPORT_CONTACTS_ASSIGNED',
      'SLA_TERMS_AGREED',
      'FINAL_INVOICE_PAID',
      'PRODUCTION_STABLE',
      'CLIENT_SIGNOFF',
      'SLA_TEAM_ACCEPT',
    ]);
    for (const i of body.data) expect(i.status).toBe('NOT_STARTED');
  });

  it('403s a no-role user', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist`,
      headers: { authorization: `Bearer ${f.noRoleToken}` },
    });
    expect(r.statusCode).toBe(403);
  });
});

// ─── /advance auto-creates the checklist ─────────────────────────────────────

describe('GOLIVE → CLOSEOUT transition auto-creates the checklist', () => {
  it('row count is 9 after a fresh advance into CLOSEOUT', async () => {
    const f = await seed('GOLIVE');
    // Strip the pre-created checklist so we can verify /advance creates it.
    await getDb().execute({
      sql: `DELETE FROM CloseoutChecklistItem WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { transition: { to: string } };
    expect(body.transition.to).toBe('CLOSEOUT');
    // Verify the checklist now has 9 rows.
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect((list.json() as { data: unknown[] }).data).toHaveLength(9);
  });

  it('re-advancing into CLOSEOUT does not duplicate rows', async () => {
    const f = await seed('GOLIVE');
    await getDb().execute({
      sql: `DELETE FROM CloseoutChecklistItem WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    // First advance creates 9 rows.
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    // Regress + re-advance — should be idempotent.
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/regress`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect((list.json() as { data: unknown[] }).data).toHaveLength(9);
  });
});

// ─── PATCH ───────────────────────────────────────────────────────────────────

describe('PATCH /engagements/:id/closeout-checklist/:key', () => {
  it('updates status + notes + stamps completedBy on DONE', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/KNOWLEDGE_TRANSFER`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'DONE', notes: 'Held the KT meeting on Friday.' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { status: string; notes: string; completedBy: string; completedAt: string } };
    expect(body.data.status).toBe('DONE');
    expect(body.data.notes).toBe('Held the KT meeting on Friday.');
    expect(body.data.completedBy).toBeTruthy();
    expect(body.data.completedAt).toBeTruthy();
  });

  it('clears completedBy / completedAt when status flips away from DONE', async () => {
    const f = await seed();
    // First set to DONE
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/KNOWLEDGE_TRANSFER`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'DONE' },
    });
    // Then back to IN_PROGRESS
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/KNOWLEDGE_TRANSFER`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'IN_PROGRESS' },
    });
    const body = r.json() as { data: { completedBy: string | null; completedAt: string | null } };
    expect(body.data.completedBy).toBeNull();
    expect(body.data.completedAt).toBeNull();
  });

  it('writes a CLOSEOUT_CHECKLIST_UPDATED activity entry', async () => {
    const f = await seed();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/SLA_TERMS_AGREED`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'IN_PROGRESS' },
    });
    const log = await getDb().execute({
      sql: `SELECT action, details FROM ActivityLog WHERE engagementId = ? ORDER BY createdAt DESC LIMIT 1`,
      args: [f.engagementId],
    });
    expect(log.rows).toHaveLength(1);
    const row = log.rows[0] as unknown as { action: string; details: string };
    expect(row.action).toBe('CLOSEOUT_CHECKLIST_UPDATED');
    expect(row.details).toContain('IN_PROGRESS');
  });

  it('rejects unknown checklist keys with 400', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/NOT_A_KEY`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'DONE' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects invalid status values with 400', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/KNOWLEDGE_TRANSFER`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'PARTIAL' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('403s a no-role user', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/KNOWLEDGE_TRANSFER`,
      headers: { authorization: `Bearer ${f.noRoleToken}` },
      payload: { status: 'DONE' },
    });
    expect(r.statusCode).toBe(403);
  });
});
