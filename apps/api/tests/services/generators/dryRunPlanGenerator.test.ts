import { describe, it, expect } from 'vitest';
import { generateDryRunPlan } from '../../../src/services/generators/dryRunPlanGenerator.js';

describe('Pack V — dryRunPlanGenerator: structure', () => {
  it('emits the canonical 5 sections', () => {
    const out = generateDryRunPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Why Dry Run');
    expect(out.markdown).toContain('## 2. Dry Run Schedule');
    expect(out.markdown).toContain('## 3. Dry Run Pass-To-Production Checklist');
    expect(out.markdown).toContain('## 4. What Counts as Production-Ready');
    expect(out.markdown).toContain('## 5. Cross-References');
  });

  it('defaults to 3 dry runs when count omitted + no schedule', () => {
    const out = generateDryRunPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Dry Run Count:** 3');
    expect(out.markdown).toContain('### Dry Run 1:');
    expect(out.markdown).toContain('### Dry Run 2:');
    expect(out.markdown).toContain('### Dry Run 3:');
  });

  it('respects custom dryRunCount', () => {
    const out = generateDryRunPlan({ clientName: 'Atlas', dryRunCount: 2 });
    expect(out.markdown).toContain('**Dry Run Count:** 2');
    expect(out.markdown).toContain('### Dry Run 1:');
    expect(out.markdown).toContain('### Dry Run 2:');
    expect(out.markdown).not.toContain('### Dry Run 3:');
  });
});

describe('Pack V — dryRunPlanGenerator: declared dry-run dates', () => {
  it('embeds parsed dates verbatim per dry run', () => {
    const out = generateDryRunPlan({
      clientName: 'Atlas',
      dryRunCount: 3,
      dryRunDates:
        'Dry Run 1: 2026-12-14: Data migration only\n' +
        'Dry Run 2: 2027-01-04: Full end-to-end with users\n' +
        'Dry Run 3: 2027-01-11: Final rehearsal',
    });
    expect(out.markdown).toContain('### Dry Run 1: 2026-12-14');
    expect(out.markdown).toContain('### Dry Run 2: 2027-01-04');
    expect(out.markdown).toContain('### Dry Run 3: 2027-01-11');
    expect(out.markdown).toContain('Data migration only');
  });

  it('uses canonical default focus when consultant focus empty', () => {
    const out = generateDryRunPlan({
      clientName: 'Atlas',
      dryRunCount: 3,
    });
    expect(out.markdown).toContain('Data migration only (extract → transform → load)');
    expect(out.markdown).toContain('Full end-to-end with user testing');
    expect(out.markdown).toContain('Final rehearsal — identical to production');
  });

  it('uses [ASSIGN date] placeholder for unscheduled runs', () => {
    const out = generateDryRunPlan({ clientName: 'Atlas', dryRunCount: 1 });
    expect(out.markdown).toContain('_[ASSIGN date]_');
  });
});

describe('Pack V — dryRunPlanGenerator: cross-references', () => {
  it('cross-refs Cutover Runbook + Go/No-Go + Smoke + Defect Log', () => {
    const out = generateDryRunPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Cutover/Cutover_Runbook.md');
    expect(out.markdown).toContain('Documentation/Cutover/Go_No_Go_Matrix.md');
    expect(out.markdown).toContain('Documentation/Cutover/Post_Cutover_Smoke.md');
    expect(out.markdown).toContain('Documentation/Defect_Log_Template.md');
  });

  it('production-ready section spells out Critical = 0 + High ≤ 2 thresholds', () => {
    const out = generateDryRunPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Zero Critical defects open');
    expect(out.markdown).toContain('≤ 2 High defects');
  });
});
