/**
 * KPI Evolution Plan generator (Pack Y — Component 6).
 *
 * Cross-platform — emits Documentation/Stabilization/KPI_Evolution_Plan.md.
 *
 * Bridges Pack X's hypercare KPI dashboard to steady-state metrics.
 * Three measurement eras (Hypercare T+0..T+30 / Stabilization T+30..T+360
 * / Steady-state T+360+) with explicit retirement and introduction
 * tables. Adaptor-conditional data sources.
 */

import { parseBusinessCase } from './stabilizationHelpers.js';

export interface KpiEvolutionPlanInput {
  clientName: string;
  /** "NetSuite" / "Odoo" — drives data-source references. */
  adaptorName?: string;
  /** TEXTAREA stabilization.benefits.businessCaseSummary — informs introduction era. */
  businessCaseSummary?: string | null;
  /** TEXT hypercare.cadence.dailyStandupTime — anchors hypercare era. */
  hypercareDailyStandupTime?: string | null;
}

export interface KpiEvolutionPlanOutput {
  markdown: string;
}

interface DataSourceProfile {
  hypercareSource: string;
  stabilizationSource: string;
  steadyStateSource: string;
}

function dataSourceFor(adaptorName: string): DataSourceProfile {
  const lower = adaptorName.toLowerCase();
  if (lower === 'netsuite') {
    return {
      hypercareSource:
        'Saved searches `customsearch_ss_hc_*` (per `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`) refreshed end-of-day via SuiteAnalytics Connect.',
      stabilizationSource:
        'Mix of business-case saved searches (`customsearch_ss_close_cycle_history`, `customsearch_ss_dpo_dso_history`, etc. per `Documentation/Stabilization/Benefits_Realization_Tracker.md`) plus retained hypercare searches that stay relevant.',
      steadyStateSource:
        'Quarterly business-review pack assembled by Sustainment Owner — pulls from saved-search refreshes scheduled per the cadence in `Documentation/Stabilization/Continuous_Improvement_Governance.md`.',
    };
  }
  if (lower === 'odoo') {
    return {
      hypercareSource:
        'Studio dashboards / SQL views `hc_*` (per `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`) refreshed end-of-day via Studio scheduled actions or `ir.cron`.',
      stabilizationSource:
        'Mix of business-case Studio dashboards (`bm_close_cycle`, `bm_dpo_dso`, etc. per `Documentation/Stabilization/Benefits_Realization_Tracker.md`) plus retained hypercare dashboards that stay relevant.',
      steadyStateSource:
        'Quarterly business-review pack assembled by Sustainment Owner — pulls from Studio dashboards refreshed per the cadence in `Documentation/Stabilization/Continuous_Improvement_Governance.md`.',
    };
  }
  return {
    hypercareSource: '_[ASSIGN platform-specific hypercare data source]_',
    stabilizationSource: '_[ASSIGN platform-specific stabilization data source]_',
    steadyStateSource: '_[ASSIGN platform-specific steady-state data source]_',
  };
}

