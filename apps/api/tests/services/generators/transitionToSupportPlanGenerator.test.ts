import { describe, it, expect } from 'vitest';
import { generateTransitionToSupportPlan } from '../../../src/services/generators/transitionToSupportPlanGenerator.js';

describe('Pack X — transitionToSupportPlanGenerator: structure', () => {
  it('emits the canonical 6 sections', () => {
    const out = generateTransitionToSupportPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Knowledge Transfer Agenda');
    expect(out.markdown).toContain('## 2. Ticket Category Mapping');
    expect(out.markdown).toContain('## 3. Standing Artefacts to Hand Over');
    expect(out.markdown).toContain('## 4. First 30 Days Post-Transition Cadence');
    expect(out.markdown).toContain('## 5. Sign-off');
    expect(out.markdown).toContain('## 6. Cross-References');
  });

  it('lists 5 KT sessions', () => {
    const out = generateTransitionToSupportPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| 1 | Modules covered');
    expect(out.markdown).toContain('| 2 | Custom record + custom field inventory');
    expect(out.markdown).toContain('| 3 | Workflow + script walk-through');
    expect(out.markdown).toContain('| 4 | Integration topology');
    expect(out.markdown).toContain('| 5 | Customisation registry');
  });
});

describe('Pack X — transitionToSupportPlanGenerator: dates + sustainment owner', () => {
  it('computes T+30 transition date when go-live is provided', () => {
    const out = generateTransitionToSupportPlan({
      clientName: 'Atlas',
      targetGoLiveDate: '2026-11-15',
      hypercareDurationDays: 30,
    });
    expect(out.markdown).toContain('**Transition Date:** 2026-12-15');
  });

  it('respects custom hypercare duration', () => {
    const out = generateTransitionToSupportPlan({
      clientName: 'Atlas',
      targetGoLiveDate: '2026-11-15',
      hypercareDurationDays: 14,
    });
    expect(out.markdown).toContain('**Transition Date:** 2026-11-29');
    expect(out.markdown).toContain('(T+14 from go-live)');
  });

  it('falls back to ASSIGN when go-live missing', () => {
    const out = generateTransitionToSupportPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('go-live + 30 days');
  });

  it('sustainment owner renders verbatim in metadata + sign-off (covers harness check)', () => {
    const out = generateTransitionToSupportPlan({
      clientName: 'Atlas',
      sustainmentOwner: 'Atlas IT Shared Services — Saif Al-Otaibi (Director, Enterprise Systems)',
    });
    // Metadata header
    expect(out.markdown).toContain(
      '**Sustainment Owner:** Atlas IT Shared Services — Saif Al-Otaibi (Director, Enterprise Systems)',
    );
    // Sign-off section
    expect(out.markdown).toContain(
      '**Sustainment Owner (receiving):** Atlas IT Shared Services — Saif Al-Otaibi (Director, Enterprise Systems)',
    );
  });

  it('falls back to ASSIGN when sustainment owner missing', () => {
    const out = generateTransitionToSupportPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN sustainment owner]_');
  });
});

describe('Pack X — transitionToSupportPlanGenerator: ticket category mapping', () => {
  it('maps S1-S4 + integration + customisation + tax categories', () => {
    const out = generateTransitionToSupportPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| S1 — Production halted |');
    expect(out.markdown).toContain('| S2 — Major impaired |');
    expect(out.markdown).toContain('| S3 — Minor / single-user |');
    expect(out.markdown).toContain('| S4 — Cosmetic / enhancement |');
    expect(out.markdown).toContain('| Integration retry / failure |');
    expect(out.markdown).toContain('| Custom-record / workflow |');
    expect(out.markdown).toContain('| Tax / financial-reporting |');
  });
});

describe('Pack X — transitionToSupportPlanGenerator: artefact handover + cadence', () => {
  it('lists key handover artefacts', () => {
    const out = generateTransitionToSupportPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Solution Design document');
    expect(out.markdown).toContain('Training Manual');
    expect(out.markdown).toContain('Cutover Runbook');
    expect(out.markdown).toContain('Defect log');
    expect(out.markdown).toContain('Integration runbooks');
    expect(out.markdown).toContain('Customisation registry');
  });

  it('post-transition cadence: weekly → office hours → monthly', () => {
    const out = generateTransitionToSupportPlan({
      clientName: 'Atlas',
      hypercareDurationDays: 30,
    });
    expect(out.markdown).toContain('Weekly check-in (T+30 to T+60)');
    expect(out.markdown).toContain('Office-hours availability (T+30 to T+60)');
    expect(out.markdown).toContain('Reduces to monthly (T+60 onwards)');
  });
});

describe('Pack X — transitionToSupportPlanGenerator: cross-references', () => {
  it('cross-refs sibling Pack X artefacts + Pack U KT_Checklist', () => {
    const out = generateTransitionToSupportPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_Plan.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_KPI_Dashboard.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Issue_Escalation_Matrix.md');
    expect(out.markdown).toContain('Documentation/Hypercare/War_Room_SOP.md');
    expect(out.markdown).toContain('Documentation/KT_Checklist.md');
  });
});
