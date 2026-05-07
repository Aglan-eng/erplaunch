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
import { threadsRoutes } from '../../src/routes/threads.js';
import { getDb, upsertFirmEmailSettings, bootstrapFirmAdmin } from '../../src/db/index.js';
import { __setTestTransportFactory } from '../../src/services/emailTransport.js';
import {
  createConversationThread,
  findConversationThreadById,
  listConversationThreadsByEngagement,
} from '../../src/db/conversationThread.js';
import {
  createMessage,
  listMessagesByThread,
  findMessageBySourceSubmissionId,
} from '../../src/db/message.js';
// Side-effect imports — register acceptors
import '../../src/services/qaMessageAcceptor.js';

/**
 * Phase 31 coverage — combined consultant routes, portal read endpoints,
 * acceptor flow, and DB layer behavior.
 */

const JWT_SECRET = 'test-threads-jwt';
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
  await f.register(threadsRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

beforeAll(async () => {
  process.env.ERPLAUNCH_MASTER_KEY = 'a'.repeat(64);
  process.env.PORTAL_SESSION_COOKIE_SECRET = 'test-portal-secret-for-threads';
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

beforeEach(() => { capturedEmails = []; });

async function seedFirmEmailSettings(firmId: string) {
  await upsertFirmEmailSettings(firmId, {
    fromEmail: 'p@x.example', fromName: 'F', smtpHost: 'h', smtpPort: 587, smtpSecure: true,
    smtpUsername: 'u', smtpPassword: 'p', inboundProtocol: 'NONE',
  });
}

async function seedClientMember(engagementId: string, email: string): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [id, engagementId, 'Client', 'Stakeholder', 'CLIENT', email, new Date().toISOString()],
  });
  return id;
}

