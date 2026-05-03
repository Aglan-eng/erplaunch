/**
 * SDF Tax Schedule generator (Pack D — Tax Engine).
 *
 * Reads the wizard's `ns.tax.taxScheduleMatrix` TEXTAREA (one schedule
 * per line, format "<transaction type>: <tax code display name>:
 * <jurisdiction>") and emits one Oracle SDF `taxschedule` XML per
 * parsed line. Each schedule binds a tax code (Component 3 / sdfTaxCodeGenerator
 * scriptid) to a transaction type within a jurisdiction.
 *
 * KPI matching parallels Pack F's dashboard generator: the wizard
 * line gives a TAX CODE DISPLAY NAME + jurisdiction; the generator
 * looks up the matching emitted tax code by displayName +
 * jurisdiction (case-insensitive) and references its scriptid in the
 * schedule's <taxitem>. Unmatched lines preserved in a comment block
 * at the top of the schedule XML so the consultant sees what's
 * missing.
 *
 * Sources:
 *   - NetSuite SDF taxschedule XML reference (Oracle docs).
 *   - NetSuite SuiteTax schedule wiring patterns (Oracle Help —
 *     Tax Schedules and Default Tax Codes).
 */

import type { EmittedTaxCode } from './sdfTaxCodeGenerator.js';

/** Transaction-type → scriptid suffix mapping. */
const TRANSACTION_TYPE_SLUG: Record<string, string> = {
  'sales order': 'sales_order',
  'purchase order': 'purchase_order',
  invoice: 'invoice',
  'vendor bill': 'vendor_bill',
  'cash sale': 'cash_sale',
  estimate: 'estimate',
};

export interface TaxScheduleGeneratorInput {
  /** Raw TEXTAREA from ns.tax.taxScheduleMatrix. */
  taxScheduleMatrix?: string | null;
  /** Tax codes emitted by the upstream code generator — drives
   *  display-name → scriptid resolution. */
  taxCodes: ReadonlyArray<EmittedTaxCode>;
}

export interface EmittedTaxSchedule {
  filename: string;
  scriptid: string;
  /** Original wizard line (verbatim). */
  rawLine: string;
  /** Transaction type token (e.g., 'Sales Order'). */
  transactionType: string;
  /** Jurisdiction (e.g., 'AE', 'US/CA'). */
  jurisdiction: string;
  /** Matched tax code scriptid, or null when unmatched. */
  matchedTaxCodeScriptid: string | null;
}

export interface TaxScheduleGeneratorOutput {
  files: Record<string, string>;
  emitted: EmittedTaxSchedule[];
  /** Lines that didn't match a known transaction type or tax code —
   *  preserved at the orchestrator layer for a single all-bundle
   *  comment block (the per-schedule XML's comment header records
   *  only the unmatched ENTRIES for that schedule). */
  globalUnmatchedLines: string[];
}

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

interface ParsedScheduleLine {
  transactionType: string;
  taxCodeName: string;
  jurisdiction: string;
  rawLine: string;
}

/**
 * Parse one schedule line. Format:
 *   "<transaction type>: <tax code display name>: <jurisdiction>"
 *
 * Subtle: the tax code display name often contains colons or other
 * punctuation — we pin to the LAST colon-delimited segment as the
 * jurisdiction (the FIRST colon-delimited segment as the transaction
 * type) and treat everything in between as the tax code name. That
 * tolerates "Sales Order: VAT 5%: UAE Standard: AE" cleanly.
 */
function parseScheduleLine(line: string): ParsedScheduleLine | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  // Split on ':' but only collapse the middle segment.
  const parts = trimmed.split(':').map((p) => p.trim());
  if (parts.length < 3) return null;
  const transactionType = parts[0];
  const jurisdiction = parts[parts.length - 1];
  const taxCodeName = parts.slice(1, -1).join(': ').trim();
  if (
    transactionType.length === 0 ||
    taxCodeName.length === 0 ||
    jurisdiction.length === 0
  ) {
    return null;
  }
  return {
    transactionType,
    taxCodeName,
    jurisdiction: jurisdiction.toUpperCase(),
    rawLine: trimmed,
  };
}

/**
 * Find the emitted tax code whose display name + jurisdiction match
 * the parsed schedule line. Display name match is case-insensitive
 * substring (so "VAT 5%" matches "VAT 5% UAE Standard" cleanly).
 * Jurisdiction match is exact (case-insensitive) on the
 * country/region key.
 */
