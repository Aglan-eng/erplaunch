/**
 * Phase 46.5 / 46.6 — SOW_SIGNED event dispatcher.
 *
 * Both the DocuSign webhook and the manual-upload route call this
 * after a signature attempt reaches SIGNED status. The dispatcher:
 *
 *   1. Stamps signedFileUrl on the EngagementSowVersion row.
 *   2. Writes a SOW_SIGNED activity entry.
 *   3. Phase 46.6 — auto-converts the engagement (CONTRACTED →
 *      DISCOVERY) when this is the first time we've seen a signed
 *      SOW for it. Side effects:
 *        - engagement.status flipped to DISCOVERY
 *        - engagement.startDate stamped to the SOW signed date
 *        - engagement.contractEndDate set to startDate +
 *          estimatedDurationDays (derived from Discovery Lite's
 *          targetGoLive code, falling back to 90 days)
 *        - BusinessProfile.answers gets the Discovery Lite answers
 *          merged in, so the full Discovery wizard's pre-fill
 *          surface starts from the pre-sales context
 *        - A placeholder ENGAGEMENT_KICKOFF action item is created
 *          assigned to a designated PM (or App Admin fallback)
 *        - An "engagement auto-converted" activity entry lands
 *        - In-app notifications + email go to the firm's
 *          PROJECT_MANAGER assignees and APP_ADMIN users
 *
 * Idempotency: re-firing for an engagement that's already past
 * CONTRACTED is a no-op for the conversion side. The activity
 * entry still goes through so the audit trail captures the
 * second attempt.
 */

import * as db from '../db/index.js';
import { sendCloseoutHandoffEmail, APP_URL } from './email.js';

const DEFAULT_DURATION_DAYS = 90;
const DURATION_BY_TARGET: Record<string, number> = {
  asap: 90,
  '3-6m': 150,
  '6-12m': 270,
  '12m+': 365,
  tbd: 180,
};

export interface SowSignedEventInput {
  signatureId: string;
  signedFileUrl?: string | null;
}

export async function dispatchSowSigned(input: SowSignedEventInput): Promise<void> {
  const sig = await db.findSowSignatureById(input.signatureId);
  if (!sig) return;
  if (sig.status !== 'SIGNED') return;

  const eng = await db.findEngagementById(sig.engagementId);
  if (!eng) return;
  const engRecord = eng as Record<string, unknown>;
  const firmId = (engRecord.firmId as string | undefined) ?? '';

  // 1. Stamp the version row.
  if (input.signedFileUrl) {
    try {
      await db.setSowSignedFileUrl(sig.sowVersionId, input.signedFileUrl);
    } catch {
      /* non-fatal */
    }
  }

  // 2. Activity entry — always logged for audit.
  try {
    await db.logActivity(
      sig.engagementId,
      firmId,
      'SOW_SIGNED',
      `SOW signed by ${sig.signedByName ?? 'client'}${sig.signedByEmail ? ` (${sig.signedByEmail})` : ''} via ${sig.signaturePath.toLowerCase()}.`,
    );
  } catch {
    /* non-fatal */
  }

  // 3. Phase 46.6 — auto-conversion. Only fire when the engagement is
  //    still in the sales funnel (PROSPECT/PROPOSED/CONTRACTED). A
  //    re-fire from a duplicate webhook gracefully no-ops.
  const currentStatus = (engRecord.status as string | undefined) ?? '';
  const SALES_STAGES = ['PROSPECT', 'PROPOSED', 'CONTRACTED'];
  if (!SALES_STAGES.includes(currentStatus)) {
    return;
  }

  await convertProspectToActiveEngagement({
    engagementId: sig.engagementId,
    firmId,
    clientName: (engRecord.clientName as string | undefined) ?? 'Client',
    signedAt: sig.signedAt ?? new Date().toISOString(),
    signedByEmail: sig.signedByEmail,
  });
}

interface ConversionInput {
  engagementId: string;
  firmId: string;
  clientName: string;
  signedAt: string;
  signedByEmail: string | null;
}

/**
 * The actual auto-conversion. Exposed for tests so they can call it
 * directly without going through the SOW signature plumbing.
 */
