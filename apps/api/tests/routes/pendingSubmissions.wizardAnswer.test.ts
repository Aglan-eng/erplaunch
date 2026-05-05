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
import {
  getDb,
  upsertFirmEmailSettings,
  updatePortalSettings,
  getProfile,
  upsertProfile,
} from '../../src/db/index.js';
import { __setTestTransportFactory } from '../../src/services/emailTransport.js';
import { createPendingSubmission } from '../../src/db/pendingSubmission.js';
// Side-effect import — registers the WIZARD_ANSWER acceptor + payload schema.
import '../../src/services/wizardAnswerAcceptor.js';

/**
 * Phase 29 — WIZARD_ANSWER end-to-end coverage.
 *
 * Verifies the full client-submit -> consultant-accept loop and the new
 * GET /engagements/portal/:token/questions allowlist endpoint.
 */

const JWT_SECRET = 'test-wizard-answer-jwt';
const KEY_BACKUP = process.env.ERPLAUNCH_MASTER_KEY;
const PORTAL_SECRET_BACKUP = process.env.PORTAL_SESSION_COOKIE_SECRET;

let cleanup: () => void;
let app: FastifyInstance;
let capturedEmails: Array<{ to: string; text: string; html?: string; subject: string }> = [];

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
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
  process.env.PORTAL_SESSION_COOKIE_SECRET = 'test-portal-secret-for-wizard-answer';
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
});

async function seedFirmEmailSettings(firmId: string) {
  await upsertFirmEmailSettings(firmId, {
    fromEmail: 'p@x.example',
    fromName: 'F',
    smtpHost: 'h',
    smtpPort: 587,
    smtpSecure: true,
    smtpUsername: 'u',
    smtpPassword: 'p',
    inboundProtocol: 'NONE',
  });
}

async function seedClientMember(engagementId: string, email: string, name = 'Client'): Promise<string> {
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
  if (!code) throw new Error('Magic-link code not captured');
  const verifyRes = await app.inject({
    method: 'POST',
    url: '/api/v1/engagements/portal/verify',
    payload: { email, engagementToken: token, code },
  });
  const setCookie = verifyRes.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : String(setCookie ?? '');
  const match = cookieHeader.match(/portal_token=([^;]+)/);
  if (!match) throw new Error('portal_token cookie missing');
  return match[1];
}

// ─── POST /portal/submissions with WIZARD_ANSWER ─────────────────────────────

describe('POST /api/v1/portal/submissions — WIZARD_ANSWER targetType', () => {
  it('returns 201 on valid payload (questionId + answer)', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'WAHappy' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'wa1@example.com');
    const portalToken = await doFullPortalLogin(token, 'wa1@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'WIZARD_ANSWER',
        payload: { questionId: 'r2r.entities.multiEntity', answer: true },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { targetType: string; payload: Record<string, unknown> } };
    expect(body.data.targetType).toBe('WIZARD_ANSWER');
    expect(body.data.payload).toEqual({ questionId: 'r2r.entities.multiEntity', answer: true });
  });

  it('returns 400 when questionId is missing from the payload', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'WANoQuestionId' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'wa2@example.com');
    const portalToken = await doFullPortalLogin(token, 'wa2@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: { targetType: 'WIZARD_ANSWER', payload: { answer: 'x' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when questionId is not a string', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'WANonString' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'wa3@example.com');
    const portalToken = await doFullPortalLogin(token, 'wa3@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: { targetType: 'WIZARD_ANSWER', payload: { questionId: 123, answer: true } },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── GET /engagements/portal/:token/questions ────────────────────────────────

describe('GET /api/v1/engagements/portal/:token/questions', () => {
  it('returns 401 without a portal session', async () => {
    const { token } = await seedEngagementWithToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${token}/questions`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns [] when allowlist is empty (default state)', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'EmptyList' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'el@example.com');
    const portalToken = await doFullPortalLogin(token, 'el@example.com');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${token}/questions`,
      headers: { cookie: `portal_token=${portalToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toEqual([]);
  });

  it('returns the allowlisted questions hydrated from the question bank', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'Hydrated' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'h@example.com');
    await updatePortalSettings(engagementId, {
      clientAnsweredQuestionIds: ['r2r.entities.multiEntity'],
    });
    const portalToken = await doFullPortalLogin(token, 'h@example.com');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${token}/questions`,
      headers: { cookie: `portal_token=${portalToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; flow: string; section: string; label: string }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe('r2r.entities.multiEntity');
    expect(body.data[0].flow).toBe('R2R');
    expect(body.data[0].label).toBeDefined();
  });

  it('filters out questions already in BusinessProfile.answers', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'AlreadyAnswered' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'aa@example.com');
    await updatePortalSettings(engagementId, {
      clientAnsweredQuestionIds: ['r2r.entities.multiEntity', 'r2r.entities.entityCount'],
    });
    await upsertProfile(engagementId, { 'r2r.entities.multiEntity': true });
    const portalToken = await doFullPortalLogin(token, 'aa@example.com');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${token}/questions`,
      headers: { cookie: `portal_token=${portalToken}` },
    });
    const body = res.json() as { data: Array<{ id: string }> };
    const ids = body.data.map((q) => q.id);
    expect(ids).not.toContain('r2r.entities.multiEntity');
    // Either way, gstEnabled is allowlisted but not yet answered → present
    expect(ids).toContain('r2r.entities.entityCount');
  });

  it('filters out questions with an in-flight PENDING WIZARD_ANSWER submission', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'InFlight' });
    await seedFirmEmailSettings(firmId);
    const memberId = await seedClientMember(engagementId, 'if@example.com');
    await updatePortalSettings(engagementId, {
      clientAnsweredQuestionIds: ['r2r.entities.multiEntity'],
    });
    await createPendingSubmission({
      engagementId,
      memberId,
      targetType: 'WIZARD_ANSWER',
      payload: { questionId: 'r2r.entities.multiEntity', answer: true },
    });
    const portalToken = await doFullPortalLogin(token, 'if@example.com');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${token}/questions`,
      headers: { cookie: `portal_token=${portalToken}` },
    });
    expect((res.json() as { data: unknown[] }).data).toEqual([]);
  });

  it('drops stale allowlist entries that no longer exist in the question bank', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'Stale' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'st@example.com');
    await updatePortalSettings(engagementId, {
      clientAnsweredQuestionIds: ['r2r.entities.multiEntity', 'r2r.removed.legacyQuestion'],
    });
    const portalToken = await doFullPortalLogin(token, 'st@example.com');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${token}/questions`,
      headers: { cookie: `portal_token=${portalToken}` },
    });
    const body = res.json() as { data: Array<{ id: string }> };
    expect(body.data.map((q) => q.id)).toEqual(['r2r.entities.multiEntity']);
  });
});

