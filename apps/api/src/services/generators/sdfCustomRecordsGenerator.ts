/**
 * SDF Custom Records generator — first real-code generator for the
 * NetSuite track. Reads the wizard's free-text TEXTAREA answer
 * `ns.design.customRecords` (one custom record name per line) and
 * emits one valid Oracle SDF `customrecordtype` XML file per record,
 * plus a companion `customlist_<slug>_status.xml` for each record's
 * baseline status field, plus companion customlists for any SELECT
 * starter / overlay field without a hardcoded selectrecordtype.
 *
 * Pack history:
 *   - Pack 3 (NS SD Depth) — first emission of customrecord_*.xml from
 *     the wizard answer; empty <customrecordcustomfields/> shells.
 *   - Pack B (Custom Field Full Coverage) — populated the shells with
 *     4 baseline audit fields (status / owner / notes / external_ref)
 *     and an auto-emitted customlist for the status SELECT.
 *   - Pack K (Custom Record Business Fields) — adds smart starter
 *     fields per record (inferred from the record name's keyword
 *     family) and a wizard-overlay layer
 *     (ns.design.customRecordExtraFields) for consultant-supplied
 *     extras. Each emitted customrecord now ships 8–12 fields
 *     (4 baseline + 4–6 starters + 0–N overlay) instead of 4.
 *
 * Output is deployable as-is via SuiteCloud CLI: each file passes the
 * structural validator in sdfValidator.ts (root <customrecordtype>,
 * required <recordname> + <customrecordcustomfields>, forbidden
 * <description> + <isordered>) which mirrors the audit-fix #1 contract
 * from OUTPUT_COMPAT_AUDIT.fixes.md.
 *
 * Field-merge precedence (highest → lowest):
 *   1. Baseline (status / owner / notes / external_ref) — audit fields,
 *      always emit, never overridden.
 *   2. Overlay (ns.design.customRecordExtraFields) — consultant intent
 *      wins over starter heuristics.
 *   3. Starter (inferStarterFields by record name) — heuristic family
 *      defaults for the most common record types.
 *
 * Dedup is by case-insensitive label. A starter with the same label as
 * baseline is dropped (baseline wins). An overlay with the same label
 * as a starter replaces the starter (overlay wins). An overlay with
 * the same label as baseline is dropped (baseline still wins).
 *
 * Sources:
 *   - NetSuite SuiteCloud SDF XML Reference — customrecordtype schema
 *     (Oracle docs, section "customrecordtype")
 *   - OUTPUT_COMPAT_AUDIT.fixes.md row #1 (Fixed in 24e256c) — root
 *     must be <customrecordtype>, no <description>, no <isordered>
 *   - NetSuite standard record type IDs (-4 / -30 / -117) — used by
 *     starter + overlay SELECT fields that link to standard records.
 */

import {
  inferStarterFields,
  type StarterField,
  type StarterFieldType,
} from './customRecordStarterFields.js';
import {
  parseExtraFields,
  type ExtraField,
} from './customRecordExtraFieldsParser.js';

export interface CustomRecordsGeneratorInput {
  /** Raw TEXTAREA value from ns.design.customRecords answer.
   *  One declared record per line (empty / whitespace lines ignored). */
  customRecordsAnswer: string | null | undefined;
  /** Raw TEXTAREA value from ns.design.customRecordExtraFields.
   *  Per-record overlay fields beyond the baseline + starter set.
   *  Each line: "<record_name>: <field_label>: <type>". Bad lines are
   *  silently skipped — the baseline + starter pipeline still emits
   *  something useful for that record. Optional: when omitted, the
   *  generator behaves as Pack B did (baseline + starters only). */
  customRecordExtraFieldsAnswer?: string | null | undefined;
}

