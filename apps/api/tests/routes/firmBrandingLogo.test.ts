import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { firmBrandingRoutes } from '../../src/routes/firmBranding.js';
import { getDb } from '../../src/db/index.js';

const JWT_SECRET = 'test-firm-logo-upload-secret';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  await f.register(firmBrandingRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

async function seedFirmAndToken(): Promise<{ firmId: string; token: string }> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const slug = `firm-${createId().slice(0, 8)}`;
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Logo Test Firm', slug, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Tester', passwordHash, 'CONSULTANT', now],
  });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Tester', email: `${userId}@example.com` });
  return { firmId, token };
}

/** Build a minimal multipart payload Fastify can parse. */
async function postMultipart(opts: {
  token: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}): Promise<{ statusCode: number; body: unknown }> {
  const boundary = `----${createId()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${opts.filename}"\r\n`),
    Buffer.from(`Content-Type: ${opts.contentType}\r\n\r\n`),
    opts.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/firm/branding/logo',
    headers: {
      cookie: `token=${opts.token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    payload: body,
  });
  return { statusCode: res.statusCode, body: res.json() };
}

// Trivially-valid PNG header bytes — 8-byte signature + IHDR length + IHDR
// tag. Enough for MIME-sniffing not to matter; we don't decode the image.
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  cleanup();
  // Clean up the upload dir created by these tests so local runs don't
  // accumulate throwaway files across runs.
  try {
    const uploadsRoot = path.join(__dirname, '..', '..', 'uploads', 'firm-logos');
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  } catch { /* best effort */ }
});

describe('POST /firm/branding/logo — auth gate', () => {
  it('returns 401 when the multipart request has no session cookie', async () => {
    // Send a properly-shaped multipart body but omit the session cookie —
    // the multipart parser should accept the body, then the authenticate
    // preHandler rejects the unauthenticated request.
    const boundary = `----${createId()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="file"; filename="x.png"\r\n`),
      Buffer.from(`Content-Type: image/png\r\n\r\n`),
      PNG_HEADER,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/firm/branding/logo',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /firm/branding/logo — happy path', () => {
  it('accepts a PNG, stores it on disk, and writes the absolute logoUrl to the firm', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const bytes = Buffer.concat([PNG_HEADER, Buffer.alloc(256)]);
    const { statusCode, body } = await postMultipart({
      token, filename: 'logo.png', contentType: 'image/png', bytes,
    });
    expect(statusCode).toBe(201);
    const branding = (body as { data: { logoUrl: string | null } }).data;
    expect(branding.logoUrl).toBeTruthy();
    // Should be a full URL (scheme + host) pointing at /uploads/firm-logos/
    expect(branding.logoUrl).toMatch(/^https?:\/\/.+\/uploads\/firm-logos\//);
    expect(branding.logoUrl).toContain(firmId);
    expect(branding.logoUrl!.endsWith('.png')).toBe(true);

    // File actually landed on disk.
    const urlPath = new URL(branding.logoUrl!).pathname;
    const diskPath = path.join(__dirname, '..', '..', urlPath);
    const stat = await fs.stat(diskPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(bytes.length);
  });

  it('accepts a JPEG and stores it with the .jpg extension', async () => {
    const { token } = await seedFirmAndToken();
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]); // JFIF marker
    const { statusCode, body } = await postMultipart({
      token, filename: 'brand.jpg', contentType: 'image/jpeg', bytes,
    });
    expect(statusCode).toBe(201);
    const branding = (body as { data: { logoUrl: string | null } }).data;
    expect(branding.logoUrl!.endsWith('.jpg')).toBe(true);
  });
});

describe('POST /firm/branding/logo — validation + tenant isolation', () => {
  it('rejects an unsupported mime (UNSUPPORTED_MIME)', async () => {
    const { token } = await seedFirmAndToken();
    const { statusCode, body } = await postMultipart({
      token, filename: 'logo.svg', contentType: 'image/svg+xml',
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'),
    });
    expect(statusCode).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe('UNSUPPORTED_MIME');
  });

  it('rejects a file over 2 MB (FILE_TOO_LARGE)', async () => {
    const { token } = await seedFirmAndToken();
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 16);
    PNG_HEADER.copy(oversized, 0);
    const { statusCode, body } = await postMultipart({
      token, filename: 'huge.png', contentType: 'image/png', bytes: oversized,
    });
    expect(statusCode).toBe(413);
    expect((body as { error: { code: string } }).error.code).toBe('FILE_TOO_LARGE');
  });

  it('stores each firm\'s uploads under a firm-scoped directory', async () => {
    const a = await seedFirmAndToken();
    const b = await seedFirmAndToken();

    const bytes = Buffer.concat([PNG_HEADER, Buffer.alloc(32)]);
    const ra = await postMultipart({ token: a.token, filename: 'a.png', contentType: 'image/png', bytes });
    const rb = await postMultipart({ token: b.token, filename: 'b.png', contentType: 'image/png', bytes });
    expect(ra.statusCode).toBe(201);
    expect(rb.statusCode).toBe(201);

    const urlA = (ra.body as { data: { logoUrl: string } }).data.logoUrl;
    const urlB = (rb.body as { data: { logoUrl: string } }).data.logoUrl;
    expect(urlA).toContain(a.firmId);
    expect(urlB).toContain(b.firmId);
    // Firm A's URL must not leak Firm B's id, and vice versa.
    expect(urlA).not.toContain(b.firmId);
    expect(urlB).not.toContain(a.firmId);
  });
});
