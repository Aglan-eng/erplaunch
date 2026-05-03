import { describe, it, expect } from 'vitest';
import {
  parseIntegrationCatalog,
  parseIntegrationOwners,
  parseIntegrationAuthMethods,
  parseIntegrationMonitoring,
  parseIntegrationErrorPatterns,
  parseIntegrationVendorContacts,
  parseIntegrationReconciliation,
  parseIntegrationSmokeTests,
  slugify,
  isCriticalPath,
  sortByCriticality,
  integrationsInScope,
  indexByName,
  NETSUITE_DEFAULT_CATALOG,
  ODOO_DEFAULT_CATALOG,
} from '../../../src/services/generators/integrationHelpers.js';

describe('Pack ZZ — integrationHelpers: parsers', () => {
  it('parseIntegrationCatalog parses 6-column rows', () => {
    const out = parseIntegrationCatalog(
      'Avalara Tax | Transactional API | Bidirectional | Realtime | RESTlet + SDK | Avalara\nSalesforce CPQ | Master-data | Bidirectional | 15min | Workato | Salesforce',
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      name: 'Avalara Tax',
      type: 'Transactional API',
      direction: 'Bidirectional',
      frequency: 'Realtime',
      tooling: 'RESTlet + SDK',
      vendor: 'Avalara',
    });
  });

  it('parseIntegrationOwners parses 3-column rows', () => {
    const out = parseIntegrationOwners('Avalara | Sarah Chen | Helena Reyes');
    expect(out).toHaveLength(1);
    expect(out[0].owner).toBe('Sarah Chen');
    expect(out[0].backup).toBe('Helena Reyes');
  });

  it('parseIntegrationAuthMethods parses 4-column rows', () => {
    const out = parseIntegrationAuthMethods(
      'Salesforce CPQ | OAuth 2.0 connected app | 90 days | Mostafa Sherif',
    );
    expect(out[0].method).toBe('OAuth 2.0 connected app');
    expect(out[0].rotationCadence).toBe('90 days');
    expect(out[0].secretOwner).toBe('Mostafa Sherif');
  });

  it('parseIntegrationMonitoring parses 5-column rows', () => {
    const out = parseIntegrationMonitoring(
      'Avalara | API success rate | > 99.5% | 99-99.5% | < 99%',
    );
    expect(out[0].metric).toBe('API success rate');
    expect(out[0].green).toBe('> 99.5%');
    expect(out[0].red).toBe('< 99%');
  });

  it('parseIntegrationErrorPatterns parses 3-column rows; multiple per integration', () => {
    const out = parseIntegrationErrorPatterns(
      'Avalara | Network timeout | Retry up to 3 attempts\nAvalara | Address validation | Flag for manual fix',
    );
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.name === 'Avalara')).toBe(true);
  });

  it('parseIntegrationVendorContacts parses 4-column rows', () => {
    const out = parseIntegrationVendorContacts(
      'Avalara | help.avalara.com + 1-877-780-4848 | 4h response | Account team',
    );
    expect(out[0].channel).toContain('help.avalara.com');
    expect(out[0].sla).toBe('4h response');
    expect(out[0].escalation).toBe('Account team');
  });

  it('parseIntegrationReconciliation parses 3-column rows', () => {
    const out = parseIntegrationReconciliation('Avalara | Daily | Sarah Chen');
    expect(out[0].cadence).toBe('Daily');
    expect(out[0].owner).toBe('Sarah Chen');
  });

  it('parseIntegrationSmokeTests parses 3-column rows', () => {
    const out = parseIntegrationSmokeTests(
      'Avalara | Calculate tax on test SO | Confirm tax on first 5 production SOs matches',
    );
    expect(out[0].preCutover).toContain('Calculate tax on test SO');
    expect(out[0].postCutover).toContain('first 5 production SOs');
  });

  it('all parsers return [] for empty / whitespace input', () => {
    expect(parseIntegrationCatalog('')).toEqual([]);
    expect(parseIntegrationOwners('   \n\n  ')).toEqual([]);
    expect(parseIntegrationAuthMethods('')).toEqual([]);
  });
});

describe('Pack ZZ — integrationHelpers: slugify', () => {
  it('lowercases + collapses non-alnum to single underscore', () => {
    expect(slugify('Avalara Tax')).toBe('avalara_tax');
    expect(slugify('ZATCA E-Invoicing Phase 2')).toBe('zatca_e_invoicing_phase_2');
    expect(slugify('HSBC Bank Statement (UK + AU)')).toBe('hsbc_bank_statement_uk_au');
  });

  it('strips leading + trailing underscores', () => {
    expect(slugify('  -- Avalara --  ')).toBe('avalara');
  });

  it('handles edge cases', () => {
    expect(slugify('!@#$%')).toBe('');
    expect(slugify('Already_Snake_Case')).toBe('already_snake_case');
  });
});

