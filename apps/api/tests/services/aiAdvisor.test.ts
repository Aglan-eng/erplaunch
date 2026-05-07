import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateAIAdvice, computeInputHash } from '../../src/services/aiAdvisor.js';

const ORIGINAL_KEY = process.env.AI_API_KEY;

beforeEach(() => {
  delete process.env.AI_API_KEY;
});

afterEach(() => {
  if (ORIGINAL_KEY !== undefined) process.env.AI_API_KEY = ORIGINAL_KEY;
  else delete process.env.AI_API_KEY;
});

describe('computeInputHash', () => {
  const baseInput = {
    sectionKey: 'r2r.entities',
    answers: { 'r2r.entities.multiEntity': true, 'r2r.entities.entityCount': 3 },
    comment: 'Discussed multi-entity setup with client.',
    license: { edition: 'MID_MARKET' as const, modules: ['ONEWORLD'] },
    conflicts: [],
  };

  it('is stable across runs for the same input', () => {
    const a = computeInputHash(baseInput);
    const b = computeInputHash(baseInput);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs when answers change', () => {
    const a = computeInputHash(baseInput);
    const b = computeInputHash({ ...baseInput, answers: { 'r2r.entities.multiEntity': false } });
    expect(a).not.toBe(b);
  });

  it('differs when the comment changes', () => {
    const a = computeInputHash(baseInput);
    const b = computeInputHash({ ...baseInput, comment: 'Different note' });
    expect(a).not.toBe(b);
  });

  it('differs when conflicts change', () => {
    const a = computeInputHash(baseInput);
    const b = computeInputHash({
      ...baseInput,
      conflicts: [{ message: 'OneWorld required', severity: 'BLOCK', resolution: 'Add module' }],
    });
    expect(a).not.toBe(b);
  });

  it('does NOT depend on platform context (advice context, not input)', () => {
    // platform context is used to phrase the prompt but doesn't change what
    // the user "answered" — caching off it would re-run advice every time
    // an adaptor metadata refresh happens. Hash should be stable.
    const a = computeInputHash(baseInput);
    const withPlatform = computeInputHash({
      ...baseInput,
      platform: { id: 'netsuite', name: 'NetSuite', vendor: 'Oracle', sectionLabel: 'Entities' },
    });
    expect(a).toBe(withPlatform);
  });
});

describe('generateAIAdvice — heuristic fallback (no AI_API_KEY)', () => {
  it('returns a well-formed AIAdviceResult shape', async () => {
    const result = await generateAIAdvice({
      sectionKey: 'r2r.entities',
      answers: { 'r2r.entities.multiEntity': true },
      comment: '',
      license: { edition: 'MID_MARKET', modules: [] },
      conflicts: [],
    });
    expect(result).toHaveProperty('suggestions');
    expect(result).toHaveProperty('consultantInstructions');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('relatedKBArticles');
    expect(Array.isArray(result.suggestions)).toBe(true);
  });

  it('always emits the universal "document configuration decisions" suggestion', async () => {
    const result = await generateAIAdvice({
      sectionKey: 'mfg.bom',
      answers: {},
      comment: '',
      license: { edition: 'MID_MARKET', modules: [] },
      conflicts: [],
    });
    const titles = result.suggestions.map((s) => s.title);
    expect(titles.some((t) => t.toLowerCase().includes('document'))).toBe(true);
  });

  it('produces a OneWorld warning when multi-entity is true but ONEWORLD module is missing', async () => {
    const result = await generateAIAdvice({
      sectionKey: 'r2r.entities',
      answers: { 'r2r.entities.multiEntity': true },
      comment: '',
      license: { edition: 'MID_MARKET', modules: [] },
      conflicts: [],
    });
    expect(result.warnings.some((w) => w.toLowerCase().includes('oneworld'))).toBe(true);
  });

  it('skips the OneWorld warning when ONEWORLD is provisioned', async () => {
    const result = await generateAIAdvice({
      sectionKey: 'r2r.entities',
      answers: { 'r2r.entities.multiEntity': true },
      comment: '',
      license: { edition: 'ONEWORLD', modules: ['ONEWORLD'] },
      conflicts: [],
    });
    expect(result.warnings.some((w) => w.toLowerCase().includes('oneworld is not provisioned'))).toBe(false);
  });

  it('escalates BLOCK conflicts into warnings', async () => {
    const result = await generateAIAdvice({
      sectionKey: 'r2r.entities',
      answers: {},
      comment: '',
      license: { edition: 'MID_MARKET', modules: [] },
      conflicts: [
        { message: 'Cross-currency conflict', severity: 'BLOCK', resolution: 'Enable Multi-Currency' },
      ],
    });
    expect(result.warnings.some((w) => w.includes('Cross-currency conflict'))).toBe(true);
  });

  it('emits a multi-currency setup instruction when currencies.isMultiCurrency is true', async () => {
    const result = await generateAIAdvice({
      sectionKey: 'r2r.currencies',
      answers: { 'r2r.currencies.isMultiCurrency': true },
      comment: '',
      license: { edition: 'MID_MARKET', modules: [] },
      conflicts: [],
    });
    const text = result.consultantInstructions.map((i) => i.instruction).join(' | ').toLowerCase();
    expect(text).toContain('multi-currency');
  });
});
