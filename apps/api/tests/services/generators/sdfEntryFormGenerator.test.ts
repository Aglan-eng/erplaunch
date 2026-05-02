import { describe, it, expect } from 'vitest';
import { generateEntryForms } from '../../../src/services/generators/sdfEntryFormGenerator.js';
import { validateSDFBundle } from '../../../src/services/generators/sdfValidator.js';

/**
 * Pack H — Entry Form generator tests.
 *
 * Pack contract (mirror of transactionform tests, scoped to entity
 * parents):
 *   1. Re-parse customFieldsScope; group fields by entity parent.
 *   2. Emit one entryform XML per parent (Customer / Vendor / Item /
 *      Employee) with ≥1 custom field.
 *   3. scriptid = custform_<client_slug>_<recordtype_lower>;
 *      name = "<Client> <Display> Form".
 *   4. Pack B field scriptids appear as <field><id>...</id></field>.
 */

const ENTITY_HEAVY_SCOPE =
  'Customer: 2 custom fields (Tier, Industry)\n' +
  'Vendor: 2 custom fields (Audit Score, Approved Tier)\n' +
  'Item: 2 custom fields (Hazard Class, Tier-Pricing Override)\n' +
  'Employee: 1 custom field (Cost Center)';

const ATLAS_FIELDS_SCOPE =
  'Customer record: 6 custom fields (Tier, Industry, KAM, Renewal Date, Payment Terms Override, Tax Exemption Status)\n' +
  'Sales Order: 8 custom fields (Project Reference, Renewal Type, Margin Override, ARM Trigger, Shipping Priority, EU Reverse-Charge Flag, Subsidiary Source, External Order ID)\n' +
  'Item: 5 custom fields (Tier-Pricing Override, ASC-606 Performance Obligation Type, Standard Cost Variance Account, Subsidiary Restriction, Hazmat Class)\n' +
  'Vendor record: 4 custom fields (1099 Withholding Class, Approved Tier, Audit Score, Last Compliance Review Date)\n' +
  'Employee record: 3 custom fields (Cost Center, Department Hierarchy, Time-Entry Approver Override)';

const BASE_INPUT = {
  clientName: 'Atlas Industries Group',
};

describe('generateEntryForms — empty / smoke cases', () => {
  it('returns empty file map for undefined scope', () => {
    expect(generateEntryForms({ ...BASE_INPUT, customFieldsScope: undefined }).files).toEqual({});
  });

  it('returns empty file map when only transaction parents are declared', () => {
    const out = generateEntryForms({
      ...BASE_INPUT,
      customFieldsScope: 'Sales Order: 1 custom field (Project Reference)',
    });
    expect(out.files).toEqual({});
  });

  it('skips transaction parents in entry-form output', () => {
    const out = generateEntryForms({
      ...BASE_INPUT,
      customFieldsScope: ATLAS_FIELDS_SCOPE,
    });
    for (const filename of Object.keys(out.files)) {
      expect(filename).not.toMatch(/_(salesord|purchord|invoice|vendbill|journalentry|itemrcpt)\.xml$/);
    }
  });
});

describe('generateEntryForms — one form per applicable parent', () => {
  it('emits one form per entity parent with ≥1 custom field', () => {
    const out = generateEntryForms({
      ...BASE_INPUT,
      customFieldsScope: ENTITY_HEAVY_SCOPE,
    });
    expect(Object.keys(out.files)).toHaveLength(4);
  });

  it('Atlas seed produces 4 entry forms (Customer + Vendor + Item + Employee)', () => {
    const out = generateEntryForms({
      ...BASE_INPUT,
      customFieldsScope: ATLAS_FIELDS_SCOPE,
    });
    expect(Object.keys(out.files)).toContain('Objects/custform_atlas_industries_customer.xml');
    expect(Object.keys(out.files)).toContain('Objects/custform_atlas_industries_vendor.xml');
    expect(Object.keys(out.files)).toContain('Objects/custform_atlas_industries_item.xml');
    expect(Object.keys(out.files)).toContain('Objects/custform_atlas_industries_employee.xml');
  });
});

describe('generateEntryForms — form structure', () => {
  it('uses <entryform> as the root element', () => {
    const out = generateEntryForms({
      ...BASE_INPUT,
      customFieldsScope: 'Customer: 1 custom field (Tier)',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<entryform scriptid=');
    expect(xml).toContain('</entryform>');
  });

  it('form name is "<Client Name> <Display> Form"', () => {
    const out = generateEntryForms({
      ...BASE_INPUT,
      customFieldsScope: 'Customer: 1 custom field (Tier)',
    });
    expect(Object.values(out.files)[0]).toContain('<name>Atlas Industries Group Customer Form</name>');
  });

  it('recordtype enum maps Customer/Vendor/Item/Employee correctly', () => {
    const out = generateEntryForms({
      ...BASE_INPUT,
      customFieldsScope: ENTITY_HEAVY_SCOPE,
    });
    const wholeBundle = Object.values(out.files).join('\n');
    expect(wholeBundle).toContain('<recordtype>CUSTOMER</recordtype>');
    expect(wholeBundle).toContain('<recordtype>VENDOR</recordtype>');
    expect(wholeBundle).toContain('<recordtype>ITEM</recordtype>');
    expect(wholeBundle).toContain('<recordtype>EMPLOYEE</recordtype>');
  });

  it('every form is preferred=T', () => {
    const out = generateEntryForms({
      ...BASE_INPUT,
      customFieldsScope: ENTITY_HEAVY_SCOPE,
    });
    for (const xml of Object.values(out.files)) {
      expect(xml).toContain('<preferred>T</preferred>');
    }
  });
});

describe('generateEntryForms — field embedding', () => {
  it('embeds every Pack B entity field as <field><id>cust(entity|item)_*</id></field>', () => {
    const out = generateEntryForms({
      ...BASE_INPUT,
      customFieldsScope: 'Customer: 2 custom fields (Tier, Industry)',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<id>custentity_tier</id>');
    expect(xml).toContain('<id>custentity_industry</id>');
  });

  it('Item form uses custitem_* prefix (not custentity_*)', () => {
    const out = generateEntryForms({
      ...BASE_INPUT,
      customFieldsScope: 'Item: 1 custom field (Hazard Class)',
    });
    const xml = out.files['Objects/custform_atlas_industries_item.xml'];
    expect(xml).toContain('<id>custitem_hazard_class</id>');
    expect(xml).not.toContain('<id>custentity_hazard_class</id>');
  });

  it('fields wrapped under a "Custom Fields" fieldgroup', () => {
    const out = generateEntryForms({
      ...BASE_INPUT,
      customFieldsScope: 'Customer: 1 custom field (Tier)',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<id>customfields</id>');
    expect(xml).toContain('<label>Custom Fields</label>');
  });
});

describe('generateEntryForms — validator passthrough', () => {
  it('Atlas-shaped seed entry forms validate clean', () => {
    const out = generateEntryForms({
      ...BASE_INPUT,
      customFieldsScope: ATLAS_FIELDS_SCOPE,
    });
    const result = validateSDFBundle(out.files);
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });
});