async function seedConsultantUser(firmId: string): Promise<{ userId: string; token: string }> {
  const db = getDb();
  const userId = createId();
  const passwordHash = await bcrypt.hash('x', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@x.com`, 'C', passwordHash, 'CONSULTANT', new Date().toISOString()],
  });
  // Phase 44.3 — RBAC gate. Bootstrap APP_ADMIN for the consultant
  // so the now-gated /threads endpoints accept their requests.
  await bootstrapFirmAdmin({ firmId, userId });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'C', email: `${userId}@x.com` });
  return { userId, token };
}

async function doFullPortalLogin(token: string, email: string): Promise<string> {
  await app.inject({
    method: 'POST', url: '/api/v1/engagements/portal/request-access',
    payload: { email, engagementToken: token },
  });
  const code = capturedEmails[capturedEmails.length - 1].text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error('Magic-link code not captured');
  const verifyRes = await app.inject({
    method: 'POST', url: '/api/v1/engagements/portal/verify',
    payload: { email, engagementToken: token, code },
  });
  const sc = verifyRes.headers['set-cookie'];
  const cookieHeader = Array.isArray(sc) ? sc[0] : String(sc ?? '');
  const m = cookieHeader.match(/portal_token=([^;]+)/);
  if (!m) throw new Error('cookie missing');
  return m[1];
}

// ─── DB layer ────────────────────────────────────────────────────────────────

describe('ConversationThread + Message DB layer', () => {
  it('creates a thread + lists by engagement', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'DBT1' });
    const t = await createConversationThread({
      engagementId,
      subject: 'COA review',
      createdByUserId: 'user-x',
    });
    const list = await listConversationThreadsByEngagement(engagementId);
    expect(list.find((x) => x.id === t.id)).toBeTruthy();
    expect(t.status).toBe('OPEN');
    expect(t.lastMessageAt).toBeTruthy();
  });

  it('CONSULTANT message gets auto-acknowledged at insert', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'DBT2' });
    const t = await createConversationThread({
      engagementId, subject: 'X', createdByUserId: 'u',
    });
    const m = await createMessage({
      threadId: t.id, senderType: 'CONSULTANT', senderUserId: 'u', body: 'hi',
    });
    expect(m.acknowledgedAt).toBeTruthy();
    expect(m.senderMemberId).toBeNull();
  });

  it('CLIENT message stays unacknowledged until explicitly stamped', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'DBT3' });
    const t = await createConversationThread({
      engagementId, subject: 'X', createdByMemberId: 'mem-1',
    });
    const m = await createMessage({
      threadId: t.id, senderType: 'CLIENT', senderMemberId: 'mem-1', body: 'hello',
    });
    expect(m.acknowledgedAt).toBeNull();
    expect(m.senderUserId).toBeNull();
  });

  it('listMessagesByThread orders ascending by createdAt', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'DBT4' });
    const t = await createConversationThread({ engagementId, subject: 'X' });
    await createMessage({ threadId: t.id, senderType: 'CONSULTANT', senderUserId: 'u', body: 'm1' });
    await new Promise((r) => setTimeout(r, 10));
    await createMessage({ threadId: t.id, senderType: 'CLIENT', senderMemberId: 'm', body: 'm2' });
    await new Promise((r) => setTimeout(r, 10));
    await createMessage({ threadId: t.id, senderType: 'CONSULTANT', senderUserId: 'u', body: 'm3' });
    const msgs = await listMessagesByThread(t.id);
    expect(msgs.map((x) => x.body)).toEqual(['m1', 'm2', 'm3']);
  });

  it('findMessageBySourceSubmissionId returns the linked message', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'DBT5' });
    const t = await createConversationThread({ engagementId, subject: 'X' });
    const m = await createMessage({
      threadId: t.id,
      senderType: 'CLIENT',
      senderMemberId: 'mem-1',
      body: 'q',
      sourceSubmissionId: 'sub-link',
    });
    const found = await findMessageBySourceSubmissionId('sub-link');
    expect(found?.id).toBe(m.id);
    expect(await findMessageBySourceSubmissionId('no-such')).toBeNull();
  });
});

// ─── Consultant routes ──────────────────────────────────────────────────────

describe('Consultant /engagements/:id/threads endpoints', () => {
  it('401 without auth on GET threads', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/threads`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('404 on cross-firm engagement', async () => {
    const a = await seedEngagementWithToken({ firmName: 'A' });
    const b = await seedEngagementWithToken({ firmName: 'B' });
    const { token } = await seedConsultantUser(b.firmId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${a.engagementId}/threads`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST creates a thread + first consultant message bypassing pending-review', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'POSTthread' });
    const { token, userId } = await seedConsultantUser(firmId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/threads`,
      cookies: { token },
      payload: { subject: 'Tax setup', body: 'Hi — quick question on VAT registration?' },
    });
    expect(res.statusCode).toBe(201);
    const thread = (res.json() as { data: { id: string } }).data;

    const msgs = await listMessagesByThread(thread.id);
    expect(msgs.length).toBe(1);
    expect(msgs[0].senderType).toBe('CONSULTANT');
    expect(msgs[0].senderUserId).toBe(userId);
    // Asymmetry assertion: consultant message is auto-acknowledged.
    expect(msgs[0].acknowledgedAt).toBeTruthy();

    // No PendingSubmission row created for this consultant send.
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM PendingSubmission WHERE engagementId = ?`,
      args: [engagementId],
    });
    expect(Number((r.rows[0] as Record<string, unknown>).n)).toBe(0);
  });

  it('POST /messages on existing thread bypasses pending-review', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'POSTmsg' });
    const { token, userId } = await seedConsultantUser(firmId);
    const thread = await createConversationThread({
      engagementId, subject: 'X', createdByUserId: userId,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/threads/${thread.id}/messages`,
      cookies: { token },
      payload: { body: 'Following up.' },
    });
    expect(res.statusCode).toBe(201);
    const m = (res.json() as { data: { id: string; senderType: string; acknowledgedAt: string | null } }).data;
    expect(m.senderType).toBe('CONSULTANT');
    expect(m.acknowledgedAt).toBeTruthy();
  });

  it('GET /threads/:id returns thread + messages', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'GETt' });
    const { token } = await seedConsultantUser(firmId);
    const thread = await createConversationThread({ engagementId, subject: 'Q' });
    await createMessage({ threadId: thread.id, senderType: 'CONSULTANT', senderUserId: 'u', body: 'hi' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/threads/${thread.id}`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { thread: Record<string, unknown>; messages: Array<Record<string, unknown>> } };
    expect(body.data.thread.id).toBe(thread.id);
    expect(body.data.messages.length).toBe(1);
  });

  it('PATCH /threads/:id flips status to RESOLVED', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'PATCHt' });
    const { token } = await seedConsultantUser(firmId);
    const thread = await createConversationThread({ engagementId, subject: 'X' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engagementId}/threads/${thread.id}`,
      cookies: { token },
      payload: { status: 'RESOLVED' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('RESOLVED');
  });

  it('returns 400 on missing subject/body for thread creation', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'BadCreate' });
    const { token } = await seedConsultantUser(firmId);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/threads`,
      cookies: { token },
      payload: { subject: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── End-to-end client→consultant via QA_MESSAGE submission ──────────────────

describe('end-to-end QA_MESSAGE: client submits → accept → message lands', () => {
  it('happy path: submit (with new threadId=null) → accept creates thread + message', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'E2EQA' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'qa@x.com');
    const portalToken = await doFullPortalLogin(token, 'qa@x.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);

    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'QA_MESSAGE',
        payload: { threadId: null, subject: 'Question on PO approvals', body: 'How should over-AED-50k POs route?' },
      },
    });
    expect(submit.statusCode).toBe(201);
    const submission = (submit.json() as { data: { id: string } }).data;

    const accept = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${submission.id}/accept`,
      cookies: { token: consultantToken },
      payload: {},
    });
    expect(accept.statusCode).toBe(200);

    // Thread + message created
    const threads = await listConversationThreadsByEngagement(engagementId);
    expect(threads.length).toBe(1);
    expect(threads[0].subject).toBe('Question on PO approvals');
    const msgs = await listMessagesByThread(threads[0].id);
    expect(msgs.length).toBe(1);
    expect(msgs[0].senderType).toBe('CLIENT');
    expect(msgs[0].acknowledgedAt).toBeTruthy(); // stamped by accept
    expect(msgs[0].sourceSubmissionId).toBe(submission.id);
  });

  it('reply to existing thread: submit with threadId → accept appends message', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'E2EReply' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 're@x.com');
    const portalToken = await doFullPortalLogin(token, 're@x.com');
    const { token: consultantToken, userId } = await seedConsultantUser(firmId);

    // Consultant creates the thread first.
    const thread = await createConversationThread({
      engagementId, subject: 'Originally consultant', createdByUserId: userId,
    });
    await createMessage({
      threadId: thread.id, senderType: 'CONSULTANT', senderUserId: userId, body: 'open question?',
    });

    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'QA_MESSAGE',
        payload: { threadId: thread.id, body: 'My answer is X.' },
      },
    });
    const submission = (submit.json() as { data: { id: string } }).data;
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${submission.id}/accept`,
      cookies: { token: consultantToken },
      payload: {},
    });

    const msgs = await listMessagesByThread(thread.id);
    expect(msgs.length).toBe(2);
    expect(msgs[1].senderType).toBe('CLIENT');
    expect(msgs[1].body).toBe('My answer is X.');
  });

  it('reject: NO message created, thread unchanged', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'E2ERej' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'rj@x.com');
    const portalToken = await doFullPortalLogin(token, 'rj@x.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);

    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'QA_MESSAGE',
        payload: { threadId: null, subject: 'Will be rejected', body: 'spam' },
      },
    });
    const submission = (submit.json() as { data: { id: string } }).data;
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${submission.id}/reject`,
      cookies: { token: consultantToken },
      payload: { comment: 'off-topic' },
    });

    const threads = await listConversationThreadsByEngagement(engagementId);
    expect(threads.length).toBe(0);
  });

  it('cross-engagement threadId in payload throws ACCEPTOR_FAILED 422', async () => {
    const a = await seedEngagementWithToken({ firmName: 'CrossA' });
    const b = await seedEngagementWithToken({ firmName: 'CrossB' });
    await seedFirmEmailSettings(a.firmId);
    await seedClientMember(a.engagementId, 'ca@x.com');
    const portalToken = await doFullPortalLogin(a.token, 'ca@x.com');
    const { token: consultantToken } = await seedConsultantUser(a.firmId);
    const otherThread = await createConversationThread({
      engagementId: b.engagementId, subject: 'Other', createdByUserId: 'u',
    });

    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'QA_MESSAGE',
        payload: { threadId: otherThread.id, body: 'leak' },
      },
    });
    const submission = (submit.json() as { data: { id: string } }).data;
    const accept = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${a.engagementId}/pending-submissions/${submission.id}/accept`,
      cookies: { token: consultantToken },
      payload: {},
    });
    expect(accept.statusCode).toBe(422);
  });
});

// ─── Client portal read endpoints ────────────────────────────────────────────

describe('Client portal /threads endpoints', () => {
  it('401 without portal session', async () => {
    const { token } = await seedEngagementWithToken();
    const res = await app.inject({
      method: 'GET', url: `/api/v1/engagements/portal/${token}/threads`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the engagement threads', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'PT' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'pt@x.com');
    const portalToken = await doFullPortalLogin(token, 'pt@x.com');

    await createConversationThread({ engagementId, subject: 'AAA' });
    await createConversationThread({ engagementId, subject: 'BBB' });

    const res = await app.inject({
      method: 'GET', url: `/api/v1/engagements/portal/${token}/threads`,
      headers: { cookie: `portal_token=${portalToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ subject: string }> };
    expect(body.data.map((t) => t.subject).sort()).toEqual(['AAA', 'BBB']);
  });

  it('GET /threads/:id returns thread + messages', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'PTdetail' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'pd@x.com');
    const portalToken = await doFullPortalLogin(token, 'pd@x.com');
    const thread = await createConversationThread({ engagementId, subject: 'D' });
    await createMessage({ threadId: thread.id, senderType: 'CONSULTANT', senderUserId: 'u', body: 'hi' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${token}/threads/${thread.id}`,
      headers: { cookie: `portal_token=${portalToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { messages: Array<{ body: string }> } };
    expect(body.data.messages[0].body).toBe('hi');
  });
});

// findConversationThreadById is exported but not directly tested here —
// it's exercised by the routes above. Reference for unused-import safety:
void findConversationThreadById;
