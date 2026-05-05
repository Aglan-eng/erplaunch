import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createId } from '@paralleldrive/cuid2';
import nodemailer from 'nodemailer';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import { portalRoutes } from '../../src/routes/portal.js';
import { portalAuthRoutes } from '../../src/routes/portalAuth.js';
import { pendingSubmissionsRoutes } from '../../src/routes/pendingSubmissions.js';
import {
  getDb,
  upsertFirmEmailSettings,
  listDataFiles,
} from '../../src/db/index.js';
import { __setTestTransportFactory } from '../../src/services/emailTransport.js';
import { findStagedFileById } from '../../src/db/stagedFile.js';
// Side-effect import — registers DATA_FILE acceptor + payload schema.
import '../../src/services/dataFileAcceptor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGING_DIR = path.join(__dirname, '../../uploads/staged');
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

const JWT_SECRET = 'test-data-file-jwt';
const KEY_BACKUP = process.env.ERPLAUNCH_MASTER_KEY;
const PORTAL_SECRET_BACKUP = process.env.PORTAL_SESSION_COOKIE_SECRET;

let cleanup: () => void;
let app: FastifyInstance;
let capturedEmails: Array<{ to: string; text: string; html?: string; subject: string }> = [];

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
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
  process.env.PORTAL_SESSION_COOKIE_SECRET = 'test-portal-secret-for-data-file';
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });
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
    args: [userId, firmId, `${userId}@x.com`, 'Reviewer', passwordHash, 'CONSULTANT', new Date().toISOString()],
  });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'R', email: `${userId}@x.com` });
  return { userId, token };
}

async function seedDataCollectionItem(engagementId: string): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO DataCollectionItem (id, engagementId, templateId, name, category, status, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [id, engagementId, 'tpl', 'Item', 'GL', 'PENDING', new Date().toISOString(), new Date().toISOString()],
  });
  return id;
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

// Build a minimal multipart body — Fastify's inject supports a payload-as-buffer
// helper but simpler to construct the boundary by hand.
function buildMultipart(filename: string, content: Buffer, mimeType = 'text/csv'): { body: Buffer; contentType: string } {
  const boundary = `----formboundary-${createId()}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([head, content, tail]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// ─── POST /portal/data-files/staged ──────────────────────────────────────────

describe('POST /api/v1/portal/data-files/staged', () => {
  it('returns 401 without portal session', async () => {
    const { contentType, body } = buildMultipart('test.csv', Buffer.from('hello'));
    const res = await app.inject({
      method: 'POST', url: '/api/v1/portal/data-files/staged',
      headers: { 'content-type': contentType }, payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when no file is provided', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'NoFile' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'nf@x.com');
    const portalToken = await doFullPortalLogin(token, 'nf@x.com');

    // Empty multipart body — no `file` field.
    const boundary = '----empty';
    const body = Buffer.from(`--${boundary}--\r\n`, 'utf8');
    const res = await app.inject({
      method: 'POST', url: '/api/v1/portal/data-files/staged',
      headers: {
        cookie: `portal_token=${portalToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('NO_FILE');
  });

  it('returns 201 + writes the file to staging on happy path', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'StgHappy' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'sh@x.com');
    const portalToken = await doFullPortalLogin(token, 'sh@x.com');

    const content = Buffer.from('header1,header2\nvalue1,value2\n');
    const { contentType, body } = buildMultipart('upload.csv', content);

    const res = await app.inject({
      method: 'POST', url: '/api/v1/portal/data-files/staged',
      headers: { cookie: `portal_token=${portalToken}`, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const r = res.json() as {
      data: { stagedFileId: string; filename: string; originalName: string; sizeBytes: number; mimeType: string };
    };
    expect(r.data.stagedFileId).toBeTruthy();
    expect(r.data.originalName).toBe('upload.csv');
    expect(r.data.sizeBytes).toBe(content.length);
    expect(r.data.mimeType).toBe('text/csv');

    // File present on disk
    const stagedPath = path.join(STAGING_DIR, r.data.filename);
    expect(fs.existsSync(stagedPath)).toBe(true);
    expect(fs.readFileSync(stagedPath).toString()).toBe(content.toString());
  });
});

// ─── End-to-end: stage → submit → accept / reject ────────────────────────────

