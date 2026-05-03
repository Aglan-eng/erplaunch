import { describe, it, expect } from 'vitest';
import { generateKpiEvolutionPlan } from '../../../src/services/generators/kpiEvolutionPlanGenerator.js';

describe('Pack Y — kpiEvolutionPlanGenerator: structure', () => {
  it('emits the canonical 8 sections', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. The Three Measurement Eras');
    expect(out.markdown).toContain('## 2. Metric Retirement');
    expect(out.markdown).toContain('## 3. Metric Continuation');
    expect(out.markdown).toContain('## 4. Metric Introduction');
    expect(out.markdown).toContain('## 5. Reporting Consumers by Era');
    expect(out.markdown).toContain('## 6. Threshold Evolution');
    expect(out.markdown).toContain('## 7. Data Sources by Era');
    expect(out.markdown).toContain('## 8. Cross-References');
  });

  it('Eras table defines Hypercare / Stabilization / Steady-state with windows', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Hypercare** | T+0 → T+30');
    expect(out.markdown).toContain('**Stabilization** | T+30 → T+360');
    expect(out.markdown).toContain('**Steady-state** | T+360+');
  });
});

describe('Pack Y — kpiEvolutionPlanGenerator: retirement + continuation tables', () => {
  it('retirement table lists 5 hypercare-only metrics', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Open issues by severity (daily)');
    expect(out.markdown).toContain('MTTA / MTTR (daily)');
    expect(out.markdown).toContain('Top 5 issues by area (daily)');
    expect(out.markdown).toContain('War-room status callout');
    expect(out.markdown).toContain('User adoption (daily login + transactions)');
  });

  it('continuation table lists cross-era metrics', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Integration health (success rate)');
    expect(out.markdown).toContain('Defect open count by severity');
    expect(out.markdown).toContain('Period close completion days');
  });
});

describe('Pack Y — kpiEvolutionPlanGenerator: metric introduction from business-case overlay', () => {
  it('uses default 6-row introduction set when overlay empty', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| Close cycle days |');
    expect(out.markdown).toContain('| AP days-payable-outstanding |');
    expect(out.markdown).toContain('| AR days-sales-outstanding |');
    expect(out.markdown).toContain('| Audit prep hours |');
    expect(out.markdown).toContain('| Headcount avoided in finance ops |');
  });

  it('parses business-case rows into introduction table', () => {
    const out = generateKpiEvolutionPlan({
      clientName: 'Atlas',
      businessCaseSummary:
        'Custom metric A | 100 | 50 | T+90\n' +
        'Custom metric B | 200 | 100 | T+360',
    });
    expect(out.markdown).toContain('| Custom metric A | T+90 | Stabilization |');
    // Metric with timing T+360 should classify as Steady-state era.
    expect(out.markdown).toContain('| Custom metric B | T+360 | Steady-state |');
  });

  it('classifies T+90/180/270 as Stabilization era', () => {
    const out = generateKpiEvolutionPlan({
      clientName: 'Atlas',
      businessCaseSummary: 'Metric A | 1 | 2 | T+180',
    });
    expect(out.markdown).toContain('| Metric A | T+180 | Stabilization |');
  });
});

describe('Pack Y — kpiEvolutionPlanGenerator: threshold evolution', () => {
  it('integration retry depth tightens across eras', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| Integration retry depth | < 5 | < 3 | < 1 |');
  });

  it('integration success rate tightens', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| Integration success rate | ≥ 99% | ≥ 99.5% | ≥ 99.9% |');
  });

  it('period close completion tightens to business-case target', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'Atlas' });
    expect(out.markdown).toMatch(/\| Period close completion \|.+ \| ≤ 5 business days \| ≤ 3 business days/);
  });

  it('S2 defect tolerance reaches zero by T+180', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| Open S2 defects | ≤ 2 | ≤ 1 | 0 (zero tolerance after T+180) |');
  });
});

describe('Pack Y — kpiEvolutionPlanGenerator: adaptor-conditional data sources', () => {
  it('NetSuite renders saved-search data sources', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'Atlas', adaptorName: 'NetSuite' });
    expect(out.markdown).toContain('customsearch_ss_hc_*');
    expect(out.markdown).toContain('customsearch_ss_close_cycle_history');
    expect(out.markdown).toContain('SuiteAnalytics Connect');
  });

  it('Odoo renders Studio dashboard / SQL view sources', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'Sahel', adaptorName: 'Odoo' });
    expect(out.markdown).toContain('Studio dashboards / SQL views `hc_*`');
    expect(out.markdown).toContain('bm_close_cycle');
    expect(out.markdown).toContain('Studio scheduled actions');
    expect(out.markdown).toContain('ir.cron');
  });

  it('unknown adaptor renders [ASSIGN] placeholder', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'X', adaptorName: 'CustomERP' });
    expect(out.markdown).toContain('_[ASSIGN platform-specific hypercare data source]_');
  });
});

describe('Pack Y — kpiEvolutionPlanGenerator: cross-references', () => {
  it('cross-refs Pack X hypercare KPI dashboard + sibling Pack Y artefacts', () => {
    const out = generateKpiEvolutionPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_KPI_Dashboard.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Benefits_Realization_Tracker.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Continuous_Improvement_Governance.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Stabilization_Roadmap.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Phase_Two_Charter.md');
  });
});
