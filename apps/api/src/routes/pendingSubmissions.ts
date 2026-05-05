/**
 * Pending submissions routes (Phase 28 — §5.1 foundation).
 *
 * 4 endpoints:
 *
 *   CLIENT (portal session required):
 *     POST   /portal/submissions
 *
 *   CONSULTANT (auth + firm-ownership required):
 *     GET    /engagements/:id/pending-submissions[?status=PENDING|ALL|ACCEPTED|REJECTED]
 *     POST   /engagements/:id/pending-submissions/:submissionId/accept
 *     POST   /engagements/:id/pending-submissions/:submissionId/reject
 *
 * §5.1 invariants enforced here:
 *   - Client submissions ALWAYS land in PENDING (DB default + create()
 *     enforces).
 *   - Accept invokes the registered acceptor BEFORE flipping status. If
 *     the acceptor throws, the row stays PENDING and the consultant can
 *     retry. ActivityLog is written AFTER the status flip succeeds.
 *   - Reject NEVER invokes any acceptor — rejected submissions are not
 *     source of truth, ever.
 *   - Status transitions are terminal: a 409 ALREADY_REVIEWED guards
 *     against double-accept / accept-then-reject / etc.
 *
 * Phase 28 also enforces an ownership double-check on the consultant
 * endpoints: the engagement must belong to the firm AND the submission
 * must belong to the engagement. Both checks are independent — this is
 * defense-in-depth against an attacker guessing submission IDs.
 */

import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { authenticatePortalSession } from '../middleware/portalAuth.js';
import * as db from '../db/index.js';
import {
  createPendingSubmission,
  findPendingSubmissionById,
  findPendingSubmissionsByEngagement,
  acceptPendingSubmission,
  rejectPendingSubmission,
  type PendingSubmissionStatus,
  type PendingSubmissionTargetType,
} from '../db/pendingSubmission.js';
import { withTransaction } from '../db/transaction.js';
import {
  getAcceptor,
} from '../services/pendingSubmissionAcceptors.js';
import {
  getSubmissionPayloadSchema,
} from '../services/pendingSubmissionPayloadSchemas.js';

const ALLOWED_TARGET_TYPES: ReadonlySet<PendingSubmissionTargetType> = new Set([
  'WIZARD_ANSWER',
  'DATA_FILE',
  'QA_MESSAGE',
  'DECISION_SIGNOFF',
  'TEST',
]);

const STATUS_FILTER_VALUES: ReadonlyArray<'PENDING' | 'ACCEPTED' | 'REJECTED' | 'ALL'> = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'ALL',
];

interface SubmissionWithMember {
  id: string;
  engagementId: string;
  memberId: string;
  memberName: string | null;
  targetType: PendingSubmissionTargetType;
  targetId: string | null;
  payload: Record<string, unknown>;
  status: PendingSubmissionStatus;
  reviewerId: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  createdAt: string;
}

/**
 * Lookup a member's name for the consultant review UI. Pure read — no
 * state change. Returns null if the member row is missing (shouldn't
 * happen given the FK, but defensive).
 */
async function lookupMemberName(memberId: string): Promise<string | null> {
  const client = db.getDb();
  const r = await client.execute({
    sql: `SELECT name FROM ProjectMember WHERE id = ?`,
    args: [memberId],
  });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? ((row.name as string | null) ?? null) : null;
}

