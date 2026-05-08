/**
 * Phase 45.5 — SLA portfolio summary helpers.
 *
 * Pure functions that compute the per-engagement health row shown on
 * the SLA portfolio dashboard. Splitting them out of the route lets us
 * test the rules without booting Fastify or seeding fixtures for every
 * threshold combination.
 *
 * Health model (intentionally simple — Phase 45.6 will replace the
 * issue-count proxy with the real ticket queue):
 *
 *   GREEN  — no open CRITICAL issues, last activity within 14 days
 *   AMBER  — open HIGH issues, OR last activity 14–30 days ago
 *   RED    — open CRITICAL issues, OR no activity in 30+ days
 *
 * Engagements that have just entered SLA_ACTIVE (within 7 days) get a
 * grace badge — they're likely still in handover-stabilisation.
 */

export type SlaHealth = 'GREEN' | 'AMBER' | 'RED';

export interface IssueCounts {
  /** Open issues by priority. Keys are CRITICAL/HIGH/MEDIUM/LOW;
   *  unspecified priorities (eg. blank) collapse to MEDIUM. */
  CRITICAL: number;
  HIGH: number;
  MEDIUM: number;
  LOW: number;
}

export interface SlaPortfolioInput {
  /** ISO8601 — when the engagement most recently transitioned into
   *  SLA_ACTIVE. Used to compute days-on-SLA + the grace badge. */
  enteredSlaAt: string | null;
  /** ISO8601 — last ActivityLog row timestamp for the engagement. */
  lastActivityAt: string | null;
  /** Open issue counts by priority. */
  openIssueCounts: IssueCounts;
  /** Reference timestamp — defaults to now. Tests pin this. */
  now?: Date;
}

export interface SlaPortfolioRow {
  health: SlaHealth;
  /** True when the engagement has been on SLA for less than 7 days. */
  inGracePeriod: boolean;
  /** Whole days since entering SLA. Null when enteredSlaAt is unknown. */
  daysOnSla: number | null;
  /** Whole days since the most recent activity. Null when never. */
  daysSinceActivity: number | null;
  /** The single most-pressing reason for the health verdict — kept
   *  short so the UI can render it as a tooltip / sub-label. */
  rationale: string;
}

const DAY_MS = 86400_000;
const STALE_AMBER_DAYS = 14;
const STALE_RED_DAYS = 30;
const GRACE_DAYS = 7;

function daysBetween(from: string | null, now: Date): number | null {
  if (!from) return null;
  const diff = now.getTime() - new Date(from).getTime();
  if (Number.isNaN(diff)) return null;
  return Math.floor(diff / DAY_MS);
}

export function summarizeSlaEngagement(input: SlaPortfolioInput): SlaPortfolioRow {
  const now = input.now ?? new Date();
  const daysOnSla = daysBetween(input.enteredSlaAt, now);
  const daysSinceActivity = daysBetween(input.lastActivityAt, now);
  const inGracePeriod = daysOnSla !== null && daysOnSla < GRACE_DAYS;

  // RED beats AMBER beats GREEN. Rationale picks the worst trigger
  // so the UI surfaces the most actionable reason.
  if (input.openIssueCounts.CRITICAL > 0) {
    return {
      health: 'RED',
      inGracePeriod,
      daysOnSla,
      daysSinceActivity,
      rationale: `${input.openIssueCounts.CRITICAL} open critical ${plural(input.openIssueCounts.CRITICAL, 'issue', 'issues')}.`,
    };
  }
  if (daysSinceActivity !== null && daysSinceActivity >= STALE_RED_DAYS) {
    return {
      health: 'RED',
      inGracePeriod,
      daysOnSla,
      daysSinceActivity,
      rationale: `No activity in ${daysSinceActivity} days.`,
    };
  }
  if (input.openIssueCounts.HIGH > 0) {
    return {
      health: 'AMBER',
      inGracePeriod,
      daysOnSla,
      daysSinceActivity,
      rationale: `${input.openIssueCounts.HIGH} open high-priority ${plural(input.openIssueCounts.HIGH, 'issue', 'issues')}.`,
    };
  }
  if (daysSinceActivity !== null && daysSinceActivity >= STALE_AMBER_DAYS) {
    return {
      health: 'AMBER',
      inGracePeriod,
      daysOnSla,
      daysSinceActivity,
      rationale: `Last activity ${daysSinceActivity} days ago.`,
    };
  }
  return {
    health: 'GREEN',
    inGracePeriod,
    daysOnSla,
    daysSinceActivity,
    rationale: inGracePeriod
      ? 'In post-handover grace window.'
      : 'No critical issues, recent activity.',
  };
}

function plural(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

/**
 * Coerce a raw priority string from the IssueItem table into a counts
 * key. Defaults missing/unrecognised priorities to MEDIUM so a noisy
 * row doesn't throw off the whole rollup.
 */
export function tallyIssueCounts(
  rows: ReadonlyArray<{ priority?: string | null; status?: string | null }>,
): IssueCounts {
  const counts: IssueCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const row of rows) {
    if (row.status && row.status !== 'OPEN') continue;
    const p = (row.priority ?? 'MEDIUM').toUpperCase();
    if (p === 'CRITICAL' || p === 'HIGH' || p === 'MEDIUM' || p === 'LOW') {
      counts[p]++;
    } else {
      counts.MEDIUM++;
    }
  }
  return counts;
}
