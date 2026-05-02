/**
 * BRD Custom Field generator (Pack B — Custom Field Full Coverage).
 *
 * Reads the wizard's free-text TEXTAREA `ns.design.customFieldsScope`
 * and emits one Oracle SDF custom-field XML per declared field —
 * itemcustomfield / entitycustomfield / transactionbodycustomfield —
 * with fieldtype inferred from a keyword classifier on the human label.
 *
 * Input shape (one parent-record line per record):
 *   "<Parent>: <count> custom fields (<comma-separated field labels>)"
 *
 * Examples (from Brightside seed):
 *   "Item: 6 custom fields (Batch tracking required, Lot expiry policy, Storage temp, Hazard classification, Controlled substance flag, Regulatory authorization #)"
 *   "Customer: 4 custom fields (Pharmacy license, Authorization expiry, GPO membership, Tier)"
 *
 * Each field becomes one Objects/<scriptid>.xml file. SELECT-classified
 * fields ALSO emit a companion customlist via sdfCustomListGenerator.ts
 * (caller-driven — this generator only flags the SELECTs in its
 * `selectFields` output, the orchestrator threads them into the list
 * generator).
 *
 * Why parser is conservative:
 *   - Lines that don't match the parent-prefix regex are SKIP'd (not
 *     emitted as TBD placeholders) — keeps the bundle deploy-clean.
 *   - Field labels with parens or special chars get slugified to a
 *     valid scriptid; original label survives in <label> + a comment
 *     header for consultant review.
 *
 * Sources:
 *   - NetSuite SDF XML Reference — itemcustomfield / entitycustomfield /
 *     transactionbodycustomfield schemas (Oracle docs).
 *   - audit Fix #2 closeout (8ba9181) — transactionbodycustomfield
 *     replaces the legacy <othercustomfield>.
 *   - sdfValidator.ts validateTransactionBodyCustomField + validateEntityCustomField
 *     enforce the contract this generator emits.
 */

export type CustomFieldType =
  | 'CHECKBOX'
  | 'DATE'
  | 'CURRENCY'
  | 'SELECT'
  | 'TEXTAREA'
  | 'FREEFORMTEXT';

export type CustomFieldRoot =
  | 'itemcustomfield'
  | 'entitycustomfield'
  | 'transactionbodycustomfield';

export interface ParentMapping {
  /** XML root element. */
  root: CustomFieldRoot;
  /** scriptid prefix (e.g. "custitem_", "custentity_", "custbody_"). */
  prefix: string;
  /** Single appliesto child element name (without angle brackets) — emitted
   *  as <name>T</name>. */
  appliesto: string;
}

const PARENT_TABLE: Record<string, ParentMapping> = {
  Item: { root: 'itemcustomfield', prefix: 'custitem_', appliesto: 'appliestoitem' },
  Customer: { root: 'entitycustomfield', prefix: 'custentity_', appliesto: 'appliestocustomer' },
  Vendor: { root: 'entitycustomfield', prefix: 'custentity_', appliesto: 'appliestovendor' },
  Employee: {
    root: 'entitycustomfield',
    prefix: 'custentity_',
    appliesto: 'appliestoemployee',
  },
  'Sales Order': {
    root: 'transactionbodycustomfield',
    prefix: 'custbody_',
    appliesto: 'appliestosalesorder',
  },
  'Purchase Order': {
    root: 'transactionbodycustomfield',
    prefix: 'custbody_',
    appliesto: 'appliestopurchaseorder',
  },
  Invoice: {
    root: 'transactionbodycustomfield',
    prefix: 'custbody_',
    appliesto: 'appliestoinvoice',
  },
  'Item Receipt': {
    root: 'transactionbodycustomfield',
    prefix: 'custbody_',
    appliesto: 'appliestoitemreceipt',
  },
  Bill: {
    root: 'transactionbodycustomfield',
    prefix: 'custbody_',
    appliesto: 'appliestovendorbill', // NetSuite's appliesto element is "vendorbill", not "bill"
  },
  'Journal Entry': {
    root: 'transactionbodycustomfield',
    prefix: 'custbody_',
    appliesto: 'appliestojournalentry',
  },
};

/**
 * Aliases the parser accepts for parent prefixes. Wizard answers in
 * the wild often write "Customer record:" / "Vendor record:" /
 * "Employee record:" instead of the canonical bare form. We canonicalise
 * to the table key.
 */
const PARENT_ALIASES: Record<string, string> = {
  'customer record': 'Customer',
  'vendor record': 'Vendor',
  'employee record': 'Employee',
  'item record': 'Item',
};

