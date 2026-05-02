/**
 * SDF Custom Records generator — first real-code generator for the
 * NetSuite track. Reads the wizard's free-text TEXTAREA answer
 * `ns.design.customRecords` (one custom record name per line) and
 * emits one valid Oracle SDF `customrecordtype` XML file per record,
 * plus a companion `customlist_<slug>_status.xml` for each record's
 * baseline status field (Pack B — Custom Field Full Coverage).
 *
 * Output is deployable as-is via SuiteCloud CLI: each file passes the
 * structural validator in sdfValidator.ts (root <customrecordtype>,
 * required <recordname> + <customrecordcustomfields>, forbidden
 * <description> + <isordered>) which mirrors the audit-fix #1 contract
 * from OUTPUT_COMPAT_AUDIT.fixes.md.
 *
 * Pack B update — every emitted record now ships with 4 baseline
 * audit/system fields populated (status, owner, notes, external_ref)
 * and an auto-emitted customlist with placeholder Open/In Progress/
 * Closed/On Hold values for the status SELECT. Replaces the previous
 * empty <customrecordcustomfields/> shells. Pre-Pack-B bundles had
 * empty record shells the consultant filled in manually; Pack B
 * raises the floor so every record deploys with a usable lifecycle
 * field set out of the box.
 *
 * Contract:
 *   - Empty / whitespace-only input → emits NO files (caller can no-op
 *     the SDF/Objects/ directory write).
 *   - Each non-empty line becomes one record:
 *       Human label = the text BEFORE the first '(' (or whole line),
 *                     trimmed.
 *       scriptid    = customrecord_<slug>, where <slug> is the human
 *                     label lowercased, stripped of non-alphanumeric
 *                     characters (replaced with '_'), collapsed to
 *                     single underscores, trimmed of underscore edges.
 *   - Duplicate scriptids are de-duplicated with a numeric suffix
 *     (_2, _3, ...) so two answers like "Approval Tracker" and
 *     "Approval Tracker (custom record)" don't collide.
 *
 * Why a separate file (not extended sdfGenerator.ts)?
 *   - sdfGenerator.ts emits hardcoded mapping-driven records (WIP log,
 *     PO approval log, etc.) keyed off specific answer flags. This
 *     generator is the wizard-driven counterpart that takes free-text
 *     input from the new ns.design.customRecords answer (NS SD Depth
 *     Pack). Separation keeps the audit-fix #1 contract narrow and
 *     this generator's input-shape concerns separate.
 *
 * Sources:
 *   - NetSuite SuiteCloud SDF XML Reference — customrecordtype schema
 *     (Oracle docs, section "customrecordtype")
 *   - OUTPUT_COMPAT_AUDIT.fixes.md row #1 (Fixed in 24e256c) — root
 *     must be <customrecordtype>, no <description>, no <isordered>
 */

export interface CustomRecordsGeneratorInput {
  /** Raw TEXTAREA value from ns.design.customRecords answer.
   *  One declared record per line (empty / whitespace lines ignored).
   *  Examples:
   *    "Approval Tracker (custom record — captures full chain)"
   *    "Vendor Onboarding Request"
   *    "Project Milestone (links Project + SO + Revenue Element)"
   */
  customRecordsAnswer: string | null | undefined;
}

