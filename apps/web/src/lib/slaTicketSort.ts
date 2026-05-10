/**
 * Phase 48.1 — pure sort helpers for the SLA ticket queue.
 *
 * Keeps the breach-proximity sort logic out of the SlaTicketsPage so
 * tests can pin the contract without rendering the page.
 *
 * Order rules (worst-first):
 *   1. Breached tickets come first (any of firstResponseBreached or
 *      resolutionBreached → put at top).
 *   2. Within the same breach bucket, sort by min(remaining minutes)
 *      ascending — the ticket closest to its target lands first.
 *   3. Tie-break by severity weight (CRITICAL < HIGH < MEDIUM < LOW).
 */

import type { FirmTicketRow, TicketSeverity } from './api';

const SEVERITY_WEIGHT: Record<TicketSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function sortTicketsByBreachProximity(
  tickets: ReadonlyArray<FirmTicketRow>,
): FirmTicketRow[] {
  return [...tickets].sort((a, b) => {
    const aBreach = a.sla.firstResponseBreached || a.sla.resolutionBreached ? 0 : 1;
    const bBreach = b.sla.firstResponseBreached || b.sla.resolutionBreached ? 0 : 1;
    if (aBreach !== bBreach) return aBreach - bBreach;
    const aMin = Math.min(
      a.sla.firstResponseMinutesRemaining ?? Number.POSITIVE_INFINITY,
      a.sla.resolutionMinutesRemaining ?? Number.POSITIVE_INFINITY,
    );
    const bMin = Math.min(
      b.sla.firstResponseMinutesRemaining ?? Number.POSITIVE_INFINITY,
      b.sla.resolutionMinutesRemaining ?? Number.POSITIVE_INFINITY,
    );
    if (aMin !== bMin) return aMin - bMin;
    return SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
  });
}

export function filterBySeverity(
  tickets: ReadonlyArray<FirmTicketRow>,
  severity: TicketSeverity | 'ALL',
): FirmTicketRow[] {
  if (severity === 'ALL') return [...tickets];
  return tickets.filter((t) => t.severity === severity);
}
