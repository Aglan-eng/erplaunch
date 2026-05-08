/**
 * Phase 45.1 — pure tests for the closeout-checklist helpers.
 *
 * The DB-backed CRUD is exercised by the route-level test in
 * tests/routes/closeoutChecklist.test.ts; this file pins the policy
 * (canonical key set, auto-detect mapping, progress maths,
 * SLA_ACTIVE transition gate).
 */
import { describe, it, expect } from 'vitest';
import {
  CHECKLIST_KEYS,
  CHECKLIST_STATUSES,
  KEY_LABELS,
  TRANSITION_BLOCKERS,
  autoDetectFor,
  canTransitionToSlaActive,
  checklistProgress,
  isChecklistKey,
  isChecklistStatus,
  type ChecklistKey,
  type ChecklistItemSummary,
} from '../../src/services/closeoutChecklist.js';

// ─── Schema integrity ───────────────────────────────────────────────────────

describe('closeout checklist schema', () => {
  it('exposes 9 canonical keys', () => {
    expect(CHECKLIST_KEYS).toHaveLength(9);
  });

  it('every key has a label', () => {
    for (const k of CHECKLIST_KEYS) {
      expect(KEY_LABELS[k]).toBeTruthy();
    }
  });

  it('exposes 4 statuses', () => {
    expect(CHECKLIST_STATUSES).toEqual(['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'NA']);
  });

  it('isChecklistKey rejects unknowns', () => {
    expect(isChecklistKey('CLIENT_SIGNOFF')).toBe(true);
    expect(isChecklistKey('NOT_A_KEY')).toBe(false);
  });

  it('isChecklistStatus rejects unknowns', () => {
    expect(isChecklistStatus('DONE')).toBe(true);
    expect(isChecklistStatus('PARTIAL')).toBe(false);
  });
});

// ─── Auto-detect rules ──────────────────────────────────────────────────────

describe('autoDetectFor', () => {
  it('HANDOFF_PACKAGE_GENERATED moves SYSTEM_CATALOG_REVIEWED → IN_PROGRESS', () => {
    expect(autoDetectFor('HANDOFF_PACKAGE_GENERATED')).toEqual({
      key: 'SYSTEM_CATALOG_REVIEWED',
      newStatus: 'IN_PROGRESS',
    });
  });

  it('FINAL_INVOICE_PAID moves FINAL_INVOICE_PAID → DONE', () => {
    expect(autoDetectFor('FINAL_INVOICE_PAID')).toEqual({
      key: 'FINAL_INVOICE_PAID',
      newStatus: 'DONE',
    });
  });
});

// ─── Progress maths ─────────────────────────────────────────────────────────

describe('checklistProgress', () => {
  function make(status: 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'NA'): ChecklistItemSummary {
    return { key: 'KNOWLEDGE_TRANSFER', status };
  }

  it('returns zero progress for an all-pending list', () => {
    const r = checklistProgress([make('NOT_STARTED'), make('IN_PROGRESS')]);
    expect(r).toEqual({ total: 2, done: 0, pending: 2, percentComplete: 0 });
  });

  it('counts NA items as satisfied (they cannot block closeout)', () => {
    const r = checklistProgress([make('DONE'), make('NA'), make('NOT_STARTED')]);
    expect(r).toEqual({ total: 3, done: 2, pending: 1, percentComplete: 67 });
  });

  it('returns 100% on a fully DONE list', () => {
    const r = checklistProgress([make('DONE'), make('DONE')]);
    expect(r).toEqual({ total: 2, done: 2, pending: 0, percentComplete: 100 });
  });

  it('handles an empty list without dividing by zero', () => {
    const r = checklistProgress([]);
    expect(r).toEqual({ total: 0, done: 0, pending: 0, percentComplete: 0 });
  });
});

// ─── Transition gate ────────────────────────────────────────────────────────

describe('canTransitionToSlaActive', () => {
  function makeAll(status: 'NOT_STARTED' | 'DONE'): ChecklistItemSummary[] {
    return CHECKLIST_KEYS.map((k) => ({ key: k as ChecklistKey, status }));
  }

  it('CLIENT_SIGNOFF and SLA_TEAM_ACCEPT are the canonical blockers', () => {
    expect(TRANSITION_BLOCKERS).toEqual(['CLIENT_SIGNOFF', 'SLA_TEAM_ACCEPT']);
  });

  it('returns true when both blockers are DONE', () => {
    const items = makeAll('NOT_STARTED');
    items.find((i) => i.key === 'CLIENT_SIGNOFF')!.status = 'DONE';
    items.find((i) => i.key === 'SLA_TEAM_ACCEPT')!.status = 'DONE';
    expect(canTransitionToSlaActive(items)).toBe(true);
  });

  it('returns false when only one blocker is DONE', () => {
    const items = makeAll('NOT_STARTED');
    items.find((i) => i.key === 'CLIENT_SIGNOFF')!.status = 'DONE';
    expect(canTransitionToSlaActive(items)).toBe(false);
  });

  it('NA on a blocker is also accepted (item explicitly marked irrelevant)', () => {
    const items = makeAll('NOT_STARTED');
    items.find((i) => i.key === 'CLIENT_SIGNOFF')!.status = 'NA';
    items.find((i) => i.key === 'SLA_TEAM_ACCEPT')!.status = 'NA';
    expect(canTransitionToSlaActive(items)).toBe(true);
  });

  it('returns false when one of the blockers is missing from the list', () => {
    const items = [{ key: 'CLIENT_SIGNOFF' as ChecklistKey, status: 'DONE' as const }];
    expect(canTransitionToSlaActive(items)).toBe(false);
  });
});
