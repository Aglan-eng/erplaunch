/**
 * Custom Record Extra Fields parser (Pack K — Custom Record Business
 * Fields).
 *
 * Parses the wizard's free-text TEXTAREA `ns.design.customRecordExtraFields`
 * into per-record overlay field lists. Each line is expected in the form:
 *
 *   "<record_name>: <field_label>: <type>"
 *
 * Examples:
 *   "Approval Tracker: Approval Tier: SELECT"
 *   "Vendor Onboarding Request: Risk Rating: SELECT"
 *   "Project Milestone: Deliverable Owner: EMPLOYEE"
 *
 * The parser is conservative: lines that don't match the
 * `name: label: type` regex are SKIPPED silently (not emitted as TBD
 * placeholders). The consultant fixes broken lines manually; the
 * customrecord generator still emits the baseline + smart starters
 * for that record either way.
 *
 * Type tokens are case-insensitive and map to NetSuite SDF fieldtypes:
 *   TEXT        → FREEFORMTEXT (single-line; the SDF enum value)
 *   TEXTAREA    → TEXTAREA
 *   CHECKBOX    → CHECKBOX
 *   DATE        → DATE
 *   CURRENCY    → CURRENCY
 *   NUMBER      → FLOAT
 *   SELECT      → SELECT (caller emits a companion customlist with
 *                 placeholder values)
 *   EMPLOYEE    → SELECT, selectrecordtype=-4
 *   TRANSACTION → SELECT, selectrecordtype=-30
 *   SUBSIDIARY  → SELECT, selectrecordtype=-117
 *
 * The customrecord generator merges these overlay fields with baseline
 * + smart starters, with overlay winning over starters on label
 * collision (consultant intent overrides smart inference) and baseline
 * always winning (audit fields are non-negotiable).
 *
 * Sources:
 *   - NetSuite SDF customrecordcustomfield XML reference (Oracle docs).
 *   - NetSuite standard record type IDs (-4 / -30 / -117).
 */

import type { StarterFieldType } from './customRecordStarterFields.js';

export interface ExtraField {
  /** Human label from the wizard line — used for label-based dedup
   *  with starter fields and for the <label> tag in the emitted XML. */
  label: string;
  /** Fieldtype mapped to the SDF enum (same enum as StarterFieldType). */
  fieldtype: StarterFieldType;
  /** Hardcoded selectrecordtype for EMPLOYEE/TRANSACTION/SUBSIDIARY tokens
   *  ('-4' / '-30' / '-117'). Undefined for plain SELECT (caller emits
   *  a companion customlist). */
  selectrecordtype?: string;
}

/**
 * Type-token → (fieldtype, selectrecordtype) lookup. Case-insensitive
 * match in the parser. Token not in the map → line is dropped.
 */
const TYPE_TOKEN_MAP: Record<string, { fieldtype: StarterFieldType; selectrecordtype?: string }> = {
  TEXT: { fieldtype: 'FREEFORMTEXT' },
  TEXTAREA: { fieldtype: 'TEXTAREA' },
  CHECKBOX: { fieldtype: 'CHECKBOX' },
  DATE: { fieldtype: 'DATE' },
  CURRENCY: { fieldtype: 'CURRENCY' },
  NUMBER: { fieldtype: 'FLOAT' },
  SELECT: { fieldtype: 'SELECT' },
  EMPLOYEE: { fieldtype: 'SELECT', selectrecordtype: '-4' },
  TRANSACTION: { fieldtype: 'SELECT', selectrecordtype: '-30' },
  SUBSIDIARY: { fieldtype: 'SELECT', selectrecordtype: '-117' },
};

/**
 * Parse one wizard line into a {recordName, label, fieldtype, ...}
 * tuple. Returns null on any failure — bad lines are skipped silently
 * (the consultant fixes them manually; the baseline + starter pipeline
 * still produces something useful for that record).
 */
function parseLine(line: string): { recordName: string; field: ExtraField } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  // Strict shape: <name>: <label>: <type>
  // Match as: name = up to first colon; label = between first and last colon;
  // type = after last colon. Using a regex with non-greedy middle.
  const m = trimmed.match(/^([^:]+):\s*(.+):\s*(\w+)\s*$/);
  if (!m) return null;
  const recordName = m[1].trim();
  const label = m[2].trim();
  const typeToken = m[3].trim().toUpperCase();
  if (recordName.length === 0 || label.length === 0) return null;

  const mapping = TYPE_TOKEN_MAP[typeToken];
  if (!mapping) return null; // unknown type — drop

  return {
    recordName,
    field: {
      label,
      fieldtype: mapping.fieldtype,
      selectrecordtype: mapping.selectrecordtype,
    },
  };
}

/**
 * Parse the full TEXTAREA answer. Returns a map keyed by the verbatim
 * record name as it appears in the wizard line. CRLF normalised.
 *
 * Empty / whitespace-only / undefined → empty map. Multiple lines
 * referencing the same record accumulate into one entry; field order
 * preserves wizard line order (which is the order the consultant
 * cares about for form layout).
 */
export function parseExtraFields(input: string | null | undefined): Map<string, ExtraField[]> {
  const out = new Map<string, ExtraField[]>();
  const raw = (input ?? '').toString();
  if (raw.trim().length === 0) return out;

  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === null) continue;
    const list = out.get(parsed.recordName) ?? [];
    list.push(parsed.field);
    out.set(parsed.recordName, list);
  }
  return out;
}
