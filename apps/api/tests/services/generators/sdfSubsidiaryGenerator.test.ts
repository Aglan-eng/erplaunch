import { describe, it, expect } from 'vitest';
import {
  generateSubsidiaries,
  extractCurrenciesFromSubsidiaries,
} from '../../../src/services/generators/sdfSubsidiaryGenerator.js';

/**
 * Pack A — Subsidiary generator tests.
 *
 * Pack contract:
 *   1. Parse the wizard's free-text TEXTAREA into one subsidiary per line.
 *   2. Map each line to a subsidiary XML with name / country / currency /
 *      iselimination / parent fields populated.
 *   3. Resolve parent references between subsidiaries by name, output as
 *      NetSuite [scriptid=subsidiary_*] bracketed reference syntax.
 *   4. When the elimination entity is supplied AND ≥2 subsidiaries are
 *      parsed, emit one extra subsidiary XML with iselimination=T,
 *      parent=root subsidiary.
 *   5. extractCurrenciesFromSubsidiaries returns deduped uppercased ISO
 *      4217 codes from the parsed list.
 */

const ATLAS_LIST =
  'Atlas Industries Group Inc., US, USD, parent\n' +
  'Atlas Manufacturing UK Ltd., GB, GBP, Atlas Industries Group Inc.\n' +
  'Atlas Trading Pty., AU, AUD, Atlas Industries Group Inc.\n' +
  'Atlas Services GmbH, DE, EUR, Atlas Industries Group Inc.';

const BRIGHTSIDE_LIST =
  'Brightside Holdings UAE, Dubai, AED, parent\n' +
  'Brightside Manufacturing KSA, Riyadh, SAR, Brightside Holdings UAE\n' +
  'Brightside Egypt, Cairo, EGP, Brightside Holdings UAE\n' +
  'Brightside R&D USA, Boston (MA), USD, Brightside Holdings UAE';

// ─── Empty / smoke ──────────────────────────────────────────────────────────

