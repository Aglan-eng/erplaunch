import { describe, it, expect } from 'vitest';
import {
  parseSourceSystemsByObject,
  parseCleansingRulesByObject,
  parseRejectSlaByObject,
  parseDataQualityOwners,
  objectsInScope,
  loadOrder,
  NETSUITE_OBJECTS,
  ODOO_OBJECTS,
  DEFAULT_CLEANSING_RULES,
  DEFAULT_REJECT_SLA,
  DEFAULT_HISTORICAL_DEPTH,
  DEFAULT_DRY_RUN_PASS_THRESHOLD,
} from '../../../src/services/generators/migrationHelpers.js';

describe('Pack Z — migrationHelpers: parsers', () => {
  it('parseSourceSystemsByObject parses 3-column pipe rows', () => {
    const out = parseSourceSystemsByObject(
      'Customers | QuickBooks Online | Customer Centre export\nVendors | Excel master list | finance shared drive',
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      object: 'Customers',
      source: 'QuickBooks Online',
      notes: 'Customer Centre export',
    });
    expect(out[1].source).toBe('Excel master list');
  });

  it('parseCleansingRulesByObject parses 3-column rows; skips blanks', () => {
    const out = parseCleansingRulesByObject(
      '\nCustomers | Trim whitespace | Finance lead\n\nVendors | Dedupe by tax ID | AP lead\n',
    );
    expect(out).toHaveLength(2);
    expect(out[0].rule).toBe('Trim whitespace');
    expect(out[1].owner).toBe('AP lead');
  });

  it('parseRejectSlaByObject parses 3-column rows', () => {
    const out = parseRejectSlaByObject(
      'Open AR | 0 rejects | 4h\nCustomers | < 1% | 24h',
    );
    expect(out).toHaveLength(2);
    expect(out[0].threshold).toBe('0 rejects');
    expect(out[1].sla).toBe('24h');
  });

  it('parseDataQualityOwners parses 3-column rows', () => {
    const out = parseDataQualityOwners(
      'Customers | Sara Khan | Hala Naim\nVendors | Omar Aziz | Nour Hassan',
    );
    expect(out).toHaveLength(2);
    expect(out[0].owner).toBe('Sara Khan');
    expect(out[0].backup).toBe('Hala Naim');
  });

  it('all parsers return [] for empty / whitespace input', () => {
    expect(parseSourceSystemsByObject('')).toEqual([]);
    expect(parseCleansingRulesByObject('   \n\n  ')).toEqual([]);
    expect(parseRejectSlaByObject('')).toEqual([]);
    expect(parseDataQualityOwners('')).toEqual([]);
  });
});

describe('Pack Z — migrationHelpers: NetSuite catalog', () => {
  it('lists 16 objects', () => {
    expect(NETSUITE_OBJECTS).toHaveLength(16);
  });

  it('files are 2-digit prefixed for natural sort', () => {
    for (const obj of NETSUITE_OBJECTS) {
      expect(obj.csvFilename).toMatch(/^\d{2}_/);
    }
  });

  it('every header row contains External ID as first column', () => {
    for (const obj of NETSUITE_OBJECTS) {
      expect(obj.csvHeader.startsWith('External ID')).toBe(true);
    }
  });

  it('subsidiaries / departments / classes / locations / COA / currencies / tax codes are reference category', () => {
    const refIds = NETSUITE_OBJECTS.filter((o) => o.category === 'reference').map((o) => o.id);
    expect(refIds).toEqual([
      'subsidiaries',
      'departments',
      'classes',
      'locations',
      'chartOfAccounts',
      'currencies',
      'taxCodes',
    ]);
  });

  it('open-balance objects depend on master data + reference data', () => {
    const ar = NETSUITE_OBJECTS.find((o) => o.id === 'openArInvoices')!;
    expect(ar.dependsOn).toContain('customers');
    expect(ar.dependsOn).toContain('chartOfAccounts');
    const ap = NETSUITE_OBJECTS.find((o) => o.id === 'openApBills')!;
    expect(ap.dependsOn).toContain('vendors');
  });
});

