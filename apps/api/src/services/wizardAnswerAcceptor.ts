/**
 * WIZARD_ANSWER acceptor + payload schema (Phase 29).
 *
 * §5.1 contract for client-submitted wizard answers: client submits
 * an answer for a question via the portal; submission lands in
 * PendingSubmission.PENDING; consultant accepts; accept-side-effect
 * merges the answer into BusinessProfile.answers — same column the
 * consultant's PATCH /engagements/:id/profile writes to. From that
 * point the answer is engagement source of truth and feeds rule
 * evaluation, generators, etc.
 *
 * The acceptor mirrors the legacy PATCH /profile semantics:
 *   const merged = { ...currentAnswers, ...newAnswers };
 *   db.upsertProfile(engagementId, merged);
 *
 * Single-key merge here (just one questionId at a time vs the legacy
 * route's record-of-keys), but the merge shape is identical.
 *
 * IDEMPOTENCY: idempotent. Re-applying the same accept twice produces
 * the same final state — `{ ...prev, [questionId]: answer }` with
 * the same key/value is a no-op on the second application.
 *
 * Phase 29 ships the acceptor; Phase 30+ acceptors that need to write
 * to multiple tables can either (a) keep all writes inside the parent
 * withTransaction block (preferred), or (b) factor the write into
 * their own transactional helpers. The acceptor MUST NOT call
 * withTransaction itself — sprint rule §5 documents single-level only.
 */

import { z } from 'zod';
import {
  registerAcceptor,
  type PendingSubmissionAcceptor,
} from './pendingSubmissionAcceptors.js';
import { registerSubmissionPayloadSchema } from './pendingSubmissionPayloadSchemas.js';
import * as db from '../db/index.js';

// ─── Payload schema ──────────────────────────────────────────────────────────

/**
 * Zod schema for WIZARD_ANSWER payloads. The `answer` field is `unknown`
 * because question inputType varies (BOOLEAN / SINGLE_SELECT / MULTI_SELECT /
 * TEXT / TEXTAREA / NUMBER / TABLE / DATE) and validating per-shape would
 * require a runtime question-bank lookup inside the schema. The legacy
 * PATCH /engagements/:id/profile uses the same approach
 * (`z.record(z.unknown())`) — answer-shape validation is per-question
 * business logic, not schema concern.
 */
export const WizardAnswerPayloadSchema = z.object({
  questionId: z.string().min(1).max(200),
  answer: z.unknown(),
});

registerSubmissionPayloadSchema('WIZARD_ANSWER', WizardAnswerPayloadSchema);

// ─── Acceptor ────────────────────────────────────────────────────────────────

export const wizardAnswerAcceptor: PendingSubmissionAcceptor = {
  targetType: 'WIZARD_ANSWER',
  async accept(submission, ctx) {
    const payload = submission.payload as { questionId?: unknown; answer?: unknown };

    if (typeof payload.questionId !== 'string' || payload.questionId.length === 0) {
      // Defensive — the route handler validates payload via the registered
      // Zod schema before insert, so this should be unreachable. But the
      // acceptor contract is "may be invoked twice on retry" so we re-check
      // here too (a corrupt JSON in DB after manual editing could break
      // the assumption).
      throw new Error(
        `WIZARD_ANSWER acceptor: payload.questionId must be a non-empty string`,
      );
    }

    // Read-modify-write merge. Mirrors the legacy PATCH /profile shape
    // exactly so a portal-side accept and a consultant-side PATCH
    // produce indistinguishable results in BusinessProfile.answers.
    //
    // upsertProfile creates the BusinessProfile row if it doesn't exist,
    // so a fresh engagement that's only ever had portal-side answers
    // still works.
    const existing = await db.getProfile(ctx.engagementId);
    const currentAnswers =
      ((existing?.answers ?? {}) as Record<string, unknown>) ?? {};
    const merged = { ...currentAnswers, [payload.questionId]: payload.answer };
    await db.upsertProfile(ctx.engagementId, merged);
  },
};

registerAcceptor(wizardAnswerAcceptor);
