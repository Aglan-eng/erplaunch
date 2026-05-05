import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import nodemailer from 'nodemailer';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import { portalRoutes } from '../../src/routes/portal.js';
import { portalAuthRoutes } from '../../src/routes/portalAuth.js';
import { pendingSubmissionsRoutes } from '../../src/routes/pendingSubmissions.js';
import { getDb, upsertFirmEmailSettings } from '../../src/db/index.js';
import { __setTestTransportFactory } from '../../src/services/emailTransport.js';
import {
  __resetTestAcceptorInvocations,
  __getTestAcceptorInvocations,
  registerAcceptor,
  type PendingSubmissionAcceptor,
} from '../../src/services/pendingSubmissionAcceptors.js';
import { z } from 'zod';
import { registerSubmissionPayloadSchema } from '../../src/services/pendingSubmissionPayloadSchemas.js';
import { createPendingSubmission } from '../../src/db/pendingSubmission.js';

/**
 * Phase 28 — pending-submission endpoint coverage.
 *
 * Test plan (from design §7):
 *   CLIENT POST /portal/submissions:
 *     - 401 without portal session cookie
 *     - 400 on missing/unknown targetType
 *     - 400 on payload schema failure
 *     - 201 happy path with TEST targetType
 *
 *   CONSULTANT GET /engagements/:id/pending-submissions:
 *     - 401 without auth
 *     - 404 on engagement not in firm
 *     - default returns only PENDING; ?status=ALL returns all
 *     - sorted createdAt DESC
 *     - submitter name enrichment
 *
 *   CONSULTANT POST .../accept:
 *     - 401 without auth
 *     - 404 on engagement not in firm
 *     - 404 on submission not in engagement
 *     - 409 on submission already ACCEPTED / REJECTED
 *     - 500 on missing acceptor (use a never-registered targetType)
 *     - 200 happy path: acceptor invoked, status flipped, ActivityLog written
 *     - acceptor failure → 422 ACCEPTOR_FAILED, status stays PENDING
 *
 *   CONSULTANT POST .../reject:
 *     - 401 without auth
 *     - 409 on already-reviewed
 *     - 200 happy path: status flipped, NO acceptor invocation, ActivityLog written
 */

const JWT_SECRET = 'test-pending-submissions-jwt-secret';
const KEY_BACKUP = process.env.ERPLAUNCH_MASTER_KEY;
const PORTAL_SECRET_BACKUP = process.env.PORTAL_SESSION_COOKIE_SECRET;

let cleanup: () => void;
let app: FastifyInstance;
let capturedEmails: Array<{ to: string; text: string; html?: string; subject: string }> = [];

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });
  await f.register(jwt, {
    namespace: 'portal',
    secret: process.env.PORTAL_SESSION_COOKIE_SECRET || 'test-portal-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(portalAuthRoutes, { prefix: '/api/v1' });
  await f.register(portalRoutes, { prefix: '/api/v1' });
  await f.register(pendingSubmissionsRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

beforeAll(async () => {
  process.env.ERPLAUNCH_MASTER_KEY = 'a'.repeat(64);
  process.env.PORTAL_SESSION_COOKIE_SECRET = 'test-portal-secret-for-pending-suite';
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildTestApp();

  __setTestTransportFactory(() => {
    const t = nodemailer.createTransport({ jsonTransport: true });
    const orig = t.sendMail.bind(t);
    t.sendMail = async (msg: Parameters<typeof t.sendMail>[0]) => {
      const info = await orig(msg as Parameters<typeof orig>[0]);
      capturedEmails.push({
        to: String(msg.to ?? ''),
        subject: String(msg.subject ?? ''),
        text: String(msg.text ?? ''),
        html: msg.html as string | undefined,
      });
      return info;
    };
    return t as unknown as ReturnType<typeof nodemailer.createTransport>;
  });
});

afterAll(async () => {
  await app.close();
  cleanup();
  __setTestTransportFactory(null);
  if (KEY_BACKUP !== undefined) process.env.ERPLAUNCH_MASTER_KEY = KEY_BACKUP;
  else delete process.env.ERPLAUNCH_MASTER_KEY;
  if (PORTAL_SECRET_BACKUP !== undefined) process.env.PORTAL_SESSION_COOKIE_SECRET = PORTAL_SECRET_BACKUP;
  else delete process.env.PORTAL_SESSION_COOKIE_SECRET;
});

beforeEach(() => {
  capturedEmails = [];
  __resetTestAcceptorInvocations();
});

// ─── Test seed helpers ──────────────────────────────────────────────────────

async function seedFirmEmailSettings(firmId: string) {
  await upsertFirmEmailSettings(firmId, {
    fromEmail: 'portal@test-firm.example',
    fromName: 'Test Firm',
    smtpHost: 'smtp.test.example',
    smtpPort: 587,
    smtpSecure: true,
    smtpUsername: 'portal@test-firm.example',
    smtpPassword: 'smtp-secret',
    inboundProtocol: 'NONE',
  });
}

async function seedClientMember(engagementId: string, email = 'client@example.com', name = 'Client'): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [id, engagementId, name, 'Stakeholder', 'CLIENT', email, new Date().toISOString()],
  });
  return id;
}

