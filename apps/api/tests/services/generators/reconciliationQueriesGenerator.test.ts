import { describe, it, expect } from 'vitest';
import { generateReconciliationQueries } from '../../../src/services/generators/reconciliationQueriesGenerator.js';

describe('Pack Z — reconciliationQueriesGenerator: NetSuite branch', () => {
  it('references SuiteQL Workbook + Saved Searches in the query tool path', () => {
    const out = generateReconciliationQueries({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('SuiteQL Workbook');
    expect(out.markdown).toContain('Saved Searches');
  });

  it('emits a SuiteQL count check per object', () => {
    const out = generateReconciliationQueries({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Count check (SuiteQL)');
    expect(out.markdown).toContain('FROM customer');
    expect(out.markdown).toContain('FROM vendor');
  });

  it('emits a financial-total SuiteQL block for open AR / AP / GL / inventory', () => {
    const out = generateReconciliationQueries({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('open_ar_total');
    expect(out.markdown).toContain('open_ap_total');
    expect(out.markdown).toContain('Trial-balance check');
    expect(out.markdown).toContain('inventory_value');
  });

  it('saved-search references follow Migration_<id>_Count naming', () => {
    const out = generateReconciliationQueries({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Migration_customers_Count');
    expect(out.markdown).toContain('Migration_OpenAR_Total_BySubsidiaryCurrency');
  });
});

describe('Pack Z — reconciliationQueriesGenerator: Odoo branch', () => {
  it('references Database Manager → Query in the query tool path', () => {
    const out = generateReconciliationQueries({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.markdown).toContain('Database Manager');
  });

  it('emits PostgreSQL queries against res_partner / account_move / account_account', () => {
    const out = generateReconciliationQueries({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.markdown).toContain('FROM res_partner');
    expect(out.markdown).toContain('FROM account_move');
    expect(out.markdown).toContain('FROM account_account');
  });

  it('emits financial-total checks for open invoices, bills, GL, inventory', () => {
    const out = generateReconciliationQueries({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.markdown).toContain('open_ar_total');
    expect(out.markdown).toContain('open_ap_total');
    expect(out.markdown).toContain('Trial-balance check');
    expect(out.markdown).toContain('inventory_value');
  });

  it('does NOT leak NetSuite vocabulary into the Odoo bundle', () => {
    const out = generateReconciliationQueries({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.markdown).not.toContain('SuiteQL');
    expect(out.markdown).not.toContain('SuiteCloud');
    expect(out.markdown).not.toContain('subsidiary');
  });
});

describe('Pack Z — reconciliationQueriesGenerator: cross-references', () => {
  it('links to Templates, Field_Mapping_Workbook, Cleansing_Rules, Reject_Handling, Data_Quality, Migration_Runbook', () => {
    const out = generateReconciliationQueries({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('./Templates/');
    expect(out.markdown).toContain('./Field_Mapping_Workbook.md');
    expect(out.markdown).toContain('./Cleansing_Rules.md');
    expect(out.markdown).toContain('./Reject_Handling_Playbook.md');
    expect(out.markdown).toContain('./Data_Quality_Scorecard.md');
    expect(out.markdown).toContain('./Migration_Runbook.md');
  });
});
