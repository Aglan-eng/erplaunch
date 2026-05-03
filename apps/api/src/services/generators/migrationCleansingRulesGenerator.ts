/**
 * Migration Cleansing Rules generator (Pack Z — Component 4).
 *
 * Cross-platform — emits Documentation/Data_Migration/Cleansing_Rules.md.
 *
 * Per-object cleansing rules table (Object / Rule / Owner / Status).
 * Pre-seeded with industry-canonical rules per migrationHelpers'
 * DEFAULT_CLEANSING_RULES; consultant overlay (cleansingRulesByObject
 * pipe-delimited) appends or overrides per-object rules. Owners come
 * from dataQualityOwners overlay (migration.readiness.dataQualityOwners)
 * with sensible default of "_[ASSIGN — finance / ops lead]_".
 */

import {
  parseCleansingRulesByObject,
  parseDataQualityOwners,
  DEFAULT_CLEANSING_RULES,
  type ParsedCleansingRuleRow,
} from './migrationHelpers.js';

export interface MigrationCleansingRulesInput {
  clientName: string;
  adaptorName: string;
  /** TEXTAREA migration.details.cleansingRulesByObject. */
  cleansingRulesByObject?: string | null;
  /** TEXTAREA migration.readiness.dataQualityOwners. */
  dataQualityOwners?: string | null;
}

export interface MigrationCleansingRulesOutput {
  markdown: string;
}

function ruleRow(row: ParsedCleansingRuleRow, ownerOverride: string | undefined): string {
  const owner = row.owner.trim().length > 0
    ? row.owner
    : ownerOverride ?? '_[ASSIGN — data quality owner]_';
  return `| ${row.object} | ${row.rule} | ${owner} | _Open_ |`;
}

export function generateMigrationCleansingRules(
  input: MigrationCleansingRulesInput,
): MigrationCleansingRulesOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const consultantRows = parseCleansingRulesByObject(
    (input.cleansingRulesByObject ?? '').toString(),
  );
  const owners = parseDataQualityOwners((input.dataQualityOwners ?? '').toString());

  // Map owners by lowercased object name for quick lookup.
  const ownerByObject = new Map<string, string>();
  for (const o of owners) {
    ownerByObject.set(o.object.toLowerCase(), o.owner);
  }

  // Default rows — emit always (canonical floor) but skip the ones the
  // consultant has explicitly overridden for the same object.
  const overriddenObjects = new Set(consultantRows.map((r) => r.object.toLowerCase()));
  const defaultRows = DEFAULT_CLEANSING_RULES.filter(
    (r) => !overriddenObjects.has(r.object.toLowerCase()),
  ).map((r) =>
    ruleRow(
      { object: r.object, rule: r.rule, owner: r.owner },
      ownerByObject.get(r.object.toLowerCase()),
    ),
  );

  const consultantTable = consultantRows
    .map((r) => ruleRow(r, ownerByObject.get(r.object.toLowerCase())))
    .join('\n');
  const defaultTable = defaultRows.join('\n');

  const markdown = [
    `# Cleansing Rules — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Per-object data-cleansing rulebook. Rules are applied at the source-extract ',
    'stage — the migration team transforms the source data BEFORE loading into the ',
    'target ERP. Loading dirty data costs more than cleansing it: every reject ',
    'creates an investigation, a re-load, and a delay.',
    '',
    '## Cleansing Principles',
    '',
    '1. **Cleanse at source, not at target.** Once a record is in the ERP, fixing ',
    '   it requires the change-request process. Cheaper to clean in the staging ',
    '   spreadsheet.',
    '2. **Standardise before you load.** Whitespace, casing, country/currency codes, ',
    '   tax-ID format — fix all of these in one pass before the first dry-run.',
    '3. **Dedupe early.** Two records for the same customer cause downstream ',
    '   reconciliation failures. Use the rules below + manual review.',
    '4. **Owner accountability.** Every rule has an owner. Disputes escalate to ',
    '   the migration lead, not the consultant.',
    '5. **Track resolution.** Every rule has a status (`Open` / `In progress` / ',
    '   `Closed`). Status updates land in the Data Quality Scorecard.',
    '',
    '## Rule Register',
    '',
    '| Object | Cleansing rule | Owner | Status |',
    '|--------|----------------|-------|--------|',
    consultantRows.length > 0 ? consultantTable : '',
    defaultTable,
    '',
    '## Owner Roster',
    '',
    owners.length > 0
      ? [
          '| Object | Primary owner | Backup |',
          '|--------|---------------|--------|',
          owners
            .map((o) => `| ${o.object} | ${o.owner} | ${o.backup.length > 0 ? o.backup : '_[ASSIGN]_'} |`)
            .join('\n'),
        ].join('\n')
      : '_Owners not yet assigned — see `migration.readiness.dataQualityOwners` answer to populate. Defaults inferred above are placeholder; replace with named individuals before kicking off cleansing._',
    '',
    '## Acceptance',
    '',
    'A rule is **Closed** when:',
    '',
    '1. The transformation is implemented in the staging extract (script + reviewable diff).',
    '2. A dry-run produces zero rejects related to the rule.',
    '3. The owner has signed off in writing (Slack ack / email / signed scorecard row).',
    '',
    '## Cross-References',
    '',
    '- CSV import templates: `./Templates/`',
    '- Field mapping workbook: `./Field_Mapping_Workbook.md`',
    '- Reject handling: `./Reject_Handling_Playbook.md`',
    '- Data quality scorecard: `./Data_Quality_Scorecard.md`',
    '- Migration runbook: `./Migration_Runbook.md`',
    '',
    '_Generated by ERPLaunch — Pack Z (Data Migration Assets)._',
    '',
  ].join('\n');

  return { markdown };
}
