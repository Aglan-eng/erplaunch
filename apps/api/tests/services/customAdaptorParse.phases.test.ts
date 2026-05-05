import { describe, it, expect } from 'vitest';
import {
  extractPhasesFromText,
  normalizePhases,
} from '../../src/services/customAdaptorParse.js';

const JDE_PRIMER = `# JD Edwards EnterpriseOne Implementation Primer

JDE EnterpriseOne is an Oracle ERP suite covering finance, procurement,
manufacturing, and project accounting.

PHASES (5):
1. Define / Discovery — high-level scoping, business process mapping,
   gap analysis with the legacy system.
2. Configure — system configuration, master data setup, custom object
   build.
3. Train — role-based training for super-users and end-users.
4. Test / UAT — rigorous validation of every business process end to end.
5. Go-Live / Refine — final data migration, cutover, and post-go-live
   stabilization.

MODULES:
- General Ledger
- Accounts Payable
- Accounts Receivable
`;

describe('extractPhasesFromText — heuristic phase extraction', () => {
  it('returns the 5 phases from a JDE-primer-shaped document', () => {
    const phases = extractPhasesFromText(JDE_PRIMER);
    expect(phases).toHaveLength(5);
    const names = phases.map((p) => p.label.toLowerCase());
    expect(names[0]).toMatch(/define/);
    expect(names[1]).toMatch(/configure/);
    expect(names[2]).toMatch(/train/);
    expect(names[3]).toMatch(/test/);
    expect(names[4]).toMatch(/go.?live/);
    expect(phases.map((p) => p.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('matches a "Methodology" section header too', () => {
    const text = `# Methodology

1. Plan
2. Build
3. Validate
4. Cutover
`;
    const phases = extractPhasesFromText(text);
    expect(phases.length).toBeGreaterThanOrEqual(4);
    expect(phases[0].label.toLowerCase()).toContain('plan');
  });

  it('matches "Implementation Approach" with bullet-style list', () => {
    const text = `## Implementation Approach

- Discover requirements
- Design solution
- Develop configuration
- Deploy to production
`;
    const phases = extractPhasesFromText(text);
    expect(phases.length).toBeGreaterThanOrEqual(4);
    expect(phases.map((p) => p.label.toLowerCase())[0]).toContain('discover');
  });

  it('returns empty when no phase-like section exists', () => {
    const text = 'Some random product description with no methodology.';
    const phases = extractPhasesFromText(text);
    expect(phases).toEqual([]);
  });

  it('emits sane defaults for trigger and id', () => {
    const phases = extractPhasesFromText(JDE_PRIMER);
    for (const p of phases) {
      expect(p.id).toMatch(/^[a-z0-9_-]+$/);
      expect(p.trigger).toBe('REQUIREMENT');
      expect(typeof p.label).toBe('string');
    }
  });
});

describe('normalizePhases — applies fallback when Claude returns nothing', () => {
  it('passes through a non-empty Claude response untouched', () => {
    const claudePhases = {
      defaultPhases: [
        { id: 'p1', label: 'Phase 1', order: 1, trigger: 'REQUIREMENT' as const },
      ],
    };
    const out = normalizePhases(claudePhases, 'whatever source text');
    expect(out.defaultPhases).toHaveLength(1);
    expect(out.defaultPhases[0].label).toBe('Phase 1');
  });

  it('falls back to text-extraction when Claude returns an empty defaultPhases array', () => {
    const claudePhases = { defaultPhases: [] };
    const out = normalizePhases(claudePhases, JDE_PRIMER);
    expect(out.defaultPhases.length).toBeGreaterThanOrEqual(5);
  });

  it('falls back when Claude returns null phases entirely', () => {
    const out = normalizePhases(null, JDE_PRIMER);
    expect(out.defaultPhases.length).toBeGreaterThanOrEqual(5);
  });

  it('fills in id when Claude omits it', () => {
    const claudePhases = {
      defaultPhases: [
        { label: 'Plan', order: 1 },
        { label: 'Build', order: 2 },
      ],
    };
    const out = normalizePhases(claudePhases, '');
    expect(out.defaultPhases[0].id).toMatch(/plan/i);
    expect(out.defaultPhases[1].id).toMatch(/build/i);
    for (const p of out.defaultPhases) {
      expect(p.trigger).toBe('REQUIREMENT');
    }
  });
});
