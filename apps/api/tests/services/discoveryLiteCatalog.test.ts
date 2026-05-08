/**
 * Phase 46.2 — pure tests for the Discovery Lite catalog.
 */
import { describe, it, expect } from 'vitest';
import {
  DISCOVERY_LITE_QUESTIONS,
  REQUIRED_QUESTION_IDS,
  missingRequiredAnswers,
  validateAnswer,
} from '../../src/services/discoveryLiteCatalog.js';

describe('DISCOVERY_LITE_QUESTIONS catalog', () => {
  it('ships 12-15 questions per the PO spec', () => {
    expect(DISCOVERY_LITE_QUESTIONS.length).toBeGreaterThanOrEqual(12);
    expect(DISCOVERY_LITE_QUESTIONS.length).toBeLessThanOrEqual(15);
  });

  it('every question has a unique id', () => {
    const ids = DISCOVERY_LITE_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every select question has at least 2 options (or is adaptor-aware)', () => {
    for (const q of DISCOVERY_LITE_QUESTIONS) {
      if (q.type === 'single_select' || q.type === 'multi_select') {
        if (q.adaptorAware) continue;
        expect(q.options?.length ?? 0).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('marks at least 4 questions as required so prospects can\'t mark complete with empty form', () => {
    expect(REQUIRED_QUESTION_IDS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('missingRequiredAnswers', () => {
  it('returns every required id when answers blob is empty', () => {
    expect(missingRequiredAnswers({}).sort()).toEqual([...REQUIRED_QUESTION_IDS].sort());
  });

  it('returns nothing when every required answer has a non-empty value', () => {
    const filled: Record<string, unknown> = {};
    for (const id of REQUIRED_QUESTION_IDS) {
      // Pick a placeholder shape per type — single_select strings, multi
      // arrays. We don't care about content here, just non-empty.
      const q = DISCOVERY_LITE_QUESTIONS.find((x) => x.id === id);
      if (q?.type === 'multi_select') filled[id] = ['placeholder'];
      else filled[id] = 'placeholder';
    }
    expect(missingRequiredAnswers(filled)).toEqual([]);
  });

  it('treats empty strings as missing', () => {
    const filled: Record<string, unknown> = {};
    for (const id of REQUIRED_QUESTION_IDS) filled[id] = '';
    expect(missingRequiredAnswers(filled).sort()).toEqual([...REQUIRED_QUESTION_IDS].sort());
  });

  it('treats empty arrays as missing', () => {
    const filled: Record<string, unknown> = {};
    for (const id of REQUIRED_QUESTION_IDS) filled[id] = [];
    // Array-shaped requireds should be flagged; string requireds get the
    // empty-array treated as missing too (caller misshape).
    expect(missingRequiredAnswers(filled).sort()).toEqual([...REQUIRED_QUESTION_IDS].sort());
  });
});

describe('validateAnswer', () => {
  it('accepts valid single-select values', () => {
    expect(validateAnswer('companySize.employees', '26-100')).toBeNull();
  });

  it('rejects single-select values not in the option list', () => {
    expect(validateAnswer('companySize.employees', 'a-million')).toBeTruthy();
  });

  it('accepts a multi-select array of valid values', () => {
    expect(validateAnswer('painPoints', ['reporting-lag', 'forecasting'])).toBeNull();
  });

  it('rejects a multi-select containing an invalid value', () => {
    expect(validateAnswer('painPoints', ['reporting-lag', 'made-up'])).toBeTruthy();
  });

  it('accepts adaptor-aware multi_select values without checking options', () => {
    // modules.interest is adaptorAware — any string array passes.
    expect(validateAnswer('modules.interest', ['gl-ar-ap', 'random-module'])).toBeNull();
  });

  it('enforces number bounds', () => {
    expect(validateAnswer('scope.locations', 0)).toBeTruthy();
    expect(validateAnswer('scope.locations', 1)).toBeNull();
    expect(validateAnswer('scope.locations', 5001)).toBeTruthy();
  });

  it('rejects type mismatches', () => {
    expect(validateAnswer('decisionMaker.name', 42)).toBe('expected string');
    expect(validateAnswer('scope.locations', 'four')).toBe('expected number');
  });

  it('returns null for unknown question ids (caller-side drop)', () => {
    expect(validateAnswer('not.a.real.question', 'foo')).toBeNull();
  });

  it('returns null for null/undefined values (let missingRequiredAnswers flag them)', () => {
    expect(validateAnswer('companySize.employees', null)).toBeNull();
    expect(validateAnswer('companySize.employees', undefined)).toBeNull();
  });
});