async function seedConsultantUser(firmId: string): Promise<{ userId: string; token: string }> {
  const db = getDb();
  const userId = createId();
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Reviewer', passwordHash, 'CONSULTANT', new Date().toISOString()],
  });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Reviewer', email: `${userId}@example.com` });
  return { userId, token };
}

async function doFullPortalLogin(token: string, email: string): Promise<string> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/engagements/portal/request-access',
    payload: { email, engagementToken: token },
  });
  const code = capturedEmails[capturedEmails.length - 1].text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error('Magic-link code not captured in test transport');
  const verifyRes = await app.inject({
    method: 'POST',
    url: '/api/v1/engagements/portal/verify',
    payload: { email, engagementToken: token, code },
  });
  const setCookie = verifyRes.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : String(setCookie ?? '');
  const match = cookieHeader.match(/portal_token=([^;]+)/);
  if (!match) throw new Error('portal_token cookie missing from verify response');
  return match[1];
}

// ─── CLIENT POST /portal/submissions ────────────────────────────────────────

describe('POST /api/v1/portal/submissions (client)', () => {
  it('returns 401 without a portal session cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      payload: { targetType: 'TEST', payload: { hello: 'world' } },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 on missing targetType', async () => {
    const { firmId, token } = await seedEngagementWithToken({ firmName: 'A' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember((await seedEngagementWithToken({ firmName: 'A2' })).engagementId);
    // Re-seed the firm's email settings + member for the SAME token used to log in.
    const seedRes = await seedEngagementWithToken({ firmName: 'Submit400Firm' });
    await seedFirmEmailSettings(seedRes.firmId);
    await seedClientMember(seedRes.engagementId, 'submit400@example.com');
    const portalToken = await doFullPortalLogin(seedRes.token, 'submit400@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: { payload: {} },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
    void token; void firmId;
  });

  it('returns 400 on unknown targetType', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'UnknownTypeFirm' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'unk@example.com');
    const portalToken = await doFullPortalLogin(token, 'unk@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: { targetType: 'BOGUS_TYPE', payload: {} },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when no payload schema is registered for the targetType', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'NoSchemaFirm' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'noschema@example.com');
    const portalToken = await doFullPortalLogin(token, 'noschema@example.com');

    // QA_MESSAGE has no schema registered in Phase 28 — Phase 31 will add it.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: { targetType: 'QA_MESSAGE', payload: {} },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('UNKNOWN_TARGET_TYPE');
  });

  it('returns 400 when the payload fails registered schema validation', async () => {
    // Register a strict schema for a never-tested-elsewhere targetType so we
    // can exercise the validation path without disturbing the TEST schema.
    registerSubmissionPayloadSchema('DECISION_SIGNOFF', z.object({ agree: z.boolean() }));

    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'BadPayload' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'bp@example.com');
    const portalToken = await doFullPortalLogin(token, 'bp@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: { targetType: 'DECISION_SIGNOFF', payload: { agree: 'yes' } },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; details?: Array<{ path: string }> } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.[0].path).toBe('agree');
  });

  it('returns 201 on happy path with TEST targetType', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'HappyClient' });
    await seedFirmEmailSettings(firmId);
    const memberId = await seedClientMember(engagementId, 'happy@example.com');
    const portalToken = await doFullPortalLogin(token, 'happy@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: { targetType: 'TEST', payload: { foo: 'bar' } },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string; engagementId: string; memberId: string; status: string; payload: Record<string, unknown> } };
    expect(body.data.engagementId).toBe(engagementId);
    expect(body.data.memberId).toBe(memberId);
    expect(body.data.status).toBe('PENDING');
    expect(body.data.payload).toEqual({ foo: 'bar' });
  });

  it('preserves an explicit targetId on create', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'TargetIdFirm' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'tid@example.com');
    const portalToken = await doFullPortalLogin(token, 'tid@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: { targetType: 'TEST', targetId: 'item-abc', payload: {} },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { data: { targetId: string } }).data.targetId).toBe('item-abc');
  });
});

// ─── CONSULTANT GET /engagements/:id/pending-submissions ────────────────────

