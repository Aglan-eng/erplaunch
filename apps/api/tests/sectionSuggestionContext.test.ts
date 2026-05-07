/**
 * Phase 40.5 — unit coverage for the engagement-context block that
 * `generateSectionSuggestions` folds into Claude's prompt. The full
 * function makes a network call we don't want in unit tests, so we
 * import the internal `__testing.buildContextBlock` and pin its output.
 */
import { describe, it, expect } from 'vitest';
import { __testing } from '../src/services/aiProfileGenerator.js';

const { buildContextBlock } = __testing;

describe('buildContextBlock', () => {
  it('returns an empty string when no context is provided', () => {
    expect(buildContextBlock(undefined)).toBe('');
    expect(buildContextBlock({})).toBe('');
    expect(buildContextBlock({ risks: [], decisions: [], members: [] })).toBe('');
  });

  it('renders risks under a labelled heading', () => {
    const out = buildContextBlock({
      risks: [{ title: 'GL mapping ambiguity', severity: 'HIGH' }],
    });
    expect(out).toContain('Known risks on this engagement:');
    expect(out).toContain('GL mapping ambiguity');
    expect(out).toContain('[HIGH]');
  });

  it('renders decisions under a labelled heading', () => {
    const out = buildContextBlock({
      decisions: [{ title: 'Use AVCO for inventory costing' }],
    });
    expect(out).toContain('Decisions already taken:');
    expect(out).toContain('AVCO');
  });

  it('renders members with their role', () => {
    const out = buildContextBlock({
      members: [{ name: 'Alice', role: 'Project Sponsor' }],
    });
    expect(out).toContain('Project team:');
    expect(out).toContain('Alice (Project Sponsor)');
  });

  it('combines all three categories with blank-line separators', () => {
    const out = buildContextBlock({
      risks: [{ title: 'r1' }],
      decisions: [{ title: 'd1' }],
      members: [{ name: 'm1', role: 'r' }],
    });
    expect(out).toContain('Known risks on this engagement:');
    expect(out).toContain('Decisions already taken:');
    expect(out).toContain('Project team:');
  });

  it('truncates long lists at 10 items per category', () => {
    const risks = Array.from({ length: 30 }, (_, i) => ({ title: `Risk ${i}` }));
    const out = buildContextBlock({ risks });
    const matches = out.match(/Risk \d+/g) ?? [];
    expect(matches.length).toBe(10);
  });

  it('omits a category that has zero entries', () => {
    const out = buildContextBlock({
      risks: [{ title: 'r1' }],
      decisions: [],
      members: [],
    });
    expect(out).toContain('Known risks');
    expect(out).not.toContain('Decisions already taken');
    expect(out).not.toContain('Project team');
  });
});
