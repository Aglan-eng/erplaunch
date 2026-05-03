import { describe, it, expect } from 'vitest';
import { generateIntegrationReconciliationProcedures } from '../../../src/services/generators/integrationReconciliationProceduresGenerator.js';

describe('Pack ZZ — integrationReconciliationProceduresGenerator: structure', () => {
  it('emits the canonical sections', () => {
    const out = generateIntegrationReconciliationProcedures({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('# Reconciliation Procedures');
    expect(out.markdown).toContain('## Per-Integration Cadence Table');
    expect(out.markdown).toContain('## Default Cadences');
    expect(out.markdown).toContain('## Variance Triage Rules');
    expect(out.markdown).toContain('## Sample Queries');
    expect(out.markdown).toContain('## Cross-System Reconciliation Report');
  });

  it('emits the 5-column cadence table', () => {
    const out = generateIntegrationReconciliationProcedures({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain(
      '| Integration | Cadence | Owner | Method | Action on variance |',
    );
  });

  it('variance triage rules cover < 0.1% / 0.1-1% / > 1% thresholds', () => {
    const out = generateIntegrationReconciliationProcedures({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('< 0.1%');
    expect(out.markdown).toContain('0.1% – 1%');
    expect(out.markdown).toContain('HALT sync immediately');
  });
});

describe('Pack ZZ — integrationReconciliationProceduresGenerator: NetSuite branch', () => {
  it('references SuiteQL Workbook + SuiteAnalytics tables', () => {
    const out = generateIntegrationReconciliationProcedures({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('SuiteQL Workbook');
    expect(out.markdown).toContain('FROM transaction');
    expect(out.markdown).toContain('custbody_int_source');
  });
});

describe('Pack ZZ — integrationReconciliationProceduresGenerator: Odoo branch', () => {
  it('references Database Manager + account_move table', () => {
    const out = generateIntegrationReconciliationProcedures({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.markdown).toContain('Database Manager');
    expect(out.markdown).toContain('FROM account_move');
    expect(out.markdown).toContain('narration ILIKE');
  });

  it('Odoo bundle does not leak NetSuite vocabulary', () => {
    const out = generateIntegrationReconciliationProcedures({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.markdown).not.toContain('SuiteQL');
    expect(out.markdown).not.toContain('SuiteCloud');
    expect(out.markdown).not.toContain('OneWorld');
  });
});

describe('Pack ZZ — integrationReconciliationProceduresGenerator: overlay', () => {
  it('uses consultant-supplied cadence + owner', () => {
    const out = generateIntegrationReconciliationProcedures({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {
        'integrations.catalog.integrationCatalog':
          'Avalara Tax | Transactional API | Bidirectional | Realtime | RESTlet | Avalara',
      },
      integrationReconciliation: 'Avalara Tax | Daily | Sarah Chen',
    });
    expect(out.markdown).toContain('Sarah Chen');
  });
});

describe('Pack ZZ — integrationReconciliationProceduresGenerator: cross-references', () => {
  it('cross-refs migration reconciliation queries (Pack Z) + war-room SOP (Pack X)', () => {
    const out = generateIntegrationReconciliationProcedures({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain(
      'Documentation/Data_Migration/Reconciliation_Queries.md',
    );
    expect(out.markdown).toContain('Documentation/Hypercare/War_Room_SOP.md');
  });
});