export interface EmittedField {
  /** SDF scriptid, e.g. "custitem_batch_tracking_required". */
  scriptid: string;
  /** The original human label from the wizard. */
  originalLabel: string;
  /** Parent record (e.g. "Item", "Customer"). */
  parent: string;
  /** Inferred fieldtype from the keyword classifier. */
  fieldtype: CustomFieldType;
  /** XML root element used. */
  root: CustomFieldRoot;
  /** Bundle-relative path (e.g. "Objects/custitem_batch_tracking_required.xml"). */
  filename: string;
  /** When fieldtype === 'SELECT', the customlist scriptid this field
   *  references — the orchestrator passes this to
   *  sdfCustomListGenerator to emit the companion customlist file. */
  selectListScriptid?: string;
}

export interface CustomFieldsGeneratorInput {
  /** Raw TEXTAREA from ns.design.customFieldsScope. */
  customFieldsScopeAnswer: string | null | undefined;
  /** When true, auto-adds custbody_nsix_required_approver (a Purchase
   *  Order TEXT field). Set to true by the orchestrator when the PO
   *  approval User Event script is also being emitted, since the
   *  script writes to this field — it MUST exist in the deployed
   *  bundle or beforeSubmit blows up. */
  includePoApprovalRequiredField?: boolean;
}

export interface CustomFieldsGeneratorOutput {
  /** Map<bundle-relative path, XML body>. */
  files: Record<string, string>;
  /** Structured record of every emitted field — used by the
   *  orchestrator to drive companion customlist emission for SELECTs
   *  and by the harness for coverage scoring. */
  emitted: EmittedField[];
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

// Accepts "<Parent>:" or "<Parent> record:" — alias map below
// canonicalises the latter to the bare key. Case-insensitive.
const LINE_RE =
  /^(Item|Customer|Vendor|Employee|Sales Order|Purchase Order|Invoice|Item Receipt|Bill|Journal Entry)(?:\s+record)?:\s*\d*\s*custom\s+fields?\s*\((.+)\)$/i;

interface ParsedLine {
  parent: string;
  fieldLabels: string[];
}

function parseLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const m = trimmed.match(LINE_RE);
  if (!m) return null;
  const parentRaw = m[1];
  // Re-canonicalise to the table's case (the regex is case-insensitive).
  const parent = canonicaliseParent(parentRaw);
  if (parent === null) return null;
  const fieldLabels = m[2]
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  if (fieldLabels.length === 0) return null;
  return { parent, fieldLabels };
}

function canonicaliseParent(raw: string): string | null {
  const lc = raw.toLowerCase();
  // Check aliases first (e.g. "customer record" → "Customer")
  if (PARENT_ALIASES[lc]) return PARENT_ALIASES[lc];
  for (const key of Object.keys(PARENT_TABLE)) {
    if (key.toLowerCase() === lc) return key;
  }
  return null;
}

// ─── Slug + classifier ───────────────────────────────────────────────────────

