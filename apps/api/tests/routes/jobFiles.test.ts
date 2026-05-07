import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { engagementRoutes } from '../../src/routes/engagements.js';
import { getDb, createEngagement, createJob, updateJob } from '../../src/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUTS_DIR = path.join(__dirname, '..', '..', 'outputs');
const JWT_SECRET = 'test-job-files-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal', secret: 'test-portal-job-files-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface SeedFixture {
  firmId: string;
  userId: string;
  engagementId: string;
  jobId: string;
  token: string;
  jobOutputDir: string;
}

async function seedJobWithFiles(): Promise<SeedFixture> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Files Firm', `files-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Tester', passwordHash, 'CONSULTANT', now],
  });
  const eng = await createEngagement({ firmId, clientName: 'Files Acme' });
  const engagementId = (eng as { id: string }).id;
  const job = await createJob(engagementId, 'STRATEGIC_handoff');
  const jobId = (job as { id: string }).id;
  await updateJob(jobId, { status: 'COMPLETE' });

  const jobOutputDir = path.join(OUTPUTS_DIR, jobId);
  await fsp.mkdir(path.join(jobOutputDir, 'Documentation'), { recursive: true });
  await fsp.mkdir(path.join(jobOutputDir, 'SDF'), { recursive: true });
  await fsp.writeFile(path.join(jobOutputDir, 'Documentation', 'BRD.md'), '# BRD\n\nHello.');
  await fsp.writeFile(path.join(jobOutputDir, 'Documentation', 'BRD.html'), '<h1>BRD</h1>');
  await fsp.writeFile(path.join(jobOutputDir, 'SDF', 'manifest.xml'), '<manifest/>');
  await fsp.writeFile(path.join(jobOutputDir, 'README.txt'), 'Output bundle.');

  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Tester', email: `${userId}@example.com` });
  return { firmId, userId, engagementId, jobId, token, jobOutputDir };
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
  // Clear out the outputs dir between tests to avoid cross-pollination.
  if (fs.existsSync(OUTPUTS_DIR)) {
    for (const entry of fs.readdirSync(OUTPUTS_DIR)) {
      const full = path.join(OUTPUTS_DIR, entry);
      try {
        fs.rmSync(full, { recursive: true, force: true });
      } catch { /* swallow — best effort */ }
    }
  }
});

describe('GET /api/v1/engagements/:id/jobs/:jobId/files — file tree', () => {
  it('requires authentication', async () => {
    const { engagementId, jobId } = await seedJobWithFiles();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/jobs/${jobId}/files`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the directory tree with sizes', async () => {
    const { engagementId, jobId, token } = await seedJobWithFiles();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/jobs/${jobId}/files`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { name: string; type: 'dir'; children: Array<{ name: string; type: 'dir' | 'file'; size?: number; children?: unknown[] }> } };
    expect(body.data.type).toBe('dir');
    expect(body.data.name).toBe('');

    const docDir = body.data.children.find((c) => c.name === 'Documentation');
    expect(docDir).toBeDefined();
    expect(docDir?.type).toBe('dir');
    const docChildren = (docDir?.children ?? []) as Array<{ name: string; type: 'file'; size: number }>;
    const brd = docChildren.find((c) => c.name === 'BRD.md');
    expect(brd?.type).toBe('file');
    expect(brd?.size).toBeGreaterThan(0);

    const readme = body.data.children.find((c) => c.name === 'README.txt');
    expect(readme?.type).toBe('file');
  });

  it('returns 404 for a job belonging to another firm', async () => {
    const a = await seedJobWithFiles();
    const b = await seedJobWithFiles();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${a.engagementId}/jobs/${a.jobId}/files`,
      cookies: { token: b.token },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/v1/engagements/:id/jobs/:jobId/files/* — single file', () => {
  it('streams a markdown file with text/markdown content type', async () => {
    const { engagementId, jobId, token } = await seedJobWithFiles();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/jobs/${jobId}/files/Documentation/BRD.md`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.body).toContain('# BRD');
  });

  it('streams an HTML file with text/html content type', async () => {
    const { engagementId, jobId, token } = await seedJobWithFiles();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/jobs/${jobId}/files/Documentation/BRD.html`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('returns 404 for a missing file', async () => {
    const { engagementId, jobId, token } = await seedJobWithFiles();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/jobs/${jobId}/files/Documentation/missing.md`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects path traversal attempts', async () => {
    const { engagementId, jobId, token } = await seedJobWithFiles();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/jobs/${jobId}/files/..%2F..%2Fpackage.json`,
      cookies: { token },
    });
    expect([400, 403, 404]).toContain(res.statusCode);
  });

  it('cross-firm 404', async () => {
    const a = await seedJobWithFiles();
    const b = await seedJobWithFiles();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${a.engagementId}/jobs/${a.jobId}/files/Documentation/BRD.md`,
      cookies: { token: b.token },
    });
    expect(res.statusCode).toBe(404);
  });
});
