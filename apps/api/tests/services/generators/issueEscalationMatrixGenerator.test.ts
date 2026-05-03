import { describe, it, expect } from 'vitest';
import { generateIssueEscalationMatrix } from '../../../src/services/generators/issueEscalationMatrixGenerator.js';

describe('Pack X — issueEscalationMatrixGenerator: structure', () => {
  it('emits the canonical 7 sections', () => {
    const out = generateIssueEscalationMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Severity Definitions');
    expect(out.markdown).toContain('## 2. Response & Resolution SLAs');
    expect(out.markdown).toContain('## 3. Escalation Tiers');
    expect(out.markdown).toContain('## 4. Escalation Triggers');
    expect(out.markdown).toContain('## 5. Communications by Severity');
    expect(out.markdown).toContain('## 6.'); // vendor name varies
    expect(out.markdown).toContain('## 7. Cross-References');
  });

  it('renders L1-L4 escalation tiers', () => {
    const out = generateIssueEscalationMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| **L1** | Power user / hypercare team member |');
    expect(out.markdown).toContain('| **L2** | Functional lead');
    expect(out.markdown).toContain('| **L3** | Consultant lead');
    expect(out.markdown).toContain('| **L4** | Vendor:');
  });
});

describe('Pack X — issueEscalationMatrixGenerator: severity + SLA tables', () => {
  it('uses default 4-level severity scheme when consultant skips', () => {
    const out = generateIssueEscalationMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| **S1** | Production halted, no workaround |');
    expect(out.markdown).toContain('| **S2** |');
    expect(out.markdown).toContain('| **S3** |');
    expect(out.markdown).toContain('| **S4** |');
  });

  it('overrides severity table when consultant provides own', () => {
    const out = generateIssueEscalationMatrix({
      clientName: 'Atlas',
      severityDefinitions: 'Critical | Stops everything | Period close blocked',
    });
    expect(out.markdown).toContain('| **Critical** | Stops everything | Period close blocked |');
  });

  it('uses default SLA grid when consultant skips', () => {
    const out = generateIssueEscalationMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| **S1** | 15 minutes | 4 hours |');
  });

  it('overrides SLA grid when consultant provides own', () => {
    const out = generateIssueEscalationMatrix({
      clientName: 'Atlas',
      responseTimeBySeverity: 'S1 | 5 minutes | 1 hour',
    });
    expect(out.markdown).toContain('| **S1** | 5 minutes | 1 hour |');
  });
});

describe('Pack X — issueEscalationMatrixGenerator: adaptor-conditional vendor channel', () => {
  it('NetSuite renders NetSuite Customer Care vendor row', () => {
    const out = generateIssueEscalationMatrix({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('NetSuite Customer Care');
    expect(out.markdown).toContain('https://system.netsuite.com');
    expect(out.markdown).toContain('account ID, environment');
    expect(out.markdown).toContain('SuiteScript / WFA log');
  });

  it('NetSuite has the Customer Care section heading', () => {
    const out = generateIssueEscalationMatrix({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('## 6. NetSuite Customer Care');
  });

  it('Odoo renders OdooSH Support vendor row', () => {
    const out = generateIssueEscalationMatrix({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
    });
    expect(out.markdown).toContain('OdooSH Support');
    expect(out.markdown).toContain('https://www.odoo.sh');
    expect(out.markdown).toContain('database name');
    expect(out.markdown).toContain('traceback if available');
  });

  it('Odoo has the OdooSH Support section heading', () => {
    const out = generateIssueEscalationMatrix({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
    });
    expect(out.markdown).toContain('## 6. OdooSH Support');
  });

  it('unknown adaptor renders [ASSIGN] placeholder for vendor channel', () => {
    const out = generateIssueEscalationMatrix({
      clientName: 'X',
      adaptorName: 'CustomERP',
    });
    expect(out.markdown).toContain('_[ASSIGN platform vendor support channel]_');
  });

  it('omitted adaptorName falls back to placeholder', () => {
    const out = generateIssueEscalationMatrix({ clientName: 'X' });
    expect(out.markdown).toContain('_[ASSIGN platform vendor support channel]_');
  });
});

describe('Pack X — issueEscalationMatrixGenerator: L3 hypercare lead', () => {
  it('hypercare lead name flows into L3 row', () => {
    const out = generateIssueEscalationMatrix({
      clientName: 'Atlas',
      hypercareLeadName: 'Lara Mansour',
    });
    expect(out.markdown).toContain('Consultant lead — Lara Mansour');
  });

  it('falls back to ASSIGN when lead missing', () => {
    const out = generateIssueEscalationMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Consultant lead — _[ASSIGN hypercare lead]_');
  });
});

describe('Pack X — issueEscalationMatrixGenerator: cross-references', () => {
  it('cross-refs Hypercare_Plan + Daily_Readiness + War_Room_SOP + Defect_Log', () => {
    const out = generateIssueEscalationMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_Plan.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Daily_Readiness_Checklist.md');
    expect(out.markdown).toContain('Documentation/Hypercare/War_Room_SOP.md');
    expect(out.markdown).toContain('Documentation/Defect_Log_Template.md');
  });
});
