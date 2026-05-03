/**
 * Field Mapping Workbook generator (Pack Z — Component 2).
 *
 * Cross-platform — emits Documentation/Data_Migration/Field_Mapping_Workbook.md.
 *
 * Per object in scope, renders a 5-column mapping table (Source field /
 * Source type / Target field / Transformation / Notes). Adaptor-conditional
 * — target column names mirror what the CSV import templates expect, so
 * a consultant who fills the workbook can map row-for-row to the CSV
 * columns shipped in `./Templates/`.
 *
 * The workbook is intentionally pre-seeded per object with the canonical
 * target columns so the consultant only fills "Source field / type /
 * transformation / notes". Empty rows force the team to actively decide
 * which source field maps to each target rather than skipping fields.
 */

import {
  parseSourceSystemsByObject,
  objectsInScope,
  type MigrationObject,
} from './migrationHelpers.js';

export interface FieldMappingWorkbookInput {
  clientName: string;
  adaptorName: string;
  answers: Record<string, unknown>;
  /** TEXTAREA migration.details.sourceSystemsByObject. */
  sourceSystemsByObject?: string | null;
}

export interface FieldMappingWorkbookOutput {
  markdown: string;
}

function tableRowsForObject(obj: MigrationObject, sourceLabel: string): string {
  const targetFields = obj.csvHeader.split(',').map((s) => s.trim());
  return targetFields
    .map((target) => {
      const transformation =
        target.toLowerCase().includes('date')
          ? 'Convert to YYYY-MM-DD'
          : target.toLowerCase().includes('amount') || target.toLowerCase().includes('price') || target.toLowerCase().includes('cost')
            ? 'Convert to ledger currency; 2 decimal places'
            : target.toLowerCase().includes('external id') || target === 'id'
              ? 'Generate stable key — see Cleansing_Rules.md'
              : '_[ASSIGN — direct, lookup, calc]_';
      return `| _[ASSIGN — ${sourceLabel} field]_ | _[type]_ | ${target} | ${transformation} | _[notes]_ |`;
    })
    .join('\n');
}

export function generateFieldMappingWorkbook(
  input: FieldMappingWorkbookInput,
): FieldMappingWorkbookOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const inScope = objectsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });

  const sourceRows = parseSourceSystemsByObject(
    (input.sourceSystemsByObject ?? '').toString(),
  );
  // Index sources by lowercased object name for quick lookup.
  const sourceByObject = new Map<string, string>();
  for (const r of sourceRows) {
    sourceByObject.set(r.object.toLowerCase(), r.source);
  }

  const sections = inScope
    .map((obj) => {
      const sourceLabel =
        sourceByObject.get(obj.label.toLowerCase()) ??
        sourceByObject.get(obj.id.toLowerCase()) ??
        '_[ASSIGN — source system]_';
      return [
        `### ${obj.label}`,
        '',
        `**Source system:** ${sourceLabel}  `,
        `**Target template:** \`./Templates/${obj.csvFilename}\``,
        '',
        '| Source field | Source type | Target field | Transformation | Notes |',
        '|--------------|-------------|--------------|-----------------|-------|',
        tableRowsForObject(obj, sourceLabel),
        '',
      ].join('\n');
    })
    .join('\n');

  const markdown = [
    `# Field Mapping Workbook — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Objects in scope:** ${inScope.length}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Per-object mapping workbook. Target columns are pre-seeded from the CSV import ',
    'templates in `./Templates/` so a row-for-row mapping translates directly to a ',
    'load-ready file. Source columns are filled by the consultant — every row must ',
    'resolve to a source field, a calculated value, or an explicit "leave blank" decision.',
    '',
    '## How to Use',
    '',
    '1. Per object section below, fill the **Source field** and **Source type** columns.',
    '2. The **Target field** column is locked — it mirrors the CSV header verbatim.',
    '3. The **Transformation** column captures any conversion logic (date format, ',
    '   currency conversion, lookup). Pre-seeded with sensible defaults for common ',
    '   types; override per row as needed.',
    '4. The **Notes** column captures decisions, source-data caveats, or open ',
    '   questions for the migration lead.',
    '5. Sign-off rule: the workbook is locked once the migration lead + finance ',
    `   controller approve. After lock, changes follow the ${platform} change-request `,
    '   process — see `Documentation/Stabilization/Continuous_Improvement_Governance.md`.',
    '',
    '## Mapping Sheets',
    '',
    sections,
    '## Cross-References',
    '',
    '- CSV import templates: `./Templates/`',
    '- Cleansing rules: `./Cleansing_Rules.md`',
    '- Reconciliation queries: `./Reconciliation_Queries.md`',
    '- Load sequencing: `./Load_Sequencing.md`',
    '- Migration runbook: `./Migration_Runbook.md`',
    '',
    '_Generated by ERPLaunch — Pack Z (Data Migration Assets)._',
    '',
  ].join('\n');

  return { markdown };
}