export interface CustomRecordsGeneratorOutput {
  /** Map<filenameRelativeToBundleRoot, fileContents>.
   *  Each entry is one Objects/customrecord_<slug>.xml file.
   *  Empty when the input has no usable record names. */
  files: Record<string, string>;
  /** Names that were parsed and emitted (in input order, after
   *  de-duplication). Useful for logging + tests. */
  emitted: Array<{ recordName: string; scriptid: string; filename: string }>;
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

/**
 * Extract the human-readable record name from one input line. The
 * convention is "Name (parenthetical hint or description)" — we keep
 * what's before the first '(' and trim whitespace.
 */
function extractRecordName(line: string): string {
  const trimmed = line.trim();
  const parenIdx = trimmed.indexOf('(');
  return (parenIdx >= 0 ? trimmed.slice(0, parenIdx) : trimmed).trim();
}

/**
 * Slugify a human record name into the Oracle SDF scriptid format:
 *   customrecord_<lowercase_alphanumeric_underscores>
 * Rules:
 *   - lowercase
 *   - non [a-z0-9] runs collapse to single '_'
 *   - leading/trailing '_' stripped
 *   - empty result falls back to 'unnamed' so the prefix never
 *     produces "customrecord_" with nothing after
 */
function slugify(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

/**
 * De-duplicate scriptids by appending a numeric suffix on collision.
 * Mutates `seen` (the running set) and returns the unique scriptid.
 */
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

// ─── XML emission ────────────────────────────────────────────────────────────

/**
 * XML-escape user-supplied text. customrecord names come from a
 * free-text TEXTAREA so we have to escape the five XML special chars
 * before splicing the value into <recordname>.
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the XML body for one customrecordtype.
 *
 * Pack B update: <customrecordcustomfields> is no longer empty —
 * every record now ships with 4 baseline fields:
 *   - <slug>_status        SELECT → companion customlist_<slug>_status
 *   - <slug>_owner         SELECT → selectrecordtype=-4 (Employee)
 *   - <slug>_notes         TEXTAREA
 *   - <slug>_external_ref  FREEFORMTEXT (label "External Reference ID")
 *
 * The structural validator in sdfValidator.ts pins the audit-fix #1
 * contract (root, required children, forbidden children) regardless of
 * what's inside the customrecordcustomfields container, so populating
 * the container does not break the existing validator gate.
 *
 * Intentionally NOT included (audit-fix #1):
 *   - <description> child on the customrecordtype root (forbidden — would
 *     fail validator). The companion customlist DOES carry a description,
 *     but that's a different element / different schema.
 *   - <isordered> child on the customrecordtype (forbidden). The
 *     customlist's <isordered> is a separate, valid element on a
 *     different schema.
 */
function buildCustomRecordTypeXml(scriptid: string, recordName: string): string {
  const escaped = xmlEscape(recordName);
  const baseline = scriptid; // e.g. "customrecord_approval_tracker"
  const statusListScriptid = `customlist_${baseline.replace(/^customrecord_/, '')}_status`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<customrecordtype scriptid="${scriptid}">
  <recordname>${escaped}</recordname>
  <customrecordcustomfields>
    <customrecordcustomfield scriptid="custrecord_${baseline.replace(/^customrecord_/, '')}_status">
      <displaytype>NORMAL</displaytype>
      <fieldtype>SELECT</fieldtype>
      <label>Status</label>
      <ismandatory>F</ismandatory>
      <selectrecordtype>${statusListScriptid}</selectrecordtype>
    </customrecordcustomfield>
    <customrecordcustomfield scriptid="custrecord_${baseline.replace(/^customrecord_/, '')}_owner">
      <displaytype>NORMAL</displaytype>
      <fieldtype>SELECT</fieldtype>
      <label>Owner</label>
      <ismandatory>F</ismandatory>
      <selectrecordtype>-4</selectrecordtype>
    </customrecordcustomfield>
    <customrecordcustomfield scriptid="custrecord_${baseline.replace(/^customrecord_/, '')}_notes">
      <displaytype>NORMAL</displaytype>
      <fieldtype>TEXTAREA</fieldtype>
      <label>Notes</label>
      <ismandatory>F</ismandatory>
    </customrecordcustomfield>
    <customrecordcustomfield scriptid="custrecord_${baseline.replace(/^customrecord_/, '')}_external_ref">
      <displaytype>NORMAL</displaytype>
      <fieldtype>FREEFORMTEXT</fieldtype>
      <label>External Reference ID</label>
      <ismandatory>F</ismandatory>
    </customrecordcustomfield>
  </customrecordcustomfields>
</customrecordtype>
`;
}

/**
 * Build the XML body for one customrecord's companion status
 * customlist. Same lifecycle slots every audit/operational record
 * needs (Open / In Progress / Closed / On Hold). Values are emitted
 * inactive so the deploy passes audit Fix #4 (every customlist must
 * carry at least one customvalue) — the consultant un-inactivates
 * after review.
 *
 * Schema follows audit Fix #4 (commit 307901c): <label> not <name>,
 * non-empty <customvalues>, validated by sdfValidator.ts.
 */
function buildStatusCustomListXml(slug: string, recordName: string): string {
  const escapedRecord = xmlEscape(recordName);
  const listScriptid = `customlist_${slug}_status`;
  const values = ['Open', 'In Progress', 'Closed', 'On Hold'];
  const customvalues = values
    .map((v, i) => `    <customvalue scriptid="val_${slug}_status_${i + 1}">
      <value>${xmlEscape(v)}</value>
      <isinactive>T</isinactive>
    </customvalue>`)
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

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the generator. Input is the raw TEXTAREA value from
 * ns.design.customRecords; output is a Map of filename →
 * customrecordtype XML, ready to merge into the SDF bundle's
 * Objects/ directory.
 *
 * Empty / whitespace-only / undefined input yields { files: {},
 * emitted: [] } — the caller (generation.ts) MUST treat that as
 * "no custom records declared" and not write an empty Objects/
 * directory.
 */
export function generateSdfCustomRecords(
  input: CustomRecordsGeneratorInput,
): CustomRecordsGeneratorOutput {
  const raw = (input.customRecordsAnswer ?? '').toString();
  if (raw.trim().length === 0) {
    return { files: {}, emitted: [] };
  }

  const lines = raw.split(/\r?\n/);
  const seen = new Set<string>();
  const emitted: Array<{ recordName: string; scriptid: string; filename: string }> = [];
  const files: Record<string, string> = {};

  for (const line of lines) {
    const recordName = extractRecordName(line);
    if (recordName.length === 0) continue; // empty lines, whitespace-only, parens-only

    const baseScriptid = `customrecord_${slugify(recordName)}`;
    const scriptid = uniqueScriptid(baseScriptid, seen);
    const filename = `Objects/${scriptid}.xml`;
    files[filename] = buildCustomRecordTypeXml(scriptid, recordName);
    emitted.push({ recordName, scriptid, filename });

    // Pack B: companion status customlist for this record's baseline
    // status field. Emitted into the same Objects/ namespace so SDF
    // CLI picks it up alongside the customrecordtype. The list
    // scriptid mirrors the record slug (no scriptid collision because
    // the prefixes differ — customrecord_ vs customlist_).
    const slug = scriptid.replace(/^customrecord_/, '');
    const listFilename = `Objects/customlist_${slug}_status.xml`;
    files[listFilename] = buildStatusCustomListXml(slug, recordName);
  }

  return { files, emitted };
}
