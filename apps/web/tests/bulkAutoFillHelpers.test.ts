import { describe, it, expect } from 'vitest';
import {
  toggleSectionSelection,
  selectAllSections,
  clearSectionSelection,
  acceptSuggestion,
  skipSuggestion,
  isSuggestionResolved,
  countUnresolvedSuggestions,
  buildEngagementContextSummary,
  type AutoFillState,
  type SuggestionMap,
} from '../src/components/wizard/bulkAutoFillHelpers';

// ─── toggleSectionSelection ──────────────────────────────────────────────────

describe('toggleSectionSelection', () => {
  it('adds a section that is not selected', () => {
    const next = toggleSectionSelection(new Set(['a']), 'b');
    expect([...next].sort()).toEqual(['a', 'b']);
  });

  it('removes a section that is already selected', () => {
    const next = toggleSectionSelection(new Set(['a', 'b']), 'a');
    expect([...next]).toEqual(['b']);
  });

  it('returns a new Set instance (does not mutate input)', () => {
    const orig = new Set(['a']);
    const next = toggleSectionSelection(orig, 'b');
    expect(next).not.toBe(orig);
    expect([...orig]).toEqual(['a']);
  });
});

// ─── selectAllSections / clearSectionSelection ───────────────────────────────

describe('selectAllSections', () => {
  it('returns a Set containing every key from the input', () => {
    const r = selectAllSections(['a', 'b', 'c']);
    expect([...r].sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty Set for an empty list', () => {
    expect(selectAllSections([])).toEqual(new Set());
  });
});

describe('clearSectionSelection', () => {
  it('returns an empty Set', () => {
    expect(clearSectionSelection()).toEqual(new Set());
  });
});

// ─── acceptSuggestion / skipSuggestion / isSuggestionResolved ────────────────

function makeState(): AutoFillState {
  return {
    accepted: {},
    skipped: {},
  };
}

describe('acceptSuggestion', () => {
  it('records the question id under the section', () => {
    const next = acceptSuggestion(makeState(), 'r2r.entities', 'r2r.entities.multiEntity');
    expect(next.accepted['r2r.entities']).toEqual(new Set(['r2r.entities.multiEntity']));
  });

  it('removes the id from skipped if it was previously skipped', () => {
    let s = makeState();
    s = skipSuggestion(s, 'r2r.entities', 'r2r.entities.multiEntity');
    s = acceptSuggestion(s, 'r2r.entities', 'r2r.entities.multiEntity');
    expect(s.skipped['r2r.entities']?.has('r2r.entities.multiEntity')).toBe(false);
    expect(s.accepted['r2r.entities']?.has('r2r.entities.multiEntity')).toBe(true);
  });

  it('returns a new state object (does not mutate)', () => {
    const orig = makeState();
    const next = acceptSuggestion(orig, 's', 'q');
    expect(next).not.toBe(orig);
    expect(orig.accepted).toEqual({});
  });
});

describe('skipSuggestion', () => {
  it('records the question id as skipped', () => {
    const next = skipSuggestion(makeState(), 'r2r.entities', 'q1');
    expect(next.skipped['r2r.entities']?.has('q1')).toBe(true);
  });

  it('removes the id from accepted if it was previously accepted', () => {
    let s = makeState();
    s = acceptSuggestion(s, 'r2r.entities', 'q1');
    s = skipSuggestion(s, 'r2r.entities', 'q1');
    expect(s.accepted['r2r.entities']?.has('q1')).toBe(false);
    expect(s.skipped['r2r.entities']?.has('q1')).toBe(true);
  });
});

describe('isSuggestionResolved', () => {
  it('is true when accepted', () => {
    const s = acceptSuggestion(makeState(), 's', 'q');
    expect(isSuggestionResolved(s, 's', 'q')).toBe(true);
  });

  it('is true when skipped', () => {
    const s = skipSuggestion(makeState(), 's', 'q');
    expect(isSuggestionResolved(s, 's', 'q')).toBe(true);
  });

  it('is false when neither', () => {
    expect(isSuggestionResolved(makeState(), 's', 'q')).toBe(false);
  });
});

// ─── countUnresolvedSuggestions ──────────────────────────────────────────────

describe('countUnresolvedSuggestions', () => {
  it('returns total number of question ids that are neither accepted nor skipped', () => {
    const suggestions: SuggestionMap = {
      's1': { suggestedAnswers: { q1: 'a', q2: 'b' }, reasoning: {} },
      's2': { suggestedAnswers: { q3: 'c' }, reasoning: {} },
    };
    let s = makeState();
    s = acceptSuggestion(s, 's1', 'q1');
    expect(countUnresolvedSuggestions(suggestions, s)).toBe(2); // q2, q3 still pending
  });

  it('returns 0 when all are resolved', () => {
    const suggestions: SuggestionMap = {
      's1': { suggestedAnswers: { q1: 'a', q2: 'b' }, reasoning: {} },
    };
    let s = makeState();
    s = acceptSuggestion(s, 's1', 'q1');
    s = skipSuggestion(s, 's1', 'q2');
    expect(countUnresolvedSuggestions(suggestions, s)).toBe(0);
  });

  it('returns 0 for empty suggestion map', () => {
    expect(countUnresolvedSuggestions({}, makeState())).toBe(0);
  });
});

// ─── buildEngagementContextSummary ───────────────────────────────────────────

describe('buildEngagementContextSummary', () => {
  it('summarises risks, decisions, and members into compact bullet points', () => {
    const summary = buildEngagementContextSummary({
      risks: [
        { title: 'Data migration timing', severity: 'HIGH' },
        { title: 'GL mapping ambiguity', severity: 'MEDIUM' },
      ],
      decisions: [
        { title: 'Use AVCO for inventory costing' },
      ],
      members: [
        { name: 'Alice', role: 'Project Sponsor' },
        { name: 'Bob', role: 'Finance Lead' },
      ],
    });
    expect(summary).toContain('Risks:');
    expect(summary).toContain('Data migration timing');
    expect(summary).toContain('Decisions:');
    expect(summary).toContain('AVCO');
    expect(summary).toContain('Team:');
    expect(summary).toContain('Alice');
  });

  it('returns an empty string when nothing is available', () => {
    expect(buildEngagementContextSummary({ risks: [], decisions: [], members: [] })).toBe('');
  });

  it('omits sections that have zero entries', () => {
    const summary = buildEngagementContextSummary({
      risks: [{ title: 'GL mapping risk', severity: 'HIGH' }],
      decisions: [],
      members: [],
    });
    expect(summary).toContain('Risks:');
    expect(summary).not.toContain('Decisions:');
    expect(summary).not.toContain('Team:');
  });

  it('truncates long lists to a reasonable size', () => {
    const risks = Array.from({ length: 50 }, (_, i) => ({ title: `Risk ${i}`, severity: 'LOW' }));
    const summary = buildEngagementContextSummary({ risks, decisions: [], members: [] });
    // The summary should NOT contain all 50 — we cap at a sensible limit.
    const matches = summary.match(/Risk \d+/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(15);
  });
});
