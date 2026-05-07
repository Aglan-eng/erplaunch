/**
 * Phase 40.2 — empty-state copy + disabled-button logic for AIAdvisorPanel.
 *
 * Extracted into a pure module so the test suite can pin the
 * "Answer at least one question to get advice" message without
 * standing up @testing-library + an Anthropic mock.
 *
 * Phase 39.4 already gates the auto-fire on sectionHasAnswers; Phase 40.2
 * extends that gate to the manual button so a consultant can't trigger a
 * low-context Claude call by accident. The "Generate Advice" CTA now
 * disables until the section has at least one answer.
 */

interface DisableArgs {
  sectionHasAnswers: boolean;
  isGenerating: boolean;
}

export function shouldDisableGenerate({ sectionHasAnswers, isGenerating }: DisableArgs): boolean {
  if (isGenerating) return true;
  if (!sectionHasAnswers) return true;
  return false;
}

export function emptyStateTitle(sectionHasAnswers: boolean): string {
  return sectionHasAnswers ? 'Preparing advice…' : 'No answers yet';
}

export function emptyStateMessage(sectionHasAnswers: boolean): string {
  if (sectionHasAnswers) {
    return 'AI advice will auto-generate when you enter this section, or click "Generate Advice" to get implementation suggestions now.';
  }
  return 'Answer at least one question to get advice';
}
