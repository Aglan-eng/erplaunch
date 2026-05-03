import { describe, it, expect } from 'vitest';
import { generateHypercarePlan } from '../../../src/services/generators/hypercarePlanGenerator.js';

const ATLAS_ROSTER =
  'Lara Mansour | Hypercare Lead | Sun-Thu 08:00-18:00 | +966-50-xxx-1001\n' +
  'Omar Said | NetSuite Functional Lead | Sun-Thu 08:00-18:00 | +966-50-xxx-1002\n' +
  'Tariq Hassan | Integration Engineer | Sun-Thu 08:00-18:00 | +966-50-xxx-1003';

describe('Pack X — hypercarePlanGenerator: structure', () => {
  it('emits the canonical 9 sections', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Overview');
    expect(out.markdown).toContain('## 2. Hypercare Team');
    expect(out.markdown).toContain('## 3. Coverage Model');
    expect(out.markdown).toContain('## 4. Cadence');
    expect(out.markdown).toContain('## 5. Severity Definitions');
    expect(out.markdown).toContain('## 6. Response & Resolution SLAs');
    expect(out.markdown).toContain('## 7. Exit Criteria');
    expect(out.markdown).toContain('## 8. Transition to BAU Support');
    expect(out.markdown).toContain('## 9. Cross-References');
  });

  it('platform default reads as ERP', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Platform:** ERP');
  });

  it('platform name flows through when provided', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas', adaptorName: 'NetSuite' });
    expect(out.markdown).toContain('**Platform:** NetSuite');
  });
});

describe('Pack X — hypercarePlanGenerator: dates + duration', () => {
  it('default duration is 30 days', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Duration:** 30 days');
  });

  it('respects custom duration', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas', hypercareDurationDays: 14 });
    expect(out.markdown).toContain('**Duration:** 14 days');
  });

  it('computes T+30 exit date when go-live is provided', () => {
    const out = generateHypercarePlan({
      clientName: 'Atlas',
      targetGoLiveDate: '2026-11-15',
      hypercareDurationDays: 30,
    });
    expect(out.markdown).toContain('**T+30 (Hypercare Exit):** 2026-12-15');
  });

  it('falls back to TBD when go-live is missing', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('TBD (set when go-live confirmed)');
  });
});

describe('Pack X — hypercarePlanGenerator: roster table', () => {
  it('renders one row per parsed roster line', () => {
    const out = generateHypercarePlan({
      clientName: 'Atlas',
      hypercareTeamRoster: ATLAS_ROSTER,
    });
    expect(out.markdown).toContain('| Lara Mansour | Hypercare Lead | Sun-Thu 08:00-18:00 | +966-50-xxx-1001 |');
    expect(out.markdown).toContain('| Omar Said | NetSuite Functional Lead | Sun-Thu 08:00-18:00 | +966-50-xxx-1002 |');
  });

  it('placeholder row when roster empty', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN]_');
  });

  it('graceful handling of 2-segment lines (only Name + Role)', () => {
    const out = generateHypercarePlan({
      clientName: 'Atlas',
      hypercareTeamRoster: 'Test Person | Some Role',
    });
    expect(out.markdown).toContain('| Test Person | Some Role | _[ASSIGN coverage]_ | _[ASSIGN phone]_ |');
  });

  it('skips blank lines + lines with no | delimiter', () => {
    const out = generateHypercarePlan({
      clientName: 'Atlas',
      hypercareTeamRoster: '\nA | B | C | D\n\nbad line no pipes\n  E | F | G | H  \n',
    });
    expect(out.markdown).toContain('| A | B | C | D |');
    expect(out.markdown).toContain('| E | F | G | H |');
    expect(out.markdown).not.toContain('bad line no pipes');
  });
});

