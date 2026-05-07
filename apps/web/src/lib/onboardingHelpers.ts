/**
 * Phase 41.5 — pure helpers for the first-engagement onboarding wizard.
 *
 * Visibility rules:
 *   - Show when the firm has zero engagements AND the user hasn't
 *     dismissed the wizard.
 *   - Hide when at least one engagement exists (the consultant has
 *     started doing real work, the guidance card just clutters the
 *     dashboard).
 *   - Hide when explicitly dismissed (per-user localStorage flag).
 *
 * Per-step completion is derived from real signals rather than tracked
 * separately, so a consultant who creates an engagement via the
 * existing dashboard flow doesn't see step 2 still flagged "to do".
 *
 * Storage is per-user (one user dismissing doesn't dismiss for their
 * teammates), and the helpers accept an injected `Storage` so the
 * tests can run against a Map-backed shim without jsdom — same
 * pattern as Phase 40.1 and 40.4.
 */

const STORAGE_PREFIX = 'onboardingDismissed';

// ─── Visibility ──────────────────────────────────────────────────────────────

export interface OnboardingInputs {
  engagementCount: number;
  dismissed: boolean;
}

export function shouldShowOnboarding({ engagementCount, dismissed }: OnboardingInputs): boolean {
  if (dismissed) return false;
  return engagementCount === 0;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

function storageKeyFor(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

export function isOnboardingDismissed(userId: string, storage?: Storage): boolean {
  if (!storage) return false;
  return storage.getItem(storageKeyFor(userId)) === '1';
}

export function dismissOnboarding(userId: string, storage?: Storage): void {
  if (!storage) return;
  try {
    storage.setItem(storageKeyFor(userId), '1');
  } catch {
    // QuotaExceededError or private-browsing block — silently no-op,
    // same compromise as the Phase 40.1 banner.
  }
}

export function resetOnboardingDismissal(userId: string, storage?: Storage): void {
  if (!storage) return;
  try {
    storage.removeItem(storageKeyFor(userId));
  } catch {
    /* ignore */
  }
}

// ─── Step completion ─────────────────────────────────────────────────────────

export interface StepCompletionInputs {
  /** True once the consultant has either picked an adaptor on the
   *  custom-adaptors page or created an engagement (which forces an
   *  adaptor choice). Implied by engagementCount > 0. */
  adaptorPreferenceSet: boolean;
  engagementCount: number;
  hasInvitedClient: boolean;
  hasOpenedWizard: boolean;
}

export interface StepCompletion {
  step1: boolean;
  step2: boolean;
  step3: boolean;
  step4: boolean;
  completedCount: number;
}

export function computeStepCompletion(inputs: StepCompletionInputs): StepCompletion {
  // Step 1 — pick an ERP. Implied complete if any engagement exists,
  // since creating an engagement forces an adaptor choice.
  const step1 = inputs.adaptorPreferenceSet || inputs.engagementCount > 0;
  // Step 2 — first client engagement.
  const step2 = inputs.engagementCount > 0;
  // Step 3 — invite the client. Only meaningful after step 2.
  const step3 = step2 && inputs.hasInvitedClient;
  // Step 4 — open the wizard. Only meaningful after step 2.
  const step4 = step2 && inputs.hasOpenedWizard;
  const completedCount = [step1, step2, step3, step4].filter(Boolean).length;
  return { step1, step2, step3, step4, completedCount };
}