describe('end-to-end DATA_FILE flow', () => {
  it('happy path: stage → submit → accept → file in permanent + DataFile + item RECEIVED + StagedFile gone', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'E2EAccept' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'e1@x.com');
    const portalToken = await doFullPortalLogin(token, 'e1@x.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);
    const itemId = await seedDataCollectionItem(engagementId);

    // 1. Stage upload
    const content = Buffer.from('row1,row2');
    const { contentType, body } = buildMultipart('e2e.csv', content);
    const stage = await app.inject({
      method: 'POST', url: '/api/v1/portal/data-files/staged',
      headers: { cookie: `portal_token=${portalToken}`, 'content-type': contentType },
      payload: body,
    });
    expect(stage.statusCode).toBe(201);
    const staged = (stage.json() as { data: { stagedFileId: string; filename: string } }).data;

    // 2. Submit
    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'DATA_FILE',
        payload: {
          stagedFileId: staged.stagedFileId,
          dataCollectionItemId: itemId,
          originalFilename: 'e2e.csv',
          sizeBytes: content.length,
        },
      },
    });
    expect(submit.statusCode).toBe(201);
    const submission = (submit.json() as { data: { id: string } }).data;

    // 3. Accept
    const accept = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${submission.id}/accept`,
      cookies: { token: consultantToken },
      payload: { comment: 'received' },
    });
    expect(accept.statusCode).toBe(200);

    // Verify side effects:
    // - StagedFile row gone
    expect(await findStagedFileById(staged.stagedFileId)).toBeNull();
    // - Permanent file exists; staged file gone
    const stagedPath = path.join(STAGING_DIR, staged.filename);
    expect(fs.existsSync(stagedPath)).toBe(false);
    const dataFiles = await listDataFiles(itemId);
    expect((dataFiles as Array<Record<string, unknown>>).length).toBe(1);
    const promotedFilename = (dataFiles as Array<Record<string, unknown>>)[0].filename as string;
    expect(fs.existsSync(path.join(UPLOADS_DIR, promotedFilename))).toBe(true);
    // - Item status = RECEIVED
    const itemRow = await getDb().execute({
      sql: `SELECT status FROM DataCollectionItem WHERE id = ?`, args: [itemId],
    });
    expect((itemRow.rows[0] as Record<string, unknown>).status).toBe('RECEIVED');
  });

  it('reject: StagedFile row + on-disk file gone, no DataFile created, item unchanged', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'E2EReject' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'r2@x.com');
    const portalToken = await doFullPortalLogin(token, 'r2@x.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);
    const itemId = await seedDataCollectionItem(engagementId);

    const content = Buffer.from('rej content');
    const { contentType, body } = buildMultipart('rej.csv', content);
    const stage = await app.inject({
      method: 'POST', url: '/api/v1/portal/data-files/staged',
      headers: { cookie: `portal_token=${portalToken}`, 'content-type': contentType },
      payload: body,
    });
    const staged = (stage.json() as { data: { stagedFileId: string; filename: string } }).data;

    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'DATA_FILE',
        payload: {
          stagedFileId: staged.stagedFileId,
          dataCollectionItemId: itemId,
          originalFilename: 'rej.csv',
          sizeBytes: content.length,
        },
      },
    });
    const submission = (submit.json() as { data: { id: string } }).data;

    const reject = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${submission.id}/reject`,
      cookies: { token: consultantToken },
      payload: { comment: 'wrong file' },
    });
    expect(reject.statusCode).toBe(200);

    // Verify side effects:
    expect(await findStagedFileById(staged.stagedFileId)).toBeNull();
    expect(fs.existsSync(path.join(STAGING_DIR, staged.filename))).toBe(false);
    const dataFiles = await listDataFiles(itemId);
    expect((dataFiles as Array<Record<string, unknown>>).length).toBe(0);
    const itemRow = await getDb().execute({
      sql: `SELECT status FROM DataCollectionItem WHERE id = ?`, args: [itemId],
    });
    expect((itemRow.rows[0] as Record<string, unknown>).status).toBe('PENDING');
  });

  it('idempotent re-accept: staged file gone but DataFile present → no-op', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'E2EIdempotent' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'id@x.com');
    const portalToken = await doFullPortalLogin(token, 'id@x.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);
    const itemId = await seedDataCollectionItem(engagementId);

    const content = Buffer.from('idempotent');
    const { contentType, body } = buildMultipart('id.csv', content);
    const stage = await app.inject({
      method: 'POST', url: '/api/v1/portal/data-files/staged',
      headers: { cookie: `portal_token=${portalToken}`, 'content-type': contentType },
      payload: body,
    });
    const staged = (stage.json() as { data: { stagedFileId: string } }).data;

    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'DATA_FILE',
        payload: {
          stagedFileId: staged.stagedFileId,
          dataCollectionItemId: itemId,
          originalFilename: 'id.csv',
          sizeBytes: content.length,
        },
      },
    });
    const submission = (submit.json() as { data: { id: string } }).data;

    const accept1 = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${submission.id}/accept`,
      cookies: { token: consultantToken },
      payload: {},
    });
    expect(accept1.statusCode).toBe(200);

    // Submission status now ACCEPTED — second accept route call returns 409
    // (which means the route handler did NOT invoke the acceptor again).
    // So to truly test idempotent acceptor invocation, force-call it:
    const { dataFileAcceptor } = await import('../../src/services/dataFileAcceptor.js');
    const { findPendingSubmissionById } = await import('../../src/db/pendingSubmission.js');
    const sub = await findPendingSubmissionById(submission.id);
    if (!sub) throw new Error('submission disappeared');
    // Should not throw (state ii: prior promotion exists, no-op return).
    await dataFileAcceptor.accept(sub, { engagementId, reviewerId: 'r', firmId });

    const dataFiles = await listDataFiles(itemId);
    expect((dataFiles as Array<Record<string, unknown>>).length).toBe(1); // not duplicated
  });

  it('throws ACCEPTOR_FAILED when staged file missing AND no prior promotion', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'NoStagedNoDF' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'ns@x.com');
    const portalToken = await doFullPortalLogin(token, 'ns@x.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);
    const itemId = await seedDataCollectionItem(engagementId);

    // Submit references a stagedFileId that does NOT exist.
    const submit = await app.inject({
      method: 'POST', url: '/api/v1/portal/submissions',
      headers: { cookie: `portal_token=${portalToken}` },
      payload: {
        targetType: 'DATA_FILE',
        payload: {
          stagedFileId: 'does-not-exist-staged',
          dataCollectionItemId: itemId,
          originalFilename: 'ghost.csv',
          sizeBytes: 0,
        },
      },
    });
    const submission = (submit.json() as { data: { id: string } }).data;

    const accept = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/pending-submissions/${submission.id}/accept`,
      cookies: { token: consultantToken },
      payload: {},
    });
    expect(accept.statusCode).toBe(422);
    expect((accept.json() as { error: { code: string } }).error.code).toBe('ACCEPTOR_FAILED');
  });
});

