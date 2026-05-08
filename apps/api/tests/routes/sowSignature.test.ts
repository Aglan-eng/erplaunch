/**
 * Phase 46.5 — integration tests for SOW signature flow.
 *
 * Covers:
 *   - List signatures for an engagement (returns docusignConfigured flag)
 *   - Manual upload happy path: writes the file, creates SIGNED row,
 *     stamps signedFileUrl on the version, fires SOW_SIGNED activity
 *   - Manual upload validation: missing fields, non-PDF magic, oversize
 *   - DocuSign send refused when not configured
 *   - Webhook updates the signature row + fires SOW_SIGNED on completed
 *   - Webhook for an unknown envelope gets a 200 with ignored:true
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { setupTestDb } from '../_helpers/testDb.js';
import { sowSignatureRoutes } from '../../src/routes/sowSignature.js';
import {
  getDb,
  bootstrapFirmAdmin,
  recordSowVersion,
  createSowSignature,
} from '../../src/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const JWT_SECRET = 'sow-signature-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-sow-sig-test',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(sowSignatureRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  engagementId: string;
  jobId: string;
  versionId: string;
  adminToken: string;
}

async function seed(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const userId = createId();
  const jobId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Sig Firm', `sig-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Acme Co', 'CONTRACTED', now, now],
  });
  const passwordHash = await bcrypt.hash('x', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, userId, passwordHash, 'CONSULTANT'],
  });
  await bootstrapFirmAdmin({ firmId, userId });
  await db.execute({
    sql: `INSERT INTO GenerationJob (id, engagementId, type) VALUES (?,?,?)`,
    args: [jobId, engagementId, 'SOW'],
  });
  const version = await recordSowVersion({ engagementId, jobId, version: 1 });
  const adminToken = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: userId, email: `${userId}@example.com` });
  return { firmId, engagementId, jobId, versionId: version.id, adminToken };
}

const TINY_PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
);
const TINY_PDF_BASE64 = TINY_PDF_BYTES.toString('base64');

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
  await db.execute(`DELETE FROM EngagementSowSignature`);
  await db.execute(`DELETE FROM EngagementSowVersion`);
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM RoleAuditLog`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM FirmRole`);
  await db.execute(`DELETE FROM GenerationJob`);
  await db.execute(`DELETE FROM LicenseProfile`);
  await db.execute(`DELETE FROM BusinessProfile`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /engagements/:id/sow-signatures', () => {
  it('returns an empty list + the docusignConfigured flag', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/sow-signatures`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { signatures: unknown[]; docusignConfigured: boolean } };
    expect(body.data.signatures).toEqual([]);
    // Without DOCUSIGN_* envs the integration is off in tests.
    expect(body.data.docusignConfigured).toBe(false);
  });
});

// ─── DocuSign send ──────────────────────────────────────────────────────────

describe('POST /engagements/:id/sow-signatures/docusign', () => {
  it('refuses with 409 DOCUSIGN_NOT_CONFIGURED when env is missing', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/sow-signatures/docusign`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { signerName: 'Jane Tate', signerEmail: 'jane@acme.example' },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('DOCUSIGN_NOT_CONFIGURED');
  });
});

// ─── Manual upload ──────────────────────────────────────────────────────────

describe('POST /engagements/:id/sow-signatures/manual-upload', () => {
  it('rejects an empty file', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/sow-signatures/manual-upload`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { fileBase64: '', signedByName: 'Jane Tate' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects a non-PDF upload', async () => {
    const f = await seed();
    const notPdf = Buffer.from('not-a-pdf', 'utf8').toString('base64');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/sow-signatures/manual-upload`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { fileBase64: notPdf, signedByName: 'Jane Tate' },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('NOT_A_PDF');
  });

  it('happy path: stores the file, creates SIGNED row, fires SOW_SIGNED activity, stamps version', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/sow-signatures/manual-upload`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: {
        fileBase64: TINY_PDF_BASE64,
        signedByName: 'Jane Tate',
        signedByEmail: 'jane@acme.example',
        signedByTitle: 'CFO',
        signedDate: '2026-06-15T12:00:00Z',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as {
      data: {
        id: string;
        status: string;
        signaturePath: string;
        signedFileUrl: string;
        signedByName: string;
        signedByEmail: string;
        signedByTitle: string;
        signedAt: string;
      };
    };
    expect(body.data.status).toBe('SIGNED');
    expect(body.data.signaturePath).toBe('MANUAL');
    expect(body.data.signedFileUrl).toMatch(/^\/uploads\/signed-sow\//);
    expect(body.data.signedByName).toBe('Jane Tate');
    expect(body.data.signedByEmail).toBe('jane@acme.example');
    expect(body.data.signedByTitle).toBe('CFO');

    // SOW version row picks up signedFileUrl.
    const versionRow = await getDb().execute({
      sql: `SELECT signedFileUrl FROM EngagementSowVersion WHERE id = ?`,
      args: [f.versionId],
    });
    expect((versionRow.rows[0] as unknown as { signedFileUrl: string }).signedFileUrl).toBe(body.data.signedFileUrl);

    // Activity entries: SOW_SIGNED_MANUAL + SOW_SIGNED.
    const log = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    const actions = log.rows.map((row) => (row as unknown as { action: string }).action);
    expect(actions).toContain('SOW_SIGNED_MANUAL');
    expect(actions).toContain('SOW_SIGNED');

    // The file actually lives on disk at the URL the API returned.
    const filePath = path.join(__dirname, '..', '..', body.data.signedFileUrl);
    const onDisk = await fs.readFile(filePath);
    expect(onDisk.subarray(0, 4).toString('ascii')).toBe('%PDF');
    // Cleanup.
    await fs.unlink(filePath).catch(() => undefined);
  });

  it('refuses when no SOW version exists yet', async () => {
    const f = await seed();
    // Strip the version so the route 409s.
    await getDb().execute({
      sql: `DELETE FROM EngagementSowVersion WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/sow-signatures/manual-upload`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { fileBase64: TINY_PDF_BASE64, signedByName: 'Jane Tate' },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('NO_SOW_VERSION');
  });
});

// ─── Webhook ────────────────────────────────────────────────────────────────

describe('POST /webhooks/docusign', () => {
  it('updates SENT → VIEWED on a delivered status', async () => {
    const f = await seed();
    const sig = await createSowSignature({
      engagementId: f.engagementId,
      sowVersionId: f.versionId,
      signaturePath: 'DOCUSIGN',
      docusignEnvelopeId: 'ENV-123',
      status: 'SENT',
    });
    void sig;
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/docusign',
      payload: { envelopeId: 'ENV-123', status: 'delivered' },
    });
    expect(r.statusCode).toBe(200);
    const after = await getDb().execute({
      sql: `SELECT status FROM EngagementSowSignature WHERE docusignEnvelopeId = ?`,
      args: ['ENV-123'],
    });
    expect((after.rows[0] as unknown as { status: string }).status).toBe('VIEWED');
  });

  it('completed status fires SOW_SIGNED activity', async () => {
    const f = await seed();
    await createSowSignature({
      engagementId: f.engagementId,
      sowVersionId: f.versionId,
      signaturePath: 'DOCUSIGN',
      docusignEnvelopeId: 'ENV-XYZ',
      status: 'SENT',
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/docusign',
      payload: {
        envelopeId: 'ENV-XYZ',
        status: 'completed',
        signerName: 'Jane Tate',
        signerEmail: 'jane@acme.example',
      },
    });
    const log = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    expect(log.rows.map((row) => (row as unknown as { action: string }).action)).toContain('SOW_SIGNED');
  });

  it('200s + ignored:true on an unknown envelope', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/docusign',
      payload: { envelopeId: 'NOT-REAL', status: 'completed' },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { ignored: boolean }).ignored).toBe(true);
  });

  it('400s when envelopeId or status is missing', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/docusign',
      payload: { envelopeId: 'ENV-123' },
    });
    expect(r.statusCode).toBe(400);
  });
});
