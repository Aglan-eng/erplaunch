import { describe, it, expect } from 'vitest';
import {
  emptyStateMessage,
  emptyStateTitle,
  shouldDisableGenerate,
} from '../src/components/wizard/aiAdvisorEmptyState';

describe('emptyStateMessage', () => {
  it('returns the no-answers prompt when sectionHasAnswers is false', () => {
    expect(emptyStateMessage(false)).toBe('Answer at least one question to get advice');
  });

  it('returns the loading prompt when sectionHasAnswers is true', () => {
    expect(emptyStateMessage(true)).toMatch(/auto-generate|generate advice/i);
  });
});

describe('emptyStateTitle', () => {
  it('returns "No answers yet" when there are no answers', () => {
    expect(emptyStateTitle(false)).toBe('No answers yet');
  });

  it('returns "Preparing advice…" when answers exist', () => {
    expect(emptyStateTitle(true)).toMatch(/preparing/i);
  });
});

describe('shouldDisableGenerate', () => {
  it('disables when section has no answers', () => {
    expect(shouldDisableGenerate({ sectionHasAnswers: false, isGenerating: false })).toBe(true);
  });

  it('disables when a request is already in flight', () => {
    expect(shouldDisableGenerate({ sectionHasAnswers: true, isGenerating: true })).toBe(true);
  });

  it('enables when answers exist and no request is in flight', () => {
    expect(shouldDisableGenerate({ sectionHasAnswers: true, isGenerating: false })).toBe(false);
  });

  it('disables on both conditions', () => {
    expect(shouldDisableGenerate({ sectionHasAnswers: false, isGenerating: true })).toBe(true);
  });
});
