/**
 * Structured Custom Fields generator (Phase 23).
 *
 * Reads the wizard's structured answer key `ns.design.customFieldsStructured`
 * (a JSON-stringified Map<recordType, StructuredCustomField[]>) and emits
 * one Oracle SDF custom-field XML per row.
 *
 * Phase 23 contract over Pack B:
 *   - Per-field type set EXPLICITLY (no keyword classifier).
 *   - 5 properties become configurable per field: required, defaultValue,
 *     helpText, showInList, isSearchable. Pack B hardcoded these.
 *   - Editor-side dedup is enforced; this generator ALSO dedups defensively
 *     (engagement could be mutated via API outside the wizard UI).
 *
 * Adaptor gate: this generator self-gates on adaptorId === 'netsuite'. Any
 * other adaptor returns { files: {}, emitted: [], errors: [] } — keeps the
 * Sahel/Odoo bundle banlist-clean even if the structured key somehow ends
 * up populated on a non-NetSuite engagement.
 *
 * Naming convention (per Phase 23 design approval):
 *   custentity_nsix_<slug>  — Customer / Vendor / Employee
 *   custitem_nsix_<slug>    — Item
 *   custbody_nsix_<slug>    — Sales Order / Purchase Order / Invoice / Vendor Bill
 *
 * Pack H linkage: the Phase 22 design intentionally does NOT bridge
 * structured fields into Pack H's custom-form embedding. Engagements that
 * use the structured editor get field XMLs but not auto-embed; the
 * consultant lays out forms in the NS UI. Future Phase 26+ to bridge.
 *
 * Sources:
 *   - NetSuite SDF XML Reference — itemcustomfield / entitycustomfield /
 *     transactionbodycustomfield schemas (Oracle docs).
 *   - sdfValidator.ts — every emit here passes the same gate Pack B does.
 */

import {
  PARENT_TABLE,
  slugify,
  buildFieldXml,
  type CustomFieldType,
  type CustomFieldRoot,
} from './sdfCustomFieldHelpers.js';

// ─── Public types ────────────────────────────────────────────────────────────

/** Record types the structured editor exposes as tabs (Phase 23). */
export type StructuredRecordType =
  | 'Customer'
  | 'Vendor'
  | 'Item'
  | 'Employee'
  | 'Sales Order'
  | 'Purchase Order'
  | 'Invoice'
  | 'Vendor Bill';

export const STRUCTURED_RECORD_TYPES: ReadonlyArray<StructuredRecordType> = [
  'Customer',
  'Vendor',
  'Item',
  'Employee',
  'Sales Order',
  'Purchase Order',
  'Invoice',
  'Vendor Bill',
];

export interface StructuredCustomField {
  /** Raw label — slugified into the scriptid suffix. */
  name: string;
  /** Human label rendered in NS UI. Defaults to `name` if empty. */
  displayLabel: string;
  /** Field type (explicit; no keyword inference). */
  type: CustomFieldType;
  /** Maps to <ismandatory>T/F</ismandatory>. */
  required: boolean;
  /** Maps to <defaultvalue>; element omitted when empty. */
  defaultValue: string;
  /** Maps to <description>; element omitted when empty. */
  helpText: string;
  /** Maps to <showinlist>T/F</showinlist>. */
  showInList: boolean;
  /** Maps to <issearchable>T/F</issearchable>. */
  isSearchable: boolean;
}

export interface StructuredCustomFieldsInput {
  /** Adaptor id from the engagement (gate: only 'netsuite' emits anything). */
  adaptorId: string;
  /** The structured answer payload. Either an already-parsed object or a
   *  JSON string from the wizardStore. Empty / null / undefined yields
   *  empty output. */
  structuredAnswer:
    | string
    | null
    | undefined
    | Partial<Record<StructuredRecordType, StructuredCustomField[]>>;
}

export interface StructuredEmittedField {
  scriptid: string;
  originalLabel: string;
  parent: StructuredRecordType;
  fieldtype: CustomFieldType;
  root: CustomFieldRoot;
  filename: string;
  /** When fieldtype === 'SELECT', the customlist scriptid this field
   *  references. The orchestrator passes this to sdfCustomListGenerator
   *  to emit a placeholder companion list (matches Pack B behavior). */
  selectListScriptid?: string;
}

export interface StructuredValidationError {
  /** "Customer" / "Vendor" / etc. */
  recordType: StructuredRecordType | 'unknown';
  /** Position within that record-type's array (0-indexed). */
  rowIndex: number;
  /** "name" / "displayLabel" / "type" / etc. — the offending field. */
  field: string;
  /** Human-readable diagnostic. */
  message: string;
}

