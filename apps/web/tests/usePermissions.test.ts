import { describe, it, expect } from 'vitest';
import { actionAtLeast } from '../src/hooks/usePermissions';

/**
 * Phase 43.5 — pure tests for the action-comparison helper used by
 * usePermissions().can. The hook itself depends on react-query, so
 * the runtime behaviour gets visual coverage via Playwright; this
 * file pins the rank arithmetic.
 */

describe('actionAtLeast', () => {
  it('treats WRITE as >= every action', () => {
    expect(actionAtLeast('WRITE', 'NONE')).toBe(true);
    expect(actionAtLeast('WRITE', 'READ')).toBe(true);
    expect(actionAtLeast('WRITE', 'WRITE')).toBe(true);
  });

  it('treats READ as >= NONE / READ but not WRITE', () => {
    expect(actionAtLeast('READ', 'NONE')).toBe(true);
    expect(actionAtLeast('READ', 'READ')).toBe(true);
    expect(actionAtLeast('READ', 'WRITE')).toBe(false);
  });

  it('treats NONE as only >= NONE', () => {
    expect(actionAtLeast('NONE', 'NONE')).toBe(true);
    expect(actionAtLeast('NONE', 'READ')).toBe(false);
    expect(actionAtLeast('NONE', 'WRITE')).toBe(false);
  });
});
