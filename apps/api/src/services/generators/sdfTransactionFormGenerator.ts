/**
 * SDF Transaction Form generator (Pack H — Custom Forms).
 *
 * Emits one Oracle SDF transactionform XML per transaction-side parent
 * record (Sales Order / Purchase Order / Invoice / Bill / Journal
 * Entry / Item Receipt) that has at least one Pack B custom field
 * declared in ns.design.customFieldsScope. Each form embeds those
 * fields as a starter layout under a "Custom Fields" fieldgroup.
 *
 * Why: by NetSuite default, custom fields land on stock forms in the
 * "Custom" subtab — usable but not consultant-grade. A senior NS
 * consultant manually creates one custom form per transaction type +
 * drags fields onto the right subtabs (5–10 forms × ~30 mins each =
 * ~1–2 days of UI clicking eliminated per engagement). Pack H makes
 * this generated, deterministic, and re-emittable from the wizard.
 *
 * Pack H is purely derivative from Pack B's custom field map — no new
 * wizard questions. The form generator calls Pack B's
 * `generateSdfCustomFields` internally to get the parsed (parent,
 * scriptid) tuples; the form's <fields> block re-references those
 * scriptids by id.
 *
 * Sources:
 *   - NetSuite SDF transactionform XML reference (Oracle docs).
 *   - NetSuite Custom Forms best practice (Oracle Help — preferred
 *     forms, recordtype enum, fieldgroup/fields layout).
 */

import {
  generateSdfCustomFields,
  type EmittedField,
} from './sdfCustomFieldsGenerator.js';

/**
 * Maps human parent name → NetSuite recordtype enum value used inside
 * <recordtype>...</recordtype>. Lower-cased projection drives the
 * scriptid suffix (custform_<client>_<recordtype_lower>.xml).
 */
const TXN_PARENT_RECORDTYPE: Record<string, string> = {
  'Sales Order': 'SALESORD',
  'Purchase Order': 'PURCHORD',
  Invoice: 'INVOICE',
  Bill: 'VENDBILL',
  'Journal Entry': 'JOURNALENTRY',
  'Item Receipt': 'ITEMRCPT',
};

/**
 * Display labels for the human-readable form name. Falls back to the
 * parent name when no override is registered.
 */
const TXN_PARENT_DISPLAY: Record<string, string> = {
  'Sales Order': 'Sales Order',
  'Purchase Order': 'Purchase Order',
  Invoice: 'Invoice',
  Bill: 'Vendor Bill',
  'Journal Entry': 'Journal Entry',
  'Item Receipt': 'Item Receipt',
};

export interface TransactionFormInput {
  /** Raw TEXTAREA from ns.design.customFieldsScope (same input as
   *  Pack B's field generator). Re-parsed here so this generator stays
   *  independent of any structured-map type. */
  customFieldsScope: string | null | undefined;
  /** Client / engagement name — drives the scriptid client_slug and
   *  the human-readable form name ("<Client> <Type> Form"). */
  clientName: string;
  /** When true, the Purchase Order form auto-includes
   *  custbody_nsix_required_approver (Pack B's auto-added field that
   *  the PO User Event script writes to). Pass through the same flag
   *  the orchestrator uses when deciding whether to emit the
   *  PO-approval User Event script. */
  poApprovalInScope: boolean;
}

