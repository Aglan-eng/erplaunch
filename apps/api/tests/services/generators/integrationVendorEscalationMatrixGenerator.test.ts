import { describe, it, expect } from 'vitest';
import { generateIntegrationVendorEscalationMatrix } from '../../../src/services/generators/integrationVendorEscalationMatrixGenerator.js';

describe('Pack ZZ — integrationVendorEscalationMatrixGenerator: structure', () => {
  it('emits the canonical sections', () => {
    const out = generateIntegrationVendorEscalationMatrix({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('# Vendor Escalation Matrix');
    expect(out.markdown).toContain('## Master Table');
    expect(out.markdown).toContain('## Escalation Tiers');
    expect(out.markdown).toContain('## Escalation Triggers');
    expect(out.markdown).toContain('## Standing Calls');
    expect(out.markdown).toContain('## Cross-References');
  });

  it('emits the 7-column master table header', () => {
    const out = generateIntegrationVendorEscalationMatrix({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain(
      '| Integration | Vendor | Support channel | Vendor SLA | Tier-1 (internal) | Tier-2 (vendor support) | Account manager |',
    );
  });

  it('lists all 4 escalation tiers (L1-L4)', () => {
    const out = generateIntegrationVendorEscalationMatrix({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('| **L1**');
    expect(out.markdown).toContain('| **L2**');
    expect(out.markdown).toContain('| **L3**');
    expect(out.markdown).toContain('| **L4**');
  });
});

describe('Pack ZZ — integrationVendorEscalationMatrixGenerator: platform vendor row', () => {
  it('NetSuite bundle includes NetSuite Customer Care platform-vendor row', () => {
    const out = generateIntegrationVendorEscalationMatrix({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Platform — NetSuite');
    expect(out.markdown).toContain('NetSuite Customer Care');
    expect(out.markdown).toContain('system.netsuite.com');
  });

  it('Odoo bundle includes OdooSH Support platform-vendor row', () => {
    const out = generateIntegrationVendorEscalationMatrix({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.markdown).toContain('Platform — Odoo');
    expect(out.markdown).toContain('OdooSH Support');
    expect(out.markdown).toContain('odoo.sh portal');
  });

  it('Odoo bundle does not leak NetSuite vocabulary in non-platform-vendor rows', () => {
    const out = generateIntegrationVendorEscalationMatrix({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    // The platform-vendor row legitimately mentions Odoo; ensure no SuiteScript / OneWorld leaks.
    expect(out.markdown).not.toContain('SuiteScript');
    expect(out.markdown).not.toContain('OneWorld');
  });
});

describe('Pack ZZ — integrationVendorEscalationMatrixGenerator: overlay', () => {
  it('uses consultant-supplied vendor channel + SLA + escalation', () => {
    const out = generateIntegrationVendorEscalationMatrix({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {
        'integrations.catalog.integrationCatalog':
          'Avalara Tax | Transactional API | Bidirectional | Realtime | RESTlet | Avalara',
      },
      integrationVendorContacts:
        'Avalara Tax | help.avalara.com + 1-877-780-4848 | 4h response | Account team via support portal',
    });
    expect(out.markdown).toContain('help.avalara.com');
    expect(out.markdown).toContain('4h response');
  });

  it('falls back to [FILL IN] markers when overlay sparse', () => {
    const out = generateIntegrationVendorEscalationMatrix({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {
        'integrations.catalog.integrationCatalog':
          'Custom App | Transactional | Inbound | Hourly | X | Y',
      },
    });
    expect(out.markdown).toContain('_[FILL IN');
  });
});