export async function pendingSubmissionsRoutes(fastify: FastifyInstance) {
  // ─── CLIENT ──────────────────────────────────────────────────────────────
  //
  // POST /portal/submissions — client submits a pending item from the
  // portal. The portal session middleware decorates request.portalMember
  // with { sessionId, memberId, engagementId }.
  //
  // No URL :token here — the engagementId comes from the validated portal
  // session, which is a stronger guarantee than a route-param token (the
  // session was minted against a real magic-link verification).
  fastify.post(
    '/portal/submissions',
    { preHandler: authenticatePortalSession },
    async (request, reply) => {
      const body = request.body as {
        targetType?: string;
        targetId?: string | null;
        payload?: unknown;
      };

      // Validate targetType is in the allowlist. Hard-fail on unknown types
      // so a typo never silently creates a never-readable row.
      if (
        typeof body.targetType !== 'string' ||
        !ALLOWED_TARGET_TYPES.has(body.targetType as PendingSubmissionTargetType)
      ) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'targetType must be one of WIZARD_ANSWER / DATA_FILE / QA_MESSAGE / DECISION_SIGNOFF / TEST',
          },
        });
      }
      const targetType = body.targetType as PendingSubmissionTargetType;

      // payload validation against the registered Zod schema. Defensive
      // 400 if no schema is registered (would happen if a Phase 29+ rollout
      // forgot to call registerSubmissionPayloadSchema for a new type).
      const schema = getSubmissionPayloadSchema(targetType);
      if (!schema) {
        return reply.code(400).send({
          error: {
            code: 'UNKNOWN_TARGET_TYPE',
            message: `No payload schema registered for targetType ${targetType}`,
          },
        });
      }
      const parsed = schema.safeParse(body.payload ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'payload failed schema validation',
            details: parsed.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
        });
      }

      const submission = await createPendingSubmission({
        engagementId: request.portalMember.engagementId,
        memberId: request.portalMember.memberId,
        targetType,
        targetId: body.targetId ?? null,
        payload: parsed.data as Record<string, unknown>,
      });

      // Phase 28 deliberately does NOT log activity on create — see design
      // §6 for rationale (the resolution event is the audit-worthy
      // transition, not the in-flight create).

      return reply.code(201).send({ data: submission });
    },
  );

  // ─── CONSULTANT ──────────────────────────────────────────────────────────

  // GET /engagements/:id/pending-submissions
  //
  // Default status filter: PENDING (the review backlog). Pass ?status=ALL
  // for the full audit list including accepted/rejected. Result is
  // enriched with submitter member name so the consultant UI doesn't need
  // a second round-trip.
  fastify.get(
    '/engagements/:id/pending-submissions',
    { onRequest: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!engagement) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      const { status: rawStatus } = request.query as { status?: string };
      const statusFilter: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'ALL' =
        rawStatus && (STATUS_FILTER_VALUES as readonly string[]).includes(rawStatus)
          ? (rawStatus as 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'ALL')
          : 'PENDING';

      const submissions = await findPendingSubmissionsByEngagement(id, { status: statusFilter });

      // Enrich with submitter names. Small batch — engagements rarely have
      // hundreds of in-flight submissions, so a per-row lookup is fine.
      // Phase 29+ may move this to a single JOIN if the volume becomes
      // material.
      const enriched: SubmissionWithMember[] = await Promise.all(
        submissions.map(async (s) => ({
          ...s,
          memberName: await lookupMemberName(s.memberId),
        })),
      );

      return reply.send({ data: enriched });
    },
  );

  // POST /engagements/:id/pending-submissions/:submissionId/accept
  //
  // Orchestrates: ownership checks → acceptor invocation → status flip →
  // activity log. The acceptor runs FIRST so a side-effect failure leaves
  // the submission PENDING (consultant can retry). Status flip is a
  // guarded UPDATE for race protection — if a second consultant clicks
  // accept simultaneously, one wins with 200 and the other gets 409.
  fastify.post(
    '/engagements/:id/pending-submissions/:submissionId/accept',
    { onRequest: authenticate },
    async (request, reply) => {
      const { id, submissionId } = request.params as {
        id: string;
        submissionId: string;
      };
      const body = (request.body ?? {}) as { comment?: string | null };

      // Defense-in-depth: engagement → firm + submission → engagement.
      const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

      const submission = await findPendingSubmissionById(submissionId);
      if (!submission || submission.engagementId !== id) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      if (submission.status !== 'PENDING') {
        return reply.code(409).send({
          error: {
            code: 'ALREADY_REVIEWED',
            message: `Submission is already ${submission.status.toLowerCase()}`,
          },
        });
      }

      // Acceptor invocation. Missing acceptor → 500 NO_ACCEPTOR_REGISTERED;
      // if Phase 29+ rolls out a new targetType but forgets to register
      // the acceptor, this is the loud failure path.
      const acceptor = getAcceptor(submission.targetType);
      if (!acceptor) {
        return reply.code(500).send({
          error: {
            code: 'NO_ACCEPTOR_REGISTERED',
            message: `No acceptor registered for targetType ${submission.targetType}`,
          },
        });
      }
      // Phase 29 — sprint rule §5: acceptor side-effect + status flip MUST
      // run in the same DB transaction. ActivityLog stays OUTSIDE so a
      // log-write hiccup never undoes a successful accept. The transaction
      // wrapper rolls back on throw, leaving status PENDING for retry.
      let updated;
      try {
        updated = await withTransaction(async () => {
          await acceptor.accept(submission, {
            engagementId: id,
            reviewerId: request.jwtUser.userId,
            firmId: request.jwtUser.firmId,
          });
          return await acceptPendingSubmission(
            submissionId,
            request.jwtUser.userId,
            body.comment ?? null,
          );
        });
      } catch (err) {
        request.log.error({ err, submissionId }, 'pending-submission acceptor threw');
        return reply.code(422).send({
          error: {
            code: 'ACCEPTOR_FAILED',
            message: err instanceof Error ? err.message : 'Acceptor side-effect failed',
          },
        });
      }
      if (!updated) {
        // Race: another reviewer beat us to it inside the transaction.
        // The flip already returned null; nothing to roll back since the
        // transaction succeeded and the caller-side effect (acceptor) was
        // re-running idempotently anyway. Surface 409.
        return reply.code(409).send({
          error: { code: 'ALREADY_REVIEWED', message: 'Submission was already reviewed' },
        });
      }

      // Audit. Activity log is OUTSIDE the (acceptor + flip) sequence —
      // failure here doesn't undo the accept; we just lose audit visibility
      // on the rare write-failure case. Documented tradeoff in design §3.
      const memberName = (await lookupMemberName(submission.memberId)) ?? 'Client';
      const commentSuffix = body.comment ? `: ${body.comment}` : '';
      await db.logActivity(
        id,
        request.jwtUser.firmId,
        'SUBMISSION_ACCEPTED',
        `Accepted ${submission.targetType} from ${memberName}${commentSuffix}`,
      );

      return reply.send({ data: updated });
    },
  );

  // POST /engagements/:id/pending-submissions/:submissionId/reject
  //
  // §5.1: rejected submissions never become source of truth. So this path
  // is purely state-machine + audit; no acceptor invocation.
  fastify.post(
    '/engagements/:id/pending-submissions/:submissionId/reject',
    { onRequest: authenticate },
    async (request, reply) => {
      const { id, submissionId } = request.params as {
        id: string;
        submissionId: string;
      };
      const body = (request.body ?? {}) as { comment?: string | null };

      const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

      const submission = await findPendingSubmissionById(submissionId);
      if (!submission || submission.engagementId !== id) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      if (submission.status !== 'PENDING') {
        return reply.code(409).send({
          error: {
            code: 'ALREADY_REVIEWED',
            message: `Submission is already ${submission.status.toLowerCase()}`,
          },
        });
      }

      const updated = await rejectPendingSubmission(
        submissionId,
        request.jwtUser.userId,
        body.comment ?? null,
      );
      if (!updated) {
        return reply.code(409).send({
          error: { code: 'ALREADY_REVIEWED', message: 'Submission was already reviewed' },
        });
      }

      const memberName = (await lookupMemberName(submission.memberId)) ?? 'Client';
      const commentSuffix = body.comment ? `: ${body.comment}` : '';
      await db.logActivity(
        id,
        request.jwtUser.firmId,
        'SUBMISSION_REJECTED',
        `Rejected ${submission.targetType} from ${memberName}${commentSuffix}`,
      );

      return reply.send({ data: updated });
    },
  );
}
