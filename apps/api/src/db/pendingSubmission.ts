/**
 * PendingSubmission — DB layer (Phase 28).
 *
 * §5.1 contract: "everything the client submits goes into a pending-review
 * state. The consultant must explicitly review and acknowledge (accept or
 * reject, with a comment) before it counts as the engagement's source of
 * truth."
 *
 * This module owns the create / list / accept / reject CRUD + status
 * transitions. The status state machine is strictly:
 *
 *   PENDING ──accept──→ ACCEPTED  (terminal)
 *      │
 *      └────reject──→ REJECTED   (terminal)
 *
 * accept() and reject() are idempotent at the DB layer: a second call on a
 * non-PENDING row returns null. Race-protection is a single guarded UPDATE
 * with `WHERE status = 'PENDING'`. The route handler converts null → 409
 * ALREADY_REVIEWED.
 *
 * Acceptor side-effects (writing the answer into profile.answers, marking a
 * data file as approved, etc.) are owned by services/pendingSubmissionAcceptors.ts.
 * This module never invokes acceptors itself — the route handler orchestrates
 * acceptor.accept() + db.acceptPendingSubmission() in a single flow.
 */

import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export type PendingSubmissionTargetType =
  | 'WIZARD_ANSWER'
  | 'DATA_FILE'
  | 'QA_MESSAGE'
  | 'DECISION_SIGNOFF'
  | 'SUPPORT_TICKET'
  | 'TEST';

export type PendingSubmissionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface PendingSubmission {
  id: string;
  engagementId: string;
  memberId: string;
  targetType: PendingSubmissionTargetType;
  targetId: string | null;
  payload: Record<string, unknown>;
  status: PendingSubmissionStatus;
  reviewerId: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;

function toSubmission(row: Row): PendingSubmission {
  // payload is stored as TEXT (JSON-stringified). Parse defensively — a
  // corrupt row should not crash the read path; surface as empty object so
  // the consultant can still see the row exists in the review tab.
  let payload: Record<string, unknown> = {};
  const rawPayload = row.payload;
  if (typeof rawPayload === 'string' && rawPayload.length > 0) {
    try {
      const parsed = JSON.parse(rawPayload);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      // Leave payload as {} — corrupt JSON shouldn't 500 the read path.
    }
  }

  return {
    id: row.id as string,
    engagementId: row.engagementId as string,
    memberId: row.memberId as string,
    targetType: row.targetType as PendingSubmissionTargetType,
    targetId: (row.targetId as string | null) ?? null,
    payload,
    status: row.status as PendingSubmissionStatus,
    reviewerId: (row.reviewerId as string | null) ?? null,
    reviewedAt: (row.reviewedAt as string | null) ?? null,
    reviewComment: (row.reviewComment as string | null) ?? null,
    createdAt: row.createdAt as string,
  };
}

export async function createPendingSubmission(input: {
  engagementId: string;
  memberId: string;
  targetType: PendingSubmissionTargetType;
  targetId?: string | null;
  payload: Record<string, unknown>;
}): Promise<PendingSubmission> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  const payloadJson = JSON.stringify(input.payload ?? {});

  await db.execute({
    sql: `INSERT INTO PendingSubmission
          (id, engagementId, memberId, targetType, targetId, payload, status, reviewerId, reviewedAt, reviewComment, createdAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.engagementId,
      input.memberId,
      input.targetType,
      input.targetId ?? null,
      payloadJson,
      'PENDING',
      null,
      null,
      null,
      now,
    ],
  });

  const r = await db.execute({
    sql: `SELECT * FROM PendingSubmission WHERE id = ?`,
    args: [id],
  });
  return toSubmission(r.rows[0] as Row);
}

export async function findPendingSubmissionById(id: string): Promise<PendingSubmission | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM PendingSubmission WHERE id = ?`,
    args: [id],
  });
  return r.rows[0] ? toSubmission(r.rows[0] as Row) : null;
}

export async function findPendingSubmissionsByEngagement(
  engagementId: string,
  opts?: { status?: PendingSubmissionStatus | 'ALL' },
): Promise<PendingSubmission[]> {
  const db = getDb();
  // Default filter is PENDING — that's the consultant review backlog.
  // 'ALL' is reserved for audit / debug surfaces.
  const status = opts?.status ?? 'PENDING';

  const result =
    status === 'ALL'
      ? await db.execute({
          sql: `SELECT * FROM PendingSubmission WHERE engagementId = ? ORDER BY createdAt DESC`,
          args: [engagementId],
        })
      : await db.execute({
          sql: `SELECT * FROM PendingSubmission WHERE engagementId = ? AND status = ? ORDER BY createdAt DESC`,
          args: [engagementId, status],
        });

  return (result.rows as Row[]).map(toSubmission);
}

/**
 * Flip status from PENDING → ACCEPTED. Returns the updated row, or null if
 * the row doesn't exist OR is already in a terminal state. The guarded
 * UPDATE protects against double-accepts under concurrent reviewer clicks.
 *
 * The acceptor side-effect must be invoked by the caller BEFORE this call
 * (so a failed acceptor leaves the row PENDING for retry). The route
 * handler is the orchestrator; this function is a pure state transition.
 */
export async function acceptPendingSubmission(
  id: string,
  reviewerId: string,
  comment: string | null,
): Promise<PendingSubmission | null> {
  const db = getDb();
  const now = new Date().toISOString();

  const update = await db.execute({
    sql: `UPDATE PendingSubmission
            SET status = 'ACCEPTED', reviewerId = ?, reviewedAt = ?, reviewComment = ?
          WHERE id = ? AND status = 'PENDING'`,
    args: [reviewerId, now, comment, id],
  });

  // libSQL returns rowsAffected as number | bigint depending on driver
  // version; normalise via Number() (mirrors apps/api/src/db/portalSession.ts).
  // A 0 means the row was already non-PENDING (or didn't exist). Either
  // way the caller treats it as 409.
  const affected = Number((update as { rowsAffected?: number | bigint }).rowsAffected ?? 0);
  if (affected === 0) return null;

  const r = await db.execute({
    sql: `SELECT * FROM PendingSubmission WHERE id = ?`,
    args: [id],
  });
  return r.rows[0] ? toSubmission(r.rows[0] as Row) : null;
}

/**
 * Flip status from PENDING → REJECTED. Same semantics as accept; never
 * invokes an acceptor. The §5.1 contract is "rejected = never source of
 * truth" so there's no side-effect on reject beyond audit logging (which
 * the route handler does after this call returns).
 */
export async function rejectPendingSubmission(
  id: string,
  reviewerId: string,
  comment: string | null,
): Promise<PendingSubmission | null> {
  const db = getDb();
  const now = new Date().toISOString();

  const update = await db.execute({
    sql: `UPDATE PendingSubmission
            SET status = 'REJECTED', reviewerId = ?, reviewedAt = ?, reviewComment = ?
          WHERE id = ? AND status = 'PENDING'`,
    args: [reviewerId, now, comment, id],
  });
  const affected = Number((update as { rowsAffected?: number | bigint }).rowsAffected ?? 0);
  if (affected === 0) return null;

  const r = await db.execute({
    sql: `SELECT * FROM PendingSubmission WHERE id = ?`,
    args: [id],
  });
  return r.rows[0] ? toSubmission(r.rows[0] as Row) : null;
}
