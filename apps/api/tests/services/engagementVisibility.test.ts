import { describe, it, expect } from 'vitest';
import {
  roleSeesEngagementAtStage,
  applyVisibilityScope,
} from '../../src/services/engagementVisibility.js';

/**
 * Phase 44.1 — pure tests for the per-role × per-stage visibility
 * rule. The DB-backed `resolveVisibilityScope` gets coverage via the
 * route-level test below; this file pins the matrix.
 */

describe('roleSeesEngagementAtStage', () => {
  it('SALES_REP sees PROSPECT/PROPOSED/CONTRACTED only', () => {
    expect(roleSeesEngagementAtStage('SALES_REP', 'PROSPECT')).toBe(true);
    expect(roleSeesEngagementAtStage('SALES_REP', 'PROPOSED')).toBe(true);
    expect(roleSeesEngagementAtStage('SALES_REP', 'CONTRACTED')).toBe(true);
    expect(roleSeesEngagementAtStage('SALES_REP', 'DISCOVERY')).toBe(false);
    expect(roleSeesEngagementAtStage('SALES_REP', 'BUILD')).toBe(false);
    expect(roleSeesEngagementAtStage('SALES_REP', 'SLA_ACTIVE')).toBe(false);
  });

  it('PROJECT_MANAGER / PROJECT_LEAD see every stage on their assigned engagements', () => {
    for (const role of ['PROJECT_MANAGER', 'PROJECT_LEAD']) {
      for (const stage of ['PROSPECT', 'DISCOVERY', 'GOLIVE', 'CLOSEOUT', 'SLA_ACTIVE', 'ARCHIVED']) {
        expect(roleSeesEngagementAtStage(role, stage)).toBe(true);
      }
    }
  });

  it('FUNCTIONAL/TECHNICAL_CONSULTANT see every stage', () => {
    for (const role of ['FUNCTIONAL_CONSULTANT', 'TECHNICAL_CONSULTANT']) {
      expect(roleSeesEngagementAtStage(role, 'BUILD')).toBe(true);
      expect(roleSeesEngagementAtStage(role, 'ARCHIVED')).toBe(true);
    }
  });

  it('SUPPORT_ENGINEER sees CLOSEOUT and SLA_ACTIVE only', () => {
    expect(roleSeesEngagementAtStage('SUPPORT_ENGINEER', 'BUILD')).toBe(false);
    expect(roleSeesEngagementAtStage('SUPPORT_ENGINEER', 'GOLIVE')).toBe(false);
    expect(roleSeesEngagementAtStage('SUPPORT_ENGINEER', 'CLOSEOUT')).toBe(true);
    expect(roleSeesEngagementAtStage('SUPPORT_ENGINEER', 'SLA_ACTIVE')).toBe(true);
    expect(roleSeesEngagementAtStage('SUPPORT_ENGINEER', 'ARCHIVED')).toBe(false);
  });

  it('ACCOUNT_MANAGER sees CLOSEOUT and SLA_ACTIVE only', () => {
    expect(roleSeesEngagementAtStage('ACCOUNT_MANAGER', 'BUILD')).toBe(false);
    expect(roleSeesEngagementAtStage('ACCOUNT_MANAGER', 'CLOSEOUT')).toBe(true);
    expect(roleSeesEngagementAtStage('ACCOUNT_MANAGER', 'SLA_ACTIVE')).toBe(true);
  });

  it('CLIENT_* roles see every stage on their engagement', () => {
    for (const role of ['CLIENT_SPONSOR', 'CLIENT_LEAD', 'CLIENT_SME', 'CLIENT_REVIEWER']) {
      expect(roleSeesEngagementAtStage(role, 'PROSPECT')).toBe(true);
      expect(roleSeesEngagementAtStage(role, 'GOLIVE')).toBe(true);
      expect(roleSeesEngagementAtStage(role, 'ARCHIVED')).toBe(true);
    }
  });

  it('unknown role returns false (defensive)', () => {
    expect(roleSeesEngagementAtStage('SOMETHING_NEW', 'BUILD')).toBe(false);
  });

  it('normalises legacy GO_LIVE to GOLIVE', () => {
    // PROJECT_MANAGER sees ALL stages, so GO_LIVE works.
    expect(roleSeesEngagementAtStage('PROJECT_MANAGER', 'GO_LIVE')).toBe(true);
    // SALES_REP doesn't see GO_LIVE/GOLIVE.
    expect(roleSeesEngagementAtStage('SALES_REP', 'GO_LIVE')).toBe(false);
  });
});

describe('applyVisibilityScope', () => {
  const engagements = [
    { id: 'a' }, { id: 'b' }, { id: 'c' },
  ];

  it('ALL scope returns the input list unchanged', () => {
    const r = applyVisibilityScope(engagements, { kind: 'ALL' });
    expect(r).toHaveLength(3);
    expect(r.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('SCOPED returns only the listed ids in original order', () => {
    const r = applyVisibilityScope(engagements, { kind: 'SCOPED', ids: ['c', 'a'] });
    expect(r.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('SCOPED with empty id list returns empty array', () => {
    const r = applyVisibilityScope(engagements, { kind: 'SCOPED', ids: [] });
    expect(r).toEqual([]);
  });

  it('ignores ids not in the input list (no extras)', () => {
    const r = applyVisibilityScope(engagements, { kind: 'SCOPED', ids: ['z', 'a'] });
    expect(r.map((e) => e.id)).toEqual(['a']);
  });
});