describe('generateSubsidiaries — empty / smoke cases', () => {
  it('returns empty file map for undefined subsidiaryList', () => {
    const out = generateSubsidiaries({
      subsidiaryList: undefined,
      eliminationEntity: 'Some Elimination Entity',
    });
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('returns empty file map for whitespace-only subsidiaryList', () => {
    const out = generateSubsidiaries({
      subsidiaryList: '   \n\n\t',
      eliminationEntity: '',
    });
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('skips lines with fewer than 4 comma-separated fields', () => {
    const out = generateSubsidiaries({
      subsidiaryList:
        'incomplete line\n' +
        'Atlas Industries Group Inc., US, USD, parent\n' +
        'just two fields, here',
      eliminationEntity: '',
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].name).toBe('Atlas Industries Group Inc.');
  });
});

// ─── Single + multi entity ──────────────────────────────────────────────────

describe('generateSubsidiaries — single + multi entity', () => {
  it('emits one XML for single-entity engagement (no elimination)', () => {
    const out = generateSubsidiaries({
      subsidiaryList: 'Acme Corp, US, USD, parent',
      eliminationEntity: 'Acme Group Eliminations',
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].isElimination).toBe(false);
    // Single-entity engagements don't need an elimination subsidiary
    expect(out.emitted.some((e) => e.isElimination)).toBe(false);
  });

  it('emits one XML per Atlas subsidiary + 1 elimination = 5', () => {
    const out = generateSubsidiaries({
      subsidiaryList: ATLAS_LIST,
      eliminationEntity: 'Atlas Group Eliminations',
    });
    expect(out.emitted).toHaveLength(5);
    expect(out.emitted.filter((e) => e.isElimination)).toHaveLength(1);
  });

  it('emits one XML per Brightside subsidiary + 1 elimination = 5', () => {
    const out = generateSubsidiaries({
      subsidiaryList: BRIGHTSIDE_LIST,
      eliminationEntity: 'Brightside Group Eliminations (UAE)',
    });
    expect(out.emitted).toHaveLength(5);
    expect(out.emitted.filter((e) => e.isElimination)).toHaveLength(1);
  });

  it('omits elimination subsidiary when eliminationEntity is empty / undefined', () => {
    const out = generateSubsidiaries({
      subsidiaryList: ATLAS_LIST,
      eliminationEntity: '',
    });
    expect(out.emitted.filter((e) => e.isElimination)).toHaveLength(0);
  });
});

// ─── XML shape ──────────────────────────────────────────────────────────────

describe('generateSubsidiaries — XML shape', () => {
  it('every emitted XML has the correct root + scriptid format', () => {
    const out = generateSubsidiaries({
      subsidiaryList: ATLAS_LIST,
      eliminationEntity: 'Atlas Group Eliminations',
    });
    for (const sub of out.emitted) {
      const xml = out.files[sub.filename];
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain(`<subsidiary scriptid="${sub.scriptid}">`);
      expect(xml).toContain('</subsidiary>');
    }
  });

  it('root subsidiary has empty <parent></parent>; child has [scriptid=...]', () => {
    const out = generateSubsidiaries({
      subsidiaryList: ATLAS_LIST,
      eliminationEntity: '',
    });
    const root = out.files['Objects/subsidiary_atlas_industries_group_inc.xml'];
    const uk = out.files['Objects/subsidiary_atlas_manufacturing_uk_ltd.xml'];
    expect(root).toContain('<parent></parent>');
    expect(uk).toContain('<parent>[scriptid=subsidiary_atlas_industries_group_inc]</parent>');
  });

  it('elimination subsidiary has iselimination=T and points at the root', () => {
    const out = generateSubsidiaries({
      subsidiaryList: ATLAS_LIST,
      eliminationEntity: 'Atlas Group Eliminations',
    });
    const elim = out.emitted.find((e) => e.isElimination);
    expect(elim).toBeDefined();
    const xml = out.files[elim!.filename];
    expect(xml).toContain('<iselimination>T</iselimination>');
    expect(xml).toContain('<parent>[scriptid=subsidiary_atlas_industries_group_inc]</parent>');
  });

  it('non-elimination subsidiaries have iselimination=F', () => {
    const out = generateSubsidiaries({
      subsidiaryList: ATLAS_LIST,
      eliminationEntity: 'Atlas Group Eliminations',
    });
    for (const sub of out.emitted.filter((e) => !e.isElimination)) {
      expect(out.files[sub.filename]).toContain('<iselimination>F</iselimination>');
    }
  });

  it('every emitted XML has currency + isinactive=F populated', () => {
    const out = generateSubsidiaries({
      subsidiaryList: ATLAS_LIST,
      eliminationEntity: '',
    });
    for (const sub of out.emitted) {
      const xml = out.files[sub.filename];
      expect(xml).toContain(`<currency>${sub.currency}</currency>`);
      expect(xml).toContain('<isinactive>F</isinactive>');
    }
  });

  it('XML-escapes ampersands in subsidiary names', () => {
    const out = generateSubsidiaries({
      subsidiaryList: 'Brightside R&D USA, Boston (MA), USD, parent',
      eliminationEntity: '',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<name>Brightside R&amp;D USA</name>');
  });

  it('emits a comment header with the original wizard line', () => {
    const out = generateSubsidiaries({
      subsidiaryList: 'Atlas Industries Group Inc., US, USD, parent',
      eliminationEntity: '',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('Original line: "Atlas Industries Group Inc., US, USD, parent"');
  });
});

// ─── Country inference ──────────────────────────────────────────────────────

describe('generateSubsidiaries — country inference', () => {
  it('infers AE from "Dubai" / "UAE"', () => {
    const out = generateSubsidiaries({
      subsidiaryList: 'Acme Dubai, Dubai, AED, parent',
      eliminationEntity: '',
    });
    expect(out.emitted[0].country).toBe('AE');
  });

  it('infers SA from "Riyadh" / "KSA"', () => {
    const out = generateSubsidiaries({
      subsidiaryList: 'Acme KSA, Riyadh, SAR, parent',
      eliminationEntity: '',
    });
    expect(out.emitted[0].country).toBe('SA');
  });

  it('infers EG from "Cairo"', () => {
    const out = generateSubsidiaries({
      subsidiaryList: 'Acme Egypt, Cairo, EGP, parent',
      eliminationEntity: '',
    });
    expect(out.emitted[0].country).toBe('EG');
  });

  it('infers US from "Boston (MA)" — caught by state abbrev OR Boston', () => {
    const out = generateSubsidiaries({
      subsidiaryList: 'Acme USA, Boston (MA), USD, parent',
      eliminationEntity: '',
    });
    expect(out.emitted[0].country).toBe('US');
  });

  it('falls back to empty country when no rule matches', () => {
    const out = generateSubsidiaries({
      subsidiaryList: 'Acme Mystery, Atlantis, USD, parent',
      eliminationEntity: '',
    });
    expect(out.emitted[0].country).toBe('');
  });
});

// ─── extractCurrenciesFromSubsidiaries ──────────────────────────────────────

describe('extractCurrenciesFromSubsidiaries', () => {
  it('extracts deduped uppercased ISO codes from emitted entities', () => {
    const out = generateSubsidiaries({
      subsidiaryList: ATLAS_LIST,
      eliminationEntity: 'Atlas Group Eliminations',
    });
    const codes = extractCurrenciesFromSubsidiaries(out.emitted);
    expect(codes).toEqual(['AUD', 'EUR', 'GBP', 'USD']); // alphabetical
  });

  it('Brightside seed currencies: AED + EGP + SAR + USD', () => {
    const out = generateSubsidiaries({
      subsidiaryList: BRIGHTSIDE_LIST,
      eliminationEntity: 'Brightside Group Eliminations (UAE)',
    });
    const codes = extractCurrenciesFromSubsidiaries(out.emitted);
    expect(codes).toEqual(['AED', 'EGP', 'SAR', 'USD']);
  });

  it('drops malformed currency codes', () => {
    const out = generateSubsidiaries({
      subsidiaryList:
        'Acme One, US, USD, parent\n' +
        'Acme Two, GB, gbp, Acme One\n' + // lowercase normalises to GBP
        'Acme Three, FR, euro, Acme One', // 4 letters — drops
      eliminationEntity: '',
    });
    const codes = extractCurrenciesFromSubsidiaries(out.emitted);
    expect(codes).toContain('USD');
    expect(codes).toContain('GBP');
    expect(codes).not.toContain('EURO');
  });

  it('returns [] for empty input', () => {
    expect(extractCurrenciesFromSubsidiaries([])).toEqual([]);
  });
});
