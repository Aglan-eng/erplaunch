import { describe, it, expect } from 'vitest';
import { generateCurrencies } from '../../../src/services/generators/sdfCurrencyGenerator.js';

/**
 * Pack A — Currency generator tests.
 *
 * Pack contract:
 *   1. One currency XML per ISO 4217 code, deduped + uppercased.
 *   2. Known codes get name + symbol from a curated lookup; unknown
 *      codes fall back to {name: code, symbol: code}.
 *   3. scriptid = `currency_<lowercase_iso>`; output keyed by
 *      `Objects/<scriptid>.xml`.
 */

describe('generateCurrencies — empty / smoke', () => {
  it('returns empty file map for empty array', () => {
    const out = generateCurrencies({ currencies: [] });
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('drops non-ISO codes (≠3 alpha chars)', () => {
    const out = generateCurrencies({ currencies: ['US', 'EURO', 'usd', '12X'] });
    // 'US' → length 2 → drop
    // 'EURO' → length 4 → drop
    // 'usd' → upcase + valid → keep as USD
    // '12X' → contains digit → drop
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].iso).toBe('USD');
  });

  it('dedupes codes across input', () => {
    const out = generateCurrencies({ currencies: ['USD', 'USD', 'usd', 'EUR'] });
    expect(out.emitted).toHaveLength(2);
    expect(out.emitted.map((e) => e.iso).sort()).toEqual(['EUR', 'USD']);
  });
});

describe('generateCurrencies — known + unknown lookup', () => {
  it('USD resolves to "US Dollar" + "$"', () => {
    const out = generateCurrencies({ currencies: ['USD'] });
    const e = out.emitted[0];
    expect(e.name).toBe('US Dollar');
    expect(e.symbol).toBe('$');
    expect(out.files[e.filename]).toContain('<name>US Dollar</name>');
    expect(out.files[e.filename]).toContain('<symbol>$</symbol>');
  });

  it('AED resolves to "UAE Dirham" + "AED"', () => {
    const out = generateCurrencies({ currencies: ['AED'] });
    expect(out.emitted[0].name).toBe('UAE Dirham');
    expect(out.emitted[0].symbol).toBe('AED');
  });

  it('SAR + EGP + KSA-region codes resolve cleanly', () => {
    const out = generateCurrencies({ currencies: ['SAR', 'EGP', 'BHD', 'QAR'] });
    const names = out.emitted.map((e) => e.name);
    expect(names).toContain('Saudi Riyal');
    expect(names).toContain('Egyptian Pound');
    expect(names).toContain('Bahraini Dinar');
    expect(names).toContain('Qatari Riyal');
  });

  it('unknown codes fall back to {name: code, symbol: code}', () => {
    const out = generateCurrencies({ currencies: ['ZZZ'] });
    expect(out.emitted[0].name).toBe('ZZZ');
    expect(out.emitted[0].symbol).toBe('ZZZ');
  });

  it('XML-escapes special chars in symbols (£/€/¥/₹/₦ pass through unchanged in UTF-8)', () => {
    const out = generateCurrencies({ currencies: ['GBP', 'EUR', 'JPY'] });
    expect(out.files['Objects/currency_gbp.xml']).toContain('<symbol>£</symbol>');
    expect(out.files['Objects/currency_eur.xml']).toContain('<symbol>€</symbol>');
    expect(out.files['Objects/currency_jpy.xml']).toContain('<symbol>¥</symbol>');
  });
});

describe('generateCurrencies — XML shape', () => {
  it('uses <currency scriptid="currency_<iso_lower>"> as the root element', () => {
    const out = generateCurrencies({ currencies: ['USD'] });
    expect(out.files['Objects/currency_usd.xml']).toContain(
      '<currency scriptid="currency_usd">',
    );
  });

  it('declares isbasecurrency=F + isinactive=F + currencyprecision=2', () => {
    const out = generateCurrencies({ currencies: ['USD'] });
    const xml = out.files['Objects/currency_usd.xml'];
    expect(xml).toContain('<isbasecurrency>F</isbasecurrency>');
    expect(xml).toContain('<isinactive>F</isinactive>');
    expect(xml).toContain('<currencyprecision>2</currencyprecision>');
  });

  it('declares symbolplacement=_BEFORENUMBER', () => {
    const out = generateCurrencies({ currencies: ['USD'] });
    expect(out.files['Objects/currency_usd.xml']).toContain(
      '<symbolplacement>_BEFORENUMBER</symbolplacement>',
    );
  });

  it('Atlas-shaped seed produces 4 currencies (USD/GBP/AUD/EUR)', () => {
    const out = generateCurrencies({ currencies: ['USD', 'GBP', 'AUD', 'EUR'] });
    expect(out.emitted).toHaveLength(4);
    expect(Object.keys(out.files).sort()).toEqual([
      'Objects/currency_aud.xml',
      'Objects/currency_eur.xml',
      'Objects/currency_gbp.xml',
      'Objects/currency_usd.xml',
    ]);
  });
});
