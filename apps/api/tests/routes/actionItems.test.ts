import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { actionItemRoutes } from '../../src/routes/actionItems.js';
import { activityRoutes } from '../../src/routes/activity.js';
import { getDb, createEngagement, bootstrapFirmAdmin } from '../../src/db/index.js';

const JWT_SECRET = 'test-action-items-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal', secret: 'test-portal-action-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(activityRoutes, { prefix: '/api/v1' });
  await f.register(actionItemRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface SeedFixture { firmId: string; userId: string; engagementId: string; token: string }

async function seed(): Promise<SeedFixture> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'AI Firm', `ai-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Tester', passwordHash, 'CONSULTANT', now],
  });
  const eng = await createEngagement({ firmId, clientName: 'Acme Action Client' });
  const engagementId = (eng as { id: string }).id;
  // Phase 44.3 — RBAC gates require a role to read/write.
  await bootstrapFirmAdmin({ firmId, userId });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Tester', email: `${userId}@example.com` });
  return { firmId, userId, engagementId, token };
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildTestApp();
});
afterAll(async () => { await app.close(); cleanup(); });
beforeEach(async () => { await getDb().execute(`DELETE FROM ActivityLog`); });

describe('Action items full CRUD', () => {
  it('GET on a fresh engagement returns []', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/action-items`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('POST creates an action item with sensible defaults', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/action-items`,
      cookies: { token },
      payload: {
        title: 'Confirm fiscal year start',
        description: 'Need confirmation from finance before phase 2.',
        owner: 'CLIENT',
        priority: 'HIGH',
        dueDate: '2026-06-15',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string; title: string; status: string; priority: string; owner: string } };
    expect(body.data.title).toBe('Confirm fiscal year start');
    expect(body.data.status).toBe('OPEN');
    expect(body.data.priority).toBe('HIGH');
    expect(body.data.owner).toBe('CLIENT');
  });

  it('rejects missing title with 400', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/action-items`,
      cookies: { token },
      payload: { description: 'no title' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH with status=DONE writes ACTION_ITEM_COMPLETED', async () => {
    const { engagementId, token } = await seed();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/action-items`,
      cookies: { token },
      payload: { title: 'Test action' },
    });
    const id = (create.json() as { data: { id: string } }).data.id;
    await getDb().execute(`DELETE FROM ActivityLog`); // clear create entry

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engagementId}/action-items/${id}`,
      cookies: { token },
      payload: { status: 'DONE' },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json() as { data: { status: string; completedAt: string } };
    expect(body.data.status).toBe('DONE');
    expect(body.data.completedAt).toBeTruthy();

    const r = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ? ORDER BY createdAt DESC`,
      args: [engagementId],
    });
    const actions = (r.rows as Array<Record<string, unknown>>).map((row) => row.action as string);
    expect(actions).toContain('ACTION_ITEM_COMPLETED');
  });

  it('PATCH with non-status fields writes ACTION_ITEM_UPDATED', async () => {
    const { engagementId, token } = await seed();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/action-items`,
      cookies: { token },
      payload: { title: 'Original' },
    });
    const id = (create.json() as { data: { id: string } }).data.id;
    await getDb().execute(`DELETE FROM ActivityLog`);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engagementId}/action-items/${id}`,
      cookies: { token },
      payload: { description: 'Edited' },
    });
    const r = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ?`,
      args: [engagementId],
    });
    const actions = (r.rows as Array<Record<string, unknown>>).map((row) => row.action as string);
    expect(actions).toContain('ACTION_ITEM_UPDATED');
  });

  it('DELETE removes the row and returns 204', async () => {
    const { engagementId, token } = await seed();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/action-items`,
      cookies: { token },
      payload: { title: 'Remove me' },
    });
    const id = (create.json() as { data: { id: string } }).data.id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/engagements/${engagementId}/action-items/${id}`,
      cookies: { token },
    });
    expect(del.statusCode).toBe(204);
  });

  it('DELETE on already-deleted returns 404', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/engagements/${engagementId}/action-items/${createId()}`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(404);
  });

  it('cross-firm 404', async () => {
    const a = await seed();
    const b = await seed();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${a.engagementId}/action-items`,
      cookies: { token: a.token },
      payload: { title: 'Owned by A' },
    });
    const id = (create.json() as { data: { id: string } }).data.id;
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${a.engagementId}/action-items`,
      cookies: { token: b.token },
    });
    expect(get.statusCode).toBe(404);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${a.engagementId}/action-items/${id}`,
      cookies: { token: b.token },
      payload: { status: 'DONE' },
    });
    expect(patch.statusCode).toBe(404);
  });

  it('writes ACTION_ITEM_CREATED on POST', async () => {
    const { engagementId, token } = await seed();
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/action-items`,
      cookies: { token },
      payload: { title: 'fresh' },
    });
    const r = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ?`,
      args: [engagementId],
    });
    const actions = (r.rows as Array<Record<string, unknown>>).map((row) => row.action as string);
    expect(actions).toContain('ACTION_ITEM_CREATED');
  });
});
