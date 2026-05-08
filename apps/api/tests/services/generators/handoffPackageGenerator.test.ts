/**
 * Phase 45.2 — pure tests for the handoff package generator.
 */
import { describe, it, expect } from 'vitest';
import {
  generateHandoffPackage,
  type HandoffPackageInput,
} from '../../../src/services/generators/handoffPackageGenerator.js';

function baseInput(overrides: Partial<HandoffPackageInput> = {}): HandoffPackageInput {
  return {
    clientName: 'Acme Industries',
    adaptorId: 'netsuite',
    adaptorName: 'NetSuite',
    license: { edition: 'MID_MARKET', modules: ['ADVANCED_REVENUE', 'INVENTORY'] },
    answers: {
      'r2r.entities.multiEntity': true,
      'p2p.purchasing.poApprovalRequired': true,
      'ns.design.customRecord.salesQuote': 'enabled',
      'ns.design.customField.regionCode': 'enabled',
    },
    members: [
      { name: 'Alice Sponsor', email: 'alice@acme.example', role: 'Project Sponsor', team: 'CLIENT' },
      { name: 'Bob Lead', email: 'bob@acme.example', role: 'Project Lead', team: 'CONSULTANT' },
    ],
    checklist: [
      { key: 'KNOWLEDGE_TRANSFER', status: 'DONE', completedBy: 'u1', completedAt: '2026-04-01T10:00:00Z' },
      { key: 'SLA_TERMS_AGREED', status: 'IN_PROGRESS', notes: 'Pending legal review' },
    ],
    slaTier: 'SILVER',
    preparedAt: '2026-04-15',
    ...overrides,
  };
}

describe('generateHandoffPackage — file inventory', () => {
  it('emits the 6 canonical Documentation/ files for a NetSuite engagement', () => {
    const out = generateHandoffPackage(baseInput());
    expect(out['Documentation/System_Catalog.md']).toBeDefined();
    expect(out['Documentation/AAI_Map.md']).toBeDefined();
    expect(out['Documentation/Support_Escalation_Matrix.md']).toBeDefined();
    expect(out['Documentation/SLA_Terms.md']).toBeDefined();
    expect(out['Documentation/Production_Readiness_Checklist.md']).toBeDefined();
    expect(out['Documentation/Knowledge_Transfer_Slides.md']).toBeDefined();
  });

  it('uses Account_Mapping.md (not AAI_Map.md) for Odoo', () => {
    const out = generateHandoffPackage(baseInput({ adaptorId: 'odoo', adaptorName: 'Odoo' }));
    expect(out['Documentation/Account_Mapping.md']).toBeDefined();
    expect(out['Documentation/AAI_Map.md']).toBeUndefined();
  });

  it('uses Account_Mapping.md for custom adaptors', () => {
    const out = generateHandoffPackage(baseInput({ adaptorId: 'custom:acme-erp', adaptorName: 'Acme ERP' }));
    expect(out['Documentation/Account_Mapping.md']).toBeDefined();
    expect(out['Documentation/AAI_Map.md']).toBeUndefined();
  });

  it('emits an Integrations/ folder via the Phase 41.1 runbook bundle (defaults to NetSuite catalog)', () => {
    const out = generateHandoffPackage(baseInput());
    const integrationFiles = Object.keys(out).filter((k) => k.startsWith('Documentation/Integrations/'));
    // NetSuite default catalog is 11 integrations; assert at least 5
    // to keep the test resilient to future catalog changes.
    expect(integrationFiles.length).toBeGreaterThanOrEqual(5);
  });
});

