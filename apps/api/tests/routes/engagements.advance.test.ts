/**
 * Phase 43.3 — coverage for POST /engagements/:id/advance and
 * POST /engagements/:id/regress.
 *
 * Verifies:
 *   - happy path advances by one stage
 *   - terminal/initial stage 409s
 *   - handoff events fire the right activity log entry on the right
 *     transitions (HANDOFF_TO_IMPLEMENTATION on PROPOSED → CONTRACTED,
 *     HANDOFF_TO_CLOSEOUT on GOLIVE → CLOSEOUT, HANDOFF_TO_SLA on
 *     CLOSEOUT → SLA_ACTIVE, plain STAGE_ADVANCED otherwise)
 *   - regress fires ENGAGEMENT_REGRESSED
 *   - 404 when the engagement isn't owned by the user's firm
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
} from '../../src/db/index.js';

const JWT_SECRET = 'lifecycle-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-lifecycle-test-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

async function seedAt(stage: string): Promise<{ engagementId: string; firmId: string; userId: string; token: string }> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const engagementId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Lifecycle Firm', `lifecycle-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Test', passwordHash, 'CONSULTANT', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Lifecycle Client', stage, now, now],
  });
  await bootstrapFirmAdmin({ firmId, userId });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Test', email: `${userId}@example.com` });
  return { engagementId, firmId, userId, token };
}

async function lastActivityAction(engagementId: string): Promise<string | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT action FROM ActivityLog WHERE engagementId = ? ORDER BY createdAt DESC LIMIT 1`,
    args: [engagementId],
  });
  if (r.rows.length === 0) return null;
  return (r.rows[0] as Record<string, unknown>).action as string;
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

// ─── /advance happy path ─────────────────────────────────────────────────────

describe('POST /engagements/:id/advance', () => {
  it('advances PROSPECT → PROPOSED with a STAGE_ADVANCED audit entry', async () => {
    const { engagementId, token } = await seedAt('PROSPECT');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/advance`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { transition: { from: string; to: string; event: string } };
    expect(body.transition).toEqual({ from: 'PROSPECT', to: 'PROPOSED', event: 'STAGE_ADVANCED' });
    expect(await lastActivityAction(engagementId)).toBe('STAGE_ADVANCED');
  });

  it('fires HANDOFF_TO_IMPLEMENTATION on PROPOSED → CONTRACTED', async () => {
    const { engagementId, token } = await seedAt('PROPOSED');
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/advance`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await lastActivityAction(engagementId)).toBe('HANDOFF_TO_IMPLEMENTATION');
  });

  it('fires HANDOFF_TO_CLOSEOUT on GOLIVE → CLOSEOUT', async () => {
    const { engagementId, token } = await seedAt('GOLIVE');
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/advance`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await lastActivityAction(engagementId)).toBe('HANDOFF_TO_CLOSEOUT');
  });

  it('fires HANDOFF_TO_SLA on CLOSEOUT → SLA_ACTIVE', async () => {
    const { engagementId, token } = await seedAt('CLOSEOUT');
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/advance`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await lastActivityAction(engagementId)).toBe('HANDOFF_TO_SLA');
  });

  it('returns 409 from the terminal ARCHIVED stage', async () => {
    const { engagementId, token } = await seedAt('ARCHIVED');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/advance`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('TERMINAL_STAGE');
  });

  it('normalises legacy GO_LIVE to GOLIVE before advancing', async () => {
    const { engagementId, token } = await seedAt('GO_LIVE');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/advance`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { transition: { to: string; event: string } };
    expect(body.transition.to).toBe('CLOSEOUT');
    expect(body.transition.event).toBe('HANDOFF_TO_CLOSEOUT');
  });

  it('returns 404 when the engagement is in a different firm', async () => {
    const { engagementId } = await seedAt('PROSPECT');
    const otherFirm = await seedAt('PROSPECT'); // different firm + token
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/advance`,
      headers: { authorization: `Bearer ${otherFirm.token}` },
    });
    expect(r.statusCode).toBe(404);
  });
});

// ─── /regress ────────────────────────────────────────────────────────────────

describe('POST /engagements/:id/regress', () => {
  it('moves backwards by one and fires ENGAGEMENT_REGRESSED', async () => {
    const { engagementId, token } = await seedAt('SLA_ACTIVE');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/regress`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { transition: { from: string; to: string; event: string } };
    expect(body.transition.to).toBe('CLOSEOUT');
    expect(body.transition.event).toBe('ENGAGEMENT_REGRESSED');
    expect(await lastActivityAction(engagementId)).toBe('ENGAGEMENT_REGRESSED');
  });

  it('returns 409 from the initial PROSPECT stage', async () => {
    const { engagementId, token } = await seedAt('PROSPECT');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/regress`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('INITIAL_STAGE');
  });
});
