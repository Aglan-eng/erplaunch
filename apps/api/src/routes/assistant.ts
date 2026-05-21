/**
 * Phase 55.2 — AI assistant routes.
 *
 *   POST /api/v1/assistant/chat
 *     body: { message, conversationId?, context: { page, customerId? } }
 *     - Loads context server-side (never trusts the client).
 *     - Calls Claude (via the shared aiClient wrapper) with the
 *       lifecycle-aware system prompt.
 *     - Persists both user + assistant messages.
 *     - Returns { conversationId, reply, suggestedActions }.
 *
 *   GET /api/v1/assistant/conversations
 *     - List the caller's conversations (firm + user scoped).
 *
 *   GET /api/v1/assistant/conversations/:id
 *     - Full message history.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { authenticate } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { getCustomer } from '../db/customer.js';
import { buildAssistantContext } from '../services/assistant/buildContext.js';
import { callAssistant, type ChatMessage } from '../services/assistant/callClaude.js';

const ChatBody = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().min(1).max(200).optional(),
  context: z.object({
    page: z.string().max(200).optional(),
    customerId: z.string().min(1).max(200).optional(),
  }),
});

interface ConversationRow {
  id: unknown;
  firmId: unknown;
  userId: unknown;
  customerId: unknown;
  title: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

interface MessageRow {
  id: unknown;
  conversationId: unknown;
  role: unknown;
  content: unknown;
  suggestedActions: unknown;
  createdAt: unknown;
}

async function loadConversation(
  id: string,
  firmId: string,
  userId: string,
): Promise<ConversationRow | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, firmId, userId, customerId, title, createdAt, updatedAt
          FROM AssistantConversation
          WHERE id = ? AND firmId = ? AND userId = ? LIMIT 1`,
    args: [id, firmId, userId],
  });
  return (r.rows[0] as unknown as ConversationRow) ?? null;
}

async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, conversationId, role, content, suggestedActions, createdAt
          FROM AssistantMessage WHERE conversationId = ?
          ORDER BY createdAt ASC LIMIT 50`,
    args: [conversationId],
  });
  return r.rows.map((raw) => {
    const m = raw as unknown as MessageRow;
    return {
      role: String(m.role) === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(m.content ?? ''),
    };
  });
}

export async function assistantRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // ── POST /assistant/chat ─────────────────────────────────────────
  fastify.post('/assistant/chat', async (request, reply) => {
    const parsed = ChatBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }
    const firmId = request.jwtUser.firmId;
    const userId = request.jwtUser.userId;
    const { message, context } = parsed.data;
    const requestedCustomerId = context.customerId ?? null;

    // Tenant + access check: if the client passes a customerId, verify
    // the customer exists in this firm before loading context for it.
    let resolvedCustomerId: string | null = null;
    if (requestedCustomerId) {
      const customer = await getCustomer(requestedCustomerId, firmId);
      if (!customer) {
        return reply.code(403).send({
          error: {
            code: 'CUSTOMER_NOT_VISIBLE',
            message: 'You do not have access to that customer.',
          },
        });
      }
      resolvedCustomerId = customer.id;
    }

    // Conversation lifecycle.
    let conversationId = parsed.data.conversationId ?? null;
    const db = getDb();
    if (conversationId) {
      const existing = await loadConversation(conversationId, firmId, userId);
      if (!existing) {
        return reply.code(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND' },
        });
      }
    } else {
      conversationId = createId();
      const title = message.slice(0, 80);
      await db.execute({
        sql: `INSERT INTO AssistantConversation (id, firmId, userId, customerId, title)
              VALUES (?, ?, ?, ?, ?)`,
        args: [conversationId, firmId, userId, resolvedCustomerId, title],
      });
    }

    // Build context + history + call model.
    const builtContext = await buildAssistantContext({
      firmId,
      customerId: resolvedCustomerId,
      page: context.page,
    });
    const history = await loadHistory(conversationId);

    const userMsgId = createId();
    await db.execute({
      sql: `INSERT INTO AssistantMessage (id, conversationId, role, content)
            VALUES (?, ?, 'user', ?)`,
      args: [userMsgId, conversationId, message],
    });

    const result = await callAssistant({
      context: builtContext,
      history,
      message,
    });

    const assistantMsgId = createId();
    await db.execute({
      sql: `INSERT INTO AssistantMessage (id, conversationId, role, content, suggestedActions)
            VALUES (?, ?, 'assistant', ?, ?)`,
      args: [
        assistantMsgId,
        conversationId,
        result.reply,
        JSON.stringify(result.suggestedActions),
      ],
    });
    await db.execute({
      sql: `UPDATE AssistantConversation SET updatedAt = ? WHERE id = ?`,
      args: [new Date().toISOString(), conversationId],
    });

    return reply.send({
      conversationId,
      reply: result.reply,
      suggestedActions: result.suggestedActions,
    });
  });

  // ── GET /assistant/conversations ────────────────────────────────
  fastify.get('/assistant/conversations', async (request, reply) => {
    const firmId = request.jwtUser.firmId;
    const userId = request.jwtUser.userId;
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT id, customerId, title, createdAt, updatedAt
            FROM AssistantConversation
            WHERE firmId = ? AND userId = ?
            ORDER BY updatedAt DESC LIMIT 50`,
      args: [firmId, userId],
    });
    const conversations = r.rows.map((raw) => {
      const c = raw as unknown as ConversationRow;
      return {
        id: String(c.id),
        customerId: c.customerId == null ? null : String(c.customerId),
        title: String(c.title ?? ''),
        createdAt: String(c.createdAt),
        updatedAt: String(c.updatedAt),
      };
    });
    return reply.send({ conversations });
  });

  // ── GET /assistant/conversations/:id ────────────────────────────
  fastify.get('/assistant/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const firmId = request.jwtUser.firmId;
    const userId = request.jwtUser.userId;
    const conv = await loadConversation(id, firmId, userId);
    if (!conv) {
      return reply.code(404).send({ error: { code: 'CONVERSATION_NOT_FOUND' } });
    }
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT id, role, content, suggestedActions, createdAt
            FROM AssistantMessage WHERE conversationId = ?
            ORDER BY createdAt ASC`,
      args: [id],
    });
    const messages = r.rows.map((raw) => {
      const m = raw as unknown as MessageRow;
      let actions: unknown[] = [];
      const rawActions = m.suggestedActions;
      if (typeof rawActions === 'string' && rawActions.length > 0) {
        try {
          const parsedActions = JSON.parse(rawActions);
          if (Array.isArray(parsedActions)) actions = parsedActions;
        } catch {
          /* tolerate corrupted action blobs */
        }
      }
      return {
        id: String(m.id),
        role: String(m.role),
        content: String(m.content ?? ''),
        suggestedActions: actions,
        createdAt: String(m.createdAt),
      };
    });
    return reply.send({
      conversation: {
        id: String(conv.id),
        customerId: conv.customerId == null ? null : String(conv.customerId),
        title: String(conv.title ?? ''),
        createdAt: String(conv.createdAt),
        updatedAt: String(conv.updatedAt),
      },
      messages,
    });
  });
}
