/**
 * Phase 47.2 — route tests for the convenience direct-download endpoint
 * `GET /api/v1/engagements/:id/project-plan/latest.xml`.
 *
 * Why: the dashboard kanban quick-download icon and the engagement page
 * "Open in MS Project" link both depend on this endpoint behaving
 * predictably across three states:
 *
 *   1. Engagement exists, no MS_PROJECT_PLAN job has ever run    → 404
 *   2. Engagement exists, latest MS_PROJECT_PLAN job is RUNNING   → 404
 *   3. Engagement exists, latest job is COMPLETE + file on disk  → 200 + xml body
 *      with Content-Disposition: attachment.
 *   4. Engagement exists, latest job is COMPLETE but file missing → 404 PROJECT_PLAN_MISSING
 *
 * The HTTP-layer test is deliberately separate from the unit test on
 * generateMsProjectPlan: this one exercises the route + DB lookup +
 * file-system streaming, not the XML structure itself.
 */
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
const JWT_SECRET = 'test-project-plan-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'test-portal-project-plan-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface SeedContext {
  firmId: string;
  userId: string;
  engagementId: string;
  token: string;
}

async function seedFirmAndEngagement(opts?: { clientName?: string }): Promise<SeedContext> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Plan Firm', `plan-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [
      userId,
      firmId,
      `${userId}@example.com`,
      'Tester',
      passwordHash,
      'CONSULTANT',
      now,
    ],
  });
  const eng = await createEngagement({
    firmId,
    clientName: opts?.clientName ?? 'Plan Acme',
  });
  const engagementId = (eng as { id: string }).id;
  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'CONSULTANT',
    name: 'Tester',
    email: `${userId}@example.com`,
  });
  return { firmId, userId, engagementId, token };
}

async function writeProjectPlanFile(jobId: string, body: string): Promise<void> {
  const dir = path.join(OUTPUTS_DIR, jobId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'Project_Plan.xml'), body);
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
  // Clear outputs dir to keep tests independent.
  if (fs.existsSync(OUTPUTS_DIR)) {
    for (const entry of fs.readdirSync(OUTPUTS_DIR)) {
      try {
        fs.rmSync(path.join(OUTPUTS_DIR, entry), { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
});

describe('GET /api/v1/engagements/:id/project-plan/latest.xml', () => {
  it('returns 404 NOT_FOUND when the engagement does not exist', async () => {
    const { token } = await seedFirmAndEngagement();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/does-not-exist/project-plan/latest.xml`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 NO_PROJECT_PLAN when the engagement has no MS_PROJECT_PLAN jobs', async () => {
    const { engagementId, token } = await seedFirmAndEngagement();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/project-plan/latest.xml`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NO_PROJECT_PLAN');
  });

  it('returns 404 NO_PROJECT_PLAN when only running / failed jobs exist', async () => {
    const { engagementId, token } = await seedFirmAndEngagement();
    // Running job — should NOT match the latest-COMPLETE filter.
    const j1 = await createJob(engagementId, 'MS_PROJECT_PLAN');
    await updateJob((j1 as { id: string }).id, { status: 'RUNNING' });
    // Failed job — also filtered out.
    const j2 = await createJob(engagementId, 'MS_PROJECT_PLAN');
    await updateJob((j2 as { id: string }).id, { status: 'FAILED' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/project-plan/latest.xml`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NO_PROJECT_PLAN');
  });

  it('returns 404 PROJECT_PLAN_MISSING when the job is COMPLETE but the file is gone', async () => {
    const { engagementId, token } = await seedFirmAndEngagement();
    const j = await createJob(engagementId, 'MS_PROJECT_PLAN');
    await updateJob((j as { id: string }).id, { status: 'COMPLETE' });
    // Note: deliberately do NOT writeProjectPlanFile — simulates outputs dir wipe.
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/project-plan/latest.xml`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PROJECT_PLAN_MISSING');
  });

  it('streams the XML with attachment Content-Disposition when COMPLETE + file exists', async () => {
    const { engagementId, token } = await seedFirmAndEngagement({ clientName: 'Acme & Co' });
    const j = await createJob(engagementId, 'MS_PROJECT_PLAN');
    const jobId = (j as { id: string }).id;
    await updateJob(jobId, { status: 'COMPLETE' });
    const xml = '<?xml version="1.0" encoding="UTF-8"?><Project xmlns="http://schemas.microsoft.com/project"><Title>Acme</Title></Project>';
    await writeProjectPlanFile(jobId, xml);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/project-plan/latest.xml`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('xml');
    // Filename uses the engagement's clientName, with XML-special chars
    // sanitized to keep the Content-Disposition header valid.
    const cd = String(res.headers['content-disposition'] ?? '');
    expect(cd).toContain('attachment');
    expect(cd).toContain('Project Plan.xml');
    // & got sanitized so the header is safe to set.
    expect(cd).not.toContain('&');
    expect(res.body).toContain('<Project');
  });

  it('picks the latest COMPLETE job when multiple exist', async () => {
    const { engagementId, token } = await seedFirmAndEngagement();
    // First completed job — older.
    const j1 = await createJob(engagementId, 'MS_PROJECT_PLAN');
    const j1Id = (j1 as { id: string }).id;
    await updateJob(j1Id, { status: 'COMPLETE' });
    await writeProjectPlanFile(j1Id, '<?xml version="1.0"?><Project><Title>OLD</Title></Project>');
    // Sleep > 1s — SQLite's `datetime('now')` default rounds createdAt to
    // the nearest second, so two jobs created within the same second tie
    // on the ORDER BY clause and the route's `.find()` may return either.
    // Real users can hit the same edge case if they double-click the
    // quick-download icon; that's a known limitation we accept rather
    // than rewriting createJob to use millisecond timestamps.
    await new Promise((r) => setTimeout(r, 1100));
    // Second completed job — newer; this is what the route should serve.
    const j2 = await createJob(engagementId, 'MS_PROJECT_PLAN');
    const j2Id = (j2 as { id: string }).id;
    await updateJob(j2Id, { status: 'COMPLETE' });
    await writeProjectPlanFile(j2Id, '<?xml version="1.0"?><Project><Title>NEW</Title></Project>');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/project-plan/latest.xml`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('NEW');
    expect(res.body).not.toContain('OLD');
  });
});
