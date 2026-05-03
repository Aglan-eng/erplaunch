import { describe, it, expect } from 'vitest';
import { generatePhaseTwoCharter } from '../../../src/services/generators/phaseTwoCharterGenerator.js';

describe('Pack Y — phaseTwoCharterGenerator: structure', () => {
  it('emits the canonical 8 sections', () => {
    const out = generatePhaseTwoCharter({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Why a Phase Two Exists');
    expect(out.markdown).toContain('## 2. Vision');
    expect(out.markdown).toContain('## 3. Scope Candidates Ranked by Business Case');
    expect(out.markdown).toContain('## 4. Sequencing Rationale');
    expect(out.markdown).toContain('## 5. Dependencies on Stabilization Milestones');
    expect(out.markdown).toContain('## 6. Suggested Kickoff Window');
    expect(out.markdown).toContain('## 7. Greenlight Decision Gate');
    expect(out.markdown).toContain('## 8. Cross-References');
  });
});

describe('Pack Y — phaseTwoCharterGenerator: T+ anchors', () => {
  it('renders T+180 greenlight anchor when go-live provided', () => {
    const out = generatePhaseTwoCharter({
      clientName: 'Atlas',
      targetGoLiveDate: '2026-11-15',
    });
    expect(out.markdown).toContain('T+180 (2027-05-14)');
    expect(out.markdown).toContain('T+270 (2027-08-12)');
  });

  it('falls back to T+N (anchor TBD) when go-live missing', () => {
    const out = generatePhaseTwoCharter({ clientName: 'Atlas' });
    expect(out.markdown).toContain('T+180 (anchor TBD until go-live confirmed)');
  });
});

describe('Pack Y — phaseTwoCharterGenerator: scope candidates', () => {
  it('uses default canonical 6-row Phase Two seed when overlay empty', () => {
    const out = generatePhaseTwoCharter({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| WhatsApp / Telegram supplier portal integration |');
    expect(out.markdown).toContain('| Advanced revenue recognition deepening |');
    expect(out.markdown).toContain('| Fixed asset module rollout |');
    expect(out.markdown).toContain('| Intercompany automation enhancement |');
    expect(out.markdown).toContain('| Additional entity rollout |');
    expect(out.markdown).toContain('| Mobile dashboards rollout |');
  });

  it('uses overlay rows when phaseTwoScope provided', () => {
    const out = generatePhaseTwoCharter({
      clientName: 'Atlas',
      phaseTwoScope:
        'Custom A | Business case A | T+180\n' +
        'Custom B | Business case B | T+270',
    });
    expect(out.markdown).toContain('| Custom A | Business case A | T+180 | _[ASSIGN effort]_ |');
    expect(out.markdown).toContain('| Custom B | Business case B | T+270 | _[ASSIGN effort]_ |');
    // Default seeds should NOT render when overlay is provided.
    expect(out.markdown).not.toContain('| WhatsApp / Telegram supplier portal integration |');
  });
});

describe('Pack Y — phaseTwoCharterGenerator: deferred features bullet list', () => {
  it('renders deferred-features overlay as bulleted candidates', () => {
    const out = generatePhaseTwoCharter({
      clientName: 'Atlas',
      deferredFeatures:
        'Bank statement auto-reconciliation | Pilot scope | T+90 enhancement\n' +
        'Approval delegation rules | Pilot scope | T+90 enhancement',
    });
    expect(out.markdown).toContain(
      '- **Bank statement auto-reconciliation** — deferred because: Pilot scope — target wave: T+90 enhancement',
    );
    expect(out.markdown).toContain(
      '- **Approval delegation rules** — deferred because: Pilot scope — target wave: T+90 enhancement',
    );
  });

  it('placeholder when deferred-features overlay empty', () => {
    const out = generatePhaseTwoCharter({ clientName: 'Atlas' });
    expect(out.markdown).toContain(
      'Deferred-features overlay is empty — no auto-imported candidates',
    );
  });
});

describe('Pack Y — phaseTwoCharterGenerator: greenlight gate dependencies', () => {
  it('lists all 6 dependencies + sponsor sign-off', () => {
    const out = generatePhaseTwoCharter({ clientName: 'Atlas' });
    expect(out.markdown).toContain('- [ ] Benefits Realization Tracker GREEN on **at least 4 of 6** core metrics');
    expect(out.markdown).toContain('- [ ] Hypercare exit clean');
    expect(out.markdown).toContain('- [ ] Steady-state governance body operational for at least 3 monthly cycles');
    expect(out.markdown).toContain('- [ ] Sponsor still bought in');
    expect(out.markdown).toContain('- [ ] No unresolved critical defects from initial implementation');
    expect(out.markdown).toContain('- [ ] Lessons-learned register signed off');
  });

  it('lists 4 greenlight decision options', () => {
    const out = generatePhaseTwoCharter({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Greenlight all');
    expect(out.markdown).toContain('Greenlight selectively');
    expect(out.markdown).toContain('Defer entirely');
    expect(out.markdown).toContain('Cancel');
  });
});

describe('Pack Y — phaseTwoCharterGenerator: sponsorship + cross-refs', () => {
  it('sponsor proposed = stabilization owner', () => {
    const out = generatePhaseTwoCharter({
      clientName: 'Atlas',
      stabilizationOwner: 'David Chen (IT Director)',
    });
    expect(out.markdown).toContain('**Sponsor (proposed):** David Chen (IT Director)');
  });

  it('cross-refs sibling Pack Y artefacts + Pack X hypercare + KICKOFF', () => {
    const out = generatePhaseTwoCharter({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Stabilization/Stabilization_Roadmap.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Process_Improvement_Backlog.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Benefits_Realization_Tracker.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Lessons_Learned_Register.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Continuous_Improvement_Governance.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_Plan.md');
    expect(out.markdown).toContain('Documentation/Project_Kickoff.md');
  });
});
