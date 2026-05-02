/**
 * SDF Custom Records generator — first real-code generator for the
 * NetSuite track. Reads the wizard's free-text TEXTAREA answer
 * `ns.design.customRecords` (one custom record name per line) and
 * emits one valid Oracle SDF `customrecordtype` XML file per record.
 *
 * Output is deployable as-is via SuiteCloud CLI: each file passes the
 * structural validator in sdfValidator.ts (root <customrecordtype>,
 * required <recordname> + <customrecordcustomfields>, forbidden
 * <description> + <isordered>) which mirrors the audit-fix #1 contract
 * from OUTPUT_COMPAT_AUDIT.fixes.md.
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
 * Build the XML body for one customrecordtype. Mirrors the existing
 * mapping/index.ts shape (audit-fix #1 contract) — minimal valid
 * record with empty <customrecordcustomfields/> container. The
 * structural validator in sdfValidator.ts pins this exact shape.
 *
 * Intentionally NOT included (audit-fix #1):
 *   - <description> child (forbidden — would fail validator)
 *   - <isordered> child (forbidden — would fail validator)
 */
function buildCustomRecordTypeXml(scriptid: string, recordName: string): string {
  const escaped = xmlEscape(recordName);
  return `<?xml version="1.0" encoding="UTF-8"?>
<customrecordtype scriptid="${scriptid}">
  <recordname>${escaped}</recordname>
  <customrecordcustomfields>
  </customrecordcustomfields>
</customrecordtype>
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
  }

  return { files, emitted };
}
