/**
 * Phase 45.8 — Renewal + expansion tracker pure helpers.
 *
 * Computes the urgency tier for the SLA portfolio's renewal column
 * based on days-to-contract-end. Pure — no DB calls — so the rules
 * can be tested exhaustively.
 *
 *   GREEN   — > 90 days remaining, or no contract end on file
 *   AMBER   — 31..90 days remaining
 *   RED     — <= 30 days remaining (including past expiry)
 *   EXPIRED — past contractEndAt (subset of RED, used for the badge)
 */

export type RenewalUrgency = 'GREEN' | 'AMBER' | 'RED';

export type RenewalStatus =
  | 'NOT_STARTED'
  | 'DISCUSSING'
  | 'PROPOSAL_OUT'
  | 'SIGNED'
  | 'LOST'
  | 'NA';

export const RENEWAL_STATUSES: ReadonlyArray<RenewalStatus> = [
  'NOT_STARTED',
  'DISCUSSING',
  'PROPOSAL_OUT',
  'SIGNED',
  'LOST',
  'NA',
];

export function isRenewalStatus(s: string): s is RenewalStatus {
  return (RENEWAL_STATUSES as readonly string[]).includes(s);
}

export interface ExpansionOpportunity {
  title: string;
  /** Free-form size estimate — "+$25k ARR", "+2 modules", etc. */
  size?: string;
  notes?: string;
}

export interface RenewalSnapshot {
  contractEndAt: string | null;
  renewalStatus: RenewalStatus;
  /** Reference time. Tests pin this. */
  now?: Date;
}

export interface RenewalWindow {
  urgency: RenewalUrgency;
  /** Whole days until contractEndAt. Negative when expired. Null when
   *  no contract end is on file. */
  daysToExpiry: number | null;
  /** True when contractEndAt has passed. */
  expired: boolean;
}

const DAY_MS = 86_400_000;
const AMBER_THRESHOLD_DAYS = 90;
const RED_THRESHOLD_DAYS = 30;

export function computeRenewalWindow(snap: RenewalSnapshot): RenewalWindow {
  const now = snap.now ?? new Date();

  // SIGNED renewals are always GREEN regardless of date — the deal's
  // already done. LOST renewals are always RED + expired-equivalent
  // (the engagement is winding down).
  if (snap.renewalStatus === 'SIGNED') {
    return { urgency: 'GREEN', daysToExpiry: daysBetween(now, snap.contractEndAt), expired: false };
  }
  if (snap.renewalStatus === 'LOST') {
    return { urgency: 'RED', daysToExpiry: daysBetween(now, snap.contractEndAt), expired: true };
  }
  if (snap.renewalStatus === 'NA') {
    return { urgency: 'GREEN', daysToExpiry: null, expired: false };
  }

  if (!snap.contractEndAt) {
    return { urgency: 'GREEN', daysToExpiry: null, expired: false };
  }

  const days = daysBetween(now, snap.contractEndAt);
  if (days === null) {
    return { urgency: 'GREEN', daysToExpiry: null, expired: false };
  }
  if (days < 0) {
    return { urgency: 'RED', daysToExpiry: days, expired: true };
  }
  if (days <= RED_THRESHOLD_DAYS) {
    return { urgency: 'RED', daysToExpiry: days, expired: false };
  }
  if (days <= AMBER_THRESHOLD_DAYS) {
    return { urgency: 'AMBER', daysToExpiry: days, expired: false };
  }
  return { urgency: 'GREEN', daysToExpiry: days, expired: false };
}

function daysBetween(now: Date, isoIn: string | null): number | null {
  if (!isoIn) return null;
  const d = new Date(isoIn);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Parse the JSON expansionOpportunities column safely. Returns an
 * empty array on null, malformed JSON, or non-array payloads — never
 * throws.
 */
export function parseExpansionOpportunities(
  raw: string | null | undefined,
): ExpansionOpportunity[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
      .map((o) => ({
        title: String(o.title ?? ''),
        size: typeof o.size === 'string' ? o.size : undefined,
        notes: typeof o.notes === 'string' ? o.notes : undefined,
      }))
      .filter((o) => o.title.length > 0);
  } catch {
    return [];
  }
}
