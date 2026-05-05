import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { engagementRoutes } from '../../src/routes/engagements.js';
import { activityRoutes } from '../../src/routes/activity.js';
import { getDb, createEngagement } from '../../src/db/index.js';

const JWT_SECRET = 'test-section-comments-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'test-portal-section-comments-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.register(activityRoutes, { prefix: '/api/v1' });
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
    args: [firmId, 'Comments Firm', `comments-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Tester', passwordHash, 'CONSULTANT', now],
  });
  const eng = await createEngagement({ firmId, clientName: 'Acme Comments Client' });
  const engagementId = (eng as { id: string }).id;
  const token = app.jwt.sign({
    userId, firmId, role: 'CONSULTANT', name: 'Tester', email: `${userId}@example.com`,
  });
  return { firmId, userId, engagementId, token };
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

describe('POST /api/v1/engagements/:id/comments', () => {
  it('requires authentication', async () => {
    const { engagementId } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/comments`,
      payload: { sectionKey: 'r2r.entities', body: 'A comment' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a comment and returns it with author + createdAt', async () => {
    const { engagementId, token, userId } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/comments`,
      cookies: { token },
      payload: { sectionKey: 'r2r.entities', body: 'Discussed multi-entity setup with client.' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string; sectionKey: string; body: string; authorUserId: string; createdAt: string } };
    expect(body.data.sectionKey).toBe('r2r.entities');
    expect(body.data.body).toBe('Discussed multi-entity setup with client.');
    expect(body.data.authorUserId).toBe(userId);
    expect(body.data.createdAt).toBeTruthy();
  });

  it('preserves mentionMemberIds when provided', async () => {
    const { engagementId, token } = await seed();
    const memberIdA = createId();
    const memberIdB = createId();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/comments`,
      cookies: { token },
      payload: {
        sectionKey: 'r2r.entities',
        body: 'Need input from finance + ops.',
        mentionMemberIds: [memberIdA, memberIdB],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { mentionMemberIds: string[] } };
    expect(body.data.mentionMemberIds).toEqual([memberIdA, memberIdB]);
  });

  it('allows multiple comments on the same sectionKey (no UNIQUE collision)', async () => {
    const { engagementId, token } = await seed();
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/engagements/${engagementId}/comments`,
        cookies: { token },
        payload: { sectionKey: 'r2r.entities', body: `Comment ${i}` },
      });
      expect(res.statusCode).toBe(201);
    }
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/comments`,
      cookies: { token },
    });
    const body = list.json() as { data: Array<{ sectionKey: string }> };
    const onSection = body.data.filter((c) => c.sectionKey === 'r2r.entities');
    expect(onSection.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects empty body with 400', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/comments`,
      cookies: { token },
      payload: { sectionKey: 'r2r.entities', body: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing sectionKey with 400', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/comments`,
      cookies: { token },
      payload: { body: 'Orphan comment' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('writes a SECTION_COMMENTED activity entry', async () => {
    const { engagementId, token } = await seed();
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/comments`,
      cookies: { token },
      payload: { sectionKey: 'r2r.entities', body: 'A note' },
    });
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ? ORDER BY createdAt DESC`,
      args: [engagementId],
    });
    const actions = (r.rows as Array<Record<string, unknown>>).map((row) => row.action as string);
    expect(actions).toContain('SECTION_COMMENTED');
  });

  it('cross-firm POST returns 404', async () => {
    const a = await seed();
    const b = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${a.engagementId}/comments`,
      cookies: { token: b.token },
      payload: { sectionKey: 'r2r.entities', body: 'sneaky' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/v1/engagements/:id/comments/:commentId', () => {
  it('updates an existing comment body', async () => {
    const { engagementId, token } = await seed();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/comments`,
      cookies: { token },
      payload: { sectionKey: 'r2r.entities', body: 'original' },
    });
    const commentId = (create.json() as { data: { id: string } }).data.id;
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engagementId}/comments/${commentId}`,
      cookies: { token },
      payload: { body: 'edited' },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json() as { data: { body: string } };
    expect(body.data.body).toBe('edited');
  });

  it('returns 404 for a missing commentId', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engagementId}/comments/${createId()}`,
      cookies: { token },
      payload: { body: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects empty body with 400', async () => {
    const { engagementId, token } = await seed();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/comments`,
      cookies: { token },
      payload: { sectionKey: 'r2r.entities', body: 'original' },
    });
    const commentId = (create.json() as { data: { id: string } }).data.id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engagementId}/comments/${commentId}`,
      cookies: { token },
      payload: { body: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/v1/engagements/:id/comments/:commentId', () => {
  it('deletes a comment and returns 204', async () => {
    const { engagementId, token } = await seed();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/comments`,
      cookies: { token },
      payload: { sectionKey: 'r2r.entities', body: 'gone soon' },
    });
    const commentId = (create.json() as { data: { id: string } }).data.id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/engagements/${engagementId}/comments/${commentId}`,
      cookies: { token },
    });
    expect(del.statusCode).toBe(204);

    const listAfter = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${engagementId}/comments`,
      cookies: { token },
    });
    const body = listAfter.json() as { data: Array<{ id: string }> };
    expect(body.data.find((c) => c.id === commentId)).toBeUndefined();
  });

  it('returns 404 for an already-deleted comment', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/engagements/${engagementId}/comments/${createId()}`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(404);
  });
});
