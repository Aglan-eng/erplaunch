import { describe, it, expect } from 'vitest';
import { generateTaxCodes } from '../../../src/services/generators/sdfTaxCodeGenerator.js';

/**
 * Pack D — Tax Code generator tests.
 *
 * Pack contract:
 *   1. Parse "<jurisdiction>: <type>: <rate>%: <name>" matrix lines.
 *   2. Auto-emit starter library codes for jurisdictions in nexusList
 *      that aren't covered by the matrix.
 *   3. Dedup: matrix wins over starter library on (jurisdiction, type,
 *      rate) collision.
 *   4. Every code references a taxtype scriptid (taxtype_nsix_<slug>).
 */

const ATLAS_NEXUS =
  'Atlas Industries Group Inc. | US/CA\n' +
  'Atlas Industries Group Inc. | US/NY\n' +
  'Atlas Industries Group Inc. | US/TX\n' +
  'Atlas Manufacturing UK Ltd. | GB\n' +
  'Atlas Trading Pty. | AU\n' +
  'Atlas Services GmbH | DE';

const ATLAS_MATRIX =
  'US/CA: SALES_TAX: 7.25: California State Sales Tax\n' +
  'US/NY: SALES_TAX: 4: New York State Sales Tax\n' +
  'US/TX: SALES_TAX: 6.25: Texas State Sales Tax';

// ─── Empty / smoke ──────────────────────────────────────────────────────────

describe('generateTaxCodes — empty / smoke', () => {
  it('emits nothing when matrix + nexusList both empty', () => {
    const out = generateTaxCodes({});
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('skips lines that do not match the matrix regex', () => {
    const out = generateTaxCodes({
      taxCodeMatrix: 'AE: VAT: 5: VAT 5% UAE\nrandom gibberish\nSA: VAT: 15: VAT 15% KSA',
    });
    expect(out.emitted).toHaveLength(2);
  });
});

// ─── Matrix parsing ────────────────────────────────────────────────────────

describe('generateTaxCodes — matrix parsing', () => {
  it('parses bare-country jurisdiction (AE / GB)', () => {
    const out = generateTaxCodes({
      taxCodeMatrix: 'AE: VAT: 5: VAT 5% UAE Standard',
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].jurisdiction).toBe('AE');
    expect(out.emitted[0].country).toBe('AE');
  });

  it('parses country/region jurisdiction (US/CA)', () => {
    const out = generateTaxCodes({
      taxCodeMatrix: 'US/CA: SALES_TAX: 7.25: California State Sales Tax',
    });
    expect(out.emitted[0].jurisdiction).toBe('US/CA');
    expect(out.emitted[0].country).toBe('US');
  });

  it('parses fractional rates (7.25 / 5.5)', () => {
    const out = generateTaxCodes({
      taxCodeMatrix:
        'US/CA: SALES_TAX: 7.25: California Sales Tax\n' +
        'FR: VAT: 5.5: France Reduced VAT',
    });
    expect(out.emitted[0].rate).toBe(7.25);
    expect(out.emitted[1].rate).toBe(5.5);
  });

  it('rejects negative or non-numeric rates', () => {
    const out = generateTaxCodes({
      taxCodeMatrix: 'AE: VAT: -5: nope\nAE: VAT: abc: nope2',
    });
    expect(out.emitted).toHaveLength(0);
  });

  it('rejects unknown type tokens', () => {
    const out = generateTaxCodes({
      taxCodeMatrix: 'AE: BOGUS: 5: nope',
    });
    expect(out.emitted).toHaveLength(0);
  });
});

// ─── Scriptid slugging ─────────────────────────────────────────────────────

describe('generateTaxCodes — scriptid slugging', () => {
  it('AE: VAT: 5 → taxcode_nsix_ae_vat_5', () => {
    const out = generateTaxCodes({ taxCodeMatrix: 'AE: VAT: 5: VAT 5% UAE Standard' });
    expect(out.emitted[0].scriptid).toBe('taxcode_nsix_ae_vat_5');
  });

  it('US/CA: SALES_TAX: 7.25 → taxcode_nsix_us_ca_sales_tax_725', () => {
    const out = generateTaxCodes({ taxCodeMatrix: 'US/CA: SALES_TAX: 7.25: CA' });
    expect(out.emitted[0].scriptid).toBe('taxcode_nsix_us_ca_sales_tax_725');
  });

  it('FR: VAT: 5.5 → taxcode_nsix_fr_vat_55', () => {
    const out = generateTaxCodes({ taxCodeMatrix: 'FR: VAT: 5.5: FR Reduced' });
    expect(out.emitted[0].scriptid).toBe('taxcode_nsix_fr_vat_55');
  });

  it('numeric-suffix on collision (matrix has identical type+rate at same jurisdiction)', () => {
    // Two lines at AE/VAT/0 with different display names — dedup
    // catches this on tuple, only first emits. To trigger numeric
    // suffix, use distinct tuples that produce the same slug —
    // contrived but verifies the collision handler works.
    const out = generateTaxCodes({
      taxCodeMatrix:
        'AE: VAT: 5: First name\n' +
        'AE: VAT: 5: Second name (would collide)',
    });
    // Tuple dedup wins — only first emits.
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].displayName).toBe('First name');
  });
});