// ─── Consultant download endpoint ────────────────────────────────────────────

describe('GET /api/v1/engagements/:id/staged-files/:stagedFileId/download', () => {
  it('streams the staged file content', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'DLHappy' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'dl@x.com');
    const portalToken = await doFullPortalLogin(token, 'dl@x.com');
    const { token: consultantToken } = await seedConsultantUser(firmId);

    const content = Buffer.from('download-me content');
    const { contentType, body } = buildMultipart('dl.csv', content);
    const stage = await app.inject({
      method: 'POST', url: '/api/v1/portal/data-files/staged',
      headers: { cookie: `portal_token=${portalToken}`, 'content-type': contentType },
      payload: body,
    });
    const staged = (stage.json() as { data: { stagedFileId: string } }).data;

    const dl = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/staged-files/${staged.stagedFileId}/download`,
      cookies: { token: consultantToken },
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe(content.toString());
  });

  it('returns 404 for unknown staged-file id', async () => {
    const { firmId, engagementId } = await seedEngagementWithToken({ firmName: 'DLMissing' });
    const { token: consultantToken } = await seedConsultantUser(firmId);
    const dl = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/staged-files/no-such/download`,
      cookies: { token: consultantToken },
    });
    expect(dl.statusCode).toBe(404);
  });

  it('returns 404 when staged-file belongs to a different engagement', async () => {
    const { firmId, engagementId, token } = await seedEngagementWithToken({ firmName: 'Owner' });
    const other = await seedEngagementWithToken({ firmName: 'Other' });
    await seedFirmEmailSettings(firmId);
    await seedClientMember(engagementId, 'd@x.com');
    const portalToken = await doFullPortalLogin(token, 'd@x.com');
    const { token: consultantToken } = await seedConsultantUser(other.firmId);

    const { contentType, body } = buildMultipart('d.csv', Buffer.from('x'));
    const stage = await app.inject({
      method: 'POST', url: '/api/v1/portal/data-files/staged',
      headers: { cookie: `portal_token=${portalToken}`, 'content-type': contentType },
      payload: body,
    });
    const staged = (stage.json() as { data: { stagedFileId: string } }).data;

    const dl = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${other.engagementId}/staged-files/${staged.stagedFileId}/download`,
      cookies: { token: consultantToken },
    });
    expect(dl.statusCode).toBe(404);
  });
});
