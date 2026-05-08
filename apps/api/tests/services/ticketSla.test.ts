/**
 * Phase 45.6 — pure tests for the ticket SLA helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  computeTicketSla,
  canTransition,
  SLA_TARGETS,
  isTicketSeverity,
  isTicketStatus,
} from '../../src/services/ticketSla.js';

const NOW = new Date('2026-05-08T12:00:00Z');

function hoursAgo(n: number): string {
  return new Date(NOW.getTime() - n * 3_600_000).toISOString();
}

describe('computeTicketSla — first response clock', () => {
  it('not breached when within target and no reply yet', () => {
    const r = computeTicketSla({
      severity: 'CRITICAL', // 1h target
      status: 'OPEN',
      createdAt: hoursAgo(0.5),
      firstSupportReplyAt: null,
      firstResolvedAt: null,
      now: NOW,
    });
    expect(r.firstResponseBreached).toBe(false);
    expect(r.firstResponseMinutesRemaining).toBeGreaterThan(0);
  });

  it('breached when no reply within target', () => {
    const r = computeTicketSla({
      severity: 'CRITICAL',
      status: 'OPEN',
      createdAt: hoursAgo(2),
      firstSupportReplyAt: null,
      firstResolvedAt: null,
      now: NOW,
    });
    expect(r.firstResponseBreached).toBe(true);
    // Negative minutes remaining shows how far past target.
    expect(r.firstResponseMinutesRemaining).toBeLessThan(0);
  });

  it('not breached when reply landed within target', () => {
    const r = computeTicketSla({
      severity: 'HIGH', // 4h target
      status: 'IN_PROGRESS',
      createdAt: hoursAgo(6),
      firstSupportReplyAt: hoursAgo(3.5), // reply was 2.5h after open
      firstResolvedAt: null,
      now: NOW,
    });
    expect(r.firstResponseBreached).toBe(false);
    expect(r.firstResponseMinutesRemaining).toBeNull();
  });

  it('breached when reply landed past target', () => {
    const r = computeTicketSla({
      severity: 'HIGH',
      status: 'IN_PROGRESS',
      createdAt: hoursAgo(10),
      firstSupportReplyAt: hoursAgo(2), // reply was 8h after open, target 4h
      firstResolvedAt: null,
      now: NOW,
    });
    expect(r.firstResponseBreached).toBe(true);
  });
});

describe('computeTicketSla — resolution clock', () => {
  it('not breached when resolved within target', () => {
    const r = computeTicketSla({
      severity: 'MEDIUM', // 72h target
      status: 'RESOLVED',
      createdAt: hoursAgo(48),
      firstSupportReplyAt: hoursAgo(40),
      firstResolvedAt: hoursAgo(2),
      now: NOW,
    });
    expect(r.resolutionBreached).toBe(false);
    expect(r.resolutionMinutesRemaining).toBeNull();
  });

  it('breached when resolved past target', () => {
    const r = computeTicketSla({
      severity: 'CRITICAL', // 4h target
      status: 'RESOLVED',
      createdAt: hoursAgo(8),
      firstSupportReplyAt: hoursAgo(7),
      firstResolvedAt: hoursAgo(1), // resolved 7h after open, target 4h
      now: NOW,
    });
    expect(r.resolutionBreached).toBe(true);
  });

  it('breached when still open past target', () => {
    const r = computeTicketSla({
      severity: 'CRITICAL',
      status: 'IN_PROGRESS',
      createdAt: hoursAgo(6),
      firstSupportReplyAt: hoursAgo(5.5),
      firstResolvedAt: null,
      now: NOW,
    });
    expect(r.resolutionBreached).toBe(true);
  });
});

describe('SLA_TARGETS', () => {
  it('exposes targets per severity', () => {
    expect(SLA_TARGETS.CRITICAL.firstResponseHours).toBe(1);
    expect(SLA_TARGETS.LOW.resolutionHours).toBe(168);
  });
});

describe('canTransition', () => {
  it('allows OPEN → IN_PROGRESS', () => {
    expect(canTransition('OPEN', 'IN_PROGRESS')).toBe(true);
  });
  it('allows RESOLVED → CLOSED', () => {
    expect(canTransition('RESOLVED', 'CLOSED')).toBe(true);
  });
  it('allows CLOSED → OPEN (re-open)', () => {
    expect(canTransition('CLOSED', 'OPEN')).toBe(true);
  });
  it('disallows same-state transition', () => {
    expect(canTransition('OPEN', 'OPEN')).toBe(false);
  });
  it('disallows backwards from RESOLVED to IN_PROGRESS', () => {
    expect(canTransition('RESOLVED', 'IN_PROGRESS')).toBe(false);
  });
  it('disallows skipping back from CLOSED to RESOLVED', () => {
    expect(canTransition('CLOSED', 'RESOLVED')).toBe(false);
  });
});

describe('type guards', () => {
  it('isTicketSeverity recognises canonical values', () => {
    expect(isTicketSeverity('HIGH')).toBe(true);
    expect(isTicketSeverity('SUPER_DUPER')).toBe(false);
  });
  it('isTicketStatus recognises canonical values', () => {
    expect(isTicketStatus('IN_PROGRESS')).toBe(true);
    expect(isTicketStatus('PENDING')).toBe(false);
  });
});
