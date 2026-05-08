/**
 * Phase 45.8 — pure tests for the renewal urgency rules.
 */
import { describe, it, expect } from 'vitest';
import {
  computeRenewalWindow,
  parseExpansionOpportunities,
  isRenewalStatus,
} from '../../src/services/renewalTracker.js';

const NOW = new Date('2026-05-08T12:00:00Z');
function days(n: number): string {
  return new Date(NOW.getTime() + n * 86_400_000).toISOString();
}

describe('computeRenewalWindow — urgency thresholds', () => {
  it('GREEN when contract ends > 90 days out', () => {
    const r = computeRenewalWindow({
      contractEndAt: days(120),
      renewalStatus: 'NOT_STARTED',
      now: NOW,
    });
    expect(r.urgency).toBe('GREEN');
    expect(r.daysToExpiry).toBe(120);
    expect(r.expired).toBe(false);
  });

  it('AMBER when contract ends in 31..90 days', () => {
    const r = computeRenewalWindow({
      contractEndAt: days(60),
      renewalStatus: 'NOT_STARTED',
      now: NOW,
    });
    expect(r.urgency).toBe('AMBER');
  });

  it('RED when contract ends in <= 30 days', () => {
    const r = computeRenewalWindow({
      contractEndAt: days(15),
      renewalStatus: 'NOT_STARTED',
      now: NOW,
    });
    expect(r.urgency).toBe('RED');
    expect(r.expired).toBe(false);
  });

  it('RED + expired when contract end is in the past', () => {
    const r = computeRenewalWindow({
      contractEndAt: days(-7),
      renewalStatus: 'NOT_STARTED',
      now: NOW,
    });
    expect(r.urgency).toBe('RED');
    expect(r.expired).toBe(true);
    expect(r.daysToExpiry).toBeLessThan(0);
  });

  it('GREEN + null when contractEndAt is missing', () => {
    const r = computeRenewalWindow({
      contractEndAt: null,
      renewalStatus: 'NOT_STARTED',
      now: NOW,
    });
    expect(r.urgency).toBe('GREEN');
    expect(r.daysToExpiry).toBeNull();
  });
});

describe('computeRenewalWindow — status overrides', () => {
  it('SIGNED is always GREEN even if expiry is close', () => {
    const r = computeRenewalWindow({
      contractEndAt: days(5),
      renewalStatus: 'SIGNED',
      now: NOW,
    });
    expect(r.urgency).toBe('GREEN');
  });

  it('LOST is always RED + expired', () => {
    const r = computeRenewalWindow({
      contractEndAt: days(120),
      renewalStatus: 'LOST',
      now: NOW,
    });
    expect(r.urgency).toBe('RED');
    expect(r.expired).toBe(true);
  });

  it('NA is GREEN with no daysToExpiry (perpetual / month-to-month)', () => {
    const r = computeRenewalWindow({
      contractEndAt: days(1),
      renewalStatus: 'NA',
      now: NOW,
    });
    expect(r.urgency).toBe('GREEN');
    expect(r.daysToExpiry).toBeNull();
  });
});

describe('parseExpansionOpportunities', () => {
  it('parses a valid JSON array', () => {
    const input = JSON.stringify([
      { title: 'Add Inventory module', size: '+$15k ARR', notes: 'Q3 target' },
    ]);
    const r = parseExpansionOpportunities(input);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('Add Inventory module');
    expect(r[0].size).toBe('+$15k ARR');
  });

  it('returns [] on null/undefined/empty', () => {
    expect(parseExpansionOpportunities(null)).toEqual([]);
    expect(parseExpansionOpportunities(undefined)).toEqual([]);
    expect(parseExpansionOpportunities('')).toEqual([]);
  });

  it('returns [] on malformed JSON', () => {
    expect(parseExpansionOpportunities('{not json')).toEqual([]);
  });

  it('returns [] on non-array JSON', () => {
    expect(parseExpansionOpportunities('"hello"')).toEqual([]);
  });

  it('drops entries without a title', () => {
    const input = JSON.stringify([{ size: '$5k' }, { title: 'Real one' }]);
    const r = parseExpansionOpportunities(input);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('Real one');
  });
});

describe('isRenewalStatus', () => {
  it('recognises canonical values', () => {
    expect(isRenewalStatus('SIGNED')).toBe(true);
    expect(isRenewalStatus('PROPOSAL_OUT')).toBe(true);
  });
  it('rejects unknown values', () => {
    expect(isRenewalStatus('GO_FOR_LAUNCH')).toBe(false);
  });
});