function findMatchingTaxCode(
  parsed: ParsedScheduleLine,
  taxCodes: ReadonlyArray<EmittedTaxCode>,
): EmittedTaxCode | null {
  const nameLc = parsed.taxCodeName.toLowerCase();
  const jurUpper = parsed.jurisdiction.toUpperCase();
  // First pass: jurisdiction exact + name substring.
  for (const code of taxCodes) {
    if (code.jurisdiction.toUpperCase() !== jurUpper) continue;
    if (code.displayName.toLowerCase().includes(nameLc)) return code;
  }
  // Fallback: jurisdiction's country matches (US/CA → US country) and
  // name substring. Catches matrix lines with bare country
  // jurisdiction against region-specific codes.
  for (const code of taxCodes) {
    if (code.country.toUpperCase() !== jurUpper) continue;
    if (code.displayName.toLowerCase().includes(nameLc)) return code;
  }
  return null;
}

function transactionTypeSlugFor(transactionType: string): string | null {
  return TRANSACTION_TYPE_SLUG[transactionType.trim().toLowerCase()] ?? null;
}

// ─── XML emission ────────────────────────────────────────────────────────────

function buildTaxScheduleXml(args: {
  scriptid: string;
  displayName: string;
  taxCodeScriptid: string | null;
  rawLine: string;
}): string {
  const taxItemLine = args.taxCodeScriptid
    ? `  <taxitem>${args.taxCodeScriptid}</taxitem>`
    : `  <!-- taxitem unmatched — consultant must add the correct taxcode_*_scriptid manually -->`;
  const matchNote = args.taxCodeScriptid
    ? `  Matched tax code: ${args.taxCodeScriptid}`
    : `  Matched tax code: NONE — wizard tax-code-name + jurisdiction did not resolve to any emitted taxcode`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Tax Schedule Generator from wizard answer ns.tax.taxScheduleMatrix.
  Original line: "${xmlEscape(args.rawLine)}"
${matchNote}
  Review before deploy:
    - Confirm schedule activation per nexus
    - Set tax-on-tax + cumulative flags per jurisdiction policy
-->
<taxschedule scriptid="${args.scriptid}">
  <name>${xmlEscape(args.displayName)}</name>
  <isinactive>F</isinactive>
${taxItemLine}
</taxschedule>
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Emit one taxschedule XML per parsed wizard line. Bad-format lines
 * (missing one of transaction-type/code-name/jurisdiction OR an
 * unrecognised transaction type) are reported via globalUnmatchedLines
 * so the orchestrator can surface them to the consultant.
 *
 * Unmatched-tax-code lines DO emit a schedule XML — but with the
 * <taxitem> element replaced by an XML comment noting the failure.
 * The consultant sees the file exists, sees what was attempted, and
 * fills in the correct scriptid post-generation.
 */
export function generateTaxSchedules(
  input: TaxScheduleGeneratorInput,
): TaxScheduleGeneratorOutput {
  const files: Record<string, string> = {};
  const emitted: EmittedTaxSchedule[] = [];
  const globalUnmatchedLines: string[] = [];
  const seenScriptids = new Set<string>();

  const raw = (input.taxScheduleMatrix ?? '').toString();
  if (raw.trim().length === 0) {
    return { files, emitted, globalUnmatchedLines };
  }

  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseScheduleLine(line);
    if (!parsed) {
      if (line.trim().length > 0) globalUnmatchedLines.push(line.trim());
      continue;
    }
    const txnSlug = transactionTypeSlugFor(parsed.transactionType);
    if (!txnSlug) {
      globalUnmatchedLines.push(parsed.rawLine);
      continue;
    }
    const matched = findMatchingTaxCode(parsed, input.taxCodes);
    let scriptidBase = `taxschedule_nsix_${txnSlug}_${slugify(parsed.jurisdiction)}`;
    let scriptid = scriptidBase;
    let n = 2;
    while (seenScriptids.has(scriptid)) {
      scriptid = `${scriptidBase}_${n++}`;
    }
    seenScriptids.add(scriptid);
    const displayName = `${parsed.transactionType} — ${parsed.taxCodeName} (${parsed.jurisdiction})`;
    const filename = `Objects/${scriptid}.xml`;
    files[filename] = buildTaxScheduleXml({
      scriptid,
      displayName,
      taxCodeScriptid: matched?.scriptid ?? null,
      rawLine: parsed.rawLine,
    });
    emitted.push({
      filename,
      scriptid,
      rawLine: parsed.rawLine,
      transactionType: parsed.transactionType,
      jurisdiction: parsed.jurisdiction,
      matchedTaxCodeScriptid: matched?.scriptid ?? null,
    });
  }

  return { files, emitted, globalUnmatchedLines };
}
