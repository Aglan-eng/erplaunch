import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { engagementRoutes } from '../../src/routes/engagements.js';
import { riskRoutes } from '../../src/routes/risks.js';
import { issueRoutes } from '../../src/routes/issues.js';
import { decisionRoutes } from '../../src/routes/decisions.js';
import { meetingRoutes } from '../../src/routes/meetings.js';
import { activityRoutes } from '../../src/routes/activity.js';
import { getDb, createEngagement, bootstrapFirmAdmin } from '../../src/db/index.js';

const JWT_SECRET = 'test-activity-hooks-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'test-portal-activity-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(activityRoutes, { prefix: '/api/v1' });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.register(riskRoutes, { prefix: '/api/v1' });
  await f.register(issueRoutes, { prefix: '/api/v1' });
  await f.register(decisionRoutes, { prefix: '/api/v1' });
  await f.register(meetingRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface SeedFixture {
  firmId: string;
  userId: string;
  engagementId: string;
  token: string;
}

async function seed(): Promise<SeedFixture> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Activity Firm', `activity-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Test', passwordHash, 'CONSULTANT', now],
  });
  const eng = await createEngagement({ firmId, clientName: 'Acme Manufacturing Ltd' });
  const engagementId = (eng as { id: string }).id;
  // Phase 43.2 — gate the existing routes behind RBAC. The test seed
  // mimics a freshly-registered firm so the user gets APP_ADMIN
  // (matches /auth/register's bootstrapFirmAdmin behaviour).
  await bootstrapFirmAdmin({ firmId, userId });
  const token = app.jwt.sign({
    userId, firmId, role: 'CONSULTANT', name: 'Test', email: `${userId}@example.com`,
  });
  return { firmId, userId, engagementId, token };
}

