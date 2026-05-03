/**
 * CSV Import Template Bundle generator (Pack Z — Component 1).
 *
 * Cross-platform — emits Documentation/Data_Migration/Templates/<NN>_<obj>.csv
 * for every object in scope. Adaptor-conditional: NetSuite catalog has
 * 16 objects (subsidiaries / departments / classes / locations / COA /
 * currencies / tax codes / customers / vendors / employees / items /
 * inventory balances / open AR / open AP / GL opening / fixed assets);
 * Odoo catalog has 10 objects (companies / COA / taxes / partners /
 * products / inventory / open invoices / open bills / GL opening /
 * BOMs).
 *
 * Each .csv file ships with:
 *   1. Byte-for-byte the header row that the adaptor's CSV importer
 *      expects. Migration teams replace the file in-place and load it.
 *   2. Two illustrative blank data rows so the file isn't header-only
 *      (header-only CSVs sometimes confuse spreadsheet apps and
 *      validation regex tooling). The blank rows are pure commas
 *      matching the header arity — zero data, just structure.
 *
 * The generator returns a Record<string, string> keyed by relative path
 * (e.g. 'Templates/01_subsidiaries.csv') so the orchestrator in
 * generation.ts can spread the result into one fs.writeFile per entry.
 */

import {
  objectsInScope,
  type MigrationObject,
} from './migrationHelpers.js';

export interface CsvBundleInput {
  clientName: string;
  /** 'NetSuite' | 'Odoo' | other adaptor name. */
  adaptorName: string;
  /** Wizard answers — drives objectsInScope filtering. */
  answers: Record<string, unknown>;
}

export interface CsvBundleOutput {
  /**
   * Map of relative-path → CSV content. Keys look like
   * 'Templates/01_subsidiaries.csv'. Spread into one fs.writeFile
   * per entry under Documentation/Data_Migration/.
   */
  files: Record<string, string>;
  /** Number of objects that emitted a template (for the index README). */
  objectCount: number;
  /** README markdown — emitted alongside the templates. */
  readme: string;
}

function blankDataRow(headerArity: number): string {
  // headerArity-1 commas → headerArity empty cells.
  return ','.repeat(Math.max(0, headerArity - 1));
}

function csvForObject(obj: MigrationObject): string {
  const arity = obj.csvHeader.split(',').length;
  // Header + 2 blank rows. Each line uses LF only — CSV importers on
  // both adaptors accept LF; CRLF would also work but LF avoids
  // platform skew when the file is checked into git.
  return [obj.csvHeader, blankDataRow(arity), blankDataRow(arity), ''].join('\n');
}

function readmeMarkdown(
  clientName: string,
  adaptorName: string,
  inScope: ReadonlyArray<MigrationObject>,
): string {
  const platformLabel = adaptorName.length > 0 ? adaptorName : 'ERP';
  const importPath =
    adaptorName.toLowerCase().includes('netsuite')
      ? 'Setup → Import/Export → Import CSV Records'
      : 'Settings → Technical → Import (per object) — or top-right menu of any list view';

  const rows = inScope
    .map((obj) => {
      const dep = obj.dependsOn.length > 0 ? obj.dependsOn.join(', ') : '(none)';
      return `| ${obj.csvFilename} | ${obj.label} | ${obj.category} | ${dep} |`;
    })
    .join('\n');

  return [
    `# CSV Import Template Bundle — ${clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Templates:** ${inScope.length} CSVs in ./Templates/  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Header-only templates ready for the migration team to populate. Headers are ',
    `byte-for-byte aligned with ${platformLabel}'s CSV importer expectations. Replace `,
    'the file in-place — keep the same filename — and load via:',
    '',
    `> **${importPath}**`,
    '',
    'Files are numbered to reflect load order. Reference data (companies / ',
    'subsidiaries, COA, taxes) loads first, then master data (customers / vendors / ',
    'products / items / employees), then open balances (AR / AP / GL / inventory). ',
    'The Load Sequencing diagram (see `../Load_Sequencing.md`) renders the full ',
    'dependency DAG.',
    '',
    '## Template Inventory',
    '',
    '| Filename | Object | Category | Depends on |',
    '|----------|--------|----------|------------|',
    rows,
    '',
    '## Loading',
    '',
    '1. Populate the CSV in your spreadsheet tool of choice. Keep the header row ',
    '   exactly as shipped — column names are matched by the importer.',
    '2. Save as UTF-8 CSV (no BOM). Spreadsheet apps often default to Latin-1; ',
    '   change the export encoding before you save.',
    '3. Load via the path above. The first dry-run is for cleansing — load, capture ',
    '   rejects, fix at source, repeat. See `../Reject_Handling_Playbook.md`.',
    '4. Run the reconciliation queries in `../Reconciliation_Queries.md` after each ',
    '   load to confirm record counts + financial totals match the source.',
    '',
    '## Cross-References',
    '',
    '- Load sequencing diagram: `../Load_Sequencing.md`',
    '- Field mapping workbook: `../Field_Mapping_Workbook.md`',
    '- Reconciliation queries: `../Reconciliation_Queries.md`',
    '- Cleansing rules: `../Cleansing_Rules.md`',
    '- Migration runbook: `../Migration_Runbook.md`',
    '- Reject handling: `../Reject_Handling_Playbook.md`',
    '- Data quality scorecard: `../Data_Quality_Scorecard.md`',
    '',
    '_Generated by ERPLaunch — Pack Z (Data Migration Assets)._',
    '',
  ].join('\n');
}

export function generateCsvImportTemplateBundle(
  input: CsvBundleInput,
): CsvBundleOutput {
  const inScope = objectsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });

  const files: Record<string, string> = {};
  for (const obj of inScope) {
    files[`Templates/${obj.csvFilename}`] = csvForObject(obj);
  }

  return {
    files,
    objectCount: inScope.length,
    readme: readmeMarkdown(input.clientName, input.adaptorName, inScope),
  };
}