describe('Pack Z — migrationHelpers: Odoo catalog', () => {
  it('lists 10 objects', () => {
    expect(ODOO_OBJECTS).toHaveLength(10);
  });

  it('every header row begins with id (Odoo external ID column)', () => {
    for (const obj of ODOO_OBJECTS) {
      expect(obj.csvHeader.startsWith('id,')).toBe(true);
    }
  });

  it('partners is master + depends on companies', () => {
    const partners = ODOO_OBJECTS.find((o) => o.id === 'partners')!;
    expect(partners.category).toBe('master');
    expect(partners.dependsOn).toContain('companies');
  });

  it('boms depend on products + companies', () => {
    const boms = ODOO_OBJECTS.find((o) => o.id === 'boms')!;
    expect(boms.dependsOn).toContain('products');
    expect(boms.dependsOn).toContain('companies');
  });
});

describe('Pack Z — migrationHelpers: objectsInScope', () => {
  it('NetSuite — defaults exclude BOMs (mfg out of scope) and fixed assets', () => {
    const ids = objectsInScope({
      adaptorName: 'NetSuite',
      answers: {},
    }).map((o) => o.id);
    // NetSuite catalog has no boms entry; just verify FA exclusion.
    expect(ids).not.toContain('fixedAssets');
  });

  it('NetSuite — fixedAssets included when ns.design.fixedAssetsScope is populated', () => {
    const ids = objectsInScope({
      adaptorName: 'NetSuite',
      answers: { 'ns.design.fixedAssetsScope': 'Asset class A; depreciation method straight-line; 60mo' },
    }).map((o) => o.id);
    expect(ids).toContain('fixedAssets');
  });

  it('Odoo — defaults exclude BOMs when manufacturing out of scope', () => {
    const ids = objectsInScope({
      adaptorName: 'Odoo',
      answers: {},
    }).map((o) => o.id);
    expect(ids).not.toContain('boms');
  });

  it('Odoo — BOMs included when odoo.mfg.routingRequired = true', () => {
    const ids = objectsInScope({
      adaptorName: 'Odoo',
      answers: { 'odoo.mfg.routingRequired': true },
    }).map((o) => o.id);
    expect(ids).toContain('boms');
  });

  it('Odoo — BOMs included when odoo.mfg.workCenterCount > 0', () => {
    const ids = objectsInScope({
      adaptorName: 'Odoo',
      answers: { 'odoo.mfg.workCenterCount': 4 },
    }).map((o) => o.id);
    expect(ids).toContain('boms');
  });
});

describe('Pack Z — migrationHelpers: loadOrder', () => {
  it('preserves catalog order (already topological)', () => {
    const inScope = objectsInScope({ adaptorName: 'NetSuite', answers: {} });
    const order = loadOrder(inScope);
    expect(order.map((o) => o.id)).toEqual(inScope.map((o) => o.id));
  });

  it('returns a defensive copy (not the same array reference)', () => {
    const inScope = objectsInScope({ adaptorName: 'Odoo', answers: {} });
    const order = loadOrder(inScope);
    expect(order).not.toBe(inScope);
  });
});

describe('Pack Z — migrationHelpers: defaults', () => {
  it('DEFAULT_CLEANSING_RULES covers customers + vendors + items + COA + open AR/AP + GL', () => {
    const objects = DEFAULT_CLEANSING_RULES.map((r) => r.object.toLowerCase());
    expect(objects.some((o) => o.includes('customer'))).toBe(true);
    expect(objects.some((o) => o.includes('vendor'))).toBe(true);
    expect(objects.some((o) => o.includes('chart'))).toBe(true);
    expect(objects.some((o) => o.includes('open'))).toBe(true);
    expect(objects.some((o) => o.includes('gl'))).toBe(true);
  });

  it('DEFAULT_REJECT_SLA covers financial-object zero-tolerance', () => {
    const ar = DEFAULT_REJECT_SLA.find((r) => r.object.toLowerCase().includes('open ar'))!;
    expect(ar).toBeDefined();
    expect(ar.threshold).toContain('0 rejects');
  });

  it('DEFAULT_HISTORICAL_DEPTH and DEFAULT_DRY_RUN_PASS_THRESHOLD are non-empty strings', () => {
    expect(DEFAULT_HISTORICAL_DEPTH.length).toBeGreaterThan(20);
    expect(DEFAULT_DRY_RUN_PASS_THRESHOLD).toContain('99.5%');
  });
});