async function getActions(engagementId: string): Promise<string[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT action FROM ActivityLog WHERE engagementId = ? ORDER BY createdAt ASC`,
    args: [engagementId],
  });
  return (r.rows as Array<Record<string, unknown>>).map((row) => row.action as string);
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

describe('Activity hooks — resource CRUD writes activity', () => {
  it('POST /risks writes RISK_ADDED', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/risks`,
      cookies: { token },
      payload: { title: 'Vendor risk' },
    });
    expect(res.statusCode).toBe(201);
    const actions = await getActions(engagementId);
    expect(actions).toContain('RISK_ADDED');
  });

  it('POST /issues writes ISSUE_OPENED', async () => {
    const { engagementId, token } = await seed();
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/issues`,
      cookies: { token },
      payload: { title: 'Bad data' },
    });
    expect(await getActions(engagementId)).toContain('ISSUE_OPENED');
  });

  it('PATCH /issues with status=RESOLVED writes ISSUE_RESOLVED', async () => {
    const { engagementId, token } = await seed();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/issues`,
      cookies: { token },
      payload: { title: 'Test bad data' },
    });
    const issue = (create.json() as { data: { id: string } }).data;
    const db = getDb();
    await db.execute(`DELETE FROM ActivityLog`); // clear setup activity

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engagementId}/issues/${issue.id}`,
      cookies: { token },
      payload: { status: 'RESOLVED' },
    });
    const actions = await getActions(engagementId);
    expect(actions).toContain('ISSUE_RESOLVED');
    expect(actions).not.toContain('ISSUE_UPDATED');
  });

  it('PATCH /issues with non-status fields writes ISSUE_UPDATED', async () => {
    const { engagementId, token } = await seed();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/issues`,
      cookies: { token },
      payload: { title: 'Initial' },
    });
    const issue = (create.json() as { data: { id: string } }).data;
    const db = getDb();
    await db.execute(`DELETE FROM ActivityLog`);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engagementId}/issues/${issue.id}`,
      cookies: { token },
      payload: { description: 'More detail' },
    });
    expect(await getActions(engagementId)).toContain('ISSUE_UPDATED');
  });

  it('POST /decisions writes DECISION_LOGGED', async () => {
    const { engagementId, token } = await seed();
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/decisions`,
      cookies: { token },
      payload: { title: 'Use OneWorld' },
    });
    expect(await getActions(engagementId)).toContain('DECISION_LOGGED');
  });

  it('POST /meetings writes MEETING_SCHEDULED', async () => {
    const { engagementId, token } = await seed();
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/meetings`,
      cookies: { token },
      payload: { title: 'Kickoff', meetingDate: '2026-06-01' },
    });
    expect(await getActions(engagementId)).toContain('MEETING_SCHEDULED');
  });

  it('POST /members writes MEMBER_ADDED', async () => {
    const { engagementId, token } = await seed();
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/members`,
      cookies: { token },
      payload: { name: 'Alice', role: 'PM', team: 'CLIENT' },
    });
    expect(await getActions(engagementId)).toContain('MEMBER_ADDED');
  });

  it('DELETE /members writes MEMBER_REMOVED', async () => {
    const { engagementId, token } = await seed();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/members`,
      cookies: { token },
      payload: { name: 'Bob', role: 'PM' },
    });
    const member = (create.json() as { data: { id: string } }).data;
    const db = getDb();
    await db.execute(`DELETE FROM ActivityLog`);

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/engagements/${engagementId}/members/${member.id}`,
      cookies: { token },
    });
    expect(await getActions(engagementId)).toContain('MEMBER_REMOVED');
  });

  it('PATCH /members writes MEMBER_UPDATED', async () => {
    const { engagementId, token } = await seed();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/members`,
      cookies: { token },
      payload: { name: 'Carol', role: 'PM' },
    });
    const member = (create.json() as { data: { id: string } }).data;
    const db = getDb();
    await db.execute(`DELETE FROM ActivityLog`);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engagementId}/members/${member.id}`,
      cookies: { token },
      payload: { role: 'Director' },
    });
    expect(await getActions(engagementId)).toContain('MEMBER_UPDATED');
  });

  it('PUT /license writes LICENSE_UPDATED', async () => {
    const { engagementId, token } = await seed();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${engagementId}/license`,
      cookies: { token },
      payload: { edition: 'MID_MARKET', modules: ['CORE'] },
    });
    expect(await getActions(engagementId)).toContain('LICENSE_UPDATED');
  });

  it('PATCH /profile writes a single PROFILE_ANSWERED entry per request (de-noised)', async () => {
    const { engagementId, token } = await seed();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engagementId}/profile`,
      cookies: { token },
      payload: { answers: { 'r2r.entities.multiEntity': true, 'r2r.entities.entityCount': 3, 'r2r.currencies.isMultiCurrency': false } },
    });
    const actions = await getActions(engagementId);
    const profileEntries = actions.filter((a) => a === 'PROFILE_ANSWERED');
    expect(profileEntries).toHaveLength(1);
  });
});

describe('POST /engagements/:id/activity — manual notes', () => {
  it('records a NOTE entry', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/activity`,
      cookies: { token },
      payload: { action: 'NOTE', detail: 'Spoke with Khalid; concerned about Q4 timing.' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { action: string; details: string } };
    expect(body.data.action).toBe('NOTE');
    expect(body.data.details).toContain('Khalid');
  });

  it('accepts OBSERVATION / TODO / DECISION whitelist values', async () => {
    const { engagementId, token } = await seed();
    for (const action of ['OBSERVATION', 'TODO', 'DECISION'] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/engagements/${engagementId}/activity`,
        cookies: { token },
        payload: { action, detail: `${action} body` },
      });
      expect(res.statusCode, `${action}`).toBe(201);
    }
  });

  it('rejects an unknown action with 400', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/activity`,
      cookies: { token },
      payload: { action: 'BOGUS', detail: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty detail with 400', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/activity`,
      cookies: { token },
      payload: { action: 'NOTE', detail: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an engagement owned by another firm', async () => {
    const a = await seed();
    const b = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${a.engagementId}/activity`,
      cookies: { token: b.token },
      payload: { action: 'NOTE', detail: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });
});
