/**
 * Shared helpers for SDF custom-field generators.
 *
 * Extracted from Pack B's sdfCustomFieldsGenerator.ts during Phase 23 to
 * support both the legacy TEXTAREA-driven generator and the new
 * structured editor (sdfStructuredCustomFieldsGenerator.ts). Behaviour
 * is identical to what Pack B was doing inline; this file is purely a
 * relocation.
 *
 * Sources:
 *   - NetSuite SDF XML Reference — itemcustomfield / entitycustomfield /
 *     transactionbodycustomfield schemas (Oracle docs).
 *   - sdfValidator.ts validateTransactionBodyCustomField + validateEntityCustomField
 *     enforce the contract every emit here must satisfy.
 */

// ─── Field-type taxonomy ─────────────────────────────────────────────────────

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

/**
 * Canonical parent-record table. Keys are the labels Pack B's TEXTAREA
 * parser accepts and the labels the structured editor exposes as tabs.
 */
export const PARENT_TABLE: Record<string, ParentMapping> = {
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
    // NetSuite's appliesto element is "vendorbill", not "bill".
    appliesto: 'appliestovendorbill',
  },
  'Vendor Bill': {
    // Phase 23 alias — the structured editor's tab is labelled
    // "Vendor Bill" to match NetSuite UI nomenclature; map to the
    // same SDF appliesto element as the Pack B "Bill" key.
    root: 'transactionbodycustomfield',
    prefix: 'custbody_',
    appliesto: 'appliestovendorbill',
  },
  'Journal Entry': {
    root: 'transactionbodycustomfield',
    prefix: 'custbody_',
    appliesto: 'appliestojournalentry',
  },
};

// ─── Slug + escape ───────────────────────────────────────────────────────────

/**
 * Convert a human field label into a safe SDF scriptid suffix.
 *
 *   "Tier (Premium/Standard)" → "tier_premium_standard"
 *   "  Whitespace Edges  "    → "whitespace_edges"
 *   "!@#$%"                   → "unnamed"
 *
 * Lowercase, collapse non-alphanumeric to single underscore, strip
 * leading/trailing underscores, fall back to "unnamed" if everything
 * was special-character.
 */
export function slugify(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

/**
 * XML-escape a value for safe inclusion in element bodies / attributes.
 * Matches Pack B's existing implementation.
 */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── XML emit ────────────────────────────────────────────────────────────────

export interface BuildFieldXmlInput {
  root: CustomFieldRoot;
  scriptid: string;
  label: string;
  parent: string;
  fieldtype: CustomFieldType;
  appliesto: string;
  /** When fieldtype === 'SELECT', the customlist scriptid this field
   *  references. */
  selectListScriptid?: string;
  /** Optional structured-field overrides (Phase 23). When omitted,
   *  fall back to Pack B's defaults: ismandatory=F, issearchable=T,
   *  no defaultvalue, no description, no showinlist. */
  ismandatory?: boolean;
  issearchable?: boolean;
  showinlist?: boolean;
  defaultValue?: string;
  helpText?: string;
  /** Free-form extra line appended to the comment header (Pack B uses
   *  this for the auto-added PO approval field). */
  commentHeaderExtra?: string;
}

/**
 * Build the SDF XML for a single custom field. Used by both Pack B (via
 * the legacy entry path) and the Phase 23 structured generator.
 *
 * The structured-field overrides (ismandatory / issearchable / showinlist /
 * defaultValue / helpText) are optional — when not provided the function
 * preserves Pack B's exact prior emit so the legacy generator stays
 * byte-identical to its previous output.
 */
export function buildFieldXml(args: BuildFieldXmlInput): string {
  const escapedLabel = xmlEscape(args.label);
  const ismandatory = args.ismandatory === true ? 'T' : 'F';
  const issearchable = args.issearchable === false ? 'F' : 'T'; // default T
  const showInListLine =
    args.showinlist === undefined
      ? ''
      : `  <showinlist>${args.showinlist ? 'T' : 'F'}</showinlist>\n`;
  const defaultValueLine =
    args.defaultValue !== undefined && args.defaultValue.length > 0
      ? `  <defaultvalue>${xmlEscape(args.defaultValue)}</defaultvalue>\n`
      : '';
  const descriptionLine =
    args.helpText !== undefined && args.helpText.length > 0
      ? `  <description>${xmlEscape(args.helpText)}</description>\n`
      : '';
  const selectLine = args.selectListScriptid
    ? `  <selectrecordtype>${args.selectListScriptid}</selectrecordtype>\n`
    : '';
  const commentExtra = args.commentHeaderExtra ? `\n  ${args.commentHeaderExtra}` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Custom Field Generator.
  Original label: ${escapedLabel}
  Parent: ${args.parent}
  Field type: ${args.fieldtype}
  Review/adjust before deploy.${commentExtra}
-->
<${args.root} scriptid="${args.scriptid}">
  <label>${escapedLabel}</label>
  <fieldtype>${args.fieldtype}</fieldtype>
  <displaytype>NORMAL</displaytype>
  <ismandatory>${ismandatory}</ismandatory>
  <issearchable>${issearchable}</issearchable>
${showInListLine}${defaultValueLine}${descriptionLine}  <storevalue>T</storevalue>
${selectLine}  <${args.appliesto}>T</${args.appliesto}>
</${args.root}>
`;
}
