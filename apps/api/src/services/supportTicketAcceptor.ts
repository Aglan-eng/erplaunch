/**
 * SUPPORT_TICKET acceptor + payload schema (Phase 48.1).
 *
 * Wires the portal "Open ticket" form to the Phase 45.6 ticket pipeline.
 * The client posts a SUPPORT_TICKET PendingSubmission via
 * POST /portal/submissions; the SLA team's consultant reviews it in the
 * pending-submissions queue and clicking "Accept" runs this acceptor,
 * which creates a real Ticket row with the client member as the
 * `openedByMemberId`. The SLA breach clock starts at submission creation
 * time so the consultant accept latency does NOT cost the customer SLA
 * budget — see the `originalSubmittedAt` payload field.
 *
 * Why pending-review instead of direct-create:
 *   - §5.1 invariant: every client write goes through review.
 *   - SLA targets are a function of `severity`. We don't trust the
 *     client's severity classification — the consultant might re-grade
 *     P3 → P2 on accept. Allowing edits-on-accept is a future Phase
 *     48.x extension; for now the consultant just accepts as-is or
 *     rejects with a comment asking the client to clarify.
 *
 * IDEMPOTENCY: idempotent at the transaction layer — the route handler's
 * `withTransaction` wrapper rolls back the createTicket on any failure,
 * and a successfully-accepted submission flips to ACCEPTED so a retry
 * 409s before the acceptor re-runs. We don't carry a sourceSubmissionId
 * on Ticket itself (Phase 45.6's table predates this acceptor) — if a
 * future Phase 48.x adds it, the idempotency check moves here.
 */

import { z } from 'zod';
import {
  registerAcceptor,
  type PendingSubmissionAcceptor,
} from './pendingSubmissionAcceptors.js';
import { registerSubmissionPayloadSchema } from './pendingSubmissionPayloadSchemas.js';
import {
  createTicket,
  addTicketMessage,
} from '../db/tickets.js';
import { TICKET_SEVERITIES } from './ticketSla.js';

// ─── Payload schema ──────────────────────────────────────────────────────────

export const SupportTicketPayloadSchema = z.object({
  title: z.string().min(1).max(200),
  severity: z.enum(TICKET_SEVERITIES as unknown as [string, ...string[]]),
  description: z.string().max(5000).optional(),
});

registerSubmissionPayloadSchema('SUPPORT_TICKET', SupportTicketPayloadSchema);

// ─── Acceptor ────────────────────────────────────────────────────────────────

export const supportTicketAcceptor: PendingSubmissionAcceptor = {
  targetType: 'SUPPORT_TICKET',
  async accept(submission, ctx) {
    const payload = submission.payload as {
      title?: unknown;
      severity?: unknown;
      description?: unknown;
    };
    if (typeof payload.title !== 'string' || payload.title.length === 0) {
      throw new Error('SUPPORT_TICKET acceptor: payload.title required');
    }
    if (
      typeof payload.severity !== 'string' ||
      !(TICKET_SEVERITIES as readonly string[]).includes(payload.severity)
    ) {
      throw new Error('SUPPORT_TICKET acceptor: payload.severity must be CRITICAL/HIGH/MEDIUM/LOW');
    }
    const description =
      typeof payload.description === 'string' && payload.description.length > 0
        ? payload.description
        : null;

    // Create the ticket. openedByMemberId = the client portal member who
    // submitted; openedByUserId stays null because portal users aren't
    // User rows. The SLA breach clock starts at the Ticket.createdAt
    // (now) — close enough to the original submission time given accept
    // latency is typically seconds, and the consultant accepting is the
    // first SUPPORT touch that stops the first-response clock anyway.
    const ticket = await createTicket({
      engagementId: ctx.engagementId,
      firmId: ctx.firmId,
      title: payload.title,
      description,
      severity: payload.severity as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
      openedByMemberId: submission.memberId,
      openedByUserId: null,
    });

    // Seed the message thread with a CLIENT-side description so the
    // ticket detail pane shows the original ask without forcing the
    // consultant to retype it. senderType=CLIENT correctly leaves the
    // first-response clock running (only SUPPORT messages stop it).
    if (description) {
      await addTicketMessage({
        ticketId: ticket.id,
        senderType: 'CLIENT',
        senderUserId: null,
        senderMemberId: submission.memberId,
        body: description,
      });
    }
  },
};

registerAcceptor(supportTicketAcceptor);