export interface CustomRecordsGeneratorOutput {
  /** Map<filenameRelativeToBundleRoot, fileContents>.
   *  Includes customrecord_*.xml, customlist_*_status.xml (Pack B
   *  companion), and customlist_<record>_<field>.xml for any
   *  SELECT-typed starter or overlay field without a hardcoded
   *  selectrecordtype. */
  files: Record<string, string>;
  /** Names that were parsed and emitted (in input order, after
   *  de-duplication). */
  emitted: Array<{ recordName: string; scriptid: string; filename: string }>;
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

function extractRecordName(line: string): string {
  const trimmed = line.trim();
  const parenIdx = trimmed.indexOf('(');
  return (parenIdx >= 0 ? trimmed.slice(0, parenIdx) : trimmed).trim();
}

function slugify(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

function uniqueScriptid(base: string, seen: Set<string>): string {
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  let n = 2;
  while (seen.has(`${base}_${n}`)) n++;
  const next = `${base}_${n}`;
  seen.add(next);
  return next;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Field-merge logic (Pack K) ──────────────────────────────────────────────

/**
 * Internal field shape used by the merger + emitter. Combines the
 * starter (id given) and overlay (id derived) shapes into one type
 * the XML emitter consumes.
 */
interface MergedField {
  /** scriptid suffix — appended to "custrecord_<recordSlug>_". */
  id: string;
  /** Human <label> tag value. */
  label: string;
  /** SDF fieldtype enum value. */
  fieldtype: StarterFieldType;
  /** When fieldtype === 'SELECT': either a hardcoded NetSuite record
   *  type ID ('-4' / '-30' / '-117') OR the scriptid of a customlist
   *  the generator will auto-emit alongside this customrecord. When
   *  fieldtype !== 'SELECT', this is undefined. */
  selectrecordtype?: string;
  /** When true, the generator emits a companion customlist with
   *  placeholder values + references it via selectrecordtype. False
   *  for hardcoded standard-record SELECTs (no companion needed). */
  needsCompanionCustomlist: boolean;
  /** Provenance — for the harness checks that distinguish baseline
   *  from business fields. Drives no XML output. */
  origin: 'baseline' | 'starter' | 'overlay';
}

function fieldIdFromLabel(label: string): string {
  return slugify(label);
}

/**
 * Compute the 4 baseline audit fields. These are always emitted and
 * never overridden — they're the contract Pack B established for
 * every customrecord in every bundle.
 */
function baselineFields(recordSlug: string): MergedField[] {
  const statusListScriptid = `customlist_${recordSlug}_status`;
  return [
    {
      id: 'status',
      label: 'Status',
      fieldtype: 'SELECT',
      selectrecordtype: statusListScriptid,
      needsCompanionCustomlist: false, // status companion is emitted separately by buildStatusCustomListXml
      origin: 'baseline',
    },
    {
      id: 'owner',
      label: 'Owner',
      fieldtype: 'SELECT',
      selectrecordtype: '-4',
      needsCompanionCustomlist: false,
      origin: 'baseline',
    },
    {
      id: 'notes',
      label: 'Notes',
      fieldtype: 'TEXTAREA',
      needsCompanionCustomlist: false,
      origin: 'baseline',
    },
    {
      id: 'external_ref',
      label: 'External Reference ID',
      fieldtype: 'FREEFORMTEXT',
      needsCompanionCustomlist: false,
      origin: 'baseline',
    },
  ];
}

function toMergedFromStarter(s: StarterField): MergedField {
  return {
    id: s.id,
    label: s.label,
    fieldtype: s.fieldtype,
    selectrecordtype: s.selectrecordtype,
    needsCompanionCustomlist:
      s.fieldtype === 'SELECT' && s.selectrecordtype === undefined,
    origin: 'starter',
  };
}

function toMergedFromOverlay(o: ExtraField): MergedField {
  return {
    id: fieldIdFromLabel(o.label),
    label: o.label,
    fieldtype: o.fieldtype,
    selectrecordtype: o.selectrecordtype,
    needsCompanionCustomlist:
      o.fieldtype === 'SELECT' && o.selectrecordtype === undefined,
    origin: 'overlay',
  };
}

/**
 * Merge baseline + starters + overlay into a single ordered list with
 * dedup by case-insensitive label. Precedence: baseline > overlay >
 * starter. Order in the output preserves the source ordering for each
 * tier (baseline first in fixed order, then starters in detection
 * order, then overlay in wizard-line order — overlay-replaced
 * starters take the overlay's position, dropped from the starter slot).
 */
function mergeFields(
  recordSlug: string,
  starters: StarterField[],
  overlays: ExtraField[],
): MergedField[] {
  // labelLc → index into the working list
  const indexByLabel = new Map<string, number>();
  const list: MergedField[] = [];

  for (const f of baselineFields(recordSlug)) {
    indexByLabel.set(f.label.toLowerCase(), list.length);
    list.push(f);
  }

  for (const s of starters) {
    const lc = s.label.toLowerCase();
    if (indexByLabel.has(lc)) continue; // baseline wins; drop colliding starter
    indexByLabel.set(lc, list.length);
    list.push(toMergedFromStarter(s));
  }

  for (const o of overlays) {
    const lc = o.label.toLowerCase();
    const merged = toMergedFromOverlay(o);
    if (!indexByLabel.has(lc)) {
      indexByLabel.set(lc, list.length);
      list.push(merged);
      continue;
    }
    const existingIdx = indexByLabel.get(lc)!;
    const existing = list[existingIdx];
    if (existing.origin === 'baseline') continue; // baseline wins; drop overlay
    // Overlay replaces starter at the same slot — preserves field ordering.
    list[existingIdx] = merged;
  }

  return list;
}

/**
 * Within a single record's merged field list, derive a unique scriptid
 * suffix for each field so two starter/overlay fields with the same
 * `id` (rare — only happens when overlay labels slugify to the same
 * thing as a starter's id even though labels differ) don't collide.
 * Returns the merged list with `id` rewritten to be unique within the
 * record.
 */
function uniqueFieldIds(merged: MergedField[]): MergedField[] {
  const seen = new Set<string>();
  const out: MergedField[] = [];
  for (const f of merged) {
    let id = f.id;
    let n = 2;
    while (seen.has(id)) {
      id = `${f.id}_${n++}`;
    }
    seen.add(id);
    out.push({ ...f, id });
  }
  return out;
}

// ─── XML emission ────────────────────────────────────────────────────────────

function renderFieldXml(recordSlug: string, f: MergedField): string {
  const selectLine = f.selectrecordtype
    ? `      <selectrecordtype>${f.selectrecordtype}</selectrecordtype>\n`
    : '';
  return `    <customrecordcustomfield scriptid="custrecord_${recordSlug}_${f.id}">
      <displaytype>NORMAL</displaytype>
      <fieldtype>${f.fieldtype}</fieldtype>
      <label>${xmlEscape(f.label)}</label>
      <ismandatory>F</ismandatory>
${selectLine}    </customrecordcustomfield>`;
}

function buildCustomRecordTypeXml(
  scriptid: string,
  recordName: string,
  mergedFields: MergedField[],
): string {
  const escaped = xmlEscape(recordName);
  const recordSlug = scriptid.replace(/^customrecord_/, '');
  const fieldRows = mergedFields.map((f) => renderFieldXml(recordSlug, f)).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<customrecordtype scriptid="${scriptid}">
  <recordname>${escaped}</recordname>
  <customrecordcustomfields>
${fieldRows}
  </customrecordcustomfields>
</customrecordtype>
`;
}

/**
 * Build the XML body for the baseline status companion customlist
 * (Pack B contract). Always emits Open / In Progress / Closed / On
 * Hold values, all inactive — consultant un-inactivates after review.
 */
function buildStatusCustomListXml(slug: string, recordName: string): string {
  const escapedRecord = xmlEscape(recordName);
  const listScriptid = `customlist_${slug}_status`;
  const values = ['Open', 'In Progress', 'Closed', 'On Hold'];
  const customvalues = values
    .map(
      (v, i) => `    <customvalue scriptid="val_${slug}_status_${i + 1}">
      <value>${xmlEscape(v)}</value>
      <isinactive>T</isinactive>
    </customvalue>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Auto-emitted alongside customrecord_${slug} as the picklist for its baseline status field.
  Placeholder values inactive — un-inactivate the relevant ones after review and add any
  record-specific lifecycle states the consultant needs.
-->
<customlist scriptid="${listScriptid}">
  <label>${escapedRecord} Status</label>
  <description>Lifecycle status picklist for ${escapedRecord}.</description>
  <ismatrixoption>F</ismatrixoption>
  <isordered>T</isordered>
  <customvalues>
${customvalues}
  </customvalues>
</customlist>
`;
}

/**
 * Build the XML body for a Pack-K SELECT-companion customlist (one
 * placeholder value, inactive). Used for starter + overlay SELECT
 * fields that don't reference a hardcoded NetSuite record type.
 */
function buildPackKCustomListXml(args: {
  listScriptid: string;
  recordName: string;
  fieldLabel: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Auto-emitted alongside customrecord_${args.listScriptid.replace(/^customlist_/, '').replace(/_[a-z0-9_]+$/, '')} as the picklist for its "${xmlEscape(args.fieldLabel)}" field.
  Single placeholder value, inactive — consultant adds real values + un-inactivates before deploy.
-->
<customlist scriptid="${args.listScriptid}">
  <label>${xmlEscape(args.fieldLabel)}</label>
  <description>Picklist for ${xmlEscape(args.fieldLabel)} on ${xmlEscape(args.recordName)}. Add values in NetSuite UI before deploy.</description>
  <ismatrixoption>F</ismatrixoption>
  <isordered>T</isordered>
  <customvalues>
    <customvalue scriptid="val_placeholder_1">
      <value>Placeholder value 1</value>
      <isinactive>T</isinactive>
    </customvalue>
  </customvalues>
</customlist>
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the generator. Empty / whitespace-only / undefined
 * customRecordsAnswer yields {files: {}, emitted: []} — the caller
 * MUST treat that as "no custom records declared" and not write an
 * empty Objects/ directory.
 *
 * customRecordExtraFieldsAnswer is optional. When omitted, the
 * generator behaves as Pack B did (baseline + smart starters only).
 */
export function generateSdfCustomRecords(
  input: CustomRecordsGeneratorInput,
): CustomRecordsGeneratorOutput {
  const raw = (input.customRecordsAnswer ?? '').toString();
  if (raw.trim().length === 0) {
    return { files: {}, emitted: [] };
  }

  const overlayMap = parseExtraFields(input.customRecordExtraFieldsAnswer);
  const lines = raw.split(/\r?\n/);
  const seen = new Set<string>();
  const emitted: Array<{ recordName: string; scriptid: string; filename: string }> = [];
  const files: Record<string, string> = {};

  for (const line of lines) {
    const recordName = extractRecordName(line);
    if (recordName.length === 0) continue;

    const baseScriptid = `customrecord_${slugify(recordName)}`;
    const scriptid = uniqueScriptid(baseScriptid, seen);
    const recordSlug = scriptid.replace(/^customrecord_/, '');

    // Build the merged field list. Overlay lookup uses the verbatim
    // record name as it appears in the wizard line — the overlay
    // parser stores it case-sensitively, so consultants writing
    // "Approval Tracker: ..." pair correctly with a record declared
    // as "Approval Tracker (custom record — captures full chain)".
    const starters = inferStarterFields(recordName);
    const overlays = overlayMap.get(recordName) ?? [];
    const merged = uniqueFieldIds(mergeFields(recordSlug, starters, overlays));

    // Customrecord XML.
    const filename = `Objects/${scriptid}.xml`;
    files[filename] = buildCustomRecordTypeXml(scriptid, recordName, merged);
    emitted.push({ recordName, scriptid, filename });

    // Pack B: baseline status companion customlist.
    files[`Objects/customlist_${recordSlug}_status.xml`] = buildStatusCustomListXml(
      recordSlug,
      recordName,
    );

    // Pack K: companion customlist per SELECT field that needs one
    // (starter / overlay SELECT without hardcoded selectrecordtype).
    for (const f of merged) {
      if (!f.needsCompanionCustomlist) continue;
      // Derive the customlist scriptid + write it back into the field
      // for the customrecord XML emission. We mutate `merged` in
      // place — re-render the customrecord XML at the end with the
      // resolved selectrecordtypes. (Below.)
      const listScriptid = `customlist_${recordSlug}_${f.id}`;
      f.selectrecordtype = listScriptid;
      f.needsCompanionCustomlist = false;
      files[`Objects/${listScriptid}.xml`] = buildPackKCustomListXml({
        listScriptid,
        recordName,
        fieldLabel: f.label,
      });
    }

    // Re-render the customrecord XML now that companion customlist
    // scriptids are wired into the SELECT fields' selectrecordtype.
    files[filename] = buildCustomRecordTypeXml(scriptid, recordName, merged);
  }

  return { files, emitted };
}
