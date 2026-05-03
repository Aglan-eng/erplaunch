import { describe, it, expect } from 'vitest';
import { generateHypercareKpiDashboard } from '../../../src/services/generators/hypercareKpiDashboardGenerator.js';

describe('Pack X — hypercareKpiDashboardGenerator: structure', () => {
  it('emits the canonical 9 sections', () => {
    const out = generateHypercareKpiDashboard({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Open Issues by Severity');
    expect(out.markdown).toContain('## 2. Mean Time to Acknowledge / Resolve');
    expect(out.markdown).toContain('## 3. Top 5 Issues by Area');
    expect(out.markdown).toContain('## 4. User Adoption Signals');
    expect(out.markdown).toContain('## 5. Integration Health');
    expect(out.markdown).toContain('## 6. Business KPIs');
    expect(out.markdown).toContain('## 7. End-of-Day Status Callout');
    expect(out.markdown).toContain('## 8.'); // section title varies per adaptor
    expect(out.markdown).toContain('## 9. Cross-References');
  });

  it('cadence header reads daily / end-of-day / sponsor + steering', () => {
    const out = generateHypercareKpiDashboard({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Cadence:** Daily — refreshed end-of-day; emailed to Sponsor + Steering');
  });
});

describe('Pack X — hypercareKpiDashboardGenerator: traffic-light bands', () => {
  it('Open Issues by Severity table defines green/yellow/red bands per severity', () => {
    const out = generateHypercareKpiDashboard({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| **S1** | _ | _ | 0 open | n/a (any open S1 = red) | ≥ 1 open |');
    expect(out.markdown).toContain('| **S2** | _ | _ | 0-2 open, all owned | 3-5 open |');
  });

  it('User Adoption Signals defines green/yellow/red bands', () => {
    const out = generateHypercareKpiDashboard({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| Login count (named users) | _ | ≥ 90% of named users | 70-90% | < 70% |');
    expect(out.markdown).toContain('| % active users (trailing 7 days) |');
  });

  it('Integration Health defines explicit traffic-light thresholds', () => {
    const out = generateHypercareKpiDashboard({ clientName: 'Atlas' });
    expect(out.markdown).toContain(
      'green = success rate ≥ 99% AND retry depth < 5; yellow = success rate 95-99% OR retry depth 5-20; red = success rate < 95% OR retry depth > 20',
    );
  });

  it('End-of-Day Status Callout uses 🟢 / 🟡 / 🔴 emoji-coded band labels', () => {
    const out = generateHypercareKpiDashboard({ clientName: 'Atlas' });
    expect(out.markdown).toContain('🟢 GREEN');
    expect(out.markdown).toContain('🟡 YELLOW');
    expect(out.markdown).toContain('🔴 RED');
  });
});

describe('Pack X — hypercareKpiDashboardGenerator: adaptor-conditional data sources', () => {
  it('NetSuite renders saved-search references with customsearch_ss_hc_* IDs', () => {
    const out = generateHypercareKpiDashboard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('## 8. NetSuite Saved Searches Behind the Metrics');
    expect(out.markdown).toContain('customsearch_ss_hc_open_issues');
    expect(out.markdown).toContain('customsearch_ss_hc_login_audit');
    expect(out.markdown).toContain('customsearch_ss_hc_integration_audit');
    expect(out.markdown).toContain('SuiteAnalytics Connect');
  });

  it('Odoo renders Studio dashboard / SQL view references', () => {
    const out = generateHypercareKpiDashboard({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
    });
    expect(out.markdown).toContain('## 8. Odoo Studio Dashboards / SQL Views Behind the Metrics');
    expect(out.markdown).toContain('hc_open_issues');
    expect(out.markdown).toContain('hc_login_audit');
    expect(out.markdown).toContain('hc_integration_audit');
    expect(out.markdown).toContain('Studio scheduled refresh');
  });

  it('unknown adaptor renders [ASSIGN] placeholder for data sources', () => {
    const out = generateHypercareKpiDashboard({
      clientName: 'X',
      adaptorName: 'CustomERP',
    });
    expect(out.markdown).toContain('_[ASSIGN platform-specific data sources');
  });
});

describe('Pack X — hypercareKpiDashboardGenerator: integration health rows', () => {
  it('renders one row per parsed integration', () => {
    const out = generateHypercareKpiDashboard({
      clientName: 'Atlas',
      integrationsList:
        'Salesforce | customer master\n' +
        'Avalara | tax-code lookup',
    });
    expect(out.markdown).toContain('| Salesforce | _ | _ | _ | _ |');
    expect(out.markdown).toContain('| Avalara | _ | _ | _ | _ |');
  });

  it('placeholder when no integrations provided', () => {
    const out = generateHypercareKpiDashboard({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN integration]_');
  });
});

describe('Pack X — hypercareKpiDashboardGenerator: cross-references', () => {
  it('cross-refs Hypercare_Plan + Daily_Readiness + Escalation + War_Room + Defect_Log + Solution_Design', () => {
    const out = generateHypercareKpiDashboard({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_Plan.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Daily_Readiness_Checklist.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Issue_Escalation_Matrix.md');
    expect(out.markdown).toContain('Documentation/Hypercare/War_Room_SOP.md');
    expect(out.markdown).toContain('Documentation/Defect_Log_Template.md');
    expect(out.markdown).toContain('Documentation/Solution_Design.html');
  });
});
