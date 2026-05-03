/**
 * Integration Reconciliation Procedures generator (Pack ZZ — Component 4).
 *
 * Cross-platform — emits Documentation/Integrations/Reconciliation_Procedures.md.
 *
 * Per-integration drift detection. Adaptor-conditional sample queries:
 *   - NetSuite: SuiteAnalytics SuiteQL examples.
 *   - Odoo: PostgreSQL examples against Odoo's tables.
 *
 * Variance triage rules:
 *   - < 0.1% — informational
 *   - 0.1-1% — investigate within SLA
 *   - > 1% — halt sync, page owner
 */

import {
  integrationsInScope,
  parseIntegrationReconciliation,
  parseIntegrationOwners,
  indexByName,
  slugify,
  type ParsedCatalogRow,
} from './integrationHelpers.js';

export interface IntegrationReconciliationProceduresInput {
  clientName: string;
  adaptorName: string;
  answers: Record<string, unknown>;
  integrationReconciliation?: string | null;
  integrationOwnersByName?: string | null;
}

export interface IntegrationReconciliationProceduresOutput {
  markdown: string;
}

function defaultCadence(row: ParsedCatalogRow): string {
  if (/transactional/i.test(row.type) && /(realtime|hourly|daily)/i.test(row.frequency)) {
    return 'Every cycle (count check)';
  }
  if (/master.?data/i.test(row.type)) {
    return 'Weekly (count + sum check by key)';
  }
  if (/file.?drop/i.test(row.type)) {
    return 'Per file (checksum + row count)';
  }
  if (/event/i.test(row.type)) {
    return 'Hourly (sequence-number gap detection)';
  }
  return 'Daily';
}

function defaultMethod(row: ParsedCatalogRow): string {
  if (/transactional/i.test(row.type)) return 'Count + financial-total match against source';
  if (/master.?data/i.test(row.type)) return 'Count + sum match by natural key';
  if (/file.?drop/i.test(row.type)) return 'Checksum + row count vs. expected';
  if (/event/i.test(row.type)) return 'Sequence-number gap detection';
  return 'Count match';
}

function reconRow(
  row: ParsedCatalogRow,
  cadence: string,
  owner: string,
  method: string,
): string {
  return `| ${row.name} | ${cadence} | ${owner} | ${method} | < 0.1% info / 0.1-1% investigate / > 1% HALT + page |`;
}

function netSuiteSampleQuery(row: ParsedCatalogRow): string {
  const slug = slugify(row.name);
  return [
    '```sql',
    `-- Count check against source-system marker`,
    `SELECT COUNT(*) AS loaded_count`,
    `FROM transaction`,
    `WHERE custbody_int_source = '${slug.toUpperCase()}'`,
    `  AND trandate >= TRUNC(SYSDATE) - 1;`,
    '```',
  ].join('\n');
}

function odooSampleQuery(row: ParsedCatalogRow): string {
  const slug = slugify(row.name);
  return [
    '```sql',
    `-- Count check against source-system narration marker`,
    `SELECT COUNT(*) AS loaded_count`,
    `FROM account_move`,
    `WHERE narration ILIKE '%${slug}%'`,
    `  AND date >= CURRENT_DATE - INTERVAL '1 day';`,
    '```',
  ].join('\n');
}

export function generateIntegrationReconciliationProcedures(
  input: IntegrationReconciliationProceduresInput,
): IntegrationReconciliationProceduresOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const isNetSuite = input.adaptorName.toLowerCase().includes('netsuite');
  const inScope = integrationsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });
  const recon = indexByName(
    parseIntegrationReconciliation((input.integrationReconciliation ?? '').toString()),
  );
  const owners = indexByName(
    parseIntegrationOwners((input.integrationOwnersByName ?? '').toString()),
  );

  const reconRows = inScope
    .map((row) => {
      const r = recon.get(row.name.toLowerCase());
      const o = owners.get(row.name.toLowerCase());
      const cadence = r?.cadence.length ? r.cadence : defaultCadence(row);
      const owner = r?.owner.length ? r.owner : o?.owner.length ? o.owner : '_[ASSIGN]_';
      return reconRow(row, cadence, owner, defaultMethod(row));
    })
    .join('\n');

  const querySamples = inScope
    .map((row) => {
      return [
        `### ${row.name}`,
        '',
        isNetSuite ? netSuiteSampleQuery(row) : odooSampleQuery(row),
        '',
      ].join('\n');
    })
    .join('\n');

  const queryToolPath = isNetSuite
    ? 'Setup → Custom → SuiteQL Workbook (or Reports → Saved Searches → New)'
    : 'Settings → Technical → Database Manager → Query (Enterprise) — or psql for self-hosted';

  const markdown = [
    `# Reconciliation Procedures — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Query tool:** ${queryToolPath}  `,
    `**Integrations covered:** ${inScope.length}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Per-integration drift detection. Every integration reconciles against its ',
    'source on a defined cadence. Variance crossing the triage thresholds below ',
    'triggers either an investigation (yellow) or an immediate halt + page (red).',
    '',
    '## Per-Integration Cadence Table',
    '',
    '| Integration | Cadence | Owner | Method | Action on variance |',
    '|-------------|---------|-------|--------|---------------------|',
    reconRows,
    '',
    '## Default Cadences (when consultant overlay sparse)',
    '',
    '| Integration type | Default cadence | Default method |',
    '|------------------|-----------------|----------------|',
    '| Transactional inbound | Every cycle (hourly / daily) | Count check |',
    '| Master-data sync | Weekly | Count + sum check by key |',
    '| File drops | Per file | Checksum + row count |',
    '| Event streams | Hourly | Sequence-number gap detection |',
    '',
    '## Variance Triage Rules',
    '',
    '| Variance | Action | Decision authority |',
    '|----------|--------|---------------------|',
    '| < 0.1% | Informational — log to scorecard, no action | On-call |',
    '| 0.1% – 1% | Investigate within SLA; document root cause | Internal owner |',
    '| > 1% | **HALT sync immediately**; page owner; convene war-room session if not resolved within 1 cycle | Internal owner + sponsor |',
    '',
    '## Sample Queries',
    '',
    `Sample queries below run via: **${queryToolPath}**. Replace the cycle window `,
    'as needed (default = trailing 24h).',
    '',
    querySamples,
    '## Cross-System Reconciliation Report',
    '',
    'Single dashboard panel surfacing the last-run variance % per integration. ',
    'Surfaced on `./Integration_Health_Dashboard.md`. Updated automatically each ',
    'cycle by the integration\'s scheduled job.',
    '',
    '| Integration | Last run | Source count | Target count | Variance % | Status |',
    '|-------------|----------|--------------|--------------|------------|--------|',
    inScope
      .map((r) => `| ${r.name} | _[auto]_ | _[auto]_ | _[auto]_ | _[auto]_ | _[auto]_ |`)
      .join('\n'),
    '',
    '## Cross-References',
    '',
    '- Per-integration runbooks: `./Runbooks/`',
    '- Health dashboard: `./Integration_Health_Dashboard.md`',
    '- Vendor escalation matrix: `./Vendor_Escalation_Matrix.md`',
    '- Migration reconciliation queries (Pack Z): `Documentation/Data_Migration/Reconciliation_Queries.md`',
    '- War-room SOP (Pack X): `Documentation/Hypercare/War_Room_SOP.md`',
    '',
    '_Generated by ERPLaunch — Pack ZZ (Integration Runbooks)._',
    '',
  ].join('\n');

  return { markdown };
}
