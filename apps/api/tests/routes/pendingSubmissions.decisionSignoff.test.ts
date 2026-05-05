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
  createDecision,
  findDecisionById,
  listDecisions,
} from '../../src/db/index.js';
import { __setTestTransportFactory } from '../../src/services/emailTransport.js';
import {
  decisionSignoffAcceptor,
} from '../../src/services/decisionSignoffAcceptor.js';
import { findPendingSubmissionById } from '../../src/db/pendingSubmission.js';
// Side-effect — registers acceptor + payload schema
import '../../src/services/decisionSignoffAcceptor.js';

/**
 * Phase 32 — DECISION_SIGNOFF end-to-end + acceptor + portal endpoint.
 */

const JWT_SECRET = 'test-decision-signoff-jwt';
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
  process.env.PORTAL_SESSION_COOKIE_SECRET = 'test-portal-secret-for-decision-signoff';
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

// ─── Acceptor unit tests ─────────────────────────────────────────────────────

describe('decisionSignoffAcceptor', () => {
  it('flips DecisionItem to SIGNED when signed=true', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'AccS' });
    const memberId = await seedClientMember(engagementId, 'as@x.com');
    const decision = await createDecision(engagementId, { title: 'D1', description: 'desc' });

    await decisionSignoffAcceptor.accept(
      {
        id: 'sub-1',
        engagementId,
        memberId,
        targetType: 'DECISION_SIGNOFF',
        targetId: null,
        payload: { decisionItemId: (decision as Record<string, unknown>).id, signed: true, comment: 'agree' },
        status: 'PENDING',
        reviewerId: null,
        reviewedAt: null,
        reviewComment: null,
        createdAt: new Date().toISOString(),
      },
      { engagementId, reviewerId: 'r', firmId: 'f' },
    );

    const after = await findDecisionById((decision as Record<string, unknown>).id as string);
    expect((after as Record<string, unknown>).clientSignoffStatus).toBe('SIGNED');
    expect((after as Record<string, unknown>).clientSignoffComment).toBe('agree');
    expect((after as Record<string, unknown>).clientSignoffMemberId).toBe(memberId);
    expect((after as Record<string, unknown>).clientSignoffSourceSubmissionId).toBe('sub-1');
  });

  it('flips DecisionItem to DECLINED when signed=false', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'AccD' });
    const memberId = await seedClientMember(engagementId, 'ad@x.com');
    const decision = await createDecision(engagementId, { title: 'D2', description: 'd2' });

    await decisionSignoffAcceptor.accept(
      {
        id: 'sub-decline',
        engagementId,
        memberId,
        targetType: 'DECISION_SIGNOFF',
        targetId: null,
        payload: { decisionItemId: (decision as Record<string, unknown>).id, signed: false, comment: 'disagree' },
        status: 'PENDING',
        reviewerId: null, reviewedAt: null, reviewComment: null,
        createdAt: new Date().toISOString(),
      },
      { engagementId, reviewerId: 'r', firmId: 'f' },
    );

    const after = await findDecisionById((decision as Record<string, unknown>).id as string);
    expect((after as Record<string, unknown>).clientSignoffStatus).toBe('DECLINED');
  });

  it('idempotent re-accept: same submission produces no state change', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'AccI' });
    const memberId = await seedClientMember(engagementId, 'ai@x.com');
    const decision = await createDecision(engagementId, { title: 'D3', description: 'd3' });
    const did = (decision as Record<string, unknown>).id as string;

    const sub = {
      id: 'sub-idem',
      engagementId,
      memberId,
      targetType: 'DECISION_SIGNOFF' as const,
      targetId: null,
      payload: { decisionItemId: did, signed: true, comment: '' },
      status: 'PENDING' as const,
      reviewerId: null, reviewedAt: null, reviewComment: null,
      createdAt: new Date().toISOString(),
    };

    await decisionSignoffAcceptor.accept(sub, { engagementId, reviewerId: 'r', firmId: 'f' });
    const first = await findDecisionById(did);
    await decisionSignoffAcceptor.accept(sub, { engagementId, reviewerId: 'r', firmId: 'f' });
    const second = await findDecisionById(did);

    expect((first as Record<string, unknown>).clientSignoffAt).toBe(
      (second as Record<string, unknown>).clientSignoffAt,
    );
  });

  it('throws on cross-engagement decisionItemId', async () => {
    const a = await seedEngagementWithToken({ firmName: 'XA' });
    const b = await seedEngagementWithToken({ firmName: 'XB' });
    const memberId = await seedClientMember(a.engagementId, 'x@x.com');
    const decision = await createDecision(b.engagementId, { title: 'D' });
    await expect(
      decisionSignoffAcceptor.accept(
        {
          id: 'sub-x',
          engagementId: a.engagementId,
          memberId,
          targetType: 'DECISION_SIGNOFF',
          targetId: null,
          payload: { decisionItemId: (decision as Record<string, unknown>).id, signed: true, comment: '' },
          status: 'PENDING',
          reviewerId: null, reviewedAt: null, reviewComment: null,
          createdAt: new Date().toISOString(),
        },
        { engagementId: a.engagementId, reviewerId: 'r', firmId: 'f' },
      ),
    ).rejects.toThrow();
  });

  it('throws on missing decisionItemId', async () => {
    await expect(
      decisionSignoffAcceptor.accept(
        {
          id: 'sub-bad',
          engagementId: 'eng',
          memberId: 'mem',
          targetType: 'DECISION_SIGNOFF',
          targetId: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payload: { signed: true } as any,
          status: 'PENDING',
          reviewerId: null, reviewedAt: null, reviewComment: null,
          createdAt: new Date().toISOString(),
        },
        { engagementId: 'eng', reviewerId: 'r', firmId: 'f' },
      ),
    ).rejects.toThrow(/decisionItemId/);
  });
});

