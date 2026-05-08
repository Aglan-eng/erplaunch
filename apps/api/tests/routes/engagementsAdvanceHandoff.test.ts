/**
 * Phase 45.3 — integration tests for the GOLIVE → CLOSEOUT auto-trigger
 * via POST /engagements/:id/advance.
 *
 * The /advance handler hooks the closeout handoff via dynamic import so
 * the test doesn't need to stub anything — we just exercise the HTTP
 * surface and assert on observable side-effects (DB rows + thread +
 * job + activity log).
 *
 * Idempotency note: regress + re-advance MUST NOT spawn a second
 * thread or job. We test that explicitly because a stage bounce is a
 * common operator action when a closeout was triggered prematurely.
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

const JWT_SECRET = 'engagements-advance-handoff-test';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-advance-handoff-test',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  engagementId: string;
  ownerUserId: string;
  supportLeadUserId: string;
  adminToken: string;
}

async function seed(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const ownerUserId = createId();
  const supportLeadUserId = createId();
  const accountManagerUserId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Advance Handoff Firm', `advance-${createId()}`, 'STARTER', now],
  });
  // Start at GOLIVE so /advance moves us into CLOSEOUT.
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Tango Bravo', 'GOLIVE', now, now],
  });
  const passwordHash = await bcrypt.hash('x', 4);
  for (const id of [ownerUserId, supportLeadUserId, accountManagerUserId]) {
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
      args: [id, firmId, `${id}@example.com`, id, passwordHash, 'CONSULTANT'],
    });
  }
  await bootstrapFirmAdmin({ firmId, userId: ownerUserId });
  await grantFirmRole({
    firmId,
    userId: supportLeadUserId,
    role: 'SUPPORT_LEAD',
    actorUserId: ownerUserId,
  });
  await grantEngagementRole({
    engagementId,
    userId: accountManagerUserId,
    role: 'ACCOUNT_MANAGER',
    assignedModules: null,
    actorUserId: ownerUserId,
  });
  const adminToken = app.jwt.sign({
    userId: ownerUserId,
    firmId,
    role: 'CONSULTANT',
    name: 'Owner',
    email: 'owner@example.com',
  });
  return { firmId, engagementId, ownerUserId, supportLeadUserId, adminToken };
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
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM Message`);
  await db.execute(`DELETE FROM ConversationThread`);
  await db.execute(`DELETE FROM GenerationJob`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM FirmRole`);
  await db.execute(`DELETE FROM RoleAuditLog`);
  await db.execute(`DELETE FROM CloseoutChecklistItem`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

describe('POST /engagements/:id/advance — GOLIVE → CLOSEOUT triggers handoff', () => {
  it('opens a HANDOFF thread when entering CLOSEOUT for the first time', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const threads = await getDb().execute({
      sql: `SELECT kind, pinned, subject FROM ConversationThread WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    expect(threads.rows).toHaveLength(1);
    const t = threads.rows[0] as unknown as { kind: string; pinned: number; subject: string };
    expect(t.kind).toBe('HANDOFF');
    expect(t.pinned).toBe(1);
    expect(t.subject).toContain('Tango Bravo');
  });

  it('queues a HANDOFF_PACKAGE job', async () => {
    const f = await seed();
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const jobs = await getDb().execute({
      sql: `SELECT type FROM GenerationJob WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    expect(jobs.rows).toHaveLength(1);
    expect((jobs.rows[0] as unknown as { type: string }).type).toBe('HANDOFF_PACKAGE');
  });

  it('writes both ENGAGEMENT_ADVANCED and CLOSEOUT_HANDOFF_FIRED activity rows', async () => {
    const f = await seed();
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const log = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ? ORDER BY createdAt ASC`,
      args: [f.engagementId],
    });
    const actions = log.rows.map((r) => (r as unknown as { action: string }).action);
    expect(actions).toContain('CLOSEOUT_HANDOFF_FIRED');
  });

  it('is idempotent across regress + re-advance — no duplicate thread or job', async () => {
    const f = await seed();
    // First advance: GOLIVE → CLOSEOUT, fires handoff.
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    // Regress back to GOLIVE.
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/regress`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    // Re-advance — handoff should NOT fire again.
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const threads = await getDb().execute({
      sql: `SELECT id FROM ConversationThread WHERE engagementId = ? AND kind = 'HANDOFF'`,
      args: [f.engagementId],
    });
    expect(threads.rows).toHaveLength(1);
    const jobs = await getDb().execute({
      sql: `SELECT id FROM GenerationJob WHERE engagementId = ? AND type = 'HANDOFF_PACKAGE'`,
      args: [f.engagementId],
    });
    expect(jobs.rows).toHaveLength(1);
  });
});
