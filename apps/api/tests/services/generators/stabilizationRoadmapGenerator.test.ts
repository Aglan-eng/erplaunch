import { describe, it, expect } from 'vitest';
import { generateStabilizationRoadmap } from '../../../src/services/generators/stabilizationRoadmapGenerator.js';

describe('Pack Y — stabilizationRoadmapGenerator: structure', () => {
  it('emits the canonical 6 sections', () => {
    const out = generateStabilizationRoadmap({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Overview');
    expect(out.markdown).toContain('## 2. The Four Phases of Stabilization');
    expect(out.markdown).toContain('## 3. Quarterly Milestones');
    expect(out.markdown).toContain('## 4. Steady-State Governance Body');
    expect(out.markdown).toContain('## 5. Cadence Calendar');
    expect(out.markdown).toContain('## 6. Cross-References');
  });

  it('renders the four phases (Settle / Optimize / Expand / Mature)', () => {
    const out = generateStabilizationRoadmap({ clientName: 'Atlas' });
    expect(out.markdown).toContain('### Phase 1 — Settle');
    expect(out.markdown).toContain('### Phase 2 — Optimize');
    expect(out.markdown).toContain('### Phase 3 — Expand');
    expect(out.markdown).toContain('### Phase 4 — Mature');
  });

  it('platform default reads as ERP', () => {
    const out = generateStabilizationRoadmap({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Platform:** ERP');
  });

  it('platform name flows through when provided', () => {
    const out = generateStabilizationRoadmap({ clientName: 'Atlas', adaptorName: 'NetSuite' });
    expect(out.markdown).toContain('**Platform:** NetSuite');
  });
});

describe('Pack Y — stabilizationRoadmapGenerator: T+ anchors + dates', () => {
  it('renders T+30/T+90/T+180/T+270/T+360 anchors when go-live provided', () => {
    const out = generateStabilizationRoadmap({
      clientName: 'Atlas',
      targetGoLiveDate: '2026-11-15',
    });
    // T+30 = 2026-12-15, T+90 = 2027-02-13, T+180 = 2027-05-14, T+270 = 2027-08-12, T+360 = 2027-11-10
    expect(out.markdown).toContain('T+30 (2026-12-15)');
    expect(out.markdown).toContain('T+90 (2027-02-13)');
    expect(out.markdown).toContain('T+180 (2027-05-14)');
    expect(out.markdown).toContain('T+270 (2027-08-12)');
    expect(out.markdown).toContain('T+360 (2027-11-10)');
  });

  it('falls back to T+N (anchor TBD) when go-live missing', () => {
    const out = generateStabilizationRoadmap({ clientName: 'Atlas' });
    expect(out.markdown).toContain('T+30 (anchor TBD until go-live confirmed)');
    expect(out.markdown).toContain('T+90 (anchor TBD until go-live confirmed)');
  });

  it('Quarterly Milestones table has 5 rows (T+30/90/180/270/360)', () => {
    const out = generateStabilizationRoadmap({ clientName: 'Atlas' });
    const milestoneRows = (out.markdown.match(/^\| T\+\d+/gm) ?? []).length;
    expect(milestoneRows).toBeGreaterThanOrEqual(5);
  });
});

describe('Pack Y — stabilizationRoadmapGenerator: governance committee', () => {
  it('uses default canonical 6-row committee when consultant skips', () => {
    const out = generateStabilizationRoadmap({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| Sustainment Owner |');
    expect(out.markdown).toContain('| Finance lead |');
    expect(out.markdown).toContain('| Operations lead |');
    expect(out.markdown).toContain('| IT lead |');
    expect(out.markdown).toContain('| Power-user representative |');
    expect(out.markdown).toContain('| Vendor account manager |');
  });

  it('parses committee overlay into rows', () => {
    const out = generateStabilizationRoadmap({
      clientName: 'Atlas',
      governanceCommittee:
        'David Chen | Director, Enterprise Systems | IT chair\n' +
        'Helena Reyes | CFO | Finance + sponsor',
    });
    expect(out.markdown).toContain('| David Chen | Director, Enterprise Systems | IT chair |');
    expect(out.markdown).toContain('| Helena Reyes | CFO | Finance + sponsor |');
    // Default committee should NOT appear when overlay provided.
    expect(out.markdown).not.toContain('| Sustainment Owner |');
  });

  it('graceful handling of 2-segment lines (no function column)', () => {
    const out = generateStabilizationRoadmap({
      clientName: 'Atlas',
      governanceCommittee: 'Test Person | Some Role',
    });
    expect(out.markdown).toContain('| Test Person | Some Role | _[ASSIGN function]_ |');
  });

  it('skips blank lines + lines without pipe delimiter', () => {
    const out = generateStabilizationRoadmap({
      clientName: 'Atlas',
      governanceCommittee: '\nA | B | C\n\nbad line no pipes\n  D | E | F  \n',
    });
    expect(out.markdown).toContain('| A | B | C |');
    expect(out.markdown).toContain('| D | E | F |');
    expect(out.markdown).not.toContain('bad line no pipes');
  });
});

describe('Pack Y — stabilizationRoadmapGenerator: stabilization owner + cadence', () => {
  it('stabilization owner renders verbatim in metadata + section 4', () => {
    const out = generateStabilizationRoadmap({
      clientName: 'Atlas',
      stabilizationOwner: 'Atlas IT Shared Services — David Chen',
    });
    expect(out.markdown).toContain('**Stabilization Owner:** Atlas IT Shared Services — David Chen');
    expect(out.markdown).toContain('**Sustainment Owner:** Atlas IT Shared Services — David Chen');
  });

  it('falls back to ASSIGN when owner missing', () => {
    const out = generateStabilizationRoadmap({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN stabilization owner]_');
  });

  it('cadence renders verbatim when provided', () => {
    const out = generateStabilizationRoadmap({
      clientName: 'Atlas',
      decisionCadence: 'Monthly steering, quarterly business review, annual board readout',
    });
    expect(out.markdown).toContain('Monthly steering, quarterly business review, annual board readout');
  });

  it('falls back to default cadence copy when missing', () => {
    const out = generateStabilizationRoadmap({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Monthly steering committee, quarterly business review, annual board readout (default cadence');
  });
});

describe('Pack Y — stabilizationRoadmapGenerator: phase-two scope from overlay', () => {
  it('renders phase-two scope as bulleted milestones', () => {
    const out = generateStabilizationRoadmap({
      clientName: 'Atlas',
      phaseTwoScope:
        'WhatsApp supplier portal | Reduce email volume by ~40% | T+180\n' +
        'Fixed asset module rollout | Replace separate FA spreadsheet | T+270',
    });
    expect(out.markdown).toContain('- **WhatsApp supplier portal** — Reduce email volume by ~40% (target: T+180)');
    expect(out.markdown).toContain('- **Fixed asset module rollout** — Replace separate FA spreadsheet (target: T+270)');
  });

  it('falls back to ASSIGN when phase-two scope is empty', () => {
    const out = generateStabilizationRoadmap({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN — populate `stabilization.backlog.phaseTwoScope`');
  });
});

describe('Pack Y — stabilizationRoadmapGenerator: cross-references', () => {
  it('cross-refs all 6 sibling Pack Y artefacts', () => {
    const out = generateStabilizationRoadmap({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Stabilization/Lessons_Learned_Register.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Benefits_Realization_Tracker.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Process_Improvement_Backlog.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Continuous_Improvement_Governance.md');
    expect(out.markdown).toContain('Documentation/Stabilization/KPI_Evolution_Plan.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Phase_Two_Charter.md');
  });

  it('back-refs Pack X hypercare plan + transition-to-support plan', () => {
    const out = generateStabilizationRoadmap({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_Plan.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Transition_To_Support_Plan.md');
  });
});
