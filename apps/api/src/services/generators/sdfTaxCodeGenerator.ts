/**
 * SDF Tax Code generator (Pack D — Tax Engine).
 *
 * Reads the wizard's `ns.tax.taxCodeMatrix` TEXTAREA (one tax code per
 * line, format "<jurisdiction>: <type>: <rate>%: <display name>") and
 * emits one Oracle SDF `taxcode` XML per parsed line. Auto-supplements
 * with a starter library of common rates per jurisdiction declared in
 * the engagement's nexusList.
 *
 * The tax code's <taxtype> field references a scriptid emitted by
 * sdfTaxTypeGenerator (Component 2). That generator MUST run before
 * this one so the references resolve at deploy.
 *
 * Dedup rule: starter-library codes only emit for jurisdictions that
 * appear in nexusList AND aren't explicitly declared in the matrix.
 * The wizard matrix wins on (jurisdiction, type, rate) tuple
 * collision (consultant intent over heuristic floor — same pattern as
 * Pack F's KPI-vs-starter dedup).
 *
 * Sources:
 *   - NetSuite SDF taxcode XML reference (Oracle docs).
 *   - NetSuite SuiteTax country starter rates (Oracle Help —
 *     Tax Codes by Country).
 */

import { taxTypeScriptidFor } from './sdfTaxTypeGenerator.js';

export type TaxTypeToken =
  | 'VAT'
  | 'SALES_TAX'
  | 'GST'
  | 'WITHHOLDING'
  | 'USE_TAX'
  | 'REVERSE_CHARGE';

export interface EmittedTaxCode {
  filename: string;
  scriptid: string;
  /** Human display name — drives <name> + dashboard KPI matching. */
  displayName: string;
  /** Jurisdiction token verbatim from input ("AE" / "US/CA" / "GB"). */
  jurisdiction: string;
  /** ISO alpha-2 country derived from jurisdiction (US/CA → US). */
  country: string;
  /** Tax type token (VAT / SALES_TAX / etc.). */
  type: string;
  /** Numeric rate. */
  rate: number;
  /** Provenance — drives the harness + comment header. */
  origin: 'wizard-matrix' | 'starter-library';
}

export interface TaxCodeGeneratorInput {
  /** Raw TEXTAREA from ns.tax.taxCodeMatrix. */
  taxCodeMatrix?: string | null;
  /** Raw TEXTAREA from ns.tax.nexusList. Used to scope starter
   *  library emissions. Lines look like "<subsidiary> | <country>" or
   *  "<subsidiary> | <country>/<region>". */
  nexusList?: string | null;
}

export interface TaxCodeGeneratorOutput {
  files: Record<string, string>;
  emitted: EmittedTaxCode[];
}

// ─── Starter library ────────────────────────────────────────────────────────

interface StarterRate {
  type: TaxTypeToken;
  rate: number;
  displayName: string;
}

/**
 * Per-jurisdiction starter library. Auto-emitted ONLY for jurisdictions
 * present in the engagement's nexusList AND not already declared in
 * the matrix. Keys are ISO alpha-2 country codes.
 */
