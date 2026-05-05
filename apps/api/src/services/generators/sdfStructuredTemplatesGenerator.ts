/**
 * Structured Templates generator (Phase 26).
 *
 * Reads the wizard's structured answer key `ns.design.templatesStructured`
 * (a JSON-stringified array of StructuredTemplate) and emits one Oracle
 * SDF advancedpdftemplate / emailtemplate per row. The generator writes
 * STUB content (CDATA-wrapped HTML/PDF with TODO markers + a header
 * comment listing the captured sections); consultants edit the actual
 * FreeMarker / BFO template body in NetSuite UI after deploy.
 *
 * Phase 26 contract:
 *   - 4 template kinds: INVOICE / PURCHASE_ORDER / STATEMENT / DUNNING_EMAIL.
 *     The first three emit advancedpdftemplate; DUNNING_EMAIL emits
 *     emailtemplate (different SDF root).
 *   - Per-row "sections" multi-select drives the TODO markers in the stub
 *     content (LOGO / BILL_TO / SHIP_TO / LINE_TABLE / SUBTOTALS /
 *     TAX_BREAKDOWN / PAYMENT_INSTRUCTIONS / FOOTER_TERMS / DUNNING_TIER).
 *   - "preferred: true" emits <preferred>T</preferred>; only one row per
 *     kind should be preferred but the generator does not enforce this
 *     (NS itself enforces uniqueness on deploy).
 *
 * Adaptor gate: this generator self-gates on adaptorId === 'netsuite'.
 *
 * Naming convention:
 *   custtmpl_nsix_<slug>   for INVOICE / PURCHASE_ORDER / STATEMENT
 *   custemail_nsix_<slug>  for DUNNING_EMAIL
 *
 * Sources:
 *   - NetSuite SDF XML Reference — advancedpdftemplate + emailtemplate schemas
 *     (Oracle docs).
 *   - sdfStructuredCustomFieldsGenerator.ts (Phase 23) and
 *     sdfStructuredRolesGenerator.ts (Phase 25) — same precedence-helper
 *     and parallel-emitter pattern this module mirrors.
 */

// ─── Public types ────────────────────────────────────────────────────────────

export type TemplateKind = 'INVOICE' | 'PURCHASE_ORDER' | 'STATEMENT' | 'DUNNING_EMAIL';

export type TemplateSection =
  | 'LOGO'
  | 'BILL_TO'
  | 'SHIP_TO'
  | 'LINE_TABLE'
  | 'SUBTOTALS'
  | 'TAX_BREAKDOWN'
  | 'PAYMENT_INSTRUCTIONS'
  | 'FOOTER_TERMS'
  | 'DUNNING_TIER';

const ALLOWED_KINDS: ReadonlySet<TemplateKind> = new Set<TemplateKind>([
  'INVOICE',
  'PURCHASE_ORDER',
  'STATEMENT',
  'DUNNING_EMAIL',
]);

const ALLOWED_SECTIONS: ReadonlySet<TemplateSection> = new Set<TemplateSection>([
  'LOGO',
  'BILL_TO',
  'SHIP_TO',
  'LINE_TABLE',
  'SUBTOTALS',
  'TAX_BREAKDOWN',
  'PAYMENT_INSTRUCTIONS',
  'FOOTER_TERMS',
  'DUNNING_TIER',
]);

/** Maps TemplateKind to NS recordtype value used inside the SDF object. */
const KIND_TO_RECORDTYPE: Record<TemplateKind, string> = {
  INVOICE: 'INVOICE',
  PURCHASE_ORDER: 'PURCHASEORDER',
  STATEMENT: 'STATEMENT',
  DUNNING_EMAIL: 'TRANSACTION', // emailtemplate uses recordtype='TRANSACTION' for txn-context emails
};

export interface StructuredTemplate {
  name: string;
  kind: TemplateKind;
  preferred: boolean;
  sections: TemplateSection[];
  notes: string;
}

