/**
 * Reject Handling Playbook generator (Pack Z — Component 7).
 *
 * Cross-platform — emits Documentation/Data_Migration/Reject_Handling_Playbook.md.
 *
 * Per-object reject categorisation + SLA + escalation + fix loop. Uses the
 * 5-bucket reject taxonomy (FK violation / type mismatch / business-rule
 * fail / dedupe / financial mismatch) consistently across objects.
 * Adaptor-conditional: NetSuite reject reports come from CSV-import
 * status; Odoo from import logs in Settings → Technical → Imports.
 */

import {
  parseRejectSlaByObject,
  DEFAULT_REJECT_SLA,
  type ParsedRejectSlaRow,
} from './migrationHelpers.js';

export interface RejectHandlingPlaybookInput {
  clientName: string;
  adaptorName: string;
  /** TEXTAREA migration.details.rejectSlaByObject. */
  rejectSlaByObject?: string | null;
}

export interface RejectHandlingPlaybookOutput {
  markdown: string;
}

function slaRow(row: ParsedRejectSlaRow): string {
  return `| ${row.object} | ${row.threshold} | ${row.sla} |`;
}

export function generateRejectHandlingPlaybook(
  input: RejectHandlingPlaybookInput,
): RejectHandlingPlaybookOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const isNetSuite = input.adaptorName.toLowerCase().includes('netsuite');
  const consultantSlas = parseRejectSlaByObject(
    (input.rejectSlaByObject ?? '').toString(),
  );

  // Combine consultant rows + defaults; consultant takes precedence per object.
  const overriddenObjects = new Set(consultantSlas.map((r) => r.object.toLowerCase()));
  const defaultSlaRows = DEFAULT_REJECT_SLA.filter(
    (r) => !overriddenObjects.has(r.object.toLowerCase()),
  ).map((r) => slaRow({ object: r.object, threshold: r.threshold, sla: r.sla }));
  const consultantSlaRows = consultantSlas.map(slaRow);

  const rejectReportPath = isNetSuite
    ? 'Setup → Import/Export → View CSV Import Job Status (per import job)'
    : 'Settings → Technical → Imports (per import session)';

  const markdown = [
    `# Reject Handling Playbook — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Reject report path:** ${rejectReportPath}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Reject-by-reject playbook for the migration team. Every reject is categorised, ',
    'has an owner, and is fixed inside an SLA window. Rejects do NOT accumulate — ',
    'they block the next load.',
    '',
    '## Reject Taxonomy',
    '',
    'Every reject falls into one of five buckets. Categorisation drives ownership ',
    'and fix-loop:',
    '',
    '| Bucket | Cause | Typical owner | Fix loop |',
    '|--------|-------|---------------|----------|',
    '| **FK violation** | Parent record not loaded yet, or parent External ID mismatched | Migration lead | Reorder load OR fix External ID mapping |',
    '| **Type mismatch** | Field value not parseable as expected type (e.g. text in number column, malformed date) | Data engineer | Fix in cleansing pipeline; re-extract |',
    '| **Business-rule fail** | Field value violates ERP business rule (e.g. negative inventory, future date) | Functional consultant | Decide: cleanse OR change source rule |',
    '| **Dedupe** | Duplicate External ID, or duplicate by natural key (tax ID, SKU) | Data steward | Merge in source; re-extract |',
    '| **Financial mismatch** | Trial balance / control total does not match source after load | Finance controller | Investigate at row level; correcting JE if needed |',
    '',
    '## Per-Object SLA',
    '',
    '| Object | Threshold | SLA |',
    '|--------|-----------|-----|',
    consultantSlas.length > 0 ? consultantSlaRows.join('\n') : '',
    defaultSlaRows.join('\n'),
    '',
    '_Threshold = the maximum reject rate that can pass. Beyond this, the load is **HALTED** per `./Migration_Runbook.md` Phase 4 rollback decision tree._',
    '',
    '## Fix Loop',
    '',
    '```',
    'Load → Reject report → Categorise → Assign owner → Fix in cleansing pipeline ',
    '       → Re-extract source → Re-load → Reconcile → Sign off',
    '```',
    '',
    '1. **Capture the reject report** from `' + rejectReportPath + '`.',
    `2. **Categorise** every reject into one of the 5 buckets. Bulk-classify by `,
    `   error message pattern in your spreadsheet tool (the ${platform} reject report `,
    `   includes a stable message field).`,
    '3. **Assign owner** per the taxonomy table.',
    '4. **Fix in the cleansing pipeline** — never edit the rejected row in place. ',
    '   The fix must be reproducible across dry-runs.',
    '5. **Re-extract** from source (the fix lives in the pipeline, so a fresh ',
    '   extract picks it up automatically).',
    '6. **Re-load** the failed object. Run reconciliation queries again.',
    '7. **Sign off** in the Data Quality Scorecard once the object is clean.',
    '',
    '## Escalation',
    '',
    '- **Within SLA + < threshold rejects** — migration lead handles in-band.',
    '- **Within SLA + > threshold rejects** — convene war-room session per ',
    '  `Documentation/Hypercare/War_Room_SOP.md`. Decide: extend SLA OR halt load.',
    '- **SLA breach** — sponsor decides go/no-go on the cutover. Cutover may slip.',
    '- **Financial-object reject (AR / AP / GL)** — finance controller is the ',
    '  decision authority, not the migration lead. Zero tolerance for unresolved ',
    '  financial rejects at sign-off.',
    '',
    '## Cross-References',
    '',
    '- Cleansing rules: `./Cleansing_Rules.md`',
    '- Field mapping workbook: `./Field_Mapping_Workbook.md`',
    '- Reconciliation queries: `./Reconciliation_Queries.md`',
    '- Migration runbook: `./Migration_Runbook.md`',
    '- Data quality scorecard: `./Data_Quality_Scorecard.md`',
    '- War-room SOP: `Documentation/Hypercare/War_Room_SOP.md`',
    '',
    '_Generated by ERPLaunch — Pack Z (Data Migration Assets)._',
    '',
  ].join('\n');

  return { markdown };
}
