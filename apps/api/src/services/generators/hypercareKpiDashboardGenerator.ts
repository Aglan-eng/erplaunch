/**
 * Hypercare KPI Dashboard generator (Pack X — Component 6).
 *
 * Cross-platform — emits Documentation/Hypercare/Hypercare_KPI_Dashboard.md.
 *
 * Defines the daily report the hypercare lead emails to sponsors at
 * end of business each day. Adaptor-conditional: NetSuite version
 * references saved-search scriptids; Odoo version references Studio
 * dashboards / SQL views. Same structure and KPI definitions otherwise.
 */

export interface HypercareKpiDashboardInput {
  clientName: string;
  /** "NetSuite" / "Odoo" — drives the data-source references. */
  adaptorName?: string;
  /** TEXT hypercare.team.hypercareLeadName — drives the "owner" line. */
  hypercareLeadName?: string | null;
  /** Optional integration names — drives the integration-health row scope. */
  integrationsList?: string | null;
}

export interface HypercareKpiDashboardOutput {
  markdown: string;
}

interface DataSourceProfile {
  /** Section heading text after "## 8. Data Sources" */
  sectionTitle: string;
  /** First-paragraph description of where the metrics come from. */
  description: string;
  /** Per-KPI implementation references (saved searches / Studio
   *  dashboards / SQL views). */
  perKpi: string;
}

function dataSourceFor(adaptorName: string): DataSourceProfile {
  const lower = adaptorName.toLowerCase();
  if (lower === 'netsuite') {
    return {
      sectionTitle: 'NetSuite Saved Searches Behind the Metrics',
      description:
        'Each KPI in this dashboard maps to a NetSuite saved search emitted by ' +
        'Pack F (`SDF/Objects/customsearch_*.xml`). The saved-search script IDs below ' +
        'are the production lookup keys; the hypercare lead schedules a daily refresh ' +
        '(via SuiteAnalytics Connect or scheduled SuiteScript) and pipes the output into the ' +
        'end-of-day report.',
      perKpi: [
        '- **Open issues by severity:** `customsearch_ss_hc_open_issues` (filters: open status, severity grouping)',
        '- **MTTA / MTTR by severity:** `customsearch_ss_hc_resolution_audit` (date logged → date resolved windowed)',
        '- **Top 5 issues by area:** `customsearch_ss_hc_issues_by_area` (group by workstream tag)',
        '- **User adoption:** `customsearch_ss_hc_login_audit` (login count by named user, trailing 7 days)',
        '- **Integration health:** `customsearch_ss_hc_integration_audit` (success rate + retry queue depth)',
        '- **Business KPIs:** Per-engagement saved searches from `Documentation/Solution_Design.html` success-metrics section',
      ].join('\n'),
    };
  }
  if (lower === 'odoo') {
    return {
      sectionTitle: 'Odoo Studio Dashboards / SQL Views Behind the Metrics',
      description:
        'Each KPI in this dashboard maps to an Odoo Studio dashboard or a custom SQL ' +
        'view. The view names below are the production lookup keys; the hypercare lead ' +
        'either uses Studio scheduled refresh or a custom Python module-level scheduled action ' +
        'to refresh end-of-day, then pipes the output into the sponsor email.',
      perKpi: [
        '- **Open issues by severity:** `hc_open_issues` (Studio dashboard or SQL view filtering open status by severity)',
        '- **MTTA / MTTR by severity:** `hc_resolution_audit` (date logged → date resolved windowed)',
        '- **Top 5 issues by area:** `hc_issues_by_area` (grouped by workstream / module tag)',
        '- **User adoption:** `hc_login_audit` (login count by `res.users`, trailing 7 days)',
        '- **Integration health:** `hc_integration_audit` (success rate + retry queue depth from `mail.message` / `ir.cron` tables)',
        '- **Business KPIs:** Per-engagement Studio dashboards from `Documentation/Solution_Design.html` success-metrics section',
      ].join('\n'),
    };
  }
  return {
    sectionTitle: 'Platform Data Sources Behind the Metrics',
    description:
      '_[ASSIGN platform-specific data sources — populate adaptorName for auto-fill. Without it, the hypercare lead must hand-document where each KPI value comes from before the daily report can be automated.]_',
    perKpi: '_[ASSIGN per-KPI implementation references]_',
  };
}

function parseIntegrations(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(/^([^|:]+)/);
    out.push((m ? m[1] : trimmed).trim());
  }
  return out;
}

