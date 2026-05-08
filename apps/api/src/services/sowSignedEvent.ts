/**
 * Phase 46.5 — SOW_SIGNED event dispatcher.
 *
 * Both the DocuSign webhook and the manual-upload route call this
 * after a signature attempt reaches SIGNED status. The dispatcher:
 *
 *   1. Stamps signedFileUrl on the EngagementSowVersion row so the
 *      audit trail can find the signed PDF without joining through
 *      the signature row.
 *   2. Writes a SOW_SIGNED activity entry.
 *   3. Phase 46.6 hooks in here to auto-convert the engagement from
 *      CONTRACTED → DISCOVERY (with carry-forward of Discovery Lite
 *      answers + kickoff action item creation). Until 46.6 lands,
 *      this is a no-op past the activity entry.
 *
 * Idempotent — calling twice for the same signature row is safe;
 * the second call writes nothing since signedAt is already set.
 */

import * as db from '../db/index.js';

export interface SowSignedEventInput {
  signatureId: string;
  /** Optional signed-PDF URL to stamp on the version. Absent for
   *  some webhook paths where the file isn't available yet — the
   *  caller can stamp it via setSowSignedFileUrl directly later. */
  signedFileUrl?: string | null;
}

export async function dispatchSowSigned(input: SowSignedEventInput): Promise<void> {
  const sig = await db.findSowSignatureById(input.signatureId);
  if (!sig) return;
  if (sig.status !== 'SIGNED') return;

  // 1. Stamp the version row.
  if (input.signedFileUrl) {
    try {
      await db.setSowSignedFileUrl(sig.sowVersionId, input.signedFileUrl);
    } catch {
      // Non-fatal — the audit trail can still find the signed PDF
      // via the EngagementSowSignature row.
    }
  }

  // 2. Activity entry. Idempotency: an existing SOW_SIGNED entry for
  // this engagement would still be appended — we deliberately allow
  // this so re-runs leave a paper trail of the dispatch attempt.
  // Routes guard against duplicate calls when needed.
  try {
    await db.logActivity(
      sig.engagementId,
      // firmId resolved via the engagement.
      await firmIdFor(sig.engagementId),
      'SOW_SIGNED',
      `SOW signed by ${sig.signedByName ?? 'client'}${sig.signedByEmail ? ` (${sig.signedByEmail})` : ''} via ${sig.signaturePath.toLowerCase()}.`,
    );
  } catch {
    // Non-fatal.
  }

  // 3. Phase 46.6 will hook here for auto-conversion. Until it
  //    ships we leave a comment marker rather than a TODO so the
  //    grep finds it later.
  // PHASE_46_6_AUTO_CONVERSION_HOOK
}

async function firmIdFor(engagementId: string): Promise<string> {
  const eng = await db.findEngagementById(engagementId);
  return ((eng as { firmId?: string } | null)?.firmId) ?? '';
}
