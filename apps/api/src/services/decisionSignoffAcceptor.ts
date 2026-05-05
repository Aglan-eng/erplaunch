/**
 * DECISION_SIGNOFF acceptor + payload schema (Phase 32, final §5 phase).
 *
 * Client signs off (signed=true) or declines (signed=false) on an
 * existing DecisionItem. Both are legitimate per spec — declining is
 * the client saying "I do not agree with this decision" and IS source
 * of truth. The acceptor flips DecisionItem.clientSignoffStatus to
 * SIGNED or DECLINED + records timestamp, comment, and the submitting
 * member.
 *
 * Consultant reject of the submission (rare — e.g. signature on the
 * wrong decision) sets clientSignoffStatus to REJECTED via the reject
 * route handler in pendingSubmissions.ts.
 *
 * IDEMPOTENCY: idempotent. The DecisionItem.clientSignoffSourceSubmissionId
 * column tracks which submission promoted to terminal state. Re-applying
 * the same submission (status already terminal AND source matches) is
 * a no-op.
 */

import { z } from 'zod';
import {
  registerAcceptor,
  type PendingSubmissionAcceptor,
} from './pendingSubmissionAcceptors.js';
import { registerSubmissionPayloadSchema } from './pendingSubmissionPayloadSchemas.js';
import * as db from '../db/index.js';

// ─── Payload schema ──────────────────────────────────────────────────────────

export const DecisionSignoffPayloadSchema = z.object({
  decisionItemId: z.string().min(1).max(64),
  signed: z.boolean(),
  comment: z.string().max(2000).default(''),
});

registerSubmissionPayloadSchema('DECISION_SIGNOFF', DecisionSignoffPayloadSchema);

// ─── Acceptor ────────────────────────────────────────────────────────────────

export const decisionSignoffAcceptor: PendingSubmissionAcceptor = {
  targetType: 'DECISION_SIGNOFF',
  async accept(submission, ctx) {
    const payload = submission.payload as {
      decisionItemId?: unknown;
      signed?: unknown;
      comment?: unknown;
    };
    if (typeof payload.decisionItemId !== 'string' || payload.decisionItemId.length === 0) {
      throw new Error('DECISION_SIGNOFF acceptor: payload.decisionItemId required');
    }
    if (typeof payload.signed !== 'boolean') {
      throw new Error('DECISION_SIGNOFF acceptor: payload.signed must be a boolean');
    }
    const comment = typeof payload.comment === 'string' ? payload.comment : '';

    const decision = await db.findDecisionById(payload.decisionItemId);
    if (!decision) {
      throw new Error(
        `DECISION_SIGNOFF acceptor: decision ${payload.decisionItemId} not found`,
      );
    }
    const decisionRow = decision as Record<string, unknown>;
    if (decisionRow.engagementId !== ctx.engagementId) {
      throw new Error(
        `DECISION_SIGNOFF acceptor: decision ${payload.decisionItemId} does not belong to engagement ${ctx.engagementId}`,
      );
    }

    // Idempotent re-accept: if already terminal AND it was THIS
    // submission that landed it, no-op.
    const currentStatus = (decisionRow.clientSignoffStatus as string | null) ?? 'NONE';
    const currentSource = decisionRow.clientSignoffSourceSubmissionId as string | null;
    if (
      ['SIGNED', 'DECLINED', 'REJECTED'].includes(currentStatus) &&
      currentSource === submission.id
    ) {
      return;
    }

    const newStatus = payload.signed ? 'SIGNED' : 'DECLINED';
    await db.updateDecisionSignoff(payload.decisionItemId, {
      clientSignoffStatus: newStatus,
      clientSignoffAt: new Date().toISOString(),
      clientSignoffComment: comment,
      clientSignoffMemberId: submission.memberId,
      clientSignoffSourceSubmissionId: submission.id,
    });
  },
};

registerAcceptor(decisionSignoffAcceptor);