export interface StructuredCustomFieldsOutput {
  files: Record<string, string>;
  emitted: StructuredEmittedField[];
  errors: StructuredValidationError[];
}

// ─── Precedence helper ──────────────────────────────────────────────────────

/**
 * Phase 23 precedence rule: when the structured editor's answer is
 * populated, the legacy TEXTAREA `ns.design.customFieldsScope` is
 * treated as empty so Pack B + Pack H stop emitting — preventing
 * double-emission during the migration window.
 *
 * Used by generation.ts to compute the effective TEXTAREA scope value
 * passed to Pack B (sdfCustomFieldsGenerator) and Pack H
 * (sdfTransactionFormGenerator / sdfEntryFormGenerator). Both honor a
 * single source of truth so we can't drift between them.
 *
 * Returns:
 *   - undefined when structured is populated (structured wins)
 *   - the legacy TEXTAREA when structured is empty / null / undefined
 *   - undefined when both are empty
 */
export function resolveLegacyCustomFieldsScope(
  legacyTextareaAnswer: string | null | undefined,
  structuredAnswer: string | null | undefined,
): string | undefined {
  // Structured wins when present + non-whitespace.
  if (typeof structuredAnswer === 'string' && structuredAnswer.trim().length > 0) {
    return undefined;
  }
  // Object-form also counts as "populated" — be defensive in case the
  // wizard ever switches to storing the parsed object directly.
  if (
    structuredAnswer !== null &&
    structuredAnswer !== undefined &&
    typeof structuredAnswer === 'object'
  ) {
    // A non-empty object literally means at least one record-type key
    // exists. We treat ANY object form as "structured wins" — the
    // generator itself will sort out empty arrays.
    return undefined;
  }
  // Normalise empty / whitespace legacy TEXTAREA to undefined so the
  // contract is single-valued ("nothing to emit" → undefined, never '').
  if (typeof legacyTextareaAnswer !== 'string' || legacyTextareaAnswer.trim().length === 0) {
    return undefined;
  }
  return legacyTextareaAnswer;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const ALLOWED_TYPES: ReadonlySet<CustomFieldType> = new Set([
  'CHECKBOX',
  'DATE',
  'CURRENCY',
  'SELECT',
  'TEXTAREA',
  'FREEFORMTEXT',
]);

/**
 * Strict validator. Returns errors for non-boolean values on boolean
 * fields (the truthy-but-not-true contract from Phase 22), unknown types,
 * empty / all-special names, etc. Does NOT coerce — coercion would mask
 * data-integrity bugs that the editor should also catch.
 */
function validateRow(
  recordType: StructuredRecordType,
  rowIndex: number,
  raw: unknown,
): { ok: true; field: StructuredCustomField } | { ok: false; errors: StructuredValidationError[] } {
  const errs: StructuredValidationError[] = [];
  if (raw === null || typeof raw !== 'object') {
    errs.push({ recordType, rowIndex, field: '_root', message: 'row must be an object' });
    return { ok: false, errors: errs };
  }
  const obj = raw as Record<string, unknown>;

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (name.length === 0) {
    errs.push({ recordType, rowIndex, field: 'name', message: 'name is required' });
  }
  // Reject names that slugify to empty (purely special chars).
  if (name.length > 0 && slugify(name) === 'unnamed') {
    errs.push({
      recordType,
      rowIndex,
      field: 'name',
      message: `name "${name}" produces an empty slug; use at least one alphanumeric character`,
    });
  }

  const displayLabel =
    typeof obj.displayLabel === 'string' && obj.displayLabel.length > 0
      ? obj.displayLabel
      : name;

  if (typeof obj.type !== 'string' || !ALLOWED_TYPES.has(obj.type as CustomFieldType)) {
    errs.push({
      recordType,
      rowIndex,
      field: 'type',
      message: `type must be one of CHECKBOX/DATE/CURRENCY/SELECT/TEXTAREA/FREEFORMTEXT (got ${JSON.stringify(obj.type)})`,
    });
  }

  // Truthy-but-not-true contract: only literal booleans are accepted.
  for (const flag of ['required', 'showInList', 'isSearchable'] as const) {
    if (typeof obj[flag] !== 'boolean') {
      errs.push({
        recordType,
        rowIndex,
        field: flag,
        message: `${flag} must be a boolean (got ${JSON.stringify(obj[flag])})`,
      });
    }
  }

  if (obj.defaultValue !== undefined && typeof obj.defaultValue !== 'string') {
    errs.push({
      recordType,
      rowIndex,
      field: 'defaultValue',
      message: 'defaultValue must be a string',
    });
  }
  if (obj.helpText !== undefined && typeof obj.helpText !== 'string') {
    errs.push({
      recordType,
      rowIndex,
      field: 'helpText',
      message: 'helpText must be a string',
    });
  }

  if (errs.length > 0) return { ok: false, errors: errs };

  return {
    ok: true,
    field: {
      name,
      displayLabel,
      type: obj.type as CustomFieldType,
      required: obj.required as boolean,
      defaultValue: typeof obj.defaultValue === 'string' ? obj.defaultValue : '',
      helpText: typeof obj.helpText === 'string' ? obj.helpText : '',
      showInList: obj.showInList as boolean,
      isSearchable: obj.isSearchable as boolean,
    },
  };
}

/**
 * Parse the input payload (string-or-object) into a normalised map. Returns
 * null + a parse error when the JSON is malformed or the shape is wrong.
 */
function parseStructuredAnswer(
  raw: StructuredCustomFieldsInput['structuredAnswer'],
):
  | { ok: true; map: Partial<Record<StructuredRecordType, unknown[]>> }
  | { ok: false; error: StructuredValidationError } {
  if (raw === null || raw === undefined) return { ok: true, map: {} };
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return { ok: true, map: {} };
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          ok: false,
          error: {
            recordType: 'unknown',
            rowIndex: -1,
            field: '_root',
            message: 'structured payload must be a JSON object keyed by record type',
          },
        };
      }
      return { ok: true, map: parsed as Partial<Record<StructuredRecordType, unknown[]>> };
    } catch (err) {
      return {
        ok: false,
        error: {
          recordType: 'unknown',
          rowIndex: -1,
          field: '_root',
          message: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }
  // Already-parsed object path.
  return { ok: true, map: raw };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate the structured custom-field XMLs.
 *
 *   - adaptorId !== 'netsuite' → empty output (gate; Sahel/Odoo banlist).
 *   - Empty / undefined / null structuredAnswer → empty output.
 *   - Per-row validation errors are collected in `errors[]` and that row
 *     does NOT emit. Other rows still emit. Caller decides whether to
 *     fail-the-job on errors.length > 0.
 *   - Same-name dedup within a record-type → first row wins, subsequent
 *     duplicates land in `errors[]` (not silently auto-suffixed — the
 *     editor enforces uniqueness, but we surface defensively).
 */
export function generateSdfStructuredCustomFields(
  input: StructuredCustomFieldsInput,
): StructuredCustomFieldsOutput {
  // Adaptor gate — non-NetSuite engagements get nothing.
  if (input.adaptorId !== 'netsuite') {
    return { files: {}, emitted: [], errors: [] };
  }

  const parsed = parseStructuredAnswer(input.structuredAnswer);
  if (!parsed.ok) {
    return { files: {}, emitted: [], errors: [parsed.error] };
  }

  const files: Record<string, string> = {};
  const emitted: StructuredEmittedField[] = [];
  const errors: StructuredValidationError[] = [];

  for (const recordType of STRUCTURED_RECORD_TYPES) {
    const rows = parsed.map[recordType];
    if (!rows || !Array.isArray(rows)) continue;

    const mapping = PARENT_TABLE[recordType];
    if (!mapping) continue; // STRUCTURED_RECORD_TYPES guarantees this exists.

    // Per-record-type name dedup (case-insensitive).
    const seenNames = new Set<string>();

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const result = validateRow(recordType, rowIndex, rows[rowIndex]);
      if (!result.ok) {
        errors.push(...result.errors);
        continue;
      }
      const field = result.field;

      const nameLc = field.name.toLowerCase();
      if (seenNames.has(nameLc)) {
        errors.push({
          recordType,
          rowIndex,
          field: 'name',
          message: `duplicate name "${field.name}" within ${recordType} — names must be unique per record type`,
        });
        continue;
      }
      seenNames.add(nameLc);

      const slug = slugify(field.name);
      const scriptid = `${mapping.prefix}nsix_${slug}`;
      const filename = `Objects/${scriptid}.xml`;

      const selectListScriptid =
        field.type === 'SELECT' ? `customlist_nsix_${slug}` : undefined;

      files[filename] = buildFieldXml({
        root: mapping.root,
        scriptid,
        label: field.displayLabel,
        parent: recordType,
        fieldtype: field.type,
        appliesto: mapping.appliesto,
        selectListScriptid,
        ismandatory: field.required,
        issearchable: field.isSearchable,
        showinlist: field.showInList,
        defaultValue: field.defaultValue,
        helpText: field.helpText,
      });

      emitted.push({
        scriptid,
        originalLabel: field.displayLabel,
        parent: recordType,
        fieldtype: field.type,
        root: mapping.root,
        filename,
        selectListScriptid,
      });
    }
  }

  return { files, emitted, errors };
}
