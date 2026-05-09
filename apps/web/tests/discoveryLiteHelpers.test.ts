/**
 * Phase 46.8.1 — pure tests for the Discovery Lite client helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  isDiscoveryLiteAnswerEmpty,
  isDiscoveryLiteAnswerValid,
  discoveryLiteProgressPct,
  type DiscoveryLiteQuestion,
} from '../src/lib/api';

const TEXT_Q: DiscoveryLiteQuestion = {
  id: 'name',
  label: 'Name',
  type: 'text',
};
const SELECT_Q: DiscoveryLiteQuestion = {
  id: 'size',
  label: 'Size',
  type: 'single_select',
  required: true,
  options: [
    { value: 's', label: 'Small' },
    { value: 'm', label: 'Medium' },
  ],
};
const MULTI_Q: DiscoveryLiteQuestion = {
  id: 'pains',
  label: 'Pains',
  type: 'multi_select',
  required: true,
  options: [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ],
};
const NUMBER_Q: DiscoveryLiteQuestion = {
  id: 'count',
  label: 'How many',
  type: 'number',
  min: 1,
  max: 100,
};

describe('isDiscoveryLiteAnswerEmpty', () => {
  it('treats null/undefined/empty string/empty array as empty', () => {
    expect(isDiscoveryLiteAnswerEmpty(TEXT_Q, null)).toBe(true);
    expect(isDiscoveryLiteAnswerEmpty(TEXT_Q, undefined)).toBe(true);
    expect(isDiscoveryLiteAnswerEmpty(TEXT_Q, '')).toBe(true);
    expect(isDiscoveryLiteAnswerEmpty(MULTI_Q, [])).toBe(true);
  });

  it('treats whitespace-only strings as empty', () => {
    expect(isDiscoveryLiteAnswerEmpty(TEXT_Q, '   ')).toBe(true);
  });

  it('treats NaN/Infinity numbers as empty for number questions', () => {
    expect(isDiscoveryLiteAnswerEmpty(NUMBER_Q, Number.NaN)).toBe(true);
  });

  it('non-empty strings + filled arrays + finite numbers are not empty', () => {
    expect(isDiscoveryLiteAnswerEmpty(TEXT_Q, 'foo')).toBe(false);
    expect(isDiscoveryLiteAnswerEmpty(MULTI_Q, ['a'])).toBe(false);
    expect(isDiscoveryLiteAnswerEmpty(NUMBER_Q, 5)).toBe(false);
  });
});

describe('isDiscoveryLiteAnswerValid', () => {
  it('rejects empty answers', () => {
    expect(isDiscoveryLiteAnswerValid(SELECT_Q, '')).toBe(false);
  });
  it('accepts valid select option values', () => {
    expect(isDiscoveryLiteAnswerValid(SELECT_Q, 's')).toBe(true);
  });
  it('rejects select values not in the option list', () => {
    expect(isDiscoveryLiteAnswerValid(SELECT_Q, 'huge')).toBe(false);
  });
  it('multi_select: rejects an unknown value in the array', () => {
    expect(isDiscoveryLiteAnswerValid(MULTI_Q, ['a', 'unknown'])).toBe(false);
  });
  it('multi_select: accepts a fully-valid array', () => {
    expect(isDiscoveryLiteAnswerValid(MULTI_Q, ['a', 'b'])).toBe(true);
  });
  it('adaptor-aware select accepts any string', () => {
    const aware: DiscoveryLiteQuestion = {
      id: 'm',
      label: 'Modules',
      type: 'multi_select',
      adaptorAware: true,
      options: [],
    };
    expect(isDiscoveryLiteAnswerValid(aware, ['anything', 'goes'])).toBe(true);
  });
  it('number: enforces min/max bounds', () => {
    expect(isDiscoveryLiteAnswerValid(NUMBER_Q, 0)).toBe(false);
    expect(isDiscoveryLiteAnswerValid(NUMBER_Q, 1)).toBe(true);
    expect(isDiscoveryLiteAnswerValid(NUMBER_Q, 200)).toBe(false);
  });
});

describe('discoveryLiteProgressPct', () => {
  it('returns 0 when nothing answered', () => {
    expect(discoveryLiteProgressPct([TEXT_Q, SELECT_Q, NUMBER_Q], {})).toBe(0);
  });

  it('returns 100 when every question has a valid answer', () => {
    const ans = { name: 'Acme', size: 's', count: 5 };
    expect(discoveryLiteProgressPct([TEXT_Q, SELECT_Q, NUMBER_Q], ans)).toBe(100);
  });

  it('rounds to whole percent', () => {
    // 1 of 3 = 33.33% → 33
    expect(discoveryLiteProgressPct([TEXT_Q, SELECT_Q, NUMBER_Q], { name: 'Acme' })).toBe(33);
  });

  it('counts only valid answers — invalid select option doesn\'t advance the bar', () => {
    expect(
      discoveryLiteProgressPct([TEXT_Q, SELECT_Q], { name: 'Acme', size: 'huge' }),
    ).toBe(50);
  });

  it('returns 0 for an empty question list (no division by zero)', () => {
    expect(discoveryLiteProgressPct([], {})).toBe(0);
  });
});
