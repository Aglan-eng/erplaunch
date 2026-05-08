/**
 * Phase 45.6 — Ticket SLA target helpers.
 *
 * Maps severity → first-response and resolution targets, then computes
 * "is this ticket breached?" against the current ticket state. Pure
 * functions — no DB calls — so the breach predicate can be exercised
 * exhaustively in unit tests and reused by the SLA portfolio rollup.
 *
 * Targets are deliberately conservative (industry-typical SaaS SLA
 * tiers); future Phase 45.x work will let firms override per-tier
 * targets in the engagement's SLA tier (BRONZE/SILVER/GOLD).
 */

export type TicketSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_CUSTOMER'
  | 'RESOLVED'
  | 'CLOSED';

export const TICKET_SEVERITIES: ReadonlyArray<TicketSeverity> = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
];

export const TICKET_STATUSES: ReadonlyArray<TicketStatus> = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
];

export function isTicketSeverity(s: string): s is TicketSeverity {
  return (TICKET_SEVERITIES as readonly string[]).includes(s);
}

export function isTicketStatus(s: string): s is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(s);
}

/**
 * SLA targets per severity. firstResponseHours is the time within
 * which a SUPPORT message must land on the ticket (any reply counts).
 * resolutionHours is the time within which the ticket must reach
 * RESOLVED. Both clocks start when the ticket is opened.
 *
 * The choices reflect a typical mid-market support tier — they're a
 * sensible default until Phase 45.x adds per-firm overrides.
 */
export const SLA_TARGETS: Record<TicketSeverity, { firstResponseHours: number; resolutionHours: number }> = {
  CRITICAL: { firstResponseHours: 1, resolutionHours: 4 },
  HIGH: { firstResponseHours: 4, resolutionHours: 24 },
  MEDIUM: { firstResponseHours: 8, resolutionHours: 72 },
  LOW: { firstResponseHours: 24, resolutionHours: 168 },
};

const HOUR_MS = 3_600_000;

export interface TicketSlaSnapshot {
  severity: TicketSeverity;
  status: TicketStatus;
  /** ISO8601 — when the ticket was first opened. */
  createdAt: string;
  /** ISO8601 — first SUPPORT message timestamp. Null when no
   *  support reply yet. */
  firstSupportReplyAt: string | null;
  /** ISO8601 — first time the ticket flipped to RESOLVED. Null when
   *  never resolved. Distinct from CLOSED so a re-opened ticket's
   *  original resolution time is preserved. */
  firstResolvedAt: string | null;
  /** Reference time — defaults to now. Tests pin this. */
  now?: Date;
}

export interface TicketSlaState {
  /** Targets in hours for the ticket's severity. */
  firstResponseTargetHours: number;
  resolutionTargetHours: number;
  /** True when the first-response clock has already breached. */
  firstResponseBreached: boolean;
  /** True when the resolution clock has already breached. */
  resolutionBreached: boolean;
  /** Whole minutes remaining (negative when breached). Null when the
   *  clock for that target has already stopped (response replied,
   *  resolution reached). */
  firstResponseMinutesRemaining: number | null;
  resolutionMinutesRemaining: number | null;
}

export function computeTicketSla(snap: TicketSlaSnapshot): TicketSlaState {
  const now = snap.now ?? new Date();
  const targets = SLA_TARGETS[snap.severity];
  const created = new Date(snap.createdAt).getTime();

  // First-response clock — stops once a SUPPORT reply lands.
  let firstResponseBreached = false;
  let firstResponseMinutesRemaining: number | null = null;
  if (snap.firstSupportReplyAt) {
    const replyMs = new Date(snap.firstSupportReplyAt).getTime();
    firstResponseBreached = replyMs - created > targets.firstResponseHours * HOUR_MS;
  } else {
    const elapsedMs = now.getTime() - created;
    firstResponseBreached = elapsedMs > targets.firstResponseHours * HOUR_MS;
    firstResponseMinutesRemaining = Math.round((targets.firstResponseHours * HOUR_MS - elapsedMs) / 60_000);
  }

  // Resolution clock — stops on first RESOLVED transition.
  let resolutionBreached = false;
  let resolutionMinutesRemaining: number | null = null;
  if (snap.firstResolvedAt) {
    const resolvedMs = new Date(snap.firstResolvedAt).getTime();
    resolutionBreached = resolvedMs - created > targets.resolutionHours * HOUR_MS;
  } else if (snap.status === 'CLOSED') {
    // Closed without ever being resolved — treat as breached only if
    // the close happened past the target. We don't have a "closedAt"
    // here, so fall back to "no, not breached" — the snapshot caller
    // can pre-set firstResolvedAt = closedAt for accurate breach
    // accounting on this edge case.
    resolutionBreached = false;
  } else {
    const elapsedMs = now.getTime() - created;
    resolutionBreached = elapsedMs > targets.resolutionHours * HOUR_MS;
    resolutionMinutesRemaining = Math.round((targets.resolutionHours * HOUR_MS - elapsedMs) / 60_000);
  }

  return {
    firstResponseTargetHours: targets.firstResponseHours,
    resolutionTargetHours: targets.resolutionHours,
    firstResponseBreached,
    resolutionBreached,
    firstResponseMinutesRemaining,
    resolutionMinutesRemaining,
  };
}

/**
 * Allowed status transitions. Operators can move forward through the
 * lifecycle freely; backwards moves are limited so the audit log
 * doesn't accumulate noise. CLOSED is a near-terminal state — only
 * explicit re-open (CLOSED → OPEN) brings a ticket back.
 */
const TRANSITIONS: Record<TicketStatus, ReadonlyArray<TicketStatus>> = {
  OPEN: ['IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['WAITING_CUSTOMER', 'RESOLVED', 'OPEN', 'CLOSED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'OPEN'],
  CLOSED: ['OPEN'],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}
