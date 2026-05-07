import { describe, it, expect } from 'vitest';
import {
  shouldShowOnboarding,
  isOnboardingDismissed,
  dismissOnboarding,
  resetOnboardingDismissal,
  computeStepCompletion,
  type OnboardingInputs,
} from '../src/lib/onboardingHelpers';

function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? (m.get(k) ?? null) : null),
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, v); },
  };
}

// ─── shouldShowOnboarding ────────────────────────────────────────────────────

describe('shouldShowOnboarding', () => {
  function inputs(overrides: Partial<OnboardingInputs> = {}): OnboardingInputs {
    return {
      engagementCount: 0,
      dismissed: false,
      ...overrides,
    };
  }

  it('shows the wizard when there are zero engagements and not dismissed', () => {
    expect(shouldShowOnboarding(inputs())).toBe(true);
  });

  it('hides when at least one engagement exists', () => {
    expect(shouldShowOnboarding(inputs({ engagementCount: 1 }))).toBe(false);
    expect(shouldShowOnboarding(inputs({ engagementCount: 5 }))).toBe(false);
  });

  it('hides when explicitly dismissed', () => {
    expect(shouldShowOnboarding(inputs({ dismissed: true }))).toBe(false);
  });

  it('hides when both dismissed and engagement exists (defence in depth)', () => {
    expect(shouldShowOnboarding(inputs({ engagementCount: 2, dismissed: true }))).toBe(false);
  });
});

// ─── isOnboardingDismissed / dismissOnboarding / resetOnboardingDismissal ────

describe('isOnboardingDismissed', () => {
  it('returns false when storage is missing', () => {
    expect(isOnboardingDismissed('user-1', undefined)).toBe(false);
  });

  it('returns false when nothing has been stored', () => {
    expect(isOnboardingDismissed('user-1', makeStorage())).toBe(false);
  });

  it('returns true once the user has dismissed', () => {
    const s = makeStorage();
    dismissOnboarding('user-1', s);
    expect(isOnboardingDismissed('user-1', s)).toBe(true);
  });

  it('keeps dismissals scoped per user — user-2 stays unaffected', () => {
    const s = makeStorage();
    dismissOnboarding('user-1', s);
    expect(isOnboardingDismissed('user-2', s)).toBe(false);
  });

  it('resetOnboardingDismissal clears the stored flag for the user', () => {
    const s = makeStorage();
    dismissOnboarding('user-1', s);
    resetOnboardingDismissal('user-1', s);
    expect(isOnboardingDismissed('user-1', s)).toBe(false);
  });

  it('dismiss is a no-op when storage is missing', () => {
    expect(() => dismissOnboarding('user-1', undefined)).not.toThrow();
  });
});

// ─── computeStepCompletion ───────────────────────────────────────────────────

describe('computeStepCompletion', () => {
  it('marks step 1 complete when an adaptor has been chosen (preferenceSet flag)', () => {
    const r = computeStepCompletion({
      adaptorPreferenceSet: true,
      engagementCount: 0,
      hasInvitedClient: false,
      hasOpenedWizard: false,
    });
    expect(r.step1).toBe(true);
    expect(r.step2).toBe(false);
  });

  it('marks step 2 complete when at least one engagement exists', () => {
    const r = computeStepCompletion({
      adaptorPreferenceSet: false,
      engagementCount: 1,
      hasInvitedClient: false,
      hasOpenedWizard: false,
    });
    expect(r.step2).toBe(true);
    // Creating an engagement implies the consultant picked an adaptor.
    expect(r.step1).toBe(true);
  });

  it('marks step 3 complete only after a client invite has been sent', () => {
    const r = computeStepCompletion({
      adaptorPreferenceSet: true,
      engagementCount: 1,
      hasInvitedClient: true,
      hasOpenedWizard: false,
    });
    expect(r.step3).toBe(true);
    expect(r.step4).toBe(false);
  });

  it('marks step 4 complete when the wizard has been opened', () => {
    const r = computeStepCompletion({
      adaptorPreferenceSet: true,
      engagementCount: 1,
      hasInvitedClient: true,
      hasOpenedWizard: true,
    });
    expect(r.step4).toBe(true);
  });

  it('all steps false on a fresh firm', () => {
    const r = computeStepCompletion({
      adaptorPreferenceSet: false,
      engagementCount: 0,
      hasInvitedClient: false,
      hasOpenedWizard: false,
    });
    expect(r).toEqual({
      step1: false, step2: false, step3: false, step4: false, completedCount: 0,
    });
  });

  it('counts overall progress as 0..4', () => {
    const fresh = computeStepCompletion({
      adaptorPreferenceSet: false,
      engagementCount: 0,
      hasInvitedClient: false,
      hasOpenedWizard: false,
    });
    expect(fresh.completedCount).toBe(0);

    const halfway = computeStepCompletion({
      adaptorPreferenceSet: true,
      engagementCount: 1,
      hasInvitedClient: false,
      hasOpenedWizard: false,
    });
    expect(halfway.completedCount).toBe(2);

    const done = computeStepCompletion({
      adaptorPreferenceSet: true,
      engagementCount: 1,
      hasInvitedClient: true,
      hasOpenedWizard: true,
    });
    expect(done.completedCount).toBe(4);
  });
});
