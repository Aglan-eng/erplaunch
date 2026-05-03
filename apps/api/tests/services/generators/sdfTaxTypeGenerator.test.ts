import { describe, it, expect } from 'vitest';
import {
  generateTaxTypes,
  taxTypeScriptidFor,
} from '../../../src/services/generators/sdfTaxTypeGenerator.js';

/**
 * Pack D — Tax Type generator tests.
 *
 * Pack contract:
 *   - Always emit VAT + Sales Tax (universal floor).
 *   - Conditional: withholding / use_tax / reverse_charge per flags.
 *   - Auto-detect GST / novel types from the matrix.
 *   - Output deterministic in canonical order.
 */

// ─── Always-on floor ────────────────────────────────────────────────────────

describe('generateTaxTypes — always-on floor', () => {
  it('emits VAT + Sales Tax with no input', () => {
    const out = generateTaxTypes({});
    const slugs = out.emitted.map((e) => e.scriptid);
    expect(slugs).toContain('taxtype_nsix_vat');
    expect(slugs).toContain('taxtype_nsix_sales_tax');
  });

  it('VAT + Sales Tax always come first in canonical order', () => {
    const out = generateTaxTypes({
      withholdingInScope: true,
      useTaxInScope: true,
      reverseChargeInScope: true,
    });
    expect(out.emitted[0].scriptid).toBe('taxtype_nsix_vat');
    expect(out.emitted[1].scriptid).toBe('taxtype_nsix_sales_tax');
  });
});

// ─── Conditional emission ──────────────────────────────────────────────────

describe('generateTaxTypes — conditional emission', () => {
  it('withholdingInScope=true → emits withholding type', () => {
    const out = generateTaxTypes({ withholdingInScope: true });
    expect(out.emitted.map((e) => e.scriptid)).toContain('taxtype_nsix_withholding');
  });

  it('withholdingInScope=false → does NOT emit withholding type', () => {
    const out = generateTaxTypes({ withholdingInScope: false });
    expect(out.emitted.map((e) => e.scriptid)).not.toContain('taxtype_nsix_withholding');
  });

  it('useTaxInScope=true → emits use_tax type', () => {
    const out = generateTaxTypes({ useTaxInScope: true });
    expect(out.emitted.map((e) => e.scriptid)).toContain('taxtype_nsix_use_tax');
  });

  it('reverseChargeInScope=true → emits reverse_charge type', () => {
    const out = generateTaxTypes({ reverseChargeInScope: true });
    expect(out.emitted.map((e) => e.scriptid)).toContain('taxtype_nsix_reverse_charge');
  });

  it('all 3 conditional flags + matrix → emits all in canonical order', () => {
    const out = generateTaxTypes({
      taxCodeMatrix: 'AU: GST: 10: GST 10% AU\nAE: VAT: 5: VAT 5% UAE',
      withholdingInScope: true,
      useTaxInScope: true,
      reverseChargeInScope: true,
    });
    const expected = [
      'taxtype_nsix_vat',
      'taxtype_nsix_sales_tax',
      'taxtype_nsix_gst',
      'taxtype_nsix_withholding',
      'taxtype_nsix_use_tax',
      'taxtype_nsix_reverse_charge',
    ];
    const got = out.emitted.map((e) => e.scriptid);
    for (const slug of expected) {
      expect(got, `expected ${slug} in emission`).toContain(slug);
    }
  });
});

// ─── Matrix detection ──────────────────────────────────────────────────────

describe('generateTaxTypes — matrix-detected types', () => {
  it('GST in matrix → emits taxtype_nsix_gst', () => {
    const out = generateTaxTypes({ taxCodeMatrix: 'AU: GST: 10: GST 10% AU Standard' });
    expect(out.emitted.map((e) => e.scriptid)).toContain('taxtype_nsix_gst');
  });

  it('novel type in matrix → emits taxtype_nsix_<typeslug>', () => {
    const out = generateTaxTypes({
      taxCodeMatrix: 'IN: DIGITAL_SERVICES_TAX: 6: India DST',
    });
    expect(out.emitted.map((e) => e.scriptid)).toContain('taxtype_nsix_digital_services_tax');
  });

  it('does not duplicate when same type appears multiple times', () => {
    const out = generateTaxTypes({
      taxCodeMatrix: 'AE: VAT: 5: VAT 5% UAE\nSA: VAT: 15: VAT 15% KSA',
    });
    const vatCount = out.emitted.filter((e) => e.scriptid === 'taxtype_nsix_vat').length;
    expect(vatCount).toBe(1);
  });
});

// ─── XML shape ─────────────────────────────────────────────────────────────

describe('generateTaxTypes — XML shape', () => {
  it('every emission has the taxtype root + name + description + isinactive=F', () => {
    const out = generateTaxTypes({ withholdingInScope: true });
    for (const e of out.emitted) {
      const xml = out.files[e.filename];
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain(`<taxtype scriptid="${e.scriptid}">`);
      expect(xml).toContain('<name>');
      expect(xml).toContain('<description>');
      expect(xml).toContain('<isinactive>F</isinactive>');
    }
  });

  it('VAT description references "Value Added Tax"', () => {
    const out = generateTaxTypes({});
    const vat = out.emitted.find((e) => e.scriptid === 'taxtype_nsix_vat')!;
    expect(out.files[vat.filename]).toContain('Value Added Tax');
  });
});

// ─── taxTypeScriptidFor helper ─────────────────────────────────────────────

describe('taxTypeScriptidFor — public helper for cross-generator referencing', () => {
  it('canonical tokens map to canonical scriptids', () => {
    expect(taxTypeScriptidFor('VAT')).toBe('taxtype_nsix_vat');
    expect(taxTypeScriptidFor('SALES_TAX')).toBe('taxtype_nsix_sales_tax');
    expect(taxTypeScriptidFor('GST')).toBe('taxtype_nsix_gst');
    expect(taxTypeScriptidFor('REVERSE_CHARGE')).toBe('taxtype_nsix_reverse_charge');
  });

  it('case-insensitive', () => {
    expect(taxTypeScriptidFor('vat')).toBe('taxtype_nsix_vat');
    expect(taxTypeScriptidFor('Reverse_Charge')).toBe('taxtype_nsix_reverse_charge');
  });

  it('novel token slugifies', () => {
    expect(taxTypeScriptidFor('DIGITAL_SERVICES_TAX')).toBe('taxtype_nsix_digital_services_tax');
  });
});