export async function convertProspectToActiveEngagement(input: ConversionInput): Promise<{
  startDate: string;
  contractEndDate: string;
  carriedForwardKeys: string[];
  kickoffActionItemId: string | null;
  notifiedUserIds: string[];
}> {
  // ── Pull Discovery Lite for carry-forward + duration derivation. ──────
  const dl = await db.findDiscoveryLite(input.engagementId);
  const dlAnswers = (dl?.answers ?? {}) as Record<string, unknown>;

  const targetGoLive =
    typeof dlAnswers['timeline.targetGoLive'] === 'string'
      ? (dlAnswers['timeline.targetGoLive'] as string)
      : 'tbd';
  const durationDays = DURATION_BY_TARGET[targetGoLive] ?? DEFAULT_DURATION_DAYS;

  const startDate = input.signedAt.slice(0, 10);
  const startMs = new Date(startDate).getTime();
  const contractEndDate = new Date(startMs + durationDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // ── Stage transition + date stamps. ──────────────────────────────────
  await db.updateEngagement(input.engagementId, {
    status: 'DISCOVERY',
    startDate,
    contractEndDate,
  });

  // ── Carry-forward Discovery Lite answers into BusinessProfile.answers.
  let carriedForwardKeys: string[] = [];
  try {
    const profile = await db.getProfile(input.engagementId);
    const existingAnswers = (profile?.answers ?? {}) as Record<string, unknown>;
    // Don't clobber existing answers — merge with existing winning.
    const merged = { ...dlAnswers, ...existingAnswers };
    carriedForwardKeys = Object.keys(dlAnswers).filter((k) => !(k in existingAnswers));
    await db.upsertProfile(input.engagementId, merged);
  } catch (err) {
    // Non-fatal — the conversion still succeeded.
    void err;
  }

  // ── Placeholder kickoff action item. ─────────────────────────────────
  let kickoffActionItemId: string | null = null;
  try {
    // Find a PM assigned to this engagement; fall back to the
    // earliest APP_ADMIN in the firm.
    const pmAssignments = await db.listEngagementUsersByRole(input.engagementId, 'PROJECT_MANAGER');
    const supportLeads = await db.listFirmUsersByRole(input.firmId, 'SUPPORT_LEAD');
    const owner = pmAssignments[0]?.userId ?? supportLeads[0]?.userId ?? null;

    const dueDate = new Date(startMs + 7 * 86_400_000).toISOString().slice(0, 10);
    const item = await db.createActionItem(input.engagementId, {
      title: `Kickoff: ${input.clientName}`,
      description:
        'Auto-created on SOW signed. Schedule the kickoff call, confirm Discovery scope, and assign module leads.',
      owner: owner ?? undefined,
      priority: 'HIGH',
      dueDate,
    });
    kickoffActionItemId = (item as { id?: string } | null)?.id ?? null;
  } catch (err) {
    void err;
  }

  // ── Notifications. ───────────────────────────────────────────────────
  const notifiedUserIds: string[] = [];
  let recipients: Array<{ userId: string; email: string; name: string }> = [];
  try {
    const pms = await db.listEngagementUsersByRole(input.engagementId, 'PROJECT_MANAGER');
    const admins = await db.listFirmUsersByRole(input.firmId, 'APP_ADMIN');
    const seen = new Set<string>();
    recipients = [...pms, ...admins].filter((r) => {
      if (seen.has(r.userId)) return false;
      seen.add(r.userId);
      return true;
    });
  } catch {
    recipients = [];
  }

  // Re-uses the closeout handoff email shape (subject + body fit the
  // "auto-converted, please pick up the engagement" intent). Future
  // phase will swap in a kickoff-specific template.
  const threadUrl = `${APP_URL}/engagements/${input.engagementId}`;
  for (const r of recipients) {
    if (!r.email) continue;
    notifiedUserIds.push(r.userId);
    try {
      await sendCloseoutHandoffEmail(r.email, {
        recipientName: r.name || 'there',
        clientName: input.clientName,
        threadUrl,
      });
    } catch {
      /* non-fatal */
    }
  }
  void input.signedByEmail;

  // ── Activity entries. ────────────────────────────────────────────────
  try {
    await db.logActivity(
      input.engagementId,
      input.firmId,
      'ENGAGEMENT_AUTO_CONVERTED',
      `Auto-converted to DISCOVERY on SOW signed. Contract end ${contractEndDate}. ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'} notified.`,
    );
  } catch { /* non-fatal */ }
  if (carriedForwardKeys.length > 0) {
    try {
      await db.logActivity(
        input.engagementId,
        input.firmId,
        'DISCOVERY_LITE_CARRIED_FORWARD',
        `${carriedForwardKeys.length} pre-sales answers merged into Discovery answers.`,
      );
    } catch { /* non-fatal */ }
  }
  if (kickoffActionItemId) {
    try {
      await db.logActivity(
        input.engagementId,
        input.firmId,
        'ENGAGEMENT_KICKED_OFF',
        `Kickoff action item created.`,
      );
    } catch { /* non-fatal */ }
  }

  return {
    startDate,
    contractEndDate,
    carriedForwardKeys,
    kickoffActionItemId,
    notifiedUserIds,
  };
}
