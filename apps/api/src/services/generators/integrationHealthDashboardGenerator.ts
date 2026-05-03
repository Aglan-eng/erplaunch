/**
 * Integration Health Dashboard generator (Pack ZZ — Component 3).
 *
 * Cross-platform — emits Documentation/Integrations/Integration_Health_Dashboard.md.
 *
 * Dashboard spec for steady-state monitoring. Adaptor-conditional
 * implementation:
 *   - NetSuite: saved searches per integration + a `publisheddashboard`
 *     that surfaces them; RESTlet endpoints if exposed.
 *   - Odoo: Studio dashboard panels per integration + ir.cron schedule
 *     for refresh; optional Power BI / Metabase pull via SQL view.
 *
 * Per-integration tile spec table sourced from `integrationMonitoring`
 * overlay; falls back to default green/yellow/red wording when
 * overlay sparse.
 */

import {
  integrationsInScope,
  parseIntegrationMonitoring,
  parseIntegrationOwners,
  indexByName,
  slugify,
  type ParsedCatalogRow,
} from './integrationHelpers.js';

export interface IntegrationHealthDashboardInput {
  clientName: string;
  adaptorName: string;
  answers: Record<string, unknown>;
  integrationMonitoring?: string | null;
  integrationOwnersByName?: string | null;
}

export interface IntegrationHealthDashboardOutput {
  markdown: string;
}

function tileRow(
  row: ParsedCatalogRow,
  metric: string,
  green: string,
  yellow: string,
  red: string,
  owner: string,
): string {
  const refresh = /realtime|hourly|min/i.test(row.frequency) ? 'Hourly (auto-refresh every 5min when red)' : 'Daily';
  return `| ${row.name} | ${metric} | ${green} | ${yellow} | ${red} | ${owner} | ${refresh} |`;
}

export function generateIntegrationHealthDashboard(
  input: IntegrationHealthDashboardInput,
): IntegrationHealthDashboardOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const isNetSuite = input.adaptorName.toLowerCase().includes('netsuite');
  const inScope = integrationsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });
  const monitoring = indexByName(
    parseIntegrationMonitoring((input.integrationMonitoring ?? '').toString()),
  );
  const owners = indexByName(
    parseIntegrationOwners((input.integrationOwnersByName ?? '').toString()),
  );

  const tileRows = inScope
    .map((row) => {
      const m = monitoring.get(row.name.toLowerCase());
      const o = owners.get(row.name.toLowerCase());
      return tileRow(
        row,
        m?.metric.length ? m.metric : 'Sync success rate',
        m?.green.length ? m.green : '> 99%',
        m?.yellow.length ? m.yellow : '95-99%',
        m?.red.length ? m.red : '< 95%',
        o?.owner.length ? o.owner : '_[ASSIGN]_',
      );
    })
    .join('\n');

  const implementationSection = isNetSuite
    ? [
        '## Implementation — NetSuite',
        '',
        'Per-integration health uses **saved searches** as the data source. Each ',
        'integration gets:',
        '',
        '1. A saved search `customsearch_int_<slug>_health` that returns a single row ',
        '   with the integration\'s health metric and current value.',
        '2. Optional RESTlet wrapper for external monitoring tools that need to poll ',
        '   the metric (Datadog / PagerDuty / etc).',
        '3. A tile on the published dashboard that surfaces the saved search result.',
        '',
        '**Published dashboard scriptid:** `custpubdash_integration_health`. ',
        'Reachable via Reports → Saved Reports → Integration Health, OR add as the ',
        'Home Dashboard for the on-call rotation role.',
        '',
        '**Per-integration saved search naming:**',
        '',
        ...inScope.map(
          (row) => `- \`customsearch_int_${slugify(row.name)}_health\` — ${row.name}`,
        ),
      ].join('\n')
    : [
        '## Implementation — Odoo',
        '',
        'Per-integration health uses **Studio dashboards** + **PostgreSQL views** as ',
        'the data source. Each integration gets:',
        '',
        '1. A SQL view `v_int_<slug>_health` that returns a single row with the ',
        '   integration\'s health metric and current value.',
        '2. A Studio dashboard panel pinned to the on-call rotation\'s default ',
        '   dashboard surface.',
        '3. An `ir.cron` job refreshing the underlying view per the cadence below.',
        '4. Optional Power BI / Metabase pull via the same SQL view (the dashboard ',
        '   is the single source-of-truth across surfaces).',
        '',
        '**Master dashboard:** Settings → Technical → User Interface → Dashboards → ',
        '"Integration Health". Add to default home for the on-call rotation security group.',
        '',
        '**Per-integration view naming:**',
        '',
        ...inScope.map((row) => `- \`v_int_${slugify(row.name)}_health\` — ${row.name}`),
      ].join('\n');

  const markdown = [
    `# Integration Health Dashboard — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Integrations monitored:** ${inScope.length}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Dashboard spec for steady-state integration monitoring. The on-call rotation ',
    'reads this dashboard during their daily readiness check (`Documentation/Hypercare/Daily_Readiness_Checklist.md`) ',
    'and during incident triage. Tiles drill through to per-integration runbooks ',
    'in `./Runbooks/`.',
    '',
    '## Per-Integration Tile Spec',
    '',
    '| Integration | Health metric | Green | Yellow | Red | Owner | Refresh cadence |',
    '|-------------|---------------|-------|--------|-----|-------|-----------------|',
    tileRows,
    '',
    '## Aggregate Panels',
    '',
    'Roll-up panels at the top of the dashboard:',
    '',
    '| Panel | Definition | Update cadence |',
    '|-------|-----------|----------------|',
    '| **Overall integration health** | % of integrations currently green | Hourly |',
    '| **Integrations red** | Count of integrations in red threshold | 5 min |',
    '| **Integrations yellow** | Count of integrations in yellow threshold | Hourly |',
    '| **Mean time to recovery (MTTR)** | Trailing-30-day average for red→green transitions | Daily |',
    '| **Reject queue depth** | Cross-integration count of records pending manual review | Hourly |',
    '',
    implementationSection,
    '',
    '## Refresh Schedule',
    '',
    '- **Green tiles:** refresh hourly (cheap; nothing to investigate).',
    '- **Yellow tiles:** refresh every 30 min.',
    '- **Red tiles:** auto-refresh every 5 min until restored to yellow / green.',
    '- **Aggregate panels:** mirror the worst per-integration tile cadence.',
    '',
    '## Drill-Through',
    '',
    'Each tile is a hyperlink to the integration\'s runbook in `./Runbooks/`. ',
    'Clicking a red tile takes the on-call directly to the runbook\'s recovery ',
    'procedures section.',
    '',
    '## Cross-References',
    '',
    '- Integration catalog: `./Integration_Catalog.md`',
    '- Per-integration runbooks: `./Runbooks/`',
    '- Reconciliation procedures: `./Reconciliation_Procedures.md`',
    '- Vendor escalation matrix: `./Vendor_Escalation_Matrix.md`',
    '- Daily readiness checklist (Pack X): `Documentation/Hypercare/Daily_Readiness_Checklist.md`',
    '- Hypercare KPI dashboard (Pack X): `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`',
    '',
    '_Generated by ERPLaunch — Pack ZZ (Integration Runbooks)._',
    '',
  ].join('\n');

  return { markdown };
}