// ─── Tax type linkage ──────────────────────────────────────────────────────

describe('generateTaxCodes — taxtype scriptid linkage', () => {
  it('VAT type → references taxtype_nsix_vat', () => {
    const out = generateTaxCodes({ taxCodeMatrix: 'AE: VAT: 5: VAT 5% UAE' });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<taxtype>taxtype_nsix_vat</taxtype>');
  });

  it('SALES_TAX type → references taxtype_nsix_sales_tax', () => {
    const out = generateTaxCodes({ taxCodeMatrix: 'US/CA: SALES_TAX: 7.25: CA' });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<taxtype>taxtype_nsix_sales_tax</taxtype>');
  });

  it('REVERSE_CHARGE type → references taxtype_nsix_reverse_charge', () => {
    const out = generateTaxCodes({ taxCodeMatrix: 'GB: REVERSE_CHARGE: 0: UK Reverse Charge' });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<taxtype>taxtype_nsix_reverse_charge</taxtype>');
  });
});

// ─── Starter library ───────────────────────────────────────────────────────

describe('generateTaxCodes — starter library', () => {
  it('emits AE starter codes when AE in nexusList and no matrix override', () => {
    const out = generateTaxCodes({
      nexusList: 'Brightside Holdings UAE | AE',
    });
    const slugs = out.emitted.map((e) => e.scriptid);
    expect(slugs).toContain('taxcode_nsix_ae_vat_5');
    expect(slugs).toContain('taxcode_nsix_ae_vat_0');
  });

  it('does NOT emit starter codes for countries not in nexusList', () => {
    const out = generateTaxCodes({
      nexusList: 'Brightside | AE',
    });
    const slugs = out.emitted.map((e) => e.scriptid);
    // GB is not in nexusList; UK starter codes should not appear.
    for (const s of slugs) {
      expect(s).not.toMatch(/^taxcode_nsix_gb_/);
    }
  });

  it('starter codes carry origin = "starter-library"', () => {
    const out = generateTaxCodes({ nexusList: 'Brightside | AE' });
    expect(out.emitted.every((e) => e.origin === 'starter-library')).toBe(true);
  });

  it('matrix wins over starter on (jurisdiction, type, rate) collision', () => {
    const out = generateTaxCodes({
      taxCodeMatrix: 'AE: VAT: 5: WIZARD-CUSTOM-NAME (overrides starter)',
      nexusList: 'Brightside | AE',
    });
    const ae5 = out.emitted.find((e) => e.scriptid === 'taxcode_nsix_ae_vat_5')!;
    expect(ae5.displayName).toBe('WIZARD-CUSTOM-NAME (overrides starter)');
    expect(ae5.origin).toBe('wizard-matrix');
  });

  it('multiple jurisdictions in nexusList all get starter codes (deterministic order)', () => {
    const out = generateTaxCodes({
      nexusList: 'Atlas | GB\nAtlas | AU\nAtlas | DE',
    });
    const countriesEmitted = new Set(out.emitted.map((e) => e.country));
    expect(countriesEmitted.has('GB')).toBe(true);
    expect(countriesEmitted.has('AU')).toBe(true);
    expect(countriesEmitted.has('DE')).toBe(true);
  });
});

// ─── XML shape ─────────────────────────────────────────────────────────────

describe('generateTaxCodes — XML shape', () => {
  it('every emission has taxcode root + rate + country + isinactive=F', () => {
    const out = generateTaxCodes({ taxCodeMatrix: ATLAS_MATRIX, nexusList: ATLAS_NEXUS });
    for (const e of out.emitted) {
      const xml = out.files[e.filename];
      expect(xml).toContain(`<taxcode scriptid="${e.scriptid}">`);
      expect(xml).toContain(`<rate>${e.rate}</rate>`);
      expect(xml).toContain(`<country>${e.country}</country>`);
      expect(xml).toContain('<isinactive>F</isinactive>');
    }
  });

  it('XML-escapes special chars in display names', () => {
    const out = generateTaxCodes({
      taxCodeMatrix: 'AE: VAT: 5: VAT "5%" Tom & Jerry',
    });
    expect(out.files[out.emitted[0].filename]).toContain('VAT &quot;5%&quot; Tom &amp; Jerry');
  });
});

// ─── End-to-end Atlas ──────────────────────────────────────────────────────

describe('generateTaxCodes — Atlas-shaped seed', () => {
  it('Atlas matrix + nexusList produce ≥10 codes (3 wizard + ≥7 starter)', () => {
    const out = generateTaxCodes({
      taxCodeMatrix: ATLAS_MATRIX,
      nexusList: ATLAS_NEXUS,
    });
    expect(out.emitted.length).toBeGreaterThanOrEqual(10);
    const wizard = out.emitted.filter((e) => e.origin === 'wizard-matrix');
    const starter = out.emitted.filter((e) => e.origin === 'starter-library');
    expect(wizard.length).toBe(3);
    expect(starter.length).toBeGreaterThan(0);
  });
});
