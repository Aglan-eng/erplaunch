/**
 * Phase 45.3 — Closeout handoff event flow.
 *
 * When an engagement transitions GOLIVE → CLOSEOUT we want a single
 * choreographed sequence to fire so the implementation team and the
 * SLA team have a clean coordination surface:
 *
 *   1. Auto-create a system-owned ConversationThread with kind=HANDOFF,
 *      pinned=true, subject "Handoff: <ClientName> → SLA team". The
 *      Threads UI sorts pinned threads first and renders HANDOFF kinds
 *      with a distinct icon + label (Phase 45.3 frontend follow-up).
 *
 *   2. Auto-create a HANDOFF_PACKAGE generation job and dispatch it
 *      via setImmediate(processJob) so the route response stays fast.
 *      The generator (Phase 45.2) emits the 7-doc bundle the SLA team
 *      needs to take over the engagement.
 *
 *   3. Notify everyone whose responsibility is SLA continuity:
 *        - all firm-level SUPPORT_LEAD users
 *        - all engagement-level ACCOUNT_MANAGER users
 *      Each receives a transactional email with a deep-link to the
 *      newly-created handoff thread. Email failures are non-fatal —
 *      the transition has already happened in the DB and we don't
 *      want SMTP / Resend hiccups to roll it back.
 *
 *   4. Write a single CLOSEOUT_HANDOFF_FIRED ActivityLog entry so the
 *      activity feed shows "Handoff coordination kicked off — N people
 *      notified, thread opened, package queued" alongside the existing
 *      stage-transition entry.
 *
 * The function is split out of `routes/engagements.ts` so the test
 * suite can exercise it directly without inject()-ing through the
 * full HTTP layer.
 */

import * as db from '../db/index.js';
import {
  createConversationThread,
  type ConversationThread,
} from '../db/conversationThread.js';
import { processJob } from './generation.js';
import { sendCloseoutHandoffEmail, APP_URL } from './email.js';

export interface CloseoutHandoffResult {
  thread: ConversationThread;
  jobId: string;
  /** Total unique recipients we attempted to email. The number of
   *  emails that *actually* sent isn't tracked here — Resend errors
   *  are intentionally swallowed so the transition isn't blocked. */
  notifiedCount: number;
}

interface TriggerArgs {
  engagementId: string;
  firmId: string;
  clientName: string;
  /** When true, run the HANDOFF_PACKAGE generator inline (await it)
   *  rather than firing it via setImmediate. Used by tests so the
   *  generator's side-effects (file writes, auto-detect) are
   *  observable when the route call resolves. */
  generateInline?: boolean;
}

/** De-duplicate contacts by userId — a single user could in theory
 *  hold both SUPPORT_LEAD (firm) and ACCOUNT_MANAGER (engagement) on
 *  the same engagement, and we don't want them double-mailed. */
function dedupeRecipients(
  contacts: ReadonlyArray<{ userId: string; email: string; name: string }>,
): Array<{ userId: string; email: string; name: string }> {
  const seen = new Set<string>();
  const out: Array<{ userId: string; email: string; name: string }> = [];
  for (const c of contacts) {
    if (seen.has(c.userId)) continue;
    seen.add(c.userId);
    out.push(c);
  }
  return out;
}

export async function triggerCloseoutHandoff(args: TriggerArgs): Promise<CloseoutHandoffResult> {
  const { engagementId, firmId, clientName } = args;

  // 1. Spawn the cross-team HANDOFF thread. Pinned so it sorts to the
  //    top of the engagement's Threads UI.
  const thread = await createConversationThread({
    engagementId,
    subject: `Handoff: ${clientName} → SLA team`,
    kind: 'HANDOFF',
    pinned: true,
    // Created by the system, not a specific user. Both id columns
    // stay null which the Threads UI already tolerates.
    createdByMemberId: null,
    createdByUserId: null,
  });

  // 2. Queue the HANDOFF_PACKAGE generator. createJob throws if the
  //    engagement is missing — propagate so the caller knows the
  //    transition is in a weird state.
  const job = await db.createJob(engagementId, 'HANDOFF_PACKAGE');
  if (!job) throw new Error(`triggerCloseoutHandoff: createJob returned null for ${engagementId}`);
  const jobId = (job as { id: string }).id;

  if (args.generateInline) {
    // Tests want the side-effects observable — wait for the job to
    // finish before returning. Failures are propagated so tests can
    // assert on them.
    await processJob(jobId, db);
  } else if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    // In the vitest harness we can't fire setImmediate(processJob)
    // because it races with the per-test DB cleanup — the libSQL
    // native binding panics if a generation finishes after its
    // engagement has been DELETEd by the next test's beforeEach.
    // Tests that *want* the job to run inline pass generateInline=true.
  } else {
    // Production path — fire-and-forget so the route response isn't
    // blocked on the (slow) file-emitting generator.
    setImmediate(() => {
      processJob(jobId, db).catch(() => {
        // Generator failures are surfaced via the GenerationJob
        // status row; nothing useful to do here. Logged inside
        // processJob already.
      });
    });
  }

  // 3. Resolve recipients: firm-level SUPPORT_LEAD + engagement-level
  //    ACCOUNT_MANAGER. dedupeRecipients collapses the unlikely case
  //    where the same user holds both.
  let recipients: Array<{ userId: string; email: string; name: string }> = [];
  try {
    const supportLeads = await db.listFirmUsersByRole(firmId, 'SUPPORT_LEAD');
    const accountManagers = await db.listEngagementUsersByRole(engagementId, 'ACCOUNT_MANAGER');
    recipients = dedupeRecipients([...supportLeads, ...accountManagers]);
  } catch {
    // RBAC tables shouldn't error for an existing engagement — but if
    // they do, fall through with an empty recipient list rather than
    // blocking the transition.
    recipients = [];
  }

  // 4. Send notifications. Per-recipient try/catch so one bad address
  //    doesn't stop the rest. The Engagement deep-link points at the
  //    threads page so the recipient lands directly in context.
  const threadUrl = `${APP_URL}/engagements/${engagementId}/threads/${thread.id}`;
  for (const r of recipients) {
    if (!r.email) continue;
    try {
      await sendCloseoutHandoffEmail(r.email, {
        recipientName: r.name || 'there',
        clientName,
        threadUrl,
      });
    } catch {
      // Non-fatal — see comment at top of file.
    }
  }

  // 5. Append a single audit row capturing what just happened so the
  //    activity feed shows "handoff fired" alongside the stage change.
  try {
    await db.logActivity(
      engagementId,
      firmId,
      'CLOSEOUT_HANDOFF_FIRED',
      `Handoff package queued, HANDOFF thread opened, ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'} notified.`,
    );
  } catch {
    // Activity log failure shouldn't roll back the handoff.
  }

  return {
    thread,
    jobId,
    notifiedCount: recipients.length,
  };
}