describe('Pack ZZ — integrationHelpers: criticality', () => {
  it('isCriticalPath: inbound + transactional + daily-or-faster = true', () => {
    expect(
      isCriticalPath({
        name: 'Avalara',
        type: 'Transactional API',
        direction: 'Bidirectional',
        frequency: 'Realtime',
        tooling: 'X',
        vendor: 'Y',
      }),
    ).toBe(true);
  });

  it('isCriticalPath: outbound transactional = false', () => {
    expect(
      isCriticalPath({
        name: 'X',
        type: 'Transactional',
        direction: 'Outbound',
        frequency: 'Daily',
        tooling: '',
        vendor: '',
      }),
    ).toBe(false);
  });

  it('isCriticalPath: master-data inbound = false', () => {
    expect(
      isCriticalPath({
        name: 'X',
        type: 'Master-data',
        direction: 'Inbound',
        frequency: 'Daily',
        tooling: '',
        vendor: '',
      }),
    ).toBe(false);
  });

  it('sortByCriticality places critical-path first', () => {
    const masterData = {
      name: 'B',
      type: 'Master-data',
      direction: 'Inbound',
      frequency: 'Daily',
      tooling: '',
      vendor: '',
    };
    const critical = {
      name: 'A',
      type: 'Transactional API',
      direction: 'Bidirectional',
      frequency: 'Realtime',
      tooling: '',
      vendor: '',
    };
    const sorted = sortByCriticality([masterData, critical]);
    expect(sorted[0].name).toBe('A');
    expect(sorted[1].name).toBe('B');
  });
});

describe('Pack ZZ — integrationHelpers: NetSuite catalog', () => {
  it('lists 11 default integrations', () => {
    expect(NETSUITE_DEFAULT_CATALOG).toHaveLength(11);
  });

  it('includes Avalara, Salesforce, Workday, Coupa, Shopify, DocuSign, Concur, Snowflake, Workato', () => {
    const names = NETSUITE_DEFAULT_CATALOG.map((r) => r.name);
    expect(names.some((n) => /Avalara/i.test(n))).toBe(true);
    expect(names.some((n) => /Salesforce/i.test(n))).toBe(true);
    expect(names.some((n) => /Workday/i.test(n))).toBe(true);
    expect(names.some((n) => /Coupa/i.test(n))).toBe(true);
    expect(names.some((n) => /Shopify/i.test(n))).toBe(true);
    expect(names.some((n) => /DocuSign/i.test(n))).toBe(true);
    expect(names.some((n) => /Concur/i.test(n))).toBe(true);
    expect(names.some((n) => /Snowflake/i.test(n))).toBe(true);
    expect(names.some((n) => /Workato/i.test(n))).toBe(true);
  });
});

describe('Pack ZZ — integrationHelpers: Odoo catalog', () => {
  it('lists 6 default integrations', () => {
    expect(ODOO_DEFAULT_CATALOG).toHaveLength(6);
  });

  it('includes ZATCA E-Invoicing Phase 2 (KSA-specific)', () => {
    const names = ODOO_DEFAULT_CATALOG.map((r) => r.name);
    expect(names.some((n) => /ZATCA/i.test(n))).toBe(true);
  });

  it('Odoo defaults do not leak NetSuite-specific vocabulary', () => {
    const all = JSON.stringify(ODOO_DEFAULT_CATALOG);
    expect(all).not.toContain('NetSuite');
    expect(all).not.toContain('SuiteScript');
    expect(all).not.toContain('SDF');
    expect(all).not.toContain('OneWorld');
  });
});

describe('Pack ZZ — integrationHelpers: integrationsInScope', () => {
  it('uses overlay when provided', () => {
    const out = integrationsInScope({
      adaptorName: 'NetSuite',
      answers: {
        'integrations.catalog.integrationCatalog':
          'Custom App | Transactional | Inbound | Hourly | Custom | Custom Vendor',
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Custom App');
  });

  it('falls back to NetSuite catalog (11 integrations) when overlay sparse', () => {
    const out = integrationsInScope({ adaptorName: 'NetSuite', answers: {} });
    expect(out).toHaveLength(11);
  });

  it('falls back to Odoo catalog (6 integrations) when overlay sparse', () => {
    const out = integrationsInScope({ adaptorName: 'Odoo', answers: {} });
    expect(out).toHaveLength(6);
  });

  it('result is sorted by criticality (critical-path first)', () => {
    const out = integrationsInScope({ adaptorName: 'NetSuite', answers: {} });
    // First entry should be critical-path (Avalara is realtime + bidirectional + transactional).
    expect(isCriticalPath(out[0])).toBe(true);
  });
});

describe('Pack ZZ — integrationHelpers: indexByName', () => {
  it('indexes by lowercased name', () => {
    const idx = indexByName([{ name: 'Avalara Tax' }, { name: 'SALESFORCE' }]);
    expect(idx.get('avalara tax')).toBeDefined();
    expect(idx.get('salesforce')).toBeDefined();
  });
});
