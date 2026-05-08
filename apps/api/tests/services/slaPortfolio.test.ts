/**
 * Phase 45.5 — pure tests for the SLA portfolio health rules.
 */
import { describe, it, expect } from 'vitest';
import {
  summarizeSlaEngagement,
  tallyIssueCounts,
  type IssueCounts,
} from '../../src/services/slaPortfolio.js';

const NO_ISSUES: IssueCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
const FIXED_NOW = new Date('2026-05-08T12:00:00Z');

function days(n: number): string {
  return new Date(FIXED_NOW.getTime() - n * 86400_000).toISOString();
}

describe('summarizeSlaEngagement — health verdict', () => {
  it('GREEN when no issues + recent activity', () => {
    const r = summarizeSlaEngagement({
      enteredSlaAt: days(20),
      lastActivityAt: days(2),
      openIssueCounts: NO_ISSUES,
      now: FIXED_NOW,
    });
    expect(r.health).toBe('GREEN');
    expect(r.daysOnSla).toBe(20);
    expect(r.daysSinceActivity).toBe(2);
    expect(r.inGracePeriod).toBe(false);
  });

  it('GREEN with grace flag when within 7 days of handover', () => {
    const r = summarizeSlaEngagement({
      enteredSlaAt: days(3),
      lastActivityAt: days(1),
      openIssueCounts: NO_ISSUES,
      now: FIXED_NOW,
    });
    expect(r.health).toBe('GREEN');
    expect(r.inGracePeriod).toBe(true);
    expect(r.rationale).toContain('grace');
  });

  it('AMBER when there is an open HIGH issue', () => {
    const r = summarizeSlaEngagement({
      enteredSlaAt: days(20),
      lastActivityAt: days(2),
      openIssueCounts: { ...NO_ISSUES, HIGH: 2 },
      now: FIXED_NOW,
    });
    expect(r.health).toBe('AMBER');
    expect(r.rationale).toContain('2 open high-priority');
  });

  it('AMBER when last activity was 14+ days ago', () => {
    const r = summarizeSlaEngagement({
      enteredSlaAt: days(60),
      lastActivityAt: days(15),
      openIssueCounts: NO_ISSUES,
      now: FIXED_NOW,
    });
    expect(r.health).toBe('AMBER');
    expect(r.rationale).toContain('Last activity 15 days ago');
  });

  it('RED when there is an open CRITICAL issue, regardless of activity', () => {
    const r = summarizeSlaEngagement({
      enteredSlaAt: days(60),
      lastActivityAt: days(1),
      openIssueCounts: { ...NO_ISSUES, CRITICAL: 1 },
      now: FIXED_NOW,
    });
    expect(r.health).toBe('RED');
    expect(r.rationale).toContain('1 open critical issue');
  });

  it('RED when no activity in 30+ days', () => {
    const r = summarizeSlaEngagement({
      enteredSlaAt: days(90),
      lastActivityAt: days(35),
      openIssueCounts: NO_ISSUES,
      now: FIXED_NOW,
    });
    expect(r.health).toBe('RED');
    expect(r.rationale).toContain('No activity in 35 days');
  });

  it('CRITICAL beats AMBER triggers (worst-wins)', () => {
    const r = summarizeSlaEngagement({
      enteredSlaAt: days(60),
      lastActivityAt: days(20),
      openIssueCounts: { CRITICAL: 1, HIGH: 5, MEDIUM: 0, LOW: 0 },
      now: FIXED_NOW,
    });
    expect(r.health).toBe('RED');
    expect(r.rationale).toContain('critical');
  });

  it('handles null enteredSlaAt + null lastActivityAt gracefully', () => {
    const r = summarizeSlaEngagement({
      enteredSlaAt: null,
      lastActivityAt: null,
      openIssueCounts: NO_ISSUES,
      now: FIXED_NOW,
    });
    expect(r.health).toBe('GREEN');
    expect(r.daysOnSla).toBeNull();
    expect(r.daysSinceActivity).toBeNull();
    expect(r.inGracePeriod).toBe(false);
  });
});

describe('tallyIssueCounts', () => {
  it('counts only OPEN issues', () => {
    const counts = tallyIssueCounts([
      { priority: 'CRITICAL', status: 'OPEN' },
      { priority: 'HIGH', status: 'CLOSED' },
      { priority: 'HIGH', status: 'OPEN' },
      { priority: 'LOW', status: 'OPEN' },
    ]);
    expect(counts).toEqual({ CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 1 });
  });

  it('coerces unknown priorities to MEDIUM', () => {
    const counts = tallyIssueCounts([
      { priority: 'urgent', status: 'OPEN' },
      { priority: null, status: 'OPEN' },
    ]);
    expect(counts.MEDIUM).toBe(2);
  });

  it('treats undefined status as OPEN (back-compat with legacy rows)', () => {
    const counts = tallyIssueCounts([
      { priority: 'HIGH' },
      { priority: 'LOW' },
    ]);
    expect(counts.HIGH).toBe(1);
    expect(counts.LOW).toBe(1);
  });
});
