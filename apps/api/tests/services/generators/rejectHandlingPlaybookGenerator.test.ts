import { describe, it, expect } from 'vitest';
import { generateRejectHandlingPlaybook } from '../../../src/services/generators/rejectHandlingPlaybookGenerator.js';

describe('Pack Z — rejectHandlingPlaybookGenerator: structure', () => {
  it('emits the canonical sections', () => {
    const out = generateRejectHandlingPlaybook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('# Reject Handling Playbook');
    expect(out.markdown).toContain('## Reject Taxonomy');
    expect(out.markdown).toContain('## Per-Object SLA');
    expect(out.markdown).toContain('## Fix Loop');
    expect(out.markdown).toContain('## Escalation');
    expect(out.markdown).toContain('## Cross-References');
  });

  it('emits the 5-bucket reject taxonomy', () => {
    const out = generateRejectHandlingPlaybook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('FK violation');
    expect(out.markdown).toContain('Type mismatch');
    expect(out.markdown).toContain('Business-rule fail');
    expect(out.markdown).toContain('Dedupe');
    expect(out.markdown).toContain('Financial mismatch');
  });
});

describe('Pack Z — rejectHandlingPlaybookGenerator: adaptor-conditional path', () => {
  it('NetSuite — references CSV Import Job Status path', () => {
    const out = generateRejectHandlingPlaybook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('Setup → Import/Export → View CSV Import Job Status');
  });

  it('Odoo — references Settings → Technical → Imports', () => {
    const out = generateRejectHandlingPlaybook({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
    });
    expect(out.markdown).toContain('Settings → Technical → Imports');
  });

  it('does not leak NetSuite vocabulary into the Odoo bundle', () => {
    const out = generateRejectHandlingPlaybook({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
    });
    expect(out.markdown).not.toContain('SuiteCloud');
    expect(out.markdown).not.toContain('SuiteScript');
    expect(out.markdown).not.toContain('subsidiary');
  });
});

describe('Pack Z — rejectHandlingPlaybookGenerator: SLA defaults + overlay', () => {
  it('renders default SLA rows when overlay empty', () => {
    const out = generateRejectHandlingPlaybook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('Open AR / AP');
    expect(out.markdown).toContain('0 rejects (financial)');
    expect(out.markdown).toContain('| GL Opening Balances |');
  });

  it('consultant overlay rows render alongside defaults', () => {
    const out = generateRejectHandlingPlaybook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      rejectSlaByObject: 'Customers | < 0.25% rejects | 12h re-load',
    });
    expect(out.markdown).toContain('< 0.25% rejects');
    expect(out.markdown).toContain('12h re-load');
    // Vendors default still present.
    expect(out.markdown).toContain('| Vendors |');
  });
});

describe('Pack Z — rejectHandlingPlaybookGenerator: cross-references', () => {
  it('references Cleansing_Rules, Field_Mapping_Workbook, Reconciliation_Queries, Migration_Runbook, Data_Quality_Scorecard, War_Room_SOP', () => {
    const out = generateRejectHandlingPlaybook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('./Cleansing_Rules.md');
    expect(out.markdown).toContain('./Field_Mapping_Workbook.md');
    expect(out.markdown).toContain('./Reconciliation_Queries.md');
    expect(out.markdown).toContain('./Migration_Runbook.md');
    expect(out.markdown).toContain('./Data_Quality_Scorecard.md');
    expect(out.markdown).toContain('Documentation/Hypercare/War_Room_SOP.md');
  });
});
