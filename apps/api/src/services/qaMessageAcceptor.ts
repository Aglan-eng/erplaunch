/**
 * QA_MESSAGE acceptor + payload schema (Phase 31).
 *
 * §5.1 asymmetry: client→consultant messages go through pending-review.
 * The acceptor inserts the Message row + (if threadId is null) creates
 * a new ConversationThread, then touches lastMessageAt.
 *
 * Consultant→client messages are handled separately by routes/threads.ts
 * which inserts directly without a PendingSubmission round-trip.
 *
 * IDEMPOTENCY: idempotent. Detected via Message.sourceSubmissionId. A
 * second accept finds the existing Message row + returns no-op.
 */

import { z } from 'zod';
import {
  registerAcceptor,
  type PendingSubmissionAcceptor,
} from './pendingSubmissionAcceptors.js';
import { registerSubmissionPayloadSchema } from './pendingSubmissionPayloadSchemas.js';
import {
  createConversationThread,
  findConversationThreadById,
  touchConversationThreadLastMessage,
} from '../db/conversationThread.js';
import {
  createMessage,
  findMessageBySourceSubmissionId,
} from '../db/message.js';

// ─── Payload schema ──────────────────────────────────────────────────────────

export const QaMessagePayloadSchema = z.object({
  threadId: z.string().min(1).max(64).nullable(),
  subject: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(5000),
});

registerSubmissionPayloadSchema('QA_MESSAGE', QaMessagePayloadSchema);

// ─── Acceptor ────────────────────────────────────────────────────────────────

export const qaMessageAcceptor: PendingSubmissionAcceptor = {
  targetType: 'QA_MESSAGE',
  async accept(submission, ctx) {
    const payload = submission.payload as {
      threadId?: unknown;
      subject?: unknown;
      body?: unknown;
    };
    const body = payload.body;
    const threadId = payload.threadId;
    const subject = payload.subject;

    if (typeof body !== 'string' || body.length === 0) {
      throw new Error('QA_MESSAGE acceptor: payload.body required');
    }

    // Idempotency guard — if a Message with sourceSubmissionId == this
    // submission already exists, prior accept already ran. No-op.
    const existing = await findMessageBySourceSubmissionId(submission.id);
    if (existing) return;

    // Resolve thread: existing or create-on-the-fly.
    let actualThreadId: string;
    if (threadId === null || threadId === undefined) {
      // Net-new thread. Subject must be present (route layer also
      // enforces; defense-in-depth).
      if (typeof subject !== 'string' || subject.length === 0) {
        throw new Error(
          'QA_MESSAGE acceptor: subject required when threadId is null',
        );
      }
      const created = await createConversationThread({
        engagementId: ctx.engagementId,
        subject,
        createdByMemberId: submission.memberId,
      });
      actualThreadId = created.id;
    } else {
      if (typeof threadId !== 'string' || threadId.length === 0) {
        throw new Error('QA_MESSAGE acceptor: threadId must be a non-empty string or null');
      }
      const thread = await findConversationThreadById(threadId);
      if (!thread || thread.engagementId !== ctx.engagementId) {
        throw new Error(
          `QA_MESSAGE acceptor: thread ${threadId} does not belong to engagement ${ctx.engagementId}`,
        );
      }
      actualThreadId = threadId;
    }

    const now = new Date().toISOString();
    await createMessage({
      threadId: actualThreadId,
      senderType: 'CLIENT',
      senderMemberId: submission.memberId,
      body,
      // Acknowledge at the moment of accept. Visible to client as
      // "consultant has read this".
      acknowledgedAt: now,
      sourceSubmissionId: submission.id,
    });
    await touchConversationThreadLastMessage(actualThreadId);
  },
};

registerAcceptor(qaMessageAcceptor);