export interface TransactionFormOutput {
  /** Map<bundle-relative path, XML body>. Keys take the form
   *  Objects/custform_<client_slug>_<recordtype_lower>.xml. */
  files: Record<string, string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Slugify a client name for use inside the form scriptid. Rules:
 *   - lowercase
 *   - non-alphanumeric runs collapse to a single underscore
 *   - leading/trailing underscores trimmed
 *   - max 20 chars; truncates at the last word boundary that fits
 *     (so "Atlas Industries Group" → "atlas_industries", not
 *     "atlas_industries_gro" mid-word)
 *
 * Word-boundary truncation matches the spec's example for Atlas
 * ("atlas_industries"). For long single-segment names that exceed 20
 * chars in their first word, the slug falls back to a hard 20-char
 * truncation (acceptable — unusual case).
 */
function clientSlug(clientName: string): string {
  const raw = clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (raw.length <= 20) return raw;
  const truncated = raw.slice(0, 20);
  const lastUnderscore = truncated.lastIndexOf('_');
  // If we found a word boundary inside the 20-char window, prefer it
  // (keeps the slug human-readable); else fall back to hard truncation.
  return lastUnderscore > 0 ? truncated.slice(0, lastUnderscore) : truncated;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Group emitted Pack B fields by parent record. Only transaction
 * parents are kept here — entity-side parents are filtered out and
 * handled by the entry-form generator.
 */
function groupTxnFieldsByParent(
  emitted: EmittedField[],
): Map<string, EmittedField[]> {
  const grouped = new Map<string, EmittedField[]>();
  for (const f of emitted) {
    if (!(f.parent in TXN_PARENT_RECORDTYPE)) continue;
    const list = grouped.get(f.parent) ?? [];
    list.push(f);
    grouped.set(f.parent, list);
  }
  return grouped;
}

function buildTransactionFormXml(args: {
  scriptid: string;
  formName: string;
  recordtype: string;
  fields: EmittedField[];
}): string {
  const fieldRows = args.fields
    .map(
      (f) => `        <field>
          <id>${f.scriptid}</id>
          <visible>T</visible>
          <mandatory>F</mandatory>
        </field>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Transaction Form Generator.
  Source: Pack B custom fields parsed from ns.design.customFieldsScope.
  Form embeds the engagement's custom fields as a starter layout. Adjust subtab placement,
  field order, and visibility in NetSuite UI before deploy if needed.
-->
<transactionform scriptid="${args.scriptid}">
  <name>${xmlEscape(args.formName)}</name>
  <recordtype>${args.recordtype}</recordtype>
  <preferred>T</preferred>
  <storedwithrecord>F</storedwithrecord>
  <mainfields>
    <fieldgroup>
      <id>customfields</id>
      <label>Custom Fields</label>
      <visible>T</visible>
      <fields>
${fieldRows}
      </fields>
    </fieldgroup>
  </mainfields>
</transactionform>
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Emit the full set of transaction-form XMLs for an engagement.
 *
 * Empty / whitespace-only / missing customFieldsScope → empty file
 * map (no errors). Forms are only emitted for parents that have at
 * least one custom field; transaction parents that didn't get any
 * custom fields stay on NetSuite's stock form by default.
 */
export function generateTransactionForms(
  input: TransactionFormInput,
): TransactionFormOutput {
  // Re-use Pack B's parser via its public API. Discard the field
  // XMLs (the orchestrator emits those independently) — we only need
  // the parsed `emitted` tuples to know (scriptid, parent) pairs.
  const fieldsResult = generateSdfCustomFields({
    customFieldsScopeAnswer: input.customFieldsScope,
    includePoApprovalRequiredField: input.poApprovalInScope,
  });

  const grouped = groupTxnFieldsByParent(fieldsResult.emitted);
  if (grouped.size === 0) return { files: {} };

  const slug = clientSlug(input.clientName);
  const files: Record<string, string> = {};

  for (const [parent, fields] of grouped.entries()) {
    const recordtype = TXN_PARENT_RECORDTYPE[parent];
    const display = TXN_PARENT_DISPLAY[parent] ?? parent;
    const scriptid = `custform_${slug}_${recordtype.toLowerCase()}`;
    const formName = `${input.clientName} ${display} Form`;
    const filename = `Objects/${scriptid}.xml`;
    files[filename] = buildTransactionFormXml({
      scriptid,
      formName,
      recordtype,
      fields,
    });
  }

  return { files };
}

// Exported for shared use by tests + the entry-form generator's slug logic.
export { clientSlug };
