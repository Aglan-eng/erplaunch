/**
 * Conversation threads routes (Phase 31, §5.1 asymmetry).
 *
 * CONSULTANT-side endpoints — these BYPASS pending-review per §5.1
 * (consultant is already source of truth; messages they send to the
 * client land directly with acknowledgedAt = createdAt).
 *
 *   GET    /api/v1/engagements/:id/threads
 *   POST   /api/v1/engagements/:id/threads
 *   GET    /api/v1/engagements/:id/threads/:threadId
 *   POST   /api/v1/engagements/:id/threads/:threadId/messages
 *   PATCH  /api/v1/engagements/:id/threads/:threadId
 *
 * Client-side equivalents live in routes/portal.ts (read-only thread/
 * message endpoints; outbound messages go through POST /portal/submissions
 * with targetType='QA_MESSAGE').
 */

import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';
import {
  createConversationThread,
  findConversationThreadById,
  listConversationThreadsByEngagement,
  touchConversationThreadLastMessage,
  updateConversationThreadStatus,
  type ThreadStatus,
} from '../db/conversationThread.js';
import {
  createMessage,
  listMessagesByThread,
} from '../db/message.js';

export async function threadsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements/:id/threads — list all threads for the engagement.
  // Phase 44.3: READ-gated on COMMENTS (threads are conversational comments).
  fastify.get('/engagements/:id/threads', { preHandler: requirePermission('READ', 'COMMENTS') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const threads = await listConversationThreadsByEngagement(id);
    return reply.send({ data: threads });
  });

  // POST /engagements/:id/threads — consultant creates a thread + first
  // message in one shot. The first message is treated as a
  // consultant→client send (bypasses pending-review — §5.1 asymmetry).
  fastify.post('/engagements/:id/threads', { preHandler: requirePermission('WRITE', 'COMMENTS') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as { subject?: unknown; body?: unknown };
    if (typeof body.subject !== 'string' || body.subject.trim().length === 0) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'subject required' },
      });
    }
    if (typeof body.body !== 'string' || body.body.trim().length === 0) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'body required' },
      });
    }

    const thread = await createConversationThread({
      engagementId: id,
      subject: body.subject.trim(),
      createdByUserId: request.jwtUser.userId,
    });
    await createMessage({
      threadId: thread.id,
      senderType: 'CONSULTANT',
      senderUserId: request.jwtUser.userId,
      body: body.body.trim(),
      // CONSULTANT messages auto-acknowledge at insert (createMessage
      // handles when acknowledgedAt is undefined and senderType=CONSULTANT).
    });
    await touchConversationThreadLastMessage(thread.id);

    await db.logActivity(
      id,
      request.jwtUser.firmId,
      'THREAD_CREATED',
      `Created thread "${body.subject.trim()}"`,
    );

    return reply.code(201).send({ data: thread });
  });

  // GET /engagements/:id/threads/:threadId — full thread + messages.
  fastify.get('/engagements/:id/threads/:threadId', { preHandler: requirePermission('READ', 'COMMENTS') }, async (request, reply) => {
    const { id, threadId } = request.params as { id: string; threadId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const thread = await findConversationThreadById(threadId);
    if (!thread || thread.engagementId !== id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }
    const messages = await listMessagesByThread(threadId);
    return reply.send({ data: { thread, messages } });
  });

  // POST /engagements/:id/threads/:threadId/messages — consultant sends
  // a message into an existing thread. BYPASSES pending-review per
  // §5.1 asymmetry (consultant is source of truth).
  fastify.post(
    '/engagements/:id/threads/:threadId/messages',
    { preHandler: requirePermission('WRITE', 'COMMENTS') },
    async (request, reply) => {
      const { id, threadId } = request.params as { id: string; threadId: string };
      const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

      const thread = await findConversationThreadById(threadId);
      if (!thread || thread.engagementId !== id) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      const body = request.body as { body?: unknown };
      if (typeof body.body !== 'string' || body.body.trim().length === 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'body required' },
        });
      }

      const message = await createMessage({
        threadId,
        senderType: 'CONSULTANT',
        senderUserId: request.jwtUser.userId,
        body: body.body.trim(),
      });
      await touchConversationThreadLastMessage(threadId);

      return reply.code(201).send({ data: message });
    },
  );

  // PATCH /engagements/:id/threads/:threadId — update status.
  fastify.patch('/engagements/:id/threads/:threadId', { preHandler: requirePermission('WRITE', 'COMMENTS') }, async (request, reply) => {
    const { id, threadId } = request.params as { id: string; threadId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const thread = await findConversationThreadById(threadId);
    if (!thread || thread.engagementId !== id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }

    const body = request.body as { status?: unknown };
    if (body.status !== 'OPEN' && body.status !== 'RESOLVED') {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'status must be OPEN or RESOLVED' },
      });
    }
    const updated = await updateConversationThreadStatus(threadId, body.status as ThreadStatus);
    return reply.send({ data: updated });
  });
}
