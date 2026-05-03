import { describe, it, expect } from 'vitest';
import { generateIntegrationHealthDashboard } from '../../../src/services/generators/integrationHealthDashboardGenerator.js';

describe('Pack ZZ — integrationHealthDashboardGenerator: structure', () => {
  it('emits the canonical sections', () => {
    const out = generateIntegrationHealthDashboard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('# Integration Health Dashboard');
    expect(out.markdown).toContain('## Per-Integration Tile Spec');
    expect(out.markdown).toContain('## Aggregate Panels');
    expect(out.markdown).toContain('## Refresh Schedule');
    expect(out.markdown).toContain('## Drill-Through');
    expect(out.markdown).toContain('## Cross-References');
  });

  it('emits the 7-column per-integration tile table', () => {
    const out = generateIntegrationHealthDashboard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain(
      '| Integration | Health metric | Green | Yellow | Red | Owner | Refresh cadence |',
    );
  });

  it('emits aggregate panels (overall health, MTTR, reject queue)', () => {
    const out = generateIntegrationHealthDashboard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Overall integration health');
    expect(out.markdown).toContain('Mean time to recovery (MTTR)');
    expect(out.markdown).toContain('Reject queue depth');
  });
});

describe('Pack ZZ — integrationHealthDashboardGenerator: NetSuite implementation', () => {
  it('NetSuite implementation references saved searches + published dashboard', () => {
    const out = generateIntegrationHealthDashboard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('## Implementation — NetSuite');
    expect(out.markdown).toContain('saved searches');
    expect(out.markdown).toContain('customsearch_int_');
    expect(out.markdown).toContain('custpubdash_integration_health');
  });

  it('NetSuite saved-search names use slug per integration', () => {
    const out = generateIntegrationHealthDashboard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    // Default catalog has Avalara Tax → avalara_tax slug.
    expect(out.markdown).toContain('customsearch_int_avalara_tax_health');
  });
});

describe('Pack ZZ — integrationHealthDashboardGenerator: Odoo implementation', () => {
  it('Odoo implementation references Studio dashboards + PostgreSQL views + ir.cron', () => {
    const out = generateIntegrationHealthDashboard({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.markdown).toContain('## Implementation — Odoo');
    expect(out.markdown).toContain('Studio dashboards');
    expect(out.markdown).toContain('PostgreSQL views');
    expect(out.markdown).toContain('ir.cron');
    expect(out.markdown).toContain('v_int_');
  });

  it('Odoo bundle does not leak NetSuite vocabulary', () => {
    const out = generateIntegrationHealthDashboard({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.markdown).not.toContain('SuiteScript');
    expect(out.markdown).not.toContain('SuiteCloud');
    expect(out.markdown).not.toContain('OneWorld');
  });
});

describe('Pack ZZ — integrationHealthDashboardGenerator: overlay integration', () => {
  it('uses consultant-supplied monitoring thresholds verbatim', () => {
    const out = generateIntegrationHealthDashboard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {
        'integrations.catalog.integrationCatalog':
          'Avalara Tax | Transactional API | Bidirectional | Realtime | RESTlet + SDK | Avalara',
      },
      integrationMonitoring:
        'Avalara Tax | Custom-metric | > 99.9% | 99.5-99.9% | < 99.5%',
    });
    expect(out.markdown).toContain('Custom-metric');
    expect(out.markdown).toContain('> 99.9%');
    expect(out.markdown).toContain('< 99.5%');
  });
});
