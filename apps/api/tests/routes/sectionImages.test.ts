import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { engagementRoutes } from '../../src/routes/engagements.js';
import { activityRoutes } from '../../src/routes/activity.js';
import { getDb, createEngagement } from '../../src/db/index.js';

const JWT_SECRET = 'test-section-images-secret';
const SECTION_IMAGE_LIMIT = 10 * 1024 * 1024;
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'test-portal-section-images-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(multipart, { limits: { fileSize: SECTION_IMAGE_LIMIT + 1024 } });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.register(activityRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface SeedFixture { firmId: string; engagementId: string; token: string }

async function seed(): Promise<SeedFixture> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Images Firm', `images-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Tester', passwordHash, 'CONSULTANT', now],
  });
  const eng = await createEngagement({ firmId, clientName: 'Acme Images Client' });
  const engagementId = (eng as { id: string }).id;
  const token = app.jwt.sign({
    userId, firmId, role: 'CONSULTANT', name: 'Tester', email: `${userId}@example.com`,
  });
  return { firmId, engagementId, token };
}

function buildMultipart(opts: { mimetype: string; filename: string; sectionKey: string; size: number }): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----TestBoundary' + createId();
  const sectionPart = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="sectionKey"`,
    '',
    opts.sectionKey,
  ].join('\r\n');
  const filePartHeader = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${opts.filename}"`,
    `Content-Type: ${opts.mimetype}`,
    '',
    '',
  ].join('\r\n');
  const filler = Buffer.alloc(opts.size, 0x42); // arbitrary non-zero bytes
  const tail = `\r\n--${boundary}--\r\n`;
  const payload = Buffer.concat([
    Buffer.from(sectionPart + '\r\n', 'utf8'),
    Buffer.from(filePartHeader, 'utf8'),
    filler,
    Buffer.from(tail, 'utf8'),
  ]);
  return {
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM ActivityLog`);
});

describe('POST /api/v1/engagements/:id/images — limits + activity', () => {
  it('accepts a 1KB png and returns 201', async () => {
    const { engagementId, token } = await seed();
    const { payload, headers } = buildMultipart({
      mimetype: 'image/png', filename: 'sample.png', sectionKey: 'r2r.entities', size: 1024,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/images`,
      cookies: { token },
      payload,
      headers,
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects a 12MB upload with 413', async () => {
    const { engagementId, token } = await seed();
    const { payload, headers } = buildMultipart({
      mimetype: 'image/png', filename: 'huge.png', sectionKey: 'r2r.entities', size: 12 * 1024 * 1024,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/images`,
      cookies: { token },
      payload,
      headers,
    });
    expect(res.statusCode).toBe(413);
  });

  it('rejects text/plain MIME with 400', async () => {
    const { engagementId, token } = await seed();
    const { payload, headers } = buildMultipart({
      mimetype: 'text/plain', filename: 'notes.txt', sectionKey: 'r2r.entities', size: 256,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/images`,
      cookies: { token },
      payload,
      headers,
    });
    expect(res.statusCode).toBe(400);
  });

  it('writes a SECTION_IMAGE_ADDED activity entry', async () => {
    const { engagementId, token } = await seed();
    const { payload, headers } = buildMultipart({
      mimetype: 'image/png', filename: 'fresh.png', sectionKey: 'r2r.entities', size: 1024,
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/images`,
      cookies: { token },
      payload,
      headers,
    });
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ? ORDER BY createdAt DESC`,
      args: [engagementId],
    });
    const actions = (r.rows as Array<Record<string, unknown>>).map((row) => row.action as string);
    expect(actions).toContain('SECTION_IMAGE_ADDED');
  });
});
