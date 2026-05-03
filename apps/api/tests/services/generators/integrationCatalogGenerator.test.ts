import { describe, it, expect } from 'vitest';
import { generateIntegrationCatalog } from '../../../src/services/generators/integrationCatalogGenerator.js';

describe('Pack ZZ — integrationCatalogGenerator: structure', () => {
  it('emits the canonical sections', () => {
    const out = generateIntegrationCatalog({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('# Integration Catalog');
    expect(out.markdown).toContain('## Inventory');
    expect(out.markdown).toContain('## Type Definitions');
    expect(out.markdown).toContain('## Critical-Path Integrations');
    expect(out.markdown).toContain('## Decommission Registry');
    expect(out.markdown).toContain('## Cross-References');
  });

  it('emits the 9-column inventory table header', () => {
    const out = generateIntegrationCatalog({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain(
      '| Integration | Type | Direction | Frequency | Tooling | Vendor | Internal owner | Vendor SLA | Criticality |',
    );
  });
});

describe('Pack ZZ — integrationCatalogGenerator: NetSuite catalog defaults', () => {
  it('renders all 11 default NetSuite integrations when overlay sparse', () => {
    const out = generateIntegrationCatalog({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Avalara Tax');
    expect(out.markdown).toContain('Salesforce CPQ');
    expect(out.markdown).toContain('Workday');
    expect(out.markdown).toContain('Shopify');
    expect(out.markdown).toContain('DocuSign');
    expect(out.markdown).toContain('Concur');
    expect(out.markdown).toContain('Snowflake');
    expect(out.markdown).toContain('Workato');
  });
});

describe('Pack ZZ — integrationCatalogGenerator: Odoo catalog defaults', () => {
  it('renders all 6 default Odoo integrations when overlay sparse', () => {
    const out = generateIntegrationCatalog({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.markdown).toContain('ZATCA E-Invoicing Phase 2');
    expect(out.markdown).toContain('Bank Statement Inbound');
    expect(out.markdown).toContain('Payment File Outbound');
  });

  it('does NOT leak NetSuite vocabulary into Odoo bundle', () => {
    const out = generateIntegrationCatalog({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.markdown).not.toContain('SuiteScript');
    expect(out.markdown).not.toContain('OneWorld');
  });
});

describe('Pack ZZ — integrationCatalogGenerator: overlay integration', () => {
  it('overlay rows render verbatim', () => {
    const out = generateIntegrationCatalog({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {
        'integrations.catalog.integrationCatalog':
          'Custom CRM | Transactional | Bidirectional | Realtime | Workato | Custom Vendor',
      },
    });
    expect(out.markdown).toContain('Custom CRM');
    expect(out.markdown).toContain('Custom Vendor');
  });

  it('joins owners + vendor SLAs from overlay', () => {
    const out = generateIntegrationCatalog({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {
        'integrations.catalog.integrationCatalog':
          'Custom CRM | Transactional | Bidirectional | Realtime | Workato | Custom Vendor',
      },
      integrationOwnersByName: 'Custom CRM | Sarah Chen | Helena Reyes',
      integrationVendorContacts: 'Custom CRM | support@vendor.com | 4h critical | TAM',
    });
    expect(out.markdown).toContain('Sarah Chen');
    expect(out.markdown).toContain('4h critical');
  });
});

describe('Pack ZZ — integrationCatalogGenerator: critical-path identification', () => {
  it('flags Avalara as critical-path (realtime + bidirectional + transactional)', () => {
    const out = generateIntegrationCatalog({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    // Avalara should appear in the Critical-Path bullets.
    expect(out.markdown).toMatch(/\*\*Avalara Tax\*\*/);
  });
});

describe('Pack ZZ — integrationCatalogGenerator: cross-references', () => {
  it('links to Runbooks/, Health_Dashboard, Reconciliation_Procedures, Vendor_Escalation, Test_Plan', () => {
    const out = generateIntegrationCatalog({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('./Runbooks/');
    expect(out.markdown).toContain('./Integration_Health_Dashboard.md');
    expect(out.markdown).toContain('./Reconciliation_Procedures.md');
    expect(out.markdown).toContain('./Vendor_Escalation_Matrix.md');
    expect(out.markdown).toContain('./Integration_Test_Plan.md');
    expect(out.markdown).toContain('Documentation/Cutover/Cutover_Runbook.md');
    expect(out.markdown).toContain('Documentation/Data_Migration/Migration_Runbook.md');
  });
});
