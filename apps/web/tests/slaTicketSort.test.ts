/**
 * Phase 48.1 — pure tests for the SLA ticket queue sort + severity filter.
 *
 * Pin the contract:
 *   - Breached tickets always come before non-breached ones, regardless
 *     of severity (a breached LOW comes before a non-breached CRITICAL
 *     because the operator needs to react to breaches first).
 *   - Within the same breach bucket, sort by min remaining minutes.
 *   - Severity is the final tie-break for tickets with identical SLA
 *     state (e.g. fresh tickets opened in the same minute).
 *   - Severity filter is exact-match.
 */
import { describe, it, expect } from 'vitest';
import {
  sortTicketsByBreachProximity,
  filterBySeverity,
} from '../src/lib/slaTicketSort';
import type { FirmTicketRow, TicketSeverity, TicketStatus } from '../src/lib/api';

function makeTicket(over: Partial<FirmTicketRow> & { id: string; severity?: TicketSeverity; sla?: Partial<FirmTicketRow['sla']> }): FirmTicketRow {
  const status: TicketStatus = 'OPEN';
  return {
    id: over.id,
    engagementId: over.engagementId ?? 'eng-1',
    firmId: over.firmId ?? 'firm-1',
    title: over.title ?? `Ticket ${over.id}`,
    description: over.description ?? null,
    severity: over.severity ?? 'MEDIUM',
    status: over.status ?? status,
    openedByUserId: null,
    openedByMemberId: null,
    assigneeUserId: null,
    firstResolvedAt: null,
    closedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    clientName: 'TestClient',
    sla: {
      firstResponseTargetHours: 4,
      resolutionTargetHours: 24,
      firstResponseBreached: false,
      resolutionBreached: false,
      firstResponseMinutesRemaining: 200,
      resolutionMinutesRemaining: 1400,
      ...(over.sla ?? {}),
    },
    ...over,
  };
}

describe('sortTicketsByBreachProximity', () => {
  it('puts breached tickets before non-breached ones, regardless of severity', () => {
    const breachedLow = makeTicket({
      id: 'breached-low',
      severity: 'LOW',
      sla: { firstResponseBreached: true },
    });
    const cleanCritical = makeTicket({
      id: 'clean-critical',
      severity: 'CRITICAL',
      sla: { firstResponseMinutesRemaining: 30, resolutionMinutesRemaining: 200 },
    });
    const sorted = sortTicketsByBreachProximity([cleanCritical, breachedLow]);
    expect(sorted.map((t) => t.id)).toEqual(['breached-low', 'clean-critical']);
  });

  it('sorts non-breached by min remaining minutes ascending', () => {
    const a = makeTicket({
      id: 'a',
      sla: { firstResponseMinutesRemaining: 30, resolutionMinutesRemaining: 1000 },
    });
    const b = makeTicket({
      id: 'b',
      sla: { firstResponseMinutesRemaining: 5, resolutionMinutesRemaining: 1000 },
    });
    const c = makeTicket({
      id: 'c',
      sla: { firstResponseMinutesRemaining: 60, resolutionMinutesRemaining: 1000 },
    });
    const sorted = sortTicketsByBreachProximity([a, b, c]);
    expect(sorted.map((t) => t.id)).toEqual(['b', 'a', 'c']);
  });

  it('treats null minutesRemaining as infinity (clock stopped)', () => {
    const stopped = makeTicket({
      id: 'stopped',
      sla: { firstResponseMinutesRemaining: null, resolutionMinutesRemaining: 200 },
    });
    const ticking = makeTicket({
      id: 'ticking',
      sla: { firstResponseMinutesRemaining: 100, resolutionMinutesRemaining: 200 },
    });
    const sorted = sortTicketsByBreachProximity([stopped, ticking]);
    // ticking is closer (min 100 < min 200) so it comes first.
    expect(sorted.map((t) => t.id)).toEqual(['ticking', 'stopped']);
  });

  it('uses severity as the final tie-break', () => {
    const low = makeTicket({
      id: 'low',
      severity: 'LOW',
      sla: { firstResponseMinutesRemaining: 100, resolutionMinutesRemaining: 100 },
    });
    const critical = makeTicket({
      id: 'critical',
      severity: 'CRITICAL',
      sla: { firstResponseMinutesRemaining: 100, resolutionMinutesRemaining: 100 },
    });
    const sorted = sortTicketsByBreachProximity([low, critical]);
    expect(sorted.map((t) => t.id)).toEqual(['critical', 'low']);
  });

  it('does not mutate the input array', () => {
    const input = [
      makeTicket({ id: 'a', sla: { firstResponseMinutesRemaining: 100 } }),
      makeTicket({ id: 'b', sla: { firstResponseMinutesRemaining: 50 } }),
    ];
    const before = input.map((t) => t.id);
    sortTicketsByBreachProximity(input);
    expect(input.map((t) => t.id)).toEqual(before);
  });
});

describe('filterBySeverity', () => {
  it('returns all tickets when filter is ALL', () => {
    const tickets = [
      makeTicket({ id: 'a', severity: 'CRITICAL' }),
      makeTicket({ id: 'b', severity: 'LOW' }),
    ];
    expect(filterBySeverity(tickets, 'ALL')).toHaveLength(2);
  });

  it('returns only matching severity', () => {
    const tickets = [
      makeTicket({ id: 'a', severity: 'CRITICAL' }),
      makeTicket({ id: 'b', severity: 'LOW' }),
      makeTicket({ id: 'c', severity: 'CRITICAL' }),
    ];
    const filtered = filterBySeverity(tickets, 'CRITICAL');
    expect(filtered.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('returns empty array when no tickets match', () => {
    const tickets = [makeTicket({ id: 'a', severity: 'CRITICAL' })];
    expect(filterBySeverity(tickets, 'LOW')).toEqual([]);
  });
});
