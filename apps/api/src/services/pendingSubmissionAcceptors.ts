/**
 * PendingSubmission acceptor registry (Phase 28).
 *
 * §5.1 strategy pattern: when a consultant accepts a pending submission,
 * the per-targetType "becomes source of truth" side-effect runs. Each
 * targetType registers its concrete acceptor here at module load time.
 *
 * Phase 28 ships ONLY the 'TEST' acceptor — a no-op observer used by
 * vitest to verify the route orchestrator invokes acceptors on accept and
 * skips them on reject. Phases 29-32 each register their concrete
 * acceptor:
 *
 *   Phase 29 — WIZARD_ANSWER  → write into BusinessProfile.answers
 *   Phase 30 — DATA_FILE      → mark DataFile as approved + visible
 *   Phase 31 — QA_MESSAGE     → append to QA thread + bump unread counter
 *   Phase 32 — DECISION_SIGNOFF → record sign-off + flip Decision.status
 *
 * IDEMPOTENCY CONTRACT: every concrete acceptor MUST be safe to invoke
 * twice on the same submission. Reason: a route handler that crashes
 * between acceptor.accept() and db.acceptPendingSubmission() leaves the
 * row PENDING but with the side-effect already applied. A consultant
 * retry must not double-apply (e.g. write the same answer twice, or send
 * two emails).
 *
 * The TEST acceptor's invocation log is intentionally NON-idempotent so
 * tests can verify the orchestrator doesn't accidentally double-call.
 *
 * This module deliberately avoids importing the route layer or db layer
 * beyond the PendingSubmission type — keeps acceptor registration cheap
 * and unit-testable in isolation.
 */

import type { PendingSubmission, PendingSubmissionTargetType } from '../db/pendingSubmission.js';

export interface AcceptorContext {
  /** The engagement the submission belongs to. */
  engagementId: string;
  /** The consultant User.id who clicked accept. */
  reviewerId: string;
  /** The firm the engagement belongs to — needed by some acceptors for
   *  multi-tenant ownership writes (e.g. ActivityLog rows). */
  firmId: string;
}

export interface PendingSubmissionAcceptor {
  targetType: PendingSubmissionTargetType;
  /**
   * Apply the per-targetType side-effect that makes the submission the
   * engagement's source of truth. Idempotent — see contract above. Throws
   * on validation/state errors; the route handler catches and converts to
   * a 4xx (typically 422 with a structured error message).
   */
  accept(submission: PendingSubmission, ctx: AcceptorContext): Promise<void>;
}

// Module-private registry. Map keys are PendingSubmissionTargetType;
// values are the concrete acceptor for that type. Re-registering the
// same type warns + overwrites (last-wins) so tests can dual-register
// against the TEST type without leaking state across suites.
const REGISTRY = new Map<PendingSubmissionTargetType, PendingSubmissionAcceptor>();

export function registerAcceptor(acceptor: PendingSubmissionAcceptor): void {
  if (REGISTRY.has(acceptor.targetType)) {
    // Re-registration is supported (last-wins) so tests + hot-reload work.
    // We log to stderr so the warning is visible during dev but doesn't
    // pollute stdout-driven test snapshots.
    // eslint-disable-next-line no-console
    console.warn(
      `[pendingSubmissionAcceptors] re-registering acceptor for ${acceptor.targetType} (last-wins)`,
    );
  }
  REGISTRY.set(acceptor.targetType, acceptor);
}

export function getAcceptor(
  targetType: PendingSubmissionTargetType,
): PendingSubmissionAcceptor | null {
  return REGISTRY.get(targetType) ?? null;
}

// ─── TEST acceptor — Phase 28 only ──────────────────────────────────────────
//
// Tracks every accept() invocation in a module-local list. Tests assert on
// this list to verify the orchestrator's invocation contract. Reset between
// tests via __resetTestAcceptorInvocations().
//
// NOTE: this list is intentionally NOT idempotent — pushing an entry every
// call lets tests catch double-invocation bugs in the route handler.

interface TestAcceptorInvocation {
  submission: PendingSubmission;
  ctx: AcceptorContext;
}

const testInvocations: TestAcceptorInvocation[] = [];

registerAcceptor({
  targetType: 'TEST',
  async accept(submission, ctx) {
    testInvocations.push({ submission, ctx });
  },
});

/** Test-only — reset the TEST acceptor's invocation log. */
export function __resetTestAcceptorInvocations(): void {
  testInvocations.length = 0;
}

/** Test-only — read the TEST acceptor's invocation log. */
export function __getTestAcceptorInvocations(): ReadonlyArray<TestAcceptorInvocation> {
  return testInvocations;
}