export interface StructuredTemplatesInput {
  adaptorId: string;
  structuredAnswer: string | null | undefined | StructuredTemplate[];
}

export interface StructuredEmittedTemplate {
  filename: string;
  scriptid: string;
  name: string;
  kind: TemplateKind;
  recordtype: string;
  preferred: boolean;
  sections: TemplateSection[];
  /** True when this template emits the emailtemplate root (DUNNING_EMAIL). */
  isEmailTemplate: boolean;
}

export interface StructuredTemplatesValidationError {
  rowIndex: number;
  field: string;
  message: string;
}

export interface StructuredTemplatesOutput {
  files: Record<string, string>;
  emitted: StructuredEmittedTemplate[];
  errors: StructuredTemplatesValidationError[];
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

// ─── Validation ──────────────────────────────────────────────────────────────

function validateRow(
  rowIndex: number,
  raw: unknown,
):
  | { ok: true; tmpl: StructuredTemplate }
  | { ok: false; errors: StructuredTemplatesValidationError[] } {
  const errs: StructuredTemplatesValidationError[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errs.push({ rowIndex, field: '_root', message: 'row must be an object' });
    return { ok: false, errors: errs };
  }
  const obj = raw as Record<string, unknown>;

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (name.length === 0) {
    errs.push({ rowIndex, field: 'name', message: 'name is required' });
  } else if (slugify(name) === 'unnamed') {
    errs.push({
      rowIndex,
      field: 'name',
      message: `name "${name}" produces an empty slug; use at least one alphanumeric character`,
    });
  }

  if (typeof obj.kind !== 'string' || !ALLOWED_KINDS.has(obj.kind as TemplateKind)) {
    errs.push({
      rowIndex,
      field: 'kind',
      message: `kind must be one of INVOICE/PURCHASE_ORDER/STATEMENT/DUNNING_EMAIL (got ${JSON.stringify(obj.kind)})`,
    });
  }

  if (typeof obj.preferred !== 'boolean') {
    errs.push({
      rowIndex,
      field: 'preferred',
      message: `preferred must be a boolean (got ${JSON.stringify(obj.preferred)})`,
    });
  }

  let sections: TemplateSection[] = [];
  if (obj.sections !== undefined) {
    if (!Array.isArray(obj.sections)) {
      errs.push({
        rowIndex,
        field: 'sections',
        message: 'sections must be an array of section names',
      });
    } else {
      for (let i = 0; i < obj.sections.length; i++) {
        const s = obj.sections[i];
        if (typeof s !== 'string' || !ALLOWED_SECTIONS.has(s as TemplateSection)) {
          errs.push({
            rowIndex,
            field: `sections[${i}]`,
            message: `unknown section ${JSON.stringify(s)}`,
          });
        }
      }
      sections = (obj.sections as unknown[]).filter(
        (s): s is TemplateSection => typeof s === 'string' && ALLOWED_SECTIONS.has(s as TemplateSection),
      );
    }
  }

  const notes = typeof obj.notes === 'string' ? obj.notes : '';

  if (errs.length > 0) return { ok: false, errors: errs };

  return {
    ok: true,
    tmpl: {
      name,
      kind: obj.kind as TemplateKind,
      preferred: obj.preferred as boolean,
      sections,
      notes,
    },
  };
}

function parseStructuredAnswer(
  raw: StructuredTemplatesInput['structuredAnswer'],
):
  | { ok: true; rows: unknown[] }
  | { ok: false; error: StructuredTemplatesValidationError } {
  if (raw === null || raw === undefined) return { ok: true, rows: [] };
  if (Array.isArray(raw)) return { ok: true, rows: raw as unknown[] };
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return { ok: true, rows: [] };
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) {
        return {
          ok: false,
          error: {
            rowIndex: -1,
            field: '_root',
            message: 'structured payload must be a JSON array of template rows',
          },
        };
      }
      return { ok: true, rows: parsed };
    } catch (err) {
      return {
        ok: false,
        error: {
          rowIndex: -1,
          field: '_root',
          message: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }
  return {
    ok: false,
    error: { rowIndex: -1, field: '_root', message: 'unsupported structured payload type' },
  };
}

// ─── XML emission ────────────────────────────────────────────────────────────

const SECTION_LABELS: Record<TemplateSection, string> = {
  LOGO: 'Company logo (top-left)',
  BILL_TO: 'Bill-to address block',
  SHIP_TO: 'Ship-to address block',
  LINE_TABLE: 'Line-item table (item, qty, rate, amount)',
  SUBTOTALS: 'Subtotals row',
  TAX_BREAKDOWN: 'Tax breakdown by code',
  PAYMENT_INSTRUCTIONS: 'Payment instructions / bank details',
  FOOTER_TERMS: 'Footer terms & conditions',
  DUNNING_TIER: 'Dunning tier message (early / late / final)',
};

function buildAdvancedPdfTemplateXml(args: {
  scriptid: string;
  name: string;
  recordtype: string;
  preferred: boolean;
  kind: TemplateKind;
  sections: TemplateSection[];
  notes: string;
}): string {
  const sectionList =
    args.sections.length > 0
      ? args.sections.map((s) => `      - ${SECTION_LABELS[s]}`).join('\n')
      : '      - (no sections selected — consultant to add content)';
  const notesBlock = args.notes.trim().length > 0
    ? `\n  Consultant notes:\n    ${xmlEscape(args.notes)}\n`
    : '';

  // Stub PDF/HTML content — CDATA-wrapped FreeMarker placeholder. Consultants
  // edit the real body in the NetSuite Customization → Templates UI after
  // deploy. The TODO markers map 1:1 to the captured sections.
  const todoLines = args.sections.map((s) => `      <!-- TODO: ${SECTION_LABELS[s]} -->`).join('\n');
  const stubContent = `<?xml version="1.0"?><!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
  <head>
    <link name="NotoSans" type="font" subtype="opentype" src="\${nsfont.NotoSans_Regular}" src-bold="\${nsfont.NotoSans_Bold}" />
    <style type="text/css">
      table { font-size: 10pt; }
    </style>
  </head>
  <body padding="0.5in" size="Letter">
    <!-- Phase 26 stub for ${args.kind}. Consultant: replace TODO markers with real FreeMarker. -->
${todoLines}
  </body>
</pdf>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Templates Generator from wizard answer ns.design.templatesStructured.
  Template: ${xmlEscape(args.name)}
  Kind: ${args.kind}
  Record type: ${args.recordtype}
  Preferred: ${args.preferred ? 'YES' : 'no'}
  Captured content sections:
${sectionList}${notesBlock}  Review before deploy:
    - Replace each TODO marker in <content> with real FreeMarker / BFO syntax
      using the NetSuite Customization → Forms → Advanced PDF/HTML Templates UI
    - Confirm <preferred>T</preferred> only on ONE template per recordtype
    - Test render in sandbox against a sample transaction before promoting
-->
<advancedpdftemplate scriptid="${args.scriptid}">
  <name>${xmlEscape(args.name)}</name>
  <recordtype>${args.recordtype}</recordtype>
  <displaysourcecode>F</displaysourcecode>
  <isinactive>F</isinactive>
  <preferred>${args.preferred ? 'T' : 'F'}</preferred>
  <content><![CDATA[${stubContent}]]></content>
</advancedpdftemplate>
`;
}

function buildEmailTemplateXml(args: {
  scriptid: string;
  name: string;
  recordtype: string;
  sections: TemplateSection[];
  notes: string;
}): string {
  const sectionList =
    args.sections.length > 0
      ? args.sections.map((s) => `      - ${SECTION_LABELS[s]}`).join('\n')
      : '      - (no sections selected — consultant to add content)';
  const notesBlock = args.notes.trim().length > 0
    ? `\n  Consultant notes:\n    ${xmlEscape(args.notes)}\n`
    : '';
  const todoLines = args.sections.map((s) => `    <!-- TODO: ${SECTION_LABELS[s]} -->`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Templates Generator from wizard answer ns.design.templatesStructured.
  Template: ${xmlEscape(args.name)}
  Kind: DUNNING_EMAIL (emailtemplate root)
  Record type: ${args.recordtype}
  Captured content sections:
${sectionList}${notesBlock}  Review before deploy:
    - Replace TODO markers with real merge fields (\${recipient.name},
      \${transaction.tranid}, \${transaction.duedate}, \${transaction.amount})
    - Confirm subject line + sender preferences in NetSuite UI
    - Test send to a sandbox account before promoting
-->
<emailtemplate scriptid="${args.scriptid}">
  <name>${xmlEscape(args.name)}</name>
  <recordtype>${args.recordtype}</recordtype>
  <isinactive>F</isinactive>
  <subject>${xmlEscape(args.name)} — \${transaction.tranid}</subject>
  <content><![CDATA[
    <html>
      <body>
        <!-- Phase 26 stub for DUNNING_EMAIL. Consultant: replace TODO markers with merge fields. -->
${todoLines}
      </body>
    </html>
  ]]></content>
</emailtemplate>
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate the structured template XMLs.
 *
 *   - adaptorId !== 'netsuite' → empty output (gate; Sahel/Odoo banlist).
 *   - Empty / undefined / null structuredAnswer → empty output.
 *   - Per-row validation errors are collected in `errors[]` and that row
 *     does NOT emit. Other rows still emit.
 *   - Same-name dedup — first row wins, subsequent duplicates flagged.
 */
export function generateSdfStructuredTemplates(
  input: StructuredTemplatesInput,
): StructuredTemplatesOutput {
  if (input.adaptorId !== 'netsuite') {
    return { files: {}, emitted: [], errors: [] };
  }

  const parsed = parseStructuredAnswer(input.structuredAnswer);
  if (!parsed.ok) {
    return { files: {}, emitted: [], errors: [parsed.error] };
  }

  const files: Record<string, string> = {};
  const emitted: StructuredEmittedTemplate[] = [];
  const errors: StructuredTemplatesValidationError[] = [];
  const seenScriptids = new Set<string>();

  for (let rowIndex = 0; rowIndex < parsed.rows.length; rowIndex++) {
    const result = validateRow(rowIndex, parsed.rows[rowIndex]);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    const tmpl = result.tmpl;

    const isEmail = tmpl.kind === 'DUNNING_EMAIL';
    const scriptidPrefix = isEmail ? 'custemail_nsix_' : 'custtmpl_nsix_';
    const slug = slugify(tmpl.name);
    const scriptid = `${scriptidPrefix}${slug}`;
    if (seenScriptids.has(scriptid)) {
      errors.push({
        rowIndex,
        field: 'name',
        message: `duplicate scriptid "${scriptid}" derived from name "${tmpl.name}" — names must be unique after slugify (per scriptid prefix)`,
      });
      continue;
    }
    seenScriptids.add(scriptid);

    const recordtype = KIND_TO_RECORDTYPE[tmpl.kind];
    const filename = `Objects/${scriptid}.xml`;

    const xml = isEmail
      ? buildEmailTemplateXml({
          scriptid,
          name: tmpl.name,
          recordtype,
          sections: tmpl.sections,
          notes: tmpl.notes,
        })
      : buildAdvancedPdfTemplateXml({
          scriptid,
          name: tmpl.name,
          recordtype,
          preferred: tmpl.preferred,
          kind: tmpl.kind,
          sections: tmpl.sections,
          notes: tmpl.notes,
        });

    files[filename] = xml;
    emitted.push({
      filename,
      scriptid,
      name: tmpl.name,
      kind: tmpl.kind,
      recordtype,
      preferred: tmpl.preferred,
      sections: tmpl.sections,
      isEmailTemplate: isEmail,
    });
  }

  return { files, emitted, errors };
}