export function generateHypercareKpiDashboard(
  input: HypercareKpiDashboardInput,
): HypercareKpiDashboardOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const lead = input.hypercareLeadName?.trim().length
    ? input.hypercareLeadName.trim()
    : '_[ASSIGN hypercare lead]_';
  const dataSource = dataSourceFor(platform);
  const integrations = parseIntegrations((input.integrationsList ?? '').toString());

  const integrationHealthRows =
    integrations.length === 0
      ? '| _[ASSIGN integration]_ | _ | _ | _ | _ |'
      : integrations
          .map(
            (name) =>
              `| ${name} | _ | _ | _ | _ |`,
          )
          .join('\n');

  const markdown = [
    `# Hypercare KPI Dashboard — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Owner:** ${lead}  `,
    `**Cadence:** Daily — refreshed end-of-day; emailed to Sponsor + Steering  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'The daily KPI dashboard the hypercare lead emails to sponsors at end of business ',
    'each day. Every KPI carries a green / yellow / red band. Status callout at the bottom ',
    'gives the sponsor the one-line take. Anything red drives the next morning\'s standup ',
    'agenda (per `Documentation/Hypercare/War_Room_SOP.md`).',
    '',
    '## 1. Open Issues by Severity',
    '',
    '| Severity | Open count | Day-over-day delta | Green band | Yellow band | Red band |',
    '|----------|-----------:|-------------------:|------------|-------------|----------|',
    '| **S1** | _ | _ | 0 open | n/a (any open S1 = red) | ≥ 1 open |',
    '| **S2** | _ | _ | 0-2 open, all owned | 3-5 open | ≥ 6 open OR any > 5 days |',
    '| **S3** | _ | _ | < 10 open | 10-20 open | > 20 open |',
    '| **S4** | _ | _ | _(backlog only)_ | _(backlog only)_ | _(backlog only)_ |',
    '',
    '## 2. Mean Time to Acknowledge / Resolve',
    '',
    '| Severity | MTTA (median) | MTTR (median) | Vs. SLA (response / resolution) |',
    '|----------|---------------|---------------|--------------------------------|',
    '| **S1** | _ | _ | per `Issue_Escalation_Matrix.md` section 2 |',
    '| **S2** | _ | _ | per `Issue_Escalation_Matrix.md` section 2 |',
    '| **S3** | _ | _ | per `Issue_Escalation_Matrix.md` section 2 |',
    '| **S4** | _ | _ | per `Issue_Escalation_Matrix.md` section 2 |',
    '',
    'Highlight any row where MTTA or MTTR exceeds the SLA — feeds the morning standup.',
    '',
    '## 3. Top 5 Issues by Area',
    '',
    'Surface module / workstream hot spots. Consistent appearance over 3 days = ',
    'investigate the underlying area.',
    '',
    '| Rank | Area | Open issues | Trending (▲ ▼ ―) |',
    '|------|------|------------:|-------------------|',
    '| 1 | _[ASSIGN]_ | _ | _ |',
    '| 2 | _[ASSIGN]_ | _ | _ |',
    '| 3 | _[ASSIGN]_ | _ | _ |',
    '| 4 | _[ASSIGN]_ | _ | _ |',
    '| 5 | _[ASSIGN]_ | _ | _ |',
    '',
    '## 4. User Adoption Signals',
    '',
    '| Signal | Today | Green band | Yellow band | Red band |',
    '|--------|-------|------------|-------------|----------|',
    '| Login count (named users) | _ | ≥ 90% of named users | 70-90% | < 70% |',
    '| Transactions posted (vs. baseline) | _ | ≥ 80% of legacy daily volume | 50-80% | < 50% |',
    '| % active users (trailing 7 days) | _ | ≥ 90% | 70-90% | < 70% |',
    '',
    '## 5. Integration Health',
    '',
    '| Integration | Success rate | Retry queue depth | Status | Notes |',
    '|-------------|--------------|-------------------|--------|-------|',
    integrationHealthRows,
    '',
    '**Bands:** green = success rate ≥ 99% AND retry depth < 5; yellow = success rate 95-99% OR retry depth 5-20; red = success rate < 95% OR retry depth > 20.',
    '',
    '## 6. Business KPIs',
    '',
    'KPIs derived from the engagement\'s success metrics (per `Documentation/Solution_Design.html`).',
    '',
    '- [ ] Each business KPI listed in Solution Design has a green / yellow / red band',
    '- [ ] Daily value vs. band charted',
    '- [ ] 5-day rolling trend plotted (so 5 consecutive green = adoption gate met)',
    '',
    '## 7. End-of-Day Status Callout',
    '',
    '> **Status:** 🟢 GREEN / 🟡 YELLOW / 🔴 RED',
    '> ',
    '> **Rationale:** [...one-paragraph summary covering anything yellow or red, action items, sponsor decisions needed...]',
    '',
    'This callout is the FIRST thing the sponsor reads in the daily email. Lead with red, ',
    'then yellow, close with green wins.',
    '',
    `## 8. ${dataSource.sectionTitle}`,
    '',
    dataSource.description,
    '',
    dataSource.perKpi,
    '',
    '## 9. Cross-References',
    '',
    '- Hypercare plan: `Documentation/Hypercare/Hypercare_Plan.md`',
    '- Daily readiness checklist: `Documentation/Hypercare/Daily_Readiness_Checklist.md`',
    '- Issue escalation matrix: `Documentation/Hypercare/Issue_Escalation_Matrix.md`',
    '- War-room SOP: `Documentation/Hypercare/War_Room_SOP.md`',
    '- Defect log: `Documentation/Defect_Log_Template.md`',
    '- Solution design (success-metrics section): `Documentation/Solution_Design.html`',
    '',
    '_Generated by ERPLaunch — Pack X (Hypercare Program)._',
    '',
  ].join('\n');

  return { markdown };
}