// ─── End-to-end: client submits → consultant accepts → answer in profile ─────

describe('end-to-end: WIZARD_ANSWER submit → accept', () => {
  it('on accept, answer lands in BusinessProfile.answers', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'E2EAccept' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'e1@example.com');
    const portalToken = await doFullPortalLogin(token, 'e1@example.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);

    // Client submits.
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'WIZARD_ANSWER',
        payload: { questionId: 'r2r.entities.multiEntity', answer: true },
      },
    });
    expect(submit.statusCode).toBe(201);
    const submission = (submit.json() as { data: { id: string } }).data;

    // Consultant accepts.
    const accept = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${submission.id}/accept`,
      cookies: { token: consultantToken },
      payload: { comment: 'looks good' },
    });
    expect(accept.statusCode).toBe(200);

    // Answer is now in profile.
    const profile = await getProfile(engagementId);
    expect((profile?.answers as Record<string, unknown>)['r2r.entities.multiEntity']).toBe(true);
  });

  it('on reject, answer does NOT land in BusinessProfile.answers', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'E2EReject' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'e2@example.com');
    const portalToken = await doFullPortalLogin(token, 'e2@example.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);

    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'WIZARD_ANSWER',
        payload: { questionId: 'r2r.entities.multiEntity', answer: true },
      },
    });
    const submission = (submit.json() as { data: { id: string } }).data;

    const reject = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${submission.id}/reject`,
      cookies: { token: consultantToken },
      payload: { comment: 'wrong answer' },
    });
    expect(reject.statusCode).toBe(200);

    const profile = await getProfile(engagementId);
    const answers = (profile?.answers as Record<string, unknown> | undefined) ?? {};
    expect(answers['r2r.entities.multiEntity']).toBeUndefined();
  });

  it('after reject, client can re-submit and the second accept lands the answer', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'ResubmitAfterReject' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'rr@example.com');
    const portalToken = await doFullPortalLogin(token, 'rr@example.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);

    const submit1 = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: { targetType: 'WIZARD_ANSWER', payload: { questionId: 'q.x', answer: 'first' } },
    });
    const sub1 = (submit1.json() as { data: { id: string } }).data;
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub1.id}/reject`,
      cookies: { token: consultantToken },
      payload: {},
    });

    const submit2 = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: { targetType: 'WIZARD_ANSWER', payload: { questionId: 'q.x', answer: 'second' } },
    });
    const sub2 = (submit2.json() as { data: { id: string } }).data;
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub2.id}/accept`,
      cookies: { token: consultantToken },
      payload: {},
    });

    const profile = await getProfile(engagementId);
    expect((profile?.answers as Record<string, unknown>)['q.x']).toBe('second');
  });
});