describe('generateHandoffPackage — content checks', () => {
  it('System_Catalog mentions the client name + edition + modules', () => {
    const out = generateHandoffPackage(baseInput());
    const md = out['Documentation/System_Catalog.md'];
    expect(md).toContain('Acme Industries');
    expect(md).toContain('MID_MARKET');
    expect(md).toContain('ADVANCED_REVENUE');
    expect(md).toContain('INVENTORY');
  });

  it('System_Catalog surfaces custom-* answers', () => {
    const out = generateHandoffPackage(baseInput());
    const md = out['Documentation/System_Catalog.md'];
    expect(md).toContain('ns.design.customRecord.salesQuote');
    expect(md).toContain('ns.design.customField.regionCode');
  });

  it('Support_Escalation_Matrix lists every member by name + role', () => {
    const out = generateHandoffPackage(baseInput());
    const md = out['Documentation/Support_Escalation_Matrix.md'];
    expect(md).toContain('Alice Sponsor');
    expect(md).toContain('Bob Lead');
    expect(md).toContain('Project Sponsor');
    expect(md).toContain('alice@acme.example');
  });

  it('Support_Escalation_Matrix shows a placeholder when no members', () => {
    const out = generateHandoffPackage(baseInput({ members: [] }));
    const md = out['Documentation/Support_Escalation_Matrix.md'];
    expect(md).toContain('No members on file');
  });

  it('SLA_Terms reflects the SILVER tier targets', () => {
    const out = generateHandoffPackage(baseInput({ slaTier: 'SILVER' }));
    const md = out['Documentation/SLA_Terms.md'];
    expect(md).toContain('SILVER');
    expect(md).toContain('4-hour response');
    expect(md).toContain('Mon-Fri 09:00-21:00 local');
  });

  it('SLA_Terms reflects the GOLD tier targets', () => {
    const out = generateHandoffPackage(baseInput({ slaTier: 'GOLD' }));
    const md = out['Documentation/SLA_Terms.md'];
    expect(md).toContain('GOLD');
    expect(md).toContain('24/7');
    expect(md).toContain('1-hour response');
  });

  it('SLA_Terms defaults to SILVER when slaTier is omitted', () => {
    const { slaTier: _omit, ...rest } = baseInput();
    void _omit;
    const out = generateHandoffPackage(rest);
    expect(out['Documentation/SLA_Terms.md']).toContain('SILVER');
  });

  it('Production_Readiness_Checklist tabulates each checklist row', () => {
    const out = generateHandoffPackage(baseInput());
    const md = out['Documentation/Production_Readiness_Checklist.md'];
    expect(md).toContain('KNOWLEDGE_TRANSFER');
    expect(md).toContain('SLA_TERMS_AGREED');
    expect(md).toContain('Pending legal review');
    expect(md).toContain('DONE');
    expect(md).toContain('IN_PROGRESS');
  });

  it('Production_Readiness_Checklist shows an empty-state when checklist is missing', () => {
    const out = generateHandoffPackage(baseInput({ checklist: [] }));
    const md = out['Documentation/Production_Readiness_Checklist.md'];
    expect(md).toContain('Closeout checklist not initialised yet');
  });

  it('Knowledge_Transfer_Slides references the engagement modules', () => {
    const out = generateHandoffPackage(baseInput());
    const md = out['Documentation/Knowledge_Transfer_Slides.md'];
    expect(md).toContain('Acme Industries');
    expect(md).toContain('NetSuite');
    expect(md).toContain('ADVANCED_REVENUE');
    expect(md).toContain('INVENTORY');
  });

  it('AAI_Map (NetSuite) describes posting setup + allocations', () => {
    const out = generateHandoffPackage(baseInput());
    const md = out['Documentation/AAI_Map.md'];
    expect(md).toContain('Posting setup');
    expect(md).toContain('Allocation rules');
    expect(md).toContain('Auto-Apply Items');
  });

  it('Account_Mapping (Odoo) lists default journals', () => {
    const out = generateHandoffPackage(baseInput({ adaptorId: 'odoo', adaptorName: 'Odoo' }));
    const md = out['Documentation/Account_Mapping.md'];
    expect(md).toContain('Default journals');
    expect(md).toContain('Sales');
    expect(md).toContain('Bank');
  });
});
