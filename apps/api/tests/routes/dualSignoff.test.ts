/**
 * Phase 45.4 — integration tests for the CLOSEOUT → SLA_ACTIVE dual
 * sign-off gate.
 *
 * Two checklist items must be DONE (or NA) before /advance lets a
 * CLOSEOUT engagement progress to SLA_ACTIVE:
 *
 *   - CLIENT_SIGNOFF — flipped via the portal-side
 *     POST /engagements/portal/:token/closeout-signoff endpoint, or
 *     by an APP_ADMIN override on the consultant-side PATCH.
 *   - SLA_TEAM_ACCEPT — flipped by a SUPPORT_LEAD (or APP_ADMIN
 *     override) on the consultant-side PATCH.
 *
 * The PATCH gate also enforces:
 *   - CLIENT_SIGNOFF refuses non-admin consultants with
 *     CLIENT_SIGNOFF_VIA_PORTAL (so the audit trail accurately
 *     records the portal member who signed off).
 *   - SLA_TEAM_ACCEPT refuses non-SUPPORT_LEAD non-admins with
 *     SUPPORT_LEAD_REQUIRED.
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
  closeoutRoutes,
  __resetCloseoutChecklistRateLimit,
} from '../../src/routes/closeout.js';
import {
  getDb,
  bootstrapFirmAdmin,
  grantFirmRole,
  createCloseoutChecklist,
} from '../../src/db/index.js';

const JWT_SECRET = 'dual-signoff-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-dual-signoff-test',
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
  adminUserId: string;
  supportLeadUserId: string;
  consultantUserId: string;
  adminToken: string;
  supportLeadToken: string;
  consultantToken: string;
}

async function seed(stage = 'CLOSEOUT'): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const adminUserId = createId();
  const supportLeadUserId = createId();
  const consultantUserId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Dual Sign-off Firm', `dual-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Client X', stage, now, now],
  });
  const passwordHash = await bcrypt.hash('x', 4);
  for (const id of [adminUserId, supportLeadUserId, consultantUserId]) {
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
      args: [id, firmId, `${id}@example.com`, id, passwordHash, 'CONSULTANT'],
    });
  }
  await bootstrapFirmAdmin({ firmId, userId: adminUserId });
  // Make consultant + supportLead also APP_ADMIN-bypassed for the
  // base permission gate on PATCH (ENGAGEMENT_META WRITE), but only
  // grant SUPPORT_LEAD to the support lead. The SLA_TEAM_ACCEPT
  // sub-gate in PATCH then differentiates them.
  await grantFirmRole({
    firmId,
    userId: supportLeadUserId,
    role: 'SUPPORT_LEAD',
    actorUserId: adminUserId,
  });
  // The "consultant" stand-in has ACCOUNT_MANAGER on this engagement —
  // the matrix grants ACCOUNT_MANAGER WRITE on ENGAGEMENT_META during
  // CLOSEOUT, so the base requirePermission gate passes. That lets the
  // role-specific sub-gate inside the PATCH handler fire (this is the
  // path we're actually trying to test).
  await db.execute({
    sql: `INSERT INTO EngagementRole (id, engagementId, userId, role, assignedModules) VALUES (?,?,?,?,?)`,
    args: [createId(), engagementId, consultantUserId, 'ACCOUNT_MANAGER', null],
  });
  await createCloseoutChecklist(engagementId);
  const sign = (id: string) =>
    app.jwt.sign({ userId: id, firmId, role: 'CONSULTANT', name: id, email: `${id}@example.com` });
  return {
    firmId,
    engagementId,
    adminUserId,
    supportLeadUserId,
    consultantUserId,
    adminToken: sign(adminUserId),
    supportLeadToken: sign(supportLeadUserId),
    consultantToken: sign(consultantUserId),
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
  await db.execute(`DELETE FROM Message`);
  await db.execute(`DELETE FROM ConversationThread`);
  await db.execute(`DELETE FROM GenerationJob`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
  __resetCloseoutChecklistRateLimit();
});

// ─── /advance gate ────────────────────────────────────────────────────────────

describe('POST /engagements/:id/advance — CLOSEOUT → SLA_ACTIVE gate', () => {
  it('refuses with 409 DUAL_SIGNOFF_REQUIRED when both blockers are NOT_STARTED', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(409);
    const body = r.json() as { error: { code: string; blocking: string[] } };
    expect(body.error.code).toBe('DUAL_SIGNOFF_REQUIRED');
    expect(body.error.blocking).toContain('CLIENT_SIGNOFF');
    expect(body.error.blocking).toContain('SLA_TEAM_ACCEPT');
  });

  it('refuses when only CLIENT_SIGNOFF is DONE', async () => {
    const f = await seed();
    // Admin override flips CLIENT_SIGNOFF.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/CLIENT_SIGNOFF`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'DONE' },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(409);
    const body = r.json() as { error: { blocking: string[] } };
    expect(body.error.blocking).toEqual(['SLA_TEAM_ACCEPT']);
  });

  it('refuses when only SLA_TEAM_ACCEPT is DONE', async () => {
    const f = await seed();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/SLA_TEAM_ACCEPT`,
      headers: { authorization: `Bearer ${f.supportLeadToken}` },
      payload: { status: 'DONE' },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(409);
    const body = r.json() as { error: { blocking: string[] } };
    expect(body.error.blocking).toEqual(['CLIENT_SIGNOFF']);
  });

  it('advances with both DONE', async () => {
    const f = await seed();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/CLIENT_SIGNOFF`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'DONE' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/SLA_TEAM_ACCEPT`,
      headers: { authorization: `Bearer ${f.supportLeadToken}` },
      payload: { status: 'DONE' },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { transition: { to: string } };
    expect(body.transition.to).toBe('SLA_ACTIVE');
  });

  it('advances when both blockers are NA (waiver path)', async () => {
    const f = await seed();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/CLIENT_SIGNOFF`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'NA' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/SLA_TEAM_ACCEPT`,
      headers: { authorization: `Bearer ${f.supportLeadToken}` },
      payload: { status: 'NA' },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/advance`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
  });
});

// ─── PATCH role gates on the two blocker keys ───────────────────────────────

describe('PATCH /closeout-checklist — sign-off key role gates', () => {
  it('SUPPORT_LEAD can flip SLA_TEAM_ACCEPT', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/SLA_TEAM_ACCEPT`,
      headers: { authorization: `Bearer ${f.supportLeadToken}` },
      payload: { status: 'DONE' },
    });
    expect(r.statusCode).toBe(200);
  });

  it('a non-SUPPORT_LEAD consultant gets 403 SUPPORT_LEAD_REQUIRED', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/SLA_TEAM_ACCEPT`,
      headers: { authorization: `Bearer ${f.consultantToken}` },
      payload: { status: 'DONE' },
    });
    expect(r.statusCode).toBe(403);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe('SUPPORT_LEAD_REQUIRED');
  });

  it('CLIENT_SIGNOFF refuses a non-admin consultant with CLIENT_SIGNOFF_VIA_PORTAL', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/CLIENT_SIGNOFF`,
      headers: { authorization: `Bearer ${f.consultantToken}` },
      payload: { status: 'DONE' },
    });
    expect(r.statusCode).toBe(403);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe('CLIENT_SIGNOFF_VIA_PORTAL');
  });

  it('CLIENT_SIGNOFF allows an APP_ADMIN override (audit-only path)', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/CLIENT_SIGNOFF`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'DONE' },
    });
    expect(r.statusCode).toBe(200);
  });

  it('non-blocker keys (KNOWLEDGE_TRANSFER) are not gated by the new sub-rules', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/KNOWLEDGE_TRANSFER`,
      headers: { authorization: `Bearer ${f.consultantToken}` },
      payload: { status: 'DONE' },
    });
    expect(r.statusCode).toBe(200);
  });
});