describe('GET /api/v1/engagements/:id/pending-submissions (consultant)', () => {
  it('returns 401 without auth', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/pending-submissions`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when the engagement does not belong to the firm', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'OwnerFirm' });
    const otherFirm = await seedEngagementWithToken({ firmName: 'AttackerFirm' });
    const { token } = await seedConsultantUser(otherFirm.firmId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/pending-submissions`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(404);
  });

  it('defaults to PENDING-only', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'ListPendingFirm' });
    const memberId = await seedClientMember(engagementId);
    const { token } = await seedConsultantUser(firmId);

    const a = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });
    await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });

    // Reject one to verify the default filter excludes it
    const reviewer = await seedConsultantUser(firmId);
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${a.id}/reject`,
      cookies: { token: reviewer.token },
      payload: {},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/pending-submissions`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ status: string }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0].status).toBe('PENDING');
  });

  it('returns ALL submissions when ?status=ALL', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'ListAllFirm' });
    const memberId = await seedClientMember(engagementId);
    const { token } = await seedConsultantUser(firmId);

    const first = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });
    await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${first.id}/reject`,
      cookies: { token },
      payload: {},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/pending-submissions?status=ALL`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ status: string }> };
    expect(body.data.length).toBe(2);
    expect(body.data.map((s) => s.status).sort()).toEqual(['PENDING', 'REJECTED']);
  });

  it('enriches results with submitter member name', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'EnrichFirm' });
    const memberId = await seedClientMember(engagementId, 'jane@example.com', 'Jane Doe');
    const { token } = await seedConsultantUser(firmId);

    await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/pending-submissions`,
      cookies: { token },
    });
    const body = res.json() as { data: Array<{ memberName: string; memberId: string }> };
    expect(body.data[0].memberId).toBe(memberId);
    expect(body.data[0].memberName).toBe('Jane Doe');
  });

  it('orders results by createdAt DESC', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'OrderFirm' });
    const memberId = await seedClientMember(engagementId);
    const { token } = await seedConsultantUser(firmId);

    await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: { i: 1 } });
    await new Promise((r) => setTimeout(r, 15));
    await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: { i: 2 } });
    await new Promise((r) => setTimeout(r, 15));
    await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: { i: 3 } });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/pending-submissions`,
      cookies: { token },
    });
    const body = res.json() as { data: Array<{ payload: { i: number } }> };
    expect(body.data.map((s) => s.payload.i)).toEqual([3, 2, 1]);
  });
});

// ─── CONSULTANT POST .../accept ─────────────────────────────────────────────