export function generateKpiEvolutionPlan(
  input: KpiEvolutionPlanInput,
): KpiEvolutionPlanOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const profile = dataSourceFor(platform);
  const businessCase = parseBusinessCase((input.businessCaseSummary ?? '').toString());

  // Introduction era table — when each business-case metric starts firing.
  const introRows =
    businessCase.length === 0
      ? [
          '| Close cycle days | T+30 (first close cycle) | Stabilization |',
          '| AP days-payable-outstanding | T+30 (first close cycle) | Stabilization |',
          '| AR days-sales-outstanding | T+90 (need 1 quarter to compare) | Stabilization |',
          '| Manual journal count per period | T+30 (first close cycle) | Stabilization |',
          '| Audit prep hours | T+360 (first annual audit) | Steady-state |',
          '| Headcount avoided in finance ops | T+180 (HR confirms post-stabilization) | Stabilization |',
        ].join('\n')
      : businessCase
          .map(
            (b) => {
              const era =
                b.timing.match(/T\+(\d+)/) && Number(RegExp.$1) >= 360
                  ? 'Steady-state'
                  : 'Stabilization';
              return `| ${b.metric} | ${b.timing.length > 0 ? b.timing : '_[ASSIGN]_'} | ${era} |`;
            },
          )
          .join('\n');

  const markdown = [
    `# KPI Evolution Plan — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Bridges hypercare KPIs (Pack X — daily exec dashboard) to stabilization KPIs ',
    '(business-case benefits realization) to steady-state KPIs (run-rate operations + ',
    'continuous improvement). Defines retirement of metrics that stop being relevant ',
    'after hypercare exits and introduction of metrics that can\'t fire until the ',
    'system has been live long enough to measure.',
    '',
    '## 1. The Three Measurement Eras',
    '',
    '| Era | Window | Purpose | Reporting Consumer | Frequency |',
    '|-----|--------|---------|---------------------|-----------|',
    '| **Hypercare** | T+0 → T+30 | Triage — "no fires" | Sponsor + Steering — daily exec email | Daily |',
    '| **Stabilization** | T+30 → T+360 | Benefits realization — "did the business case hold?" | Steering + Sponsor — weekly ops review + monthly steering + quarterly business review | Weekly / Monthly / Quarterly |',
    '| **Steady-state** | T+360+ | Run-rate ops + continuous improvement | Quarterly business review + annual board readout | Quarterly + annual |',
    '',
    '## 2. Metric Retirement',
    '',
    'Metrics that STOP being measured (or de-emphasised) at hypercare exit. They were ',
    'high-frequency reactive measures during triage; they don\'t serve the long horizon.',
    '',
    '| Metric | Retired at | Why | Replacement (if any) |',
    '|--------|-----------|-----|----------------------|',
    '| Open issues by severity (daily) | T+30 | Defect log moves to weekly review cadence | Weekly defect summary in ops review |',
    '| MTTA / MTTR (daily) | T+30 | After hypercare, all S1 within SLA — no daily signal value | Quarterly trend in Benefits Realization Tracker |',
    '| Top 5 issues by area (daily) | T+30 | Hot spots stabilise; daily granularity stops adding value | Monthly steering scorecard |',
    '| War-room status callout (🟢/🟡/🔴 daily) | T+30 | War-room dissolves at hypercare exit | Weekly ops-review status |',
    '| User adoption (daily login + transactions) | T+90 | Adoption gate met by end of Settle phase | Quarterly trend (does adoption hold?) |',
    '',
    '## 3. Metric Continuation',
    '',
    'Metrics that span eras — same definition, different cadence + threshold.',
    '',
    '| Metric | Hypercare cadence | Stabilization cadence | Steady-state cadence |',
    '|--------|-------------------|------------------------|----------------------|',
    '| Integration health (success rate) | Daily | Weekly | Monthly |',
    '| Defect open count by severity | Daily | Weekly summary | Monthly summary |',
    '| Period close completion days | _[during hypercare = pre-go-live baseline]_ | Each period | Each period |',
    '',
    '## 4. Metric Introduction',
    '',
    'Metrics that BEGIN being measured during stabilization (they require at least ',
    'one full close cycle on the new system to compute).',
    '',
    '| Metric | First measured at | Era |',
    '|--------|-------------------|-----|',
    introRows,
    '',
    '## 5. Reporting Consumers by Era',
    '',
    '- **Hypercare:** Daily exec email to Sponsor + Steering (per `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`)',
    '- **Stabilization:** Weekly ops review (Sustainment Owner + Workstream Leads) + Monthly steering (full governance body) + Quarterly business review (Sponsor + Sustainment Owner + CFO)',
    '- **Steady-state:** Quarterly business review + Annual board readout',
    '',
    '## 6. Threshold Evolution',
    '',
    'Bands tighten as the system matures. The hypercare green band on integration retry ',
    'depth (< 5) might tighten to (< 2) by T+360 once ETL is fully optimised.',
    '',
    '| Metric | Hypercare green | Stabilization green | Steady-state green |',
    '|--------|-----------------|----------------------|----------------------|',
    '| Integration retry depth | < 5 | < 3 | < 1 |',
    '| Integration success rate | ≥ 99% | ≥ 99.5% | ≥ 99.9% |',
    '| Period close completion | _[hypercare reactive]_ | ≤ 5 business days | ≤ 3 business days (per business-case target) |',
    '| Open S2 defects | ≤ 2 | ≤ 1 | 0 (zero tolerance after T+180) |',
    '',
    '## 7. Data Sources by Era',
    '',
    `**Hypercare:** ${profile.hypercareSource}`,
    '',
    `**Stabilization:** ${profile.stabilizationSource}`,
    '',
    `**Steady-state:** ${profile.steadyStateSource}`,
    '',
    '## 8. Cross-References',
    '',
    '- Hypercare KPI dashboard (precedes this): `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`',
    '- Benefits realization tracker: `Documentation/Stabilization/Benefits_Realization_Tracker.md`',
    '- Continuous-improvement governance: `Documentation/Stabilization/Continuous_Improvement_Governance.md`',
    '- Stabilization roadmap: `Documentation/Stabilization/Stabilization_Roadmap.md`',
    '- Phase-two charter: `Documentation/Stabilization/Phase_Two_Charter.md`',
    '',
    '_Generated by ERPLaunch — Pack Y (Stabilization Roadmap)._',
    '',
  ].join('\n');

  return { markdown };
}