const STARTER_LIBRARY: Record<string, StarterRate[]> = {
  AE: [
    { type: 'VAT', rate: 5, displayName: 'VAT 5% UAE Standard' },
    { type: 'VAT', rate: 0, displayName: 'VAT 0% UAE Zero-rated' },
    { type: 'VAT', rate: 0, displayName: 'VAT UAE Exempt' },
  ],
  SA: [
    { type: 'VAT', rate: 15, displayName: 'VAT 15% KSA Standard' },
    { type: 'VAT', rate: 0, displayName: 'VAT 0% KSA Zero-rated' },
    { type: 'VAT', rate: 0, displayName: 'VAT KSA Exempt' },
  ],
  EG: [
    { type: 'VAT', rate: 14, displayName: 'VAT 14% Egypt Standard' },
    { type: 'VAT', rate: 0, displayName: 'VAT 0% Egypt Zero-rated' },
    { type: 'VAT', rate: 0, displayName: 'VAT Egypt Exempt' },
  ],
  GB: [
    { type: 'VAT', rate: 20, displayName: 'VAT 20% UK Standard' },
    { type: 'VAT', rate: 5, displayName: 'VAT 5% UK Reduced' },
    { type: 'VAT', rate: 0, displayName: 'VAT 0% UK Zero-rated' },
    { type: 'VAT', rate: 0, displayName: 'VAT UK Exempt' },
  ],
  AU: [
    { type: 'GST', rate: 10, displayName: 'GST 10% AU Standard' },
    { type: 'GST', rate: 0, displayName: 'GST 0% AU GST-free' },
  ],
  DE: [
    { type: 'VAT', rate: 19, displayName: 'VAT 19% Germany Standard' },
    { type: 'VAT', rate: 7, displayName: 'VAT 7% Germany Reduced' },
  ],
  FR: [
    { type: 'VAT', rate: 20, displayName: 'VAT 20% France Standard' },
    { type: 'VAT', rate: 10, displayName: 'VAT 10% France Intermediate' },
    { type: 'VAT', rate: 5.5, displayName: 'VAT 5.5% France Reduced' },
    { type: 'VAT', rate: 2.1, displayName: 'VAT 2.1% France Super-reduced' },
  ],
  IT: [
    { type: 'VAT', rate: 22, displayName: 'VAT 22% Italy Standard' },
    { type: 'VAT', rate: 10, displayName: 'VAT 10% Italy Reduced' },
    { type: 'VAT', rate: 5, displayName: 'VAT 5% Italy Special' },
    { type: 'VAT', rate: 4, displayName: 'VAT 4% Italy Super-reduced' },
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slugify(s: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

/** Derive ISO alpha-2 country from a jurisdiction token. "US/CA" → "US",
 *  "AE" → "AE". Everything before the first '/' is the country. */
function jurisdictionToCountry(jurisdiction: string): string {
  const slashIdx = jurisdiction.indexOf('/');
  return (slashIdx >= 0 ? jurisdiction.slice(0, slashIdx) : jurisdiction).trim().toUpperCase();
}

/** Slug for the rate — "7.25" → "725", "5" → "5", "5.5" → "55". */
function rateToSlug(rate: number): string {
  return rate.toString().replace('.', '');
}

/**
 * Extract the set of countries from the engagement's nexusList. Lines
 * look like "<subsidiary> | <country>" or "<subsidiary> | <country>/
 * <region>". The country is the segment after '|', before any '/'.
 */
function extractNexusCountries(nexusList: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const line of (nexusList ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const pipeIdx = trimmed.indexOf('|');
    if (pipeIdx < 0) continue;
    const right = trimmed.slice(pipeIdx + 1).trim();
    const country = jurisdictionToCountry(right);
    if (country.length > 0) out.add(country);
  }
  return out;
}

// ─── Matrix parsing ─────────────────────────────────────────────────────────

interface ParsedMatrixLine {
  jurisdiction: string;
  type: string;
  rate: number;
  displayName: string;
  rawLine: string;
}

function parseMatrixLine(line: string): ParsedMatrixLine | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const m = trimmed.match(
    /^([\w/]+):\s*(VAT|SALES_TAX|GST|WITHHOLDING|USE_TAX|REVERSE_CHARGE):\s*([\d.]+)%?:\s*(.+)$/i,
  );
  if (!m) return null;
  const rate = Number(m[3]);
  if (!Number.isFinite(rate) || rate < 0) return null;
  return {
    jurisdiction: m[1].trim().toUpperCase(),
    type: m[2].toUpperCase(),
    rate,
    displayName: m[4].trim(),
    rawLine: trimmed,
  };
}

// ─── XML emission ────────────────────────────────────────────────────────────

function buildTaxCodeXml(args: {
  scriptid: string;
  displayName: string;
  country: string;
  rate: number;
  taxTypeScriptid: string;
  source: string;
  rawLine?: string;
}): string {
  const sourceLine = args.rawLine
    ? `  Original line: "${xmlEscape(args.rawLine)}"\n`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Tax Code Generator.
  Source: ${args.source}
${sourceLine}  Review before deploy:
    - Confirm rate matches current jurisdiction regulations
    - Confirm tax type linkage (VAT vs Sales Tax) matches accounting team expectation
    - Validate effective date in NetSuite UI before activation
-->
<taxcode scriptid="${args.scriptid}">
  <name>${xmlEscape(args.displayName)}</name>
  <description>${xmlEscape(args.displayName)}</description>
  <country>${xmlEscape(args.country)}</country>
  <rate>${args.rate}</rate>
  <taxtype>${args.taxTypeScriptid}</taxtype>
  <isexport>F</isexport>
  <isinactive>F</isinactive>
</taxcode>
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Emit tax codes from the wizard matrix + starter library. Output is
 * deterministic — wizard codes appear in declared order, starter
 * codes in jurisdiction-order then rate-order.
 *
 * Empty matrix + empty nexusList → empty output. Every emitted code
 * references a scriptid that the tax type generator MUST also emit;
 * the harness's p4.sdf-tax-codes-reference-tax-types check enforces
 * this referential integrity.
 */
export function generateTaxCodes(input: TaxCodeGeneratorInput): TaxCodeGeneratorOutput {
  const files: Record<string, string> = {};
  const emitted: EmittedTaxCode[] = [];

  // De-dup map keyed by (jurisdiction, type, rate) tuple — wizard wins
  // when the same tuple appears in both matrix and starter library.
  const seenTuples = new Set<string>();
  const seenScriptids = new Set<string>();
  const tupleKey = (j: string, t: string, r: number): string => `${j}|${t}|${r}`;

  // Helper: derive a unique scriptid via the tuple slug + numeric
  // suffix on collision.
  const buildScriptid = (jurisdiction: string, type: string, rate: number): string => {
    const base = `taxcode_nsix_${slugify(jurisdiction)}_${type.toLowerCase()}_${rateToSlug(rate)}`;
    if (!seenScriptids.has(base)) {
      seenScriptids.add(base);
      return base;
    }
    let n = 2;
    let candidate = `${base}_${n}`;
    while (seenScriptids.has(candidate)) {
      candidate = `${base}_${++n}`;
    }
    seenScriptids.add(candidate);
    return candidate;
  };

  // 1. Wizard matrix — first pass (wins on dedup).
  const matrixRaw = (input.taxCodeMatrix ?? '').toString();
  for (const line of matrixRaw.split(/\r?\n/)) {
    const parsed = parseMatrixLine(line);
    if (!parsed) continue;
    const key = tupleKey(parsed.jurisdiction, parsed.type, parsed.rate);
    if (seenTuples.has(key)) continue;
    seenTuples.add(key);
    const country = jurisdictionToCountry(parsed.jurisdiction);
    const scriptid = buildScriptid(parsed.jurisdiction, parsed.type, parsed.rate);
    const filename = `Objects/${scriptid}.xml`;
    const taxTypeScriptid = taxTypeScriptidFor(parsed.type);
    files[filename] = buildTaxCodeXml({
      scriptid,
      displayName: parsed.displayName,
      country,
      rate: parsed.rate,
      taxTypeScriptid,
      source: 'wizard matrix (ns.tax.taxCodeMatrix)',
      rawLine: parsed.rawLine,
    });
    emitted.push({
      filename,
      scriptid,
      displayName: parsed.displayName,
      jurisdiction: parsed.jurisdiction,
      country,
      type: parsed.type,
      rate: parsed.rate,
      origin: 'wizard-matrix',
    });
  }

  // 2. Starter library — only for nexus countries, only when matrix
  // didn't already cover the (jurisdiction, type, rate) tuple. Order
  // is alphabetical by country then by rate descending (standard
  // rate first).
  const nexusCountries = extractNexusCountries(input.nexusList);
  const starterCountries = [...nexusCountries].sort();
  for (const country of starterCountries) {
    const starterSet = STARTER_LIBRARY[country];
    if (!starterSet) continue;
    for (const s of starterSet) {
      const key = tupleKey(country, s.type, s.rate);
      // Use country as jurisdiction for starter codes (never region-
      // specific in the curated set). Wizard's "US/CA: SALES_TAX:..."
      // keys differently and won't collide.
      if (seenTuples.has(key)) continue;
      seenTuples.add(key);
      const scriptid = buildScriptid(country, s.type, s.rate);
      const filename = `Objects/${scriptid}.xml`;
      const taxTypeScriptid = taxTypeScriptidFor(s.type);
      files[filename] = buildTaxCodeXml({
        scriptid,
        displayName: s.displayName,
        country,
        rate: s.rate,
        taxTypeScriptid,
        source: `starter library (${country} curated rates)`,
      });
      emitted.push({
        filename,
        scriptid,
        displayName: s.displayName,
        jurisdiction: country,
        country,
        type: s.type,
        rate: s.rate,
        origin: 'starter-library',
      });
    }
  }

  return { files, emitted };
}