describe('POST /api/v1/engagements/:id/pending-submissions/:submissionId/accept', () => {
  it('returns 401 without auth', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedClientMember(engagementId);
    const sub = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/accept`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when engagement does not belong to firm', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'OwnerOfSub' });
    const memberId = await seedClientMember(engagementId);
    const sub = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });

    const attacker = await seedEngagementWithToken({ firmName: 'AttackerForAccept' });
    const { token } = await seedConsultantUser(attacker.firmId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/accept`,
      cookies: { token },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when submission does not belong to the engagement', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'EngA' });
    const otherEng = await seedEngagementWithToken({ firmName: 'EngB' });
    const otherMember = await seedClientMember(otherEng.engagementId);
    const sub = await createPendingSubmission({
      engagementId: otherEng.engagementId,
      memberId: otherMember,
      targetType: 'TEST',
      payload: {},
    });
    const { token } = await seedConsultantUser(firmId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/accept`,
      cookies: { token },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when submission is already ACCEPTED', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'AlreadyAccepted' });
    const memberId = await seedClientMember(engagementId);
    const sub = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });
    const { token } = await seedConsultantUser(firmId);

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/accept`,
      cookies: { token },
      payload: {},
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/accept`,
      cookies: { token },
      payload: {},
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe('ALREADY_REVIEWED');
  });

  it('returns 409 when submission is already REJECTED', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'AlreadyRejected' });
    const memberId = await seedClientMember(engagementId);
    const sub = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });
    const { token } = await seedConsultantUser(firmId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/reject`,
      cookies: { token },
      payload: {},
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/accept`,
      cookies: { token },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 500 NO_ACCEPTOR_REGISTERED when no acceptor exists for targetType', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'NoAcceptor' });
    const memberId = await seedClientMember(engagementId);
    // Phase 28 has not registered an acceptor for QA_MESSAGE — perfect target.
    const sub = await createPendingSubmission({ engagementId, memberId, targetType: 'QA_MESSAGE', payload: {} });
    const { token } = await seedConsultantUser(firmId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/accept`,
      cookies: { token },
      payload: {},
    });
    expect(res.statusCode).toBe(500);
    expect((res.json() as { error: { code: string } }).error.code).toBe('NO_ACCEPTOR_REGISTERED');
  });

  it('happy path: invokes acceptor, flips status, writes ActivityLog', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'HappyAccept' });
    const memberId = await seedClientMember(engagementId, 'jane@happy.example', 'Jane');
    const sub = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: { x: 1 } });
    const { userId, token } = await seedConsultantUser(firmId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/accept`,
      cookies: { token },
      payload: { comment: 'looks fine' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string; reviewerId: string; reviewedAt: string; reviewComment: string } };
    expect(body.data.status).toBe('ACCEPTED');
    expect(body.data.reviewerId).toBe(userId);
    expect(body.data.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.data.reviewComment).toBe('looks fine');

    // Acceptor invocation contract: exactly once, with the correct ctx
    const invocations = __getTestAcceptorInvocations();
    expect(invocations.length).toBe(1);
    expect(invocations[0].submission.id).toBe(sub.id);
    expect(invocations[0].ctx).toEqual({ engagementId, reviewerId: userId, firmId });

    // ActivityLog row created with the SUBMISSION_ACCEPTED action
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT * FROM ActivityLog WHERE engagementId = ? AND action = ?`,
      args: [engagementId, 'SUBMISSION_ACCEPTED'],
    });
    expect(r.rows.length).toBe(1);
    expect((r.rows[0].details as string)).toContain('Jane');
    expect((r.rows[0].details as string)).toContain('TEST');
    expect((r.rows[0].details as string)).toContain('looks fine');
  });

  it('acceptor failure → 422 ACCEPTOR_FAILED, status stays PENDING, no ActivityLog', async () => {
    // Register a throwing acceptor against a Phase-28-unused type. Use
    // DATA_FILE since it's not registered in Phase 28 either.
    const failingAcceptor: PendingSubmissionAcceptor = {
      targetType: 'DATA_FILE',
      async accept() {
        throw new Error('disk full');
      },
    };
    registerAcceptor(failingAcceptor);

    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'AcceptorFails' });
    const memberId = await seedClientMember(engagementId);
    const sub = await createPendingSubmission({ engagementId, memberId, targetType: 'DATA_FILE', payload: {} });
    const { token } = await seedConsultantUser(firmId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/accept`,
      cookies: { token },
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('ACCEPTOR_FAILED');
    expect(body.error.message).toContain('disk full');

    // Status stays PENDING so the consultant can retry after the underlying
    // failure is resolved.
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT status FROM PendingSubmission WHERE id = ?`,
      args: [sub.id],
    });
    expect((r.rows[0].status as string)).toBe('PENDING');

    // No ActivityLog written on failure (audit only on resolved transitions).
    const al = await db.execute({
      sql: `SELECT * FROM ActivityLog WHERE engagementId = ? AND action = ?`,
      args: [engagementId, 'SUBMISSION_ACCEPTED'],
    });
    expect(al.rows.length).toBe(0);
  });
});

// ─── CONSULTANT POST .../reject ─────────────────────────────────────────────

describe('POST /api/v1/engagements/:id/pending-submissions/:submissionId/reject', () => {
  it('returns 401 without auth', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedClientMember(engagementId);
    const sub = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/reject`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 409 on already-reviewed', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'RejTwice' });
    const memberId = await seedClientMember(engagementId);
    const sub = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });
    const { token } = await seedConsultantUser(firmId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/reject`,
      cookies: { token },
      payload: {},
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/reject`,
      cookies: { token },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  it('happy path: flips status, NO acceptor invocation, writes ActivityLog', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'HappyReject' });
    const memberId = await seedClientMember(engagementId, 'late@example.com', 'Late Submitter');
    const sub = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });
    const { userId, token } = await seedConsultantUser(firmId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/reject`,
      cookies: { token },
      payload: { comment: 'wrong period' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string; reviewerId: string; reviewComment: string } };
    expect(body.data.status).toBe('REJECTED');
    expect(body.data.reviewerId).toBe(userId);
    expect(body.data.reviewComment).toBe('wrong period');

    // §5.1 invariant: reject NEVER invokes the acceptor.
    expect(__getTestAcceptorInvocations().length).toBe(0);

    // ActivityLog written with the SUBMISSION_REJECTED action.
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT * FROM ActivityLog WHERE engagementId = ? AND action = ?`,
      args: [engagementId, 'SUBMISSION_REJECTED'],
    });
    expect(r.rows.length).toBe(1);
    expect((r.rows[0].details as string)).toContain('Late Submitter');
    expect((r.rows[0].details as string)).toContain('wrong period');
  });
});
