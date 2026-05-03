import { describe, it, expect } from 'vitest';
import { generateLessonsLearned } from '../../../src/services/generators/lessonsLearnedGenerator.js';

describe('Pack Y — lessonsLearnedGenerator: structure', () => {
  it('emits the canonical 5 sections', () => {
    const out = generateLessonsLearned({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Retro Logistics');
    expect(out.markdown).toContain('## 2. Retro Agenda');
    expect(out.markdown).toContain('## 3. Lessons-Learned Register');
    expect(out.markdown).toContain('## 4. Closure & Next Steps');
    expect(out.markdown).toContain('## 5. Cross-References');
  });

  it('emits the 4-column register table header', () => {
    const out = generateLessonsLearned({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| Theme | What happened | So what (impact) | Now what (action) |');
  });
});

describe('Pack Y — lessonsLearnedGenerator: agenda format branching', () => {
  it('half-day workshop renders the half-day agenda (10+ time-coded lines)', () => {
    const out = generateLessonsLearned({
      clientName: 'Atlas',
      retroFormat: 'Half-day workshop with project + business + ops',
    });
    expect(out.markdown).toContain('Half-day workshop');
    expect(out.markdown).toContain('00:00 — Welcome');
    expect(out.markdown).toContain('00:40 — Theme-by-theme breakouts');
    expect(out.markdown).toContain('04:30 — End');
  });

  it('default (omitted format) renders half-day workshop agenda', () => {
    const out = generateLessonsLearned({ clientName: 'Atlas' });
    // Default format string says "Half-day workshop ... (default)" so half-day path fires.
    expect(out.markdown).toContain('Half-day workshop');
  });

  it('non-half-day format renders the 90-minute compact agenda', () => {
    const out = generateLessonsLearned({
      clientName: 'Atlas',
      retroFormat: 'Quick 90-minute virtual session',
    });
    expect(out.markdown).toContain('90-minute compact retro');
    expect(out.markdown).toContain('00:00 — Welcome + objectives (5 min)');
    expect(out.markdown).toContain('01:30 — End');
    expect(out.markdown).not.toContain('04:30 — End');
  });
});

describe('Pack Y — lessonsLearnedGenerator: canonical theme rows', () => {
  it('always renders all 7 canonical themes when no seed provided', () => {
    const out = generateLessonsLearned({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| Scope discipline |');
    expect(out.markdown).toContain('| Change management |');
    expect(out.markdown).toContain('| Data quality |');
    expect(out.markdown).toContain('| Integration testing |');
    expect(out.markdown).toContain('| Sponsor engagement |');
    expect(out.markdown).toContain('| Training depth |');
    expect(out.markdown).toContain('| Hypercare staffing |');
  });

  it('canonical theme rows have ASSIGN placeholders for what/so-what/now-what', () => {
    const out = generateLessonsLearned({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN — what happened]_');
    expect(out.markdown).toContain('_[ASSIGN — so what?]_');
    expect(out.markdown).toContain('_[ASSIGN — now what?]_');
  });
});

describe('Pack Y — lessonsLearnedGenerator: pre-seeded entries', () => {
  it('renders pre-seeded lessons above canonical defaults', () => {
    const out = generateLessonsLearned({
      clientName: 'Atlas',
      lessonsLearnedSeed:
        'Scope discipline | Approval delegation deferred late | Reduced finance approval bottleneck risk | Bring delegation forward in phase-two estimating',
    });
    expect(out.markdown).toContain(
      '| Scope discipline | Approval delegation deferred late | Reduced finance approval bottleneck risk | Bring delegation forward in phase-two estimating |',
    );
  });

  it('canonical theme rows DEDUP against seeded themes (case-insensitive)', () => {
    const out = generateLessonsLearned({
      clientName: 'Atlas',
      lessonsLearnedSeed:
        'scope discipline | seeded what | seeded so-what | seeded now-what',
    });
    // Seeded version renders with full content.
    expect(out.markdown).toContain('| scope discipline | seeded what | seeded so-what | seeded now-what |');
    // Canonical "Scope discipline" placeholder row does NOT also render.
    const placeholderCount = (
      out.markdown.match(/\| Scope discipline \| _\[ASSIGN — what happened\]_/g) ?? []
    ).length;
    expect(placeholderCount).toBe(0);
  });

  it('canonical themes NOT covered by seed still render', () => {
    const out = generateLessonsLearned({
      clientName: 'Atlas',
      lessonsLearnedSeed:
        'Scope discipline | A | B | C',
    });
    // Other 6 canonical themes still render their placeholder rows.
    expect(out.markdown).toContain('| Change management |');
    expect(out.markdown).toContain('| Data quality |');
    expect(out.markdown).toContain('| Hypercare staffing |');
  });

  it('multiple seeded entries all render', () => {
    const out = generateLessonsLearned({
      clientName: 'Atlas',
      lessonsLearnedSeed:
        'Theme A | What A | So-what A | Now-what A\n' +
        'Theme B | What B | So-what B | Now-what B',
    });
    expect(out.markdown).toContain('| Theme A | What A | So-what A | Now-what A |');
    expect(out.markdown).toContain('| Theme B | What B | So-what B | Now-what B |');
  });

  it('graceful handling of 2-segment seeded lines (no soWhat / nowWhat)', () => {
    const out = generateLessonsLearned({
      clientName: 'Atlas',
      lessonsLearnedSeed: 'Custom Theme | What happened only',
    });
    expect(out.markdown).toContain('| Custom Theme | What happened only | _[ASSIGN — so what?]_ | _[ASSIGN — now what?]_ |');
  });
});

describe('Pack Y — lessonsLearnedGenerator: retro logistics', () => {
  it('retro date renders verbatim when provided', () => {
    const out = generateLessonsLearned({
      clientName: 'Atlas',
      retroDate: 'T+45 — first Friday of month following hypercare exit (2027-01-30)',
    });
    expect(out.markdown).toContain('T+45 — first Friday of month following hypercare exit (2027-01-30)');
  });

  it('falls back to ASSIGN placeholder when retro date missing', () => {
    const out = generateLessonsLearned({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN retro date — typically T+45');
  });

  it('facilitator line uses stabilization owner', () => {
    const out = generateLessonsLearned({
      clientName: 'Atlas',
      stabilizationOwner: 'David Chen (IT Director)',
    });
    expect(out.markdown).toContain('**Facilitator:** David Chen (IT Director)');
  });

  it('falls back to ASSIGN when stabilization owner missing', () => {
    const out = generateLessonsLearned({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN stabilization owner]_');
  });
});

describe('Pack Y — lessonsLearnedGenerator: cross-references', () => {
  it('cross-refs Stabilization_Roadmap + Process_Improvement_Backlog + Continuous_Improvement_Governance', () => {
    const out = generateLessonsLearned({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Stabilization/Stabilization_Roadmap.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Process_Improvement_Backlog.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Continuous_Improvement_Governance.md');
  });

  it('back-refs Hypercare_Plan + Defect_Log_Template', () => {
    const out = generateLessonsLearned({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_Plan.md');
    expect(out.markdown).toContain('Documentation/Defect_Log_Template.md');
  });
});
