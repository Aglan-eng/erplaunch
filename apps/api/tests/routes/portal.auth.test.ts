import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { createId } from '@paralleldrive/cuid2';
import nodemailer from 'nodemailer';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import { portalRoutes } from '../../src/routes/portal.js';
import { portalAuthRoutes } from '../../src/routes/portalAuth.js';
import { getDb, upsertFirmEmailSettings } from '../../src/db/index.js';
import { __setTestTransportFactory } from '../../src/services/emailTransport.js';

const KEY_BACKUP = process.env.ERPLAUNCH_MASTER_KEY;
const PORTAL_SECRET_BACKUP = process.env.PORTAL_SESSION_COOKIE_SECRET;
const APP_URL_BACKUP = process.env.APP_URL;

let cleanup: () => void;
let app: FastifyInstance;
let capturedEmails: Array<{ to: string; text: string; html?: string; subject: string }> = [];

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  // Consultant JWT (kept as-is from server.ts for parity) — not used here but
  // registered so both route modules can load their shared plugin tree.
  await f.register(jwt, {
    secret: process.env.JWT_SECRET || 'test-consultant-secret',
    cookie: { cookieName: 'token', signed: false },
  });
  // Portal JWT — dedicated namespace + cookie + secret. Mirrors prod wiring.
  await f.register(jwt, {
    namespace: 'portal',
    secret: process.env.PORTAL_SESSION_COOKIE_SECRET || 'test-portal-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(portalAuthRoutes, { prefix: '/api/v1' });
  await f.register(portalRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

beforeAll(async () => {
  process.env.ERPLAUNCH_MASTER_KEY = 'a'.repeat(64);
  process.env.PORTAL_SESSION_COOKIE_SECRET = 'test-portal-secret-for-suite';
  process.env.APP_URL = 'https://erplaunch-web.vercel.app';
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildTestApp();

  // Capture-only email transport — never actually sends.
  __setTestTransportFactory(() =>
    nodemailer.createTransport({
      jsonTransport: true,
    }) as unknown as ReturnType<typeof nodemailer.createTransport>,
  );
});

beforeEach(() => {
  capturedEmails = [];
  // Intercept the nodemailer factory per test so we can read the message each time.
  __setTestTransportFactory((_opts) => {
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
  if (APP_URL_BACKUP !== undefined) process.env.APP_URL = APP_URL_BACKUP;
  else delete process.env.APP_URL;
});

async function seedMember(engagementId: string, email: string, name = 'Test Client') {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [id, engagementId, name, 'Stakeholder', 'CLIENT', email, new Date().toISOString()],
  });
  return id;
}

async function seedFirmEmailSettings(firmId: string) {
  await upsertFirmEmailSettings(firmId, {
    fromEmail: 'portal@test-firm.example',
    fromName: 'Test Firm Portal',
    smtpHost: 'smtp.test.example',
    smtpPort: 587,
    smtpSecure: true,
    smtpUsername: 'portal@test-firm.example',
    smtpPassword: 'smtp-secret',
    inboundProtocol: 'NONE',
  });
}

async function seedTodo(engagementId: string, title = 'Provide chart of accounts') {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO PortalTodo (id, engagementId, title, priority, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?)`,
    args: [id, engagementId, title, 'MEDIUM', new Date().toISOString(), new Date().toISOString()],
  });
  return id;
}

describe('POST /api/v1/engagements/portal/request-access', () => {
  it('returns 202 for a known client email and sends a magic-link email', async () => {
    const { engagementId, firmId, token } = await seedEngagementWithToken({ firmName: 'Capture Firm' });
    await seedFirmEmailSettings(firmId);
    await seedMember(engagementId, 'client@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/request-access',
      payload: { email: 'client@example.com', engagementToken: token },
    });

    expect(res.statusCode).toBe(202);
    expect(capturedEmails).toHaveLength(1);
    expect(capturedEmails[0].to).toContain('client@example.com');
    // Magic link URL should embed engagement token, email, and code
    const body = capturedEmails[0].text + (capturedEmails[0].html ?? '');
    expect(body).toMatch(new RegExp(token));
    expect(body).toMatch(/\b\d{6}\b/); // 6-digit code visible as fallback
  });

  it('returns 202 and does NOT send email for an unknown email (no user enumeration)', async () => {
    const { firmId, token } = await seedEngagementWithToken({ firmName: 'Enum Firm' });
    await seedFirmEmailSettings(firmId);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/request-access',
      payload: { email: 'does-not-exist@example.com', engagementToken: token },
    });

    expect(res.statusCode).toBe(202);
    expect(capturedEmails).toHaveLength(0);
  });

  it('returns 404 for an unknown engagement token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/request-access',
      payload: { email: 'x@y.com', engagementToken: 'does-not-exist-token' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 on invalid email', async () => {
    const { token } = await seedEngagementWithToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/request-access',
      payload: { email: 'not-an-email', engagementToken: token },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/engagements/portal/verify', () => {
  it('valid code issues a portal_token cookie and returns the member', async () => {
    const { engagementId, firmId, token } = await seedEngagementWithToken({ firmName: 'Verify Firm' });
    await seedFirmEmailSettings(firmId);
    await seedMember(engagementId, 'verify@example.com', 'Verify Client');

    await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/request-access',
      payload: { email: 'verify@example.com', engagementToken: token },
    });
    const code = capturedEmails[0].text.match(/\b(\d{6})\b/)?.[1];
    expect(code).toBeTruthy();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/verify',
      payload: { email: 'verify@example.com', engagementToken: token, code: code! },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { member: { id: string; name: string; email: string } } };
    expect(body.data.member.email).toBe('verify@example.com');
    expect(body.data.member.name).toBe('Verify Client');

    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie ?? '');
    expect(cookieStr).toMatch(/portal_token=/);
    expect(cookieStr).toMatch(/HttpOnly/i);
  });

  it('wrong code returns 401 INVALID_CODE', async () => {
    const { engagementId, firmId, token } = await seedEngagementWithToken({ firmName: 'Wrong Firm' });
    await seedFirmEmailSettings(firmId);
    await seedMember(engagementId, 'wrong@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/request-access',
      payload: { email: 'wrong@example.com', engagementToken: token },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/verify',
      payload: { email: 'wrong@example.com', engagementToken: token, code: '000000' },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_CODE');
  });

  it('no prior request returns 401 NO_ACTIVE_LINK', async () => {
    const { engagementId, firmId, token } = await seedEngagementWithToken({ firmName: 'Fresh Firm' });
    await seedFirmEmailSettings(firmId);
    await seedMember(engagementId, 'fresh@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/verify',
      payload: { email: 'fresh@example.com', engagementToken: token, code: '123456' },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('NO_ACTIVE_LINK');
  });

  it('unknown email returns 401 without leaking which field was wrong', async () => {
    const { token } = await seedEngagementWithToken({ firmName: 'Unknown Email Firm' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/verify',
      payload: { email: 'ghost@example.com', engagementToken: token, code: '123456' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Portal session authenticate on mutations', () => {
  async function doFullLogin(token: string, email: string): Promise<string> {
    await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/request-access',
      payload: { email, engagementToken: token },
    });
    const code = capturedEmails[capturedEmails.length - 1].text.match(/\b(\d{6})\b/)?.[1];
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/verify',
      payload: { email, engagementToken: token, code: code! },
    });
    const setCookie = verifyRes.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : String(setCookie ?? '');
    const match = cookieHeader.match(/portal_token=([^;]+)/);
    expect(match).not.toBeNull();
    return match![1];
  }

  it('authenticated client can complete a portal todo', async () => {
    const { engagementId, firmId, token } = await seedEngagementWithToken({ firmName: 'Mutation Firm' });
    await seedFirmEmailSettings(firmId);
    await seedMember(engagementId, 'mutator@example.com', 'Mutator');
    const todoId = await seedTodo(engagementId);
    const portalToken = await doFullLogin(token, 'mutator@example.com');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/portal/${token}/todos/${todoId}/complete`,
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { completedAt: string | null; completedBy: string | null } };
    expect(body.data.completedAt).toBeTruthy();
    expect(body.data.completedBy).toBe('Mutator');
  });

  it('unauthenticated mutation returns 401', async () => {
    const { engagementId, firmId, token } = await seedEngagementWithToken({ firmName: 'Anon Mutation' });
    await seedFirmEmailSettings(firmId);
    await seedMember(engagementId, 'noauth@example.com');
    const todoId = await seedTodo(engagementId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/portal/${token}/todos/${todoId}/complete`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('revoked session fails a follow-up mutation', async () => {
    const { engagementId, firmId, token } = await seedEngagementWithToken({ firmName: 'Revoke Firm' });
    await seedFirmEmailSettings(firmId);
    await seedMember(engagementId, 'revoke@example.com');
    const todoId = await seedTodo(engagementId);
    const portalToken = await doFullLogin(token, 'revoke@example.com');

    // Log out via endpoint
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/portal/logout',
      headers: { cookie: `portal_token=${portalToken}` },
    });
    expect(logoutRes.statusCode).toBe(200);

    const followup = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/portal/${token}/todos/${todoId}/complete`,
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {},
    });
    expect(followup.statusCode).toBe(401);
  });

  it('a cookie whose engagement does not match the URL token is rejected', async () => {
    const firstEng = await seedEngagementWithToken({ firmName: 'Cross Firm A' });
    const secondEng = await seedEngagementWithToken({ firmName: 'Cross Firm B' });
    await seedFirmEmailSettings(firstEng.firmId);
    await seedMember(firstEng.engagementId, 'cross@example.com');
    const cookieToken = await doFullLogin(firstEng.token, 'cross@example.com');
    const foreignTodoId = await seedTodo(secondEng.engagementId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/portal/${secondEng.token}/todos/${foreignTodoId}/complete`,
      headers: { cookie: `portal_token=${cookieToken}` },
      payload: {},
    });
    // Either 403 (engagement mismatch) or 404 (not found) — both communicate "not yours"
    expect([401, 403, 404]).toContain(res.statusCode);
  });
});

describe('Portal GET remains public for read', () => {
  it('GET /engagements/portal/:token still works without a session cookie', async () => {
    const { token } = await seedEngagementWithToken({ firmName: 'Public Read' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${token}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { engagement: { id: string } } };
    expect(body.data.engagement).toBeTruthy();
  });
});
