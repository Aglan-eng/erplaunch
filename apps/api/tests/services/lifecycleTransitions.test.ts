import { describe, it, expect } from 'vitest';
import {
  nextStage,
  previousStage,
  handoffEventFor,
  handoffNotificationTargets,
  handoffMessageFor,
} from '../../src/services/lifecycleTransitions.js';

/**
 * Phase 43.3 — pure tests for the stage transition rules.
 */

describe('nextStage', () => {
  it('walks the canonical order', () => {
    expect(nextStage('PROSPECT')).toBe('PROPOSED');
    expect(nextStage('PROPOSED')).toBe('CONTRACTED');
    expect(nextStage('CONTRACTED')).toBe('DISCOVERY');
    expect(nextStage('DISCOVERY')).toBe('SCOPING');
    expect(nextStage('GOLIVE')).toBe('CLOSEOUT');
    expect(nextStage('CLOSEOUT')).toBe('SLA_ACTIVE');
    expect(nextStage('SLA_ACTIVE')).toBe('ARCHIVED');
  });

  it('returns null when already at the terminal stage', () => {
    expect(nextStage('ARCHIVED')).toBeNull();
  });

  it('normalises legacy GO_LIVE to GOLIVE before advancing', () => {
    expect(nextStage('GO_LIVE')).toBe('CLOSEOUT');
  });
});

describe('previousStage', () => {
  it('walks back one stage', () => {
    expect(previousStage('SLA_ACTIVE')).toBe('CLOSEOUT');
    expect(previousStage('CLOSEOUT')).toBe('GOLIVE');
    expect(previousStage('PROPOSED')).toBe('PROSPECT');
  });

  it('returns null when already at the first stage', () => {
    expect(previousStage('PROSPECT')).toBeNull();
  });
});

describe('handoffEventFor', () => {
  it('flags PROPOSED → CONTRACTED as HANDOFF_TO_IMPLEMENTATION', () => {
    expect(handoffEventFor('PROPOSED', 'CONTRACTED')).toBe('HANDOFF_TO_IMPLEMENTATION');
  });

  it('flags CONTRACTED → DISCOVERY as HANDOFF_TO_IMPLEMENTATION (kickoff start)', () => {
    expect(handoffEventFor('CONTRACTED', 'DISCOVERY')).toBe('HANDOFF_TO_IMPLEMENTATION');
  });

  it('flags GOLIVE → CLOSEOUT as HANDOFF_TO_CLOSEOUT', () => {
    expect(handoffEventFor('GOLIVE', 'CLOSEOUT')).toBe('HANDOFF_TO_CLOSEOUT');
  });

  it('flags CLOSEOUT → SLA_ACTIVE as HANDOFF_TO_SLA', () => {
    expect(handoffEventFor('CLOSEOUT', 'SLA_ACTIVE')).toBe('HANDOFF_TO_SLA');
  });

  it('flags any backwards move as ENGAGEMENT_REGRESSED', () => {
    expect(handoffEventFor('BUILD', 'SCOPING')).toBe('ENGAGEMENT_REGRESSED');
    expect(handoffEventFor('SLA_ACTIVE', 'GOLIVE')).toBe('ENGAGEMENT_REGRESSED');
  });

  it('falls back to STAGE_ADVANCED for non-handoff forwards transitions', () => {
    expect(handoffEventFor('SCOPING', 'BUILD')).toBe('STAGE_ADVANCED');
    expect(handoffEventFor('BUILD', 'UAT')).toBe('STAGE_ADVANCED');
    expect(handoffEventFor('UAT', 'GOLIVE')).toBe('STAGE_ADVANCED');
  });

  it('honours the legacy GO_LIVE alias for the from-stage', () => {
    expect(handoffEventFor('GO_LIVE', 'CLOSEOUT')).toBe('HANDOFF_TO_CLOSEOUT');
  });
});

describe('handoffNotificationTargets', () => {
  it('routes HANDOFF_TO_IMPLEMENTATION to PROJECT_MANAGER + PROJECT_LEAD', () => {
    const t = handoffNotificationTargets('HANDOFF_TO_IMPLEMENTATION');
    expect(t.engagementRoles).toContain('PROJECT_MANAGER');
    expect(t.engagementRoles).toContain('PROJECT_LEAD');
  });

  it('routes HANDOFF_TO_CLOSEOUT to ACCOUNT_MANAGER + SUPPORT_LEAD', () => {
    const t = handoffNotificationTargets('HANDOFF_TO_CLOSEOUT');
    expect(t.engagementRoles).toContain('ACCOUNT_MANAGER');
    expect(t.firmRoles).toContain('SUPPORT_LEAD');
  });

  it('routes HANDOFF_TO_SLA to SUPPORT_ENGINEER + SUPPORT_LEAD', () => {
    const t = handoffNotificationTargets('HANDOFF_TO_SLA');
    expect(t.engagementRoles).toContain('SUPPORT_ENGINEER');
    expect(t.firmRoles).toContain('SUPPORT_LEAD');
  });

  it('returns no targets for STAGE_ADVANCED / ENGAGEMENT_REGRESSED', () => {
    expect(handoffNotificationTargets('STAGE_ADVANCED').engagementRoles).toHaveLength(0);
    expect(handoffNotificationTargets('ENGAGEMENT_REGRESSED').engagementRoles).toHaveLength(0);
  });
});

describe('handoffMessageFor', () => {
  it('produces a human sentence for each handoff', () => {
    expect(handoffMessageFor('HANDOFF_TO_IMPLEMENTATION', 'PROPOSED', 'CONTRACTED')).toContain('contracted');
    expect(handoffMessageFor('HANDOFF_TO_CLOSEOUT', 'GOLIVE', 'CLOSEOUT')).toContain('handoff');
    expect(handoffMessageFor('HANDOFF_TO_SLA', 'CLOSEOUT', 'SLA_ACTIVE')).toContain('SLA');
    expect(handoffMessageFor('ENGAGEMENT_REGRESSED', 'BUILD', 'SCOPING')).toContain('backwards');
    expect(handoffMessageFor('STAGE_ADVANCED', 'BUILD', 'UAT')).toContain('Stage advanced');
  });
});
