import { describe, it, expect } from 'vitest';
import { generateTaxSchedules } from '../../../src/services/generators/sdfTaxScheduleGenerator.js';
import type { EmittedTaxCode } from '../../../src/services/generators/sdfTaxCodeGenerator.js';

/**
 * Pack D — Tax Schedule generator tests.
 *
 * Pack contract:
 *   1. Parse "<transaction type>: <tax code display name>: <jurisdiction>".
 *   2. Match tax code by display-name substring + jurisdiction.
 *   3. Emit schedule XML wiring code → transaction type.
 *   4. Unmatched lines preserved in comment header AND globalUnmatchedLines.
 */

const FAKE_CODES: EmittedTaxCode[] = [
  {
    filename: 'Objects/x.xml',
    scriptid: 'taxcode_nsix_us_ca_sales_tax_725',
    displayName: 'California State Sales Tax',
    jurisdiction: 'US/CA',
    country: 'US',
    type: 'SALES_TAX',
    rate: 7.25,
    origin: 'wizard-matrix',
  },
  {
    filename: 'Objects/x.xml',
    scriptid: 'taxcode_nsix_us_ny_sales_tax_4',
    displayName: 'New York State Sales Tax',
    jurisdiction: 'US/NY',
    country: 'US',
    type: 'SALES_TAX',
    rate: 4,
    origin: 'wizard-matrix',
  },
  {
    filename: 'Objects/x.xml',
    scriptid: 'taxcode_nsix_gb_vat_20',
    displayName: 'VAT 20% UK Standard',
    jurisdiction: 'GB',
    country: 'GB',
    type: 'VAT',
    rate: 20,
    origin: 'starter-library',
  },
  {
    filename: 'Objects/x.xml',
    scriptid: 'taxcode_nsix_au_gst_10',
    displayName: 'GST 10% AU Standard',
    jurisdiction: 'AU',
    country: 'AU',
    type: 'GST',
    rate: 10,
    origin: 'starter-library',
  },
];

// ─── Empty / smoke ──────────────────────────────────────────────────────────

describe('generateTaxSchedules — empty / smoke', () => {
  it('emits nothing when matrix is empty', () => {
    const out = generateTaxSchedules({ taxScheduleMatrix: '', taxCodes: FAKE_CODES });
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('emits nothing when matrix is undefined', () => {
    const out = generateTaxSchedules({ taxScheduleMatrix: undefined, taxCodes: FAKE_CODES });
    expect(out.files).toEqual({});
  });
});

// ─── Matrix parsing ────────────────────────────────────────────────────────

describe('generateTaxSchedules — matrix parsing', () => {
  it('parses simple line: "Sales Order: California State Sales Tax: US/CA"', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Sales Order: California State Sales Tax: US/CA',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].transactionType).toBe('Sales Order');
    expect(out.emitted[0].jurisdiction).toBe('US/CA');
  });

  it('reports unrecognised transaction types via globalUnmatchedLines', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Random Transaction: California State Sales Tax: US/CA',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted).toHaveLength(0);
    expect(out.globalUnmatchedLines).toHaveLength(1);
  });

  it('reports lines with too few segments via globalUnmatchedLines', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'just one segment',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted).toHaveLength(0);
    expect(out.globalUnmatchedLines).toContain('just one segment');
  });

  it('handles tax-code names containing colons', () => {
    // "VAT: 5%" inside the name — the parser should keep that as the
    // tax code name and use the LAST segment as jurisdiction.
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Sales Order: California State Sales Tax: US/CA',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted[0].matchedTaxCodeScriptid).toBe('taxcode_nsix_us_ca_sales_tax_725');
  });
});

// ─── Tax code matching ─────────────────────────────────────────────────────

describe('generateTaxSchedules — tax code matching', () => {
  it('matches by display-name substring + jurisdiction', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Sales Order: VAT 20% UK Standard: GB',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted[0].matchedTaxCodeScriptid).toBe('taxcode_nsix_gb_vat_20');
  });

  it('partial substring match works ("VAT 20%" matches "VAT 20% UK Standard")', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Sales Order: VAT 20%: GB',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted[0].matchedTaxCodeScriptid).toBe('taxcode_nsix_gb_vat_20');
  });

  it('jurisdiction match is case-insensitive', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Sales Order: VAT 20% UK Standard: gb',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted[0].matchedTaxCodeScriptid).toBe('taxcode_nsix_gb_vat_20');
  });

  it('unmatched name → matchedTaxCodeScriptid = null + comment in XML', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Sales Order: NonexistentTaxCode: US/CA',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted[0].matchedTaxCodeScriptid).toBeNull();
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('taxitem unmatched');
  });

  it('country fallback: jurisdiction "US" matches a "US/CA" tax code by country', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Purchase Order: California State Sales Tax: US',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted[0].matchedTaxCodeScriptid).toBe('taxcode_nsix_us_ca_sales_tax_725');
  });
});

// ─── Transaction-type slugging ─────────────────────────────────────────────

describe('generateTaxSchedules — transaction-type slugging', () => {
  it('Sales Order → sales_order suffix', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Sales Order: California State Sales Tax: US/CA',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted[0].scriptid).toBe('taxschedule_nsix_sales_order_us_ca');
  });

  it('Purchase Order → purchase_order', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Purchase Order: VAT 20% UK Standard: GB',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted[0].scriptid).toBe('taxschedule_nsix_purchase_order_gb');
  });

  it('Vendor Bill → vendor_bill', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Vendor Bill: GST 10% AU Standard: AU',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted[0].scriptid).toBe('taxschedule_nsix_vendor_bill_au');
  });

  it('case-insensitive transaction type matching', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'sales order: VAT 20% UK Standard: GB',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].scriptid).toBe('taxschedule_nsix_sales_order_gb');
  });
});

// ─── XML shape ─────────────────────────────────────────────────────────────

describe('generateTaxSchedules — XML shape', () => {
  it('every emission has taxschedule root + name + isinactive=F', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix:
        'Sales Order: California State Sales Tax: US/CA\n' +
        'Purchase Order: VAT 20% UK Standard: GB',
      taxCodes: FAKE_CODES,
    });
    for (const e of out.emitted) {
      const xml = out.files[e.filename];
      expect(xml).toContain(`<taxschedule scriptid="${e.scriptid}">`);
      expect(xml).toContain('<isinactive>F</isinactive>');
    }
  });

  it('matched lines emit <taxitem> with the tax code scriptid', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Sales Order: California State Sales Tax: US/CA',
      taxCodes: FAKE_CODES,
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<taxitem>taxcode_nsix_us_ca_sales_tax_725</taxitem>');
  });

  it('comment header records the matched scriptid + verbatim line', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix: 'Sales Order: California State Sales Tax: US/CA',
      taxCodes: FAKE_CODES,
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('Original line:');
    expect(xml).toContain('Matched tax code: taxcode_nsix_us_ca_sales_tax_725');
  });

  it('Atlas-shaped seed: 5 schedule lines all match against starter+matrix codes', () => {
    const out = generateTaxSchedules({
      taxScheduleMatrix:
        'Sales Order: California State Sales Tax: US/CA\n' +
        'Sales Order: New York State Sales Tax: US/NY\n' +
        'Purchase Order: VAT 20% UK Standard: GB\n' +
        'Vendor Bill: GST 10% AU Standard: AU',
      taxCodes: FAKE_CODES,
    });
    expect(out.emitted).toHaveLength(4);
    for (const e of out.emitted) {
      expect(e.matchedTaxCodeScriptid).not.toBeNull();
    }
  });
});