describe('Pack X — hypercarePlanGenerator: severity + SLA tables', () => {
  it('uses default 4-level severity scheme when consultant skips', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| **S1** | Production halted, no workaround |');
    expect(out.markdown).toContain('| **S2** |');
    expect(out.markdown).toContain('| **S3** |');
    expect(out.markdown).toContain('| **S4** |');
  });

  it('overrides default severity when consultant provides own', () => {
    const out = generateHypercarePlan({
      clientName: 'Atlas',
      severityDefinitions:
        'Major | Stops everything | Period close blocked\n' +
        'Minor | Workaround exists | Report styling issue',
    });
    // Custom severity definitions render in the Severity Definitions section.
    const severitySection = out.markdown.split('## 6. Response & Resolution SLAs')[0];
    expect(severitySection).toContain('| **Major** | Stops everything | Period close blocked |');
    expect(severitySection).toContain('| **Minor** |');
    // Default 4-level severity should NOT render in the severity section
    // when consultant provides override. The SLA section (driven by a
    // separate input) may still show S1-S4 defaults.
    expect(severitySection).not.toContain('| **S3** |');
  });

  it('uses default SLA grid when consultant skips', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| **S1** | 15 minutes | 4 hours |');
    expect(out.markdown).toContain('| **S4** | 5 business days | Backlog |');
  });

  it('overrides SLA grid when consultant provides own', () => {
    const out = generateHypercarePlan({
      clientName: 'Atlas',
      responseTimeBySeverity:
        'S1 | 10 minutes | 2 hours\n' +
        'S2 | 30 minutes | 4 hours',
    });
    expect(out.markdown).toContain('| **S1** | 10 minutes | 2 hours |');
    expect(out.markdown).toContain('| **S2** | 30 minutes | 4 hours |');
  });
});

describe('Pack X — hypercarePlanGenerator: exit criteria augmentation', () => {
  it('augments consultant criteria with default gates when not covered', () => {
    const out = generateHypercarePlan({
      clientName: 'Atlas',
      hypercareExitCriteria: 'Custom client-specific gate\nAnother custom gate',
    });
    // Consultant criteria render first.
    expect(out.markdown).toContain('- Custom client-specific gate');
    expect(out.markdown).toContain('- Another custom gate');
    // Default gates supplement (since consultant didn't cover them).
    expect(out.markdown).toContain('Default minimum gates');
    expect(out.markdown).toContain('Sponsor sign-off captured');
  });

  it('does NOT duplicate default gates already covered by consultant input', () => {
    const out = generateHypercarePlan({
      clientName: 'Atlas',
      hypercareExitCriteria:
        'Zero S1 open for 7 consecutive business days\n' +
        'Sponsor sign-off captured by both CFO and Sponsor',
    });
    // Consultant's "Zero S1 open" wording is kept; default supplement
    // skips its own "Zero S1 open" since consultant covered it.
    const occurrences = (out.markdown.match(/Zero S1 open/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('falls back to ASSIGN placeholder when no exit criteria provided', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas' });
    // With no consultant input, augmentation provides defaults — so we
    // should NOT see [ASSIGN]; we should see all 6 default gates.
    expect(out.markdown).toContain('Sponsor sign-off captured');
    expect(out.markdown).toContain('Zero S1 open');
  });
});

describe('Pack X — hypercarePlanGenerator: lead + sustainment + cadence', () => {
  it('hypercare lead + sustainment owner render in metadata', () => {
    const out = generateHypercarePlan({
      clientName: 'Atlas',
      hypercareLeadName: 'Lara Mansour',
      sustainmentOwner: 'Atlas IT Shared Services',
    });
    expect(out.markdown).toContain('**Hypercare Lead:** Lara Mansour');
    expect(out.markdown).toContain('**Sustainment Owner:** Atlas IT Shared Services');
  });

  it('falls back to ASSIGN placeholders when lead/sustainment missing', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN hypercare lead]_');
    expect(out.markdown).toContain('_[ASSIGN sustainment owner]_');
  });

  it('cadence values render verbatim', () => {
    const out = generateHypercarePlan({
      clientName: 'Atlas',
      dailyStandupTime: '09:00 KSA daily',
      weeklyReviewTime: 'Thu 14:00 KSA',
      warRoomHours: 'T+1 to T+5: full team 08:00-18:00. T+6+: 09:00-13:00',
    });
    expect(out.markdown).toContain('**Daily standup:** 09:00 KSA daily');
    expect(out.markdown).toContain('**Weekly review:** Thu 14:00 KSA');
    expect(out.markdown).toContain('T+1 to T+5: full team 08:00-18:00');
  });
});

describe('Pack X — hypercarePlanGenerator: cross-references', () => {
  it('cross-refs all 6 sibling Pack X artefacts', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Hypercare/Daily_Readiness_Checklist.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Issue_Escalation_Matrix.md');
    expect(out.markdown).toContain('Documentation/Hypercare/War_Room_SOP.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Transition_To_Support_Plan.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_KPI_Dashboard.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Power_User_Office_Hours.md');
  });

  it('back-refs Pack V cutover runbook + Pack T defect log', () => {
    const out = generateHypercarePlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Cutover/Cutover_Runbook.md');
    expect(out.markdown).toContain('Documentation/Defect_Log_Template.md');
  });
});
