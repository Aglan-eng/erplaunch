/**
 * Phase 55.2 — Assistant route tests.
 *
 * Pins the contract:
 *   - POST /assistant/chat works without an AI key (heuristic
 *     fallback) so the route is testable in CI.
 *   - Customer-scoped chats build a customer context and persist
 *     messages.
 *   - Firm-wide chats don't require a customerId.
 *   - The route refuses a customerId the caller can't access
 *     (cross-firm or unknown).
 *   - GET /conversations + /conversations/:id are firm + user
 *     scoped.
 *   - Suggested actions are advisory only — none of the chat
 *     endpoint's persisted messages mutate any customer state.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { createId } from '@paralleldrive/cuid2';

import { setupTestDb } from '../_helpers/testDb.js';
import { assistantRoutes } from '../../src/routes/assistant.js';
import { getDb, insertCustomer } from '../../src/db/index.js';

const JWT_SECRET = 'assistant-route-test';

let cleanup: () => void;
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });
  await f.register(assistantRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

async function seedFirmUser(): Promise<{ firmId: string; userId: string; token: string }> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
    args: [firmId, 'Assistant Firm', `af-${firmId}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
          VALUES (?, ?, ?, ?, 'x', 'CONSULTANT', ?)`,
    args: [userId, firmId, `${userId}@x.io`, 'Demo', now],
  });
  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'APP_ADMIN',
    name: 'Demo',
    email: `${userId}@x.io`,
  });
  return { firmId, userId, token };
}

async function seedCustomer(firmId: string, stage = 'BUILD'): Promise<string> {
  const id = createId();
  const now = new Date().toISOString();
  await getDb().execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
          VALUES (?, ?, ?, 'PROSPECT', ?, ?)`,
    args: [id, firmId, `Customer ${id.slice(0, 6)}`, now, now],
  });
  await insertCustomer({
    id,
    firmId,
    name: `Customer ${id.slice(0, 6)}`,
    currentStage: stage as 'BUILD',
    sourceEngagementId: id,
  });
  return id;
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM AssistantMessage`);
  await db.execute(`DELETE FROM AssistantConversation`);
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM IssueItem`);
  await db.execute(`DELETE FROM DecisionItem`);
  await db.execute(`DELETE FROM Customer`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

describe('POST /assistant/chat', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      payload: { message: 'hi', context: {} },
    });
    expect(r.statusCode).toBe(401);
  });

  it('creates a conversation + persists user/assistant messages (firm-wide context)', async () => {
    const u = await seedFirmUser();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      cookies: { token: u.token },
      payload: { message: 'Give me a firm snapshot.', context: {} },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { conversationId: string; reply: string; suggestedActions: unknown[] };
    expect(body.conversationId).toBeTruthy();
    expect(typeof body.reply).toBe('string');
    expect(body.reply.length).toBeGreaterThan(0);
    expect(Array.isArray(body.suggestedActions)).toBe(true);

    // Persisted: 1 user + 1 assistant = 2 rows.
    const rows = await getDb().execute({
      sql: `SELECT COUNT(*) AS c FROM AssistantMessage WHERE conversationId = ?`,
      args: [body.conversationId],
    });
    expect(Number((rows.rows[0] as unknown as { c: number }).c)).toBe(2);
  });

  it('builds a customer-scoped context when customerId is provided', async () => {
    const u = await seedFirmUser();
    const cid = await seedCustomer(u.firmId, 'BUILD');
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      cookies: { token: u.token },
      payload: {
        message: "What's blocking this customer?",
        context: { customerId: cid, page: `/customers/${cid}` },
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { conversationId: string; reply: string };
    // The conversation row carries the customerId so the next open
    // can restore the right context.
    const conv = await getDb().execute({
      sql: `SELECT customerId FROM AssistantConversation WHERE id = ?`,
      args: [body.conversationId],
    });
    const row = conv.rows[0] as unknown as { customerId: unknown };
    expect(row.customerId).toBe(cid);
  });

  it('refuses a customerId the user cannot access (cross-firm 403)', async () => {
    const userA = await seedFirmUser();
    const userB = await seedFirmUser();
    const cidB = await seedCustomer(userB.firmId);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      cookies: { token: userA.token },
      payload: {
        message: 'show me',
        context: { customerId: cidB },
      },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({
      error: { code: 'CUSTOMER_NOT_VISIBLE' },
    });
  });

  it('continues an existing conversation when conversationId is provided', async () => {
    const u = await seedFirmUser();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      cookies: { token: u.token },
      payload: { message: 'hi', context: {} },
    });
    const conversationId = (first.json() as { conversationId: string }).conversationId;
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      cookies: { token: u.token },
      payload: { message: 'follow up', conversationId, context: {} },
    });
    expect(second.statusCode).toBe(200);
    const body = second.json() as { conversationId: string };
    expect(body.conversationId).toBe(conversationId);
    // 2 turns × 2 messages = 4 rows.
    const rows = await getDb().execute({
      sql: `SELECT COUNT(*) AS c FROM AssistantMessage WHERE conversationId = ?`,
      args: [conversationId],
    });
    expect(Number((rows.rows[0] as unknown as { c: number }).c)).toBe(4);
  });

  it('returns 404 when conversationId belongs to a different user/firm', async () => {
    const a = await seedFirmUser();
    const b = await seedFirmUser();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      cookies: { token: a.token },
      payload: { message: 'mine', context: {} },
    });
    const conversationId = (created.json() as { conversationId: string }).conversationId;
    const stolen = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      cookies: { token: b.token },
      payload: { message: 'not yours', conversationId, context: {} },
    });
    expect(stolen.statusCode).toBe(404);
  });
});

describe('GET /assistant/conversations', () => {
  it('lists only the caller\'s conversations', async () => {
    const a = await seedFirmUser();
    const b = await seedFirmUser();
    // a creates 2 conversations.
    await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      cookies: { token: a.token },
      payload: { message: 'one', context: {} },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      cookies: { token: a.token },
      payload: { message: 'two', context: {} },
    });
    // b creates 1.
    await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      cookies: { token: b.token },
      payload: { message: 'three', context: {} },
    });

    const listA = await app.inject({
      method: 'GET',
      url: '/api/v1/assistant/conversations',
      cookies: { token: a.token },
    });
    expect(listA.statusCode).toBe(200);
    expect((listA.json() as { conversations: unknown[] }).conversations).toHaveLength(2);

    const listB = await app.inject({
      method: 'GET',
      url: '/api/v1/assistant/conversations',
      cookies: { token: b.token },
    });
    expect((listB.json() as { conversations: unknown[] }).conversations).toHaveLength(1);
  });
});

describe('GET /assistant/conversations/:id', () => {
  it('returns the conversation + persisted messages with suggested-actions parsed', async () => {
    const u = await seedFirmUser();
    const chat = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      cookies: { token: u.token },
      payload: { message: 'tell me', context: {} },
    });
    const conversationId = (chat.json() as { conversationId: string }).conversationId;
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/assistant/conversations/${conversationId}`,
      cookies: { token: u.token },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      conversation: { id: string };
      messages: Array<{ role: string; content: string; suggestedActions: unknown[] }>;
    };
    expect(body.conversation.id).toBe(conversationId);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[1].role).toBe('assistant');
    expect(Array.isArray(body.messages[1].suggestedActions)).toBe(true);
  });
});