// ─── End-to-end (route) tests ────────────────────────────────────────────────

describe('end-to-end DECISION_SIGNOFF', () => {
  it('signed=true: client submits → consultant accepts → decision SIGNED + dedicated activity action', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'E2ESign' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 's1@x.com');
    const portalToken = await doFullPortalLogin(token, 's1@x.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);

    const decision = await createDecision(engagementId, { title: 'COA structure', description: 'desc' });
    const did = (decision as Record<string, unknown>).id as string;

    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'DECISION_SIGNOFF',
        payload: { decisionItemId: did, signed: true, comment: 'looks good' },
      },
    });
    expect(submit.statusCode).toBe(201);
    const sub = (submit.json() as { data: { id: string } }).data;

    const accept = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/accept`,
      cookies: { token: consultantToken },
      payload: {},
    });
    expect(accept.statusCode).toBe(200);

    const after = await findDecisionById(did);
    expect((after as Record<string, unknown>).clientSignoffStatus).toBe('SIGNED');

    // Dedicated activity action.
    const al = await getDb().execute({
      sql: `SELECT * FROM ActivityLog WHERE engagementId = ? AND action = ?`,
      args: [engagementId, 'DECISION_SIGNED_OFF'],
    });
    expect(al.rows.length).toBe(1);
  });

  it('signed=false: produces DECLINED status + DECISION_DECLINED activity action', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'E2EDecl' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'd1@x.com');
    const portalToken = await doFullPortalLogin(token, 'd1@x.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);
    const decision = await createDecision(engagementId, { title: 'X' });
    const did = (decision as Record<string, unknown>).id as string;

    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'DECISION_SIGNOFF',
        payload: { decisionItemId: did, signed: false, comment: 'disagree' },
      },
    });
    const sub = (submit.json() as { data: { id: string } }).data;
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/accept`,
      cookies: { token: consultantToken },
      payload: {},
    });

    const after = await findDecisionById(did);
    expect((after as Record<string, unknown>).clientSignoffStatus).toBe('DECLINED');
    const al = await getDb().execute({
      sql: `SELECT * FROM ActivityLog WHERE engagementId = ? AND action = ?`,
      args: [engagementId, 'DECISION_DECLINED'],
    });
    expect(al.rows.length).toBe(1);
  });

  it('reject path: decision flips to REJECTED + DECISION_REJECTED activity action', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'E2ERej' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'r1@x.com');
    const portalToken = await doFullPortalLogin(token, 'r1@x.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);
    const decision = await createDecision(engagementId, { title: 'Z' });
    const did = (decision as Record<string, unknown>).id as string;

    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'DECISION_SIGNOFF',
        payload: { decisionItemId: did, signed: true, comment: '' },
      },
    });
    const sub = (submit.json() as { data: { id: string } }).data;
    const reject = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sub.id}/reject`,
      cookies: { token: consultantToken },
      payload: { comment: 'wrong decision' },
    });
    expect(reject.statusCode).toBe(200);

    const after = await findDecisionById(did);
    expect((after as Record<string, unknown>).clientSignoffStatus).toBe('REJECTED');
    const al = await getDb().execute({
      sql: `SELECT * FROM ActivityLog WHERE engagementId = ? AND action = ?`,
      args: [engagementId, 'DECISION_REJECTED'],
    });
    expect(al.rows.length).toBe(1);
  });

  it('400 on missing decisionItemId in submit', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'BadPay' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'b@x.com');
    const portalToken = await doFullPortalLogin(token, 'b@x.com');

    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: { targetType: 'DECISION_SIGNOFF', payload: { signed: true } },
    });
    expect(submit.statusCode).toBe(400);
  });

  it('400 on non-boolean signed', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'BadSign' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'b2@x.com');
    const portalToken = await doFullPortalLogin(token, 'b2@x.com');

    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: { targetType: 'DECISION_SIGNOFF', payload: { decisionItemId: 'd', signed: 'yes' } },
    });
    expect(submit.statusCode).toBe(400);
  });
});

// ─── Portal /decisions endpoint ──────────────────────────────────────────────

describe('GET /api/v1/engagements/portal/:token/decisions', () => {
  it('401 without portal session', async () => {
    const { token } = await seedEngagementWithToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${token}/decisions`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns decisions in non-terminal sign-off state', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'PortalD' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'p@x.com');
    const portalToken = await doFullPortalLogin(token, 'p@x.com');

    await createDecision(engagementId, { title: 'A' });
    await createDecision(engagementId, { title: 'B' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${token}/decisions`,
      headers: { cookie: `portal_token=${portalToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ title: string }> };
    expect(body.data.length).toBe(2);
  });

  it('filters out terminal-state decisions (after accept)', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'PortalDFilter' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'pf@x.com');
    const portalToken = await doFullPortalLogin(token, 'pf@x.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);

    const dA = await createDecision(engagementId, { title: 'A' });
    const dB = await createDecision(engagementId, { title: 'B' });

    // Accept signoff on A.
    const sub = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'DECISION_SIGNOFF',
        payload: { decisionItemId: (dA as Record<string, unknown>).id, signed: true, comment: '' },
      },
    });
    const sid = (sub.json() as { data: { id: string } }).data.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${sid}/accept`,
      cookies: { token: consultantToken },
      payload: {},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${token}/decisions`,
      headers: { cookie: `portal_token=${portalToken}` },
    });
    const body = res.json() as { data: Array<{ id: string }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe((dB as Record<string, unknown>).id);
  });

  it('enriches with pendingSubmissionId for in-flight submissions by THIS member', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'PortalDEnr' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'pe@x.com');
    const portalToken = await doFullPortalLogin(token, 'pe@x.com');

    const dec = await createDecision(engagementId, { title: 'pendingD' });
    const sub = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'DECISION_SIGNOFF',
        payload: { decisionItemId: (dec as Record<string, unknown>).id, signed: true, comment: '' },
      },
    });
    const sid = (sub.json() as { data: { id: string } }).data.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${token}/decisions`,
      headers: { cookie: `portal_token=${portalToken}` },
    });
    const body = res.json() as { data: Array<{ id: string; pendingSubmissionId: string | null }> };
    const target = body.data.find((d) => d.id === (dec as Record<string, unknown>).id);
    expect(target?.pendingSubmissionId).toBe(sid);
  });
});

void listDecisions;
void findPendingSubmissionById;