function slugify(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

/**
 * Keyword classifier. Priority order (FIRST match wins):
 *   1. CHECKBOX  — flag / required / enabled / allowed
 *   2. DATE      — date / expir / deadline / maturit
 *   3. CURRENCY  — amount / cost / price / value / total
 *   4. SELECT    — tier / level / category / type / status / policy /
 *                  reason / class / grade   (auto-emits customlist)
 *   5. TEXTAREA  — note / comment / description
 *   6. TEXT      — default
 *
 * Matched against the lowercased label. Order matters: "Status amount"
 * is a CHECKBOX-leaning label so CHECKBOX wins (no checkbox keyword
 * here), then SELECT wins over CURRENCY in this hypothetical.
 */
export function classifyFieldType(label: string): CustomFieldType {
  const lc = label.toLowerCase();
  if (/\b(flag|required|enabled|allowed)\b/.test(lc)) return 'CHECKBOX';
  if (/\bdate\b|\bexpir|\bdeadline|\bmaturit/.test(lc)) return 'DATE';
  if (/\b(amount|cost|price|value|total)\b/.test(lc)) return 'CURRENCY';
  // SELECT family — match prefixes liberally so common variants
  // ("classification", "categorization", "policies") count. The base
  // keywords are exact-word; the broader keywords (class, category)
  // also match their word-family.
  if (
    /\b(tier|level|status|reason|grade)\b/.test(lc) ||
    /\bclass[a-z]*\b/.test(lc) ||         // class, classification, classified
    /\bcategor[a-z]*\b/.test(lc) ||       // category, categorization
    /\btype\b/.test(lc) ||                // type (strict — avoid "subtype" of unrelated words)
    /\bpolic[a-z]*\b/.test(lc)            // policy, policies
  ) {
    return 'SELECT';
  }
  // TEXTAREA family — accept singular + plural variants ("note" /
  // "notes" / "comment" / "comments" / "description" / "descriptions").
  if (/\b(notes?|comments?|descriptions?)\b/.test(lc)) return 'TEXTAREA';
  return 'FREEFORMTEXT';
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildFieldXml(args: {
  root: CustomFieldRoot;
  scriptid: string;
  label: string;
  parent: string;
  fieldtype: CustomFieldType;
  appliesto: string;
  selectListScriptid?: string;
  commentHeaderExtra?: string;
}): string {
  const escapedLabel = xmlEscape(args.label);
  const selectLine = args.selectListScriptid
    ? `  <selectrecordtype>${args.selectListScriptid}</selectrecordtype>\n`
    : '';
  const commentExtra = args.commentHeaderExtra
    ? `\n  ${args.commentHeaderExtra}`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Custom Field Generator from wizard answer ns.design.customFieldsScope.
  Original label: ${escapedLabel}
  Parent: ${args.parent}
  Inferred fieldtype: ${args.fieldtype}
  Review/adjust before deploy.${commentExtra}
-->
<${args.root} scriptid="${args.scriptid}">
  <label>${escapedLabel}</label>
  <fieldtype>${args.fieldtype}</fieldtype>
  <displaytype>NORMAL</displaytype>
  <ismandatory>F</ismandatory>
  <issearchable>T</issearchable>
  <storevalue>T</storevalue>
${selectLine}  <${args.appliesto}>T</${args.appliesto}>
</${args.root}>
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate the full set of BRD custom-field XMLs.
 *
 * Empty / whitespace-only / undefined input yields { files: {},
 * emitted: [] }. Lines that don't match the parent-prefix regex are
 * silently skipped — Pack B's job is "emit what we can parse"; the
 * existing approvalThresholds TABLE is the consultant-facing source of
 * truth for unparseable cases.
 *
 * When `includePoApprovalRequiredField` is true, an extra synthetic
 * field (custbody_nsix_required_approver) is appended regardless of
 * the wizard answer. The PO approval User Event script writes to this
 * field at runtime — without it, the script throws on the first
 * non-auto PO. Comment header on the auto-added field tells the
 * consultant why it's there.
 */
export function generateSdfCustomFields(
  input: CustomFieldsGeneratorInput,
): CustomFieldsGeneratorOutput {
  const files: Record<string, string> = {};
  const emitted: EmittedField[] = [];
  const seen = new Set<string>();

  const raw = (input.customFieldsScopeAnswer ?? '').toString();
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const mapping = PARENT_TABLE[parsed.parent];
    if (!mapping) continue;

    for (const label of parsed.fieldLabels) {
      const baseScriptid = `${mapping.prefix}${slugify(label)}`;
      // De-dup colliding scriptids with numeric suffix (same approach
      // as sdfCustomRecordsGenerator).
      let scriptid = baseScriptid;
      let n = 2;
      while (seen.has(scriptid)) {
        scriptid = `${baseScriptid}_${n++}`;
      }
      seen.add(scriptid);

      const fieldtype = classifyFieldType(label);
      const selectListScriptid =
        fieldtype === 'SELECT'
          ? `customlist_${scriptid.replace(/^cust(item|entity|body)_/, '')}`
          : undefined;

      const filename = `Objects/${scriptid}.xml`;
      files[filename] = buildFieldXml({
        root: mapping.root,
        scriptid,
        label,
        parent: parsed.parent,
        fieldtype,
        appliesto: mapping.appliesto,
        selectListScriptid,
      });
      emitted.push({
        scriptid,
        originalLabel: label,
        parent: parsed.parent,
        fieldtype,
        root: mapping.root,
        filename,
        selectListScriptid,
      });
    }
  }

  // PO approval User Event reference field — auto-added when the PO
  // script will be in the bundle. Without this, the script's
  // setValue({ fieldId: 'custbody_nsix_required_approver', ... }) blows
  // up at runtime with "field not found".
  if (input.includePoApprovalRequiredField) {
    const scriptid = 'custbody_nsix_required_approver';
    if (!seen.has(scriptid)) {
      seen.add(scriptid);
      const label = 'Required Approver (auto-routed)';
      const filename = `Objects/${scriptid}.xml`;
      files[filename] = buildFieldXml({
        root: 'transactionbodycustomfield',
        scriptid,
        label,
        parent: 'Purchase Order',
        fieldtype: 'FREEFORMTEXT',
        appliesto: 'appliestopurchaseorder',
        commentHeaderExtra:
          'Auto-added because the PO Approval User Event script depends on this field.',
      });
      emitted.push({
        scriptid,
        originalLabel: label,
        parent: 'Purchase Order',
        fieldtype: 'FREEFORMTEXT',
        root: 'transactionbodycustomfield',
        filename,
      });
    }
  }

  return { files, emitted };
}
