import { describe, it, expect } from 'vitest';
import { generateRollbackPlan } from '../../../src/services/generators/rollbackPlanGenerator.js';

describe('Pack V — rollbackPlanGenerator: structure', () => {
  it('emits the canonical 5 sections', () => {
    const out = generateRollbackPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. When to Roll Back');
    expect(out.markdown).toContain('## 2. Rollback Procedure');
    expect(out.markdown).toContain('## 3. Post-Rollback Recovery');
    expect(out.markdown).toContain('## 4. What Counts as Mid-Cutover vs Hypercare');
    expect(out.markdown).toContain('## 5. Sign-off');
  });

  it('rollback procedure has Phase 1/2/3 subsections', () => {
    const out = generateRollbackPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('### Phase 1 — Halt Forward Progress');
    expect(out.markdown).toContain('### Phase 2 — Restore Legacy');
    expect(out.markdown).toContain('### Phase 3 — Communicate');
  });

  it('platform default reads as ERP', () => {
    const out = generateRollbackPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Platform:** ERP');
  });
});

describe('Pack V — rollbackPlanGenerator: trigger parsing', () => {
  it('renders one numbered trigger row per parsed line', () => {
    const out = generateRollbackPlan({
      clientName: 'Atlas',
      rollbackTriggers:
        'Critical defect found in core finance flow with no workaround\n' +
        'Migration tie-out fails for >1% of records and cannot be reconciled within 2h',
    });
    expect(out.markdown).toContain(
      '1. **Critical defect found in core finance flow with no workaround**',
    );
    expect(out.markdown).toContain(
      '2. **Migration tie-out fails for >1% of records and cannot be reconciled within 2h**',
    );
  });

  it('shows ASSIGN placeholder when no triggers captured', () => {
    const out = generateRollbackPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain(
      '_[ASSIGN rollback triggers — populate `cutover.decisions.rollbackTriggers` in the wizard]_',
    );
  });

  it('skips blank lines + trims whitespace', () => {
    const out = generateRollbackPlan({
      clientName: 'Atlas',
      rollbackTriggers: '\n  Trigger A  \n\n   \n  Trigger B  \n',
    });
    expect(out.markdown).toContain('1. **Trigger A**');
    expect(out.markdown).toContain('2. **Trigger B**');
  });
});

describe('Pack V — rollbackPlanGenerator: cutoverStyle branching for Phase 2', () => {
  it('BIG_BANG (default) renders full-restoration-from-snapshot copy', () => {
    const out = generateRollbackPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('full restoration of the legacy systems from the snapshot');
  });

  it('PARALLEL_RUN renders direct-users-back-to-legacy copy', () => {
    const out = generateRollbackPlan({
      clientName: 'Atlas',
      cutoverStyle: 'PARALLEL_RUN',
    });
    expect(out.markdown).toContain('legacy is already live');
    expect(out.markdown).toContain('direct users back to legacy');
  });

  it('PHASED_ENTITY renders per-wave rollback copy', () => {
    const out = generateRollbackPlan({
      clientName: 'Atlas',
      cutoverStyle: 'PHASED_ENTITY',
    });
    expect(out.markdown).toContain('rollback is per-wave');
    expect(out.markdown).toContain('Already-cut-over entities continue running');
  });

  it('PHASED_MODULE renders per-module rollback copy', () => {
    const out = generateRollbackPlan({
      clientName: 'Atlas',
      cutoverStyle: 'PHASED_MODULE',
    });
    expect(out.markdown).toContain('unwinds only the affected module wave');
  });

  it('unknown style falls back to BIG_BANG', () => {
    const out = generateRollbackPlan({
      clientName: 'Atlas',
      cutoverStyle: 'BOGUS' as unknown as 'BIG_BANG',
    });
    expect(out.markdown).toContain('full restoration of the legacy systems');
  });
});

describe('Pack V — rollbackPlanGenerator: cross-references + platform name', () => {
  it('cross-refs Communication_Plan + Defect_Log_Template + Hypercare_Plan', () => {
    const out = generateRollbackPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Cutover/Communication_Plan.md');
    expect(out.markdown).toContain('Documentation/Defect_Log_Template.md');
    expect(out.markdown).toContain('Documentation/Hypercare_Plan.md');
  });

  it('platform name appears in Phase 1 Lock production step', () => {
    const out = generateRollbackPlan({ clientName: 'Atlas', adaptorName: 'NetSuite' });
    expect(out.markdown).toContain('Lock NetSuite production from end users');
  });
});
