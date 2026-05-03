/**
 * Benefits Realization Tracker generator (Pack Y — Component 3).
 *
 * Cross-platform — emits Documentation/Stabilization/Benefits_Realization_Tracker.md.
 *
 * The single most overlooked deliverable in real implementations.
 * Tracker table populated from businessCaseSummary overlay; default
 * canonical metrics render when overlay sparse. Per-row measurement
 * methodology is adaptor-conditional (NetSuite saved searches vs.
 * Odoo Studio dashboards / SQL views).
 *
 * Sources:
 *   - PMI / PMBOK benefits realization management.
 *   - Standard ERP business-case metric library (close cycle days,
 *     DPO/DSO, manual JE count, audit prep hours, headcount avoided).
 */

import {
  parseBusinessCase,
  DEFAULT_BUSINESS_CASE_ROWS,
  type ParsedBusinessCaseRow,
} from './stabilizationHelpers.js';

export interface BenefitsRealizationTrackerInput {
  clientName: string;
  /** "NetSuite" / "Odoo" — drives measurement-methodology references. */
  adaptorName?: string;
  /** TEXTAREA stabilization.benefits.businessCaseSummary. */
  businessCaseSummary?: string | null;
  /** TEXT stabilization.benefits.benefitsReviewCadence. */
  benefitsReviewCadence?: string | null;
  /** TEXT stabilization.benefits.benefitsReviewOwner — drives owner column. */
  benefitsReviewOwner?: string | null;
}

export interface BenefitsRealizationTrackerOutput {
  markdown: string;
}

interface MeasurementProfile {
  sectionTitle: string;
  description: string;
  perMetricRefs: string;
}

function measurementProfileFor(adaptorName: string): MeasurementProfile {
  const lower = adaptorName.toLowerCase();
  if (lower === 'netsuite') {
    return {
      sectionTitle: 'NetSuite Measurement Methodology',
      description:
        'Each metric in the tracker maps to a NetSuite saved search emitted by ' +
        'Pack F (`SDF/Objects/customsearch_*.xml`) or one created during stabilization. ' +
        'Saved-search results refresh on a schedule via SuiteAnalytics Connect or ' +
        'scheduled SuiteScript and feed the quarterly Benefits Review. Results ' +
        'are archived in the engagement KB so trend analysis is preserved.',
      perMetricRefs: [
        '- **Close cycle days:** `customsearch_ss_close_cycle_history` — date range from period-open to period-locked, averaged across the trailing 3 periods.',
        '- **DPO / DSO:** `customsearch_ss_dpo_dso_history` — running calculation per period, computed from AR and AP saved searches.',
        '- **Manual JE count:** `customsearch_ss_manual_je_count` — count of journal entries with type=Standard and source=Manual per period.',
        '- **Audit prep hours:** Captured manually in the engagement timesheet system; logged to `Documentation/Stabilization/Benefits_Realization_Tracker.md` via quarterly review.',
        '- **Headcount avoided:** Tracked by Finance HR; reported quarterly to steering. No saved search — cross-functional metric.',
        '- **Multi-currency reval runtime:** Map/Reduce script execution log — average runtime per period.',
      ].join('\n'),
    };
  }
  if (lower === 'odoo') {
    return {
      sectionTitle: 'Odoo Measurement Methodology',
      description:
        'Each metric in the tracker maps to an Odoo Studio dashboard or a custom SQL ' +
        'view. Dashboard refreshes are scheduled via Studio scheduled actions or ' +
        '`ir.cron` jobs. Results feed the quarterly Benefits Review and are archived ' +
        'in the engagement KB so trend analysis is preserved.',
      perMetricRefs: [
        '- **Close cycle days:** Studio dashboard `bm_close_cycle` — date range from period-open to lock, averaged across trailing 3 periods.',
        '- **DPO / DSO:** SQL view `bm_dpo_dso` — running calculation per period from `account.move.line` aggregates.',
        '- **Manual journal count:** Studio dashboard `bm_manual_je` — count of `account.move` records where `journal_id` = "Manual JE" per period.',
        '- **Audit prep hours:** Captured manually in engagement timesheet system; logged via quarterly review.',
        '- **Headcount avoided:** Tracked by Finance HR; reported quarterly to steering. Cross-functional metric.',
        '- **Multi-currency reval runtime:** Logged to `ir.logging` by the revaluation cron; aggregated per period.',
      ].join('\n'),
    };
  }
  return {
    sectionTitle: 'Platform Measurement Methodology',
    description:
      '_[ASSIGN platform-specific data sources — populate adaptorName for auto-fill.]_',
    perMetricRefs: '_[ASSIGN per-metric implementation references]_',
  };
}

function trackerRow(row: ParsedBusinessCaseRow, owner: string): string {
  return [
    `| ${row.metric}`,
    row.baseline.length > 0 ? row.baseline : '_[ASSIGN]_',
    row.target.length > 0 ? row.target : '_[ASSIGN]_',
    row.timing.length > 0 ? row.timing : 'T+180',
    'See section 3 below',
    owner,
    '⏳ Not yet measured',
    '',
  ].join(' | ');
}

export function generateBenefitsRealizationTracker(
  input: BenefitsRealizationTrackerInput,
): BenefitsRealizationTrackerOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const owner = input.benefitsReviewOwner?.trim().length
    ? input.benefitsReviewOwner.trim()
    : '_[ASSIGN benefits-review owner]_';
  const cadence = input.benefitsReviewCadence?.trim().length
    ? input.benefitsReviewCadence.trim()
    : 'Quarterly to steering committee, annual to board (default — populate `stabilization.benefits.benefitsReviewCadence` to customise)';

  const declared = parseBusinessCase((input.businessCaseSummary ?? '').toString());
  const rows = declared.length >= 3 ? declared : DEFAULT_BUSINESS_CASE_ROWS;
  const sourceLabel = declared.length >= 3
    ? '_(Source: parsed `stabilization.benefits.businessCaseSummary` overlay.)_'
    : '_(Source: canonical default ERP business-case metrics — overlay sparse. Populate `stabilization.benefits.businessCaseSummary` with engagement-specific metrics.)_';

  const profile = measurementProfileFor(platform);

  const markdown = [
    `# Benefits Realization Tracker — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Benefits Owner:** ${owner}  `,
    `**Review Cadence:** ${cadence}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'The single most-skipped deliverable in real ERP implementations. This tracker ',
    'measures whether the business case held — were the benefits we promised actually ',
    'delivered? Each metric has a baseline (pre-implementation), a target (post-go-live), ',
    'and a measurement timing (T+90 / T+180 / T+270 / T+360).',
    '',
    '## 1. Purpose',
    '',
    'Move benefits realization from "we hope it worked" to "we measured it and here is ',
    'the data." Quarterly reviews compare actuals to targets; misses trigger the ',
    're-baselining workflow in section 4. The tracker is the canonical artefact for the ',
    'Sponsor + Steering quarterly business review and the annual board readout.',
    '',
    '## 2. Tracker Table',
    '',
    sourceLabel,
    '',
    '| Metric | Baseline | Target | Timing | Source data | Owner | Status |',
    '|--------|----------|--------|--------|-------------|-------|--------|',
    rows.map((r) => trackerRow(r, owner)).join('\n'),
    '',
    `## 3. ${profile.sectionTitle}`,
    '',
    profile.description,
    '',
    profile.perMetricRefs,
    '',
    '## 4. Re-baselining Trigger Conditions',
    '',
    'A metric **target** must be revised (not just declared "missed") when ANY of the following fires:',
    '',
    '- The underlying business model changes (e.g., new acquisition, divestiture, regulatory shift)',
    '- The original baseline turns out to have been mismeasured (e.g., wrong calculation, missing data)',
    '- A scope change reduces or expands what the platform delivers',
    '- The timing assumption turns out to be unrealistic given dependencies (re-baseline timing only — don\'t move the target)',
    '',
    'A miss without a re-baselining trigger demands action — root cause analysis + ',
    'remediation plan tracked in `Documentation/Stabilization/Process_Improvement_Backlog.md`.',
    '',
    '## 5. Review Cadence',
    '',
    `**Owner:** ${owner}`,
    '',
    `**Cadence:** ${cadence}`,
    '',
    'Quarterly reviews:',
    '- T+90: Settle phase complete — first quarterly review. Expect early-quarter metrics partial; later metrics still TBD.',
    '- T+180: Optimize phase complete — second review. Most short-cycle metrics should be GREEN; long-cycle metrics still partial.',
    '- T+270: Expand phase complete — third review. All metrics measurable; misses now actionable.',
    '- T+360: Mature phase complete — fourth review + annual readout. All targets either GREEN or formally re-baselined.',
    '',
    '## 6. Cross-References',
    '',
    '- Stabilization roadmap: `Documentation/Stabilization/Stabilization_Roadmap.md`',
    '- Process-improvement backlog: `Documentation/Stabilization/Process_Improvement_Backlog.md`',
    '- KPI evolution plan: `Documentation/Stabilization/KPI_Evolution_Plan.md`',
    '- Continuous-improvement governance: `Documentation/Stabilization/Continuous_Improvement_Governance.md`',
    '- Phase-two charter: `Documentation/Stabilization/Phase_Two_Charter.md`',
    '- Solution Design (success metrics): `Documentation/Solution_Design.html`',
    '- KICKOFF business case: `Documentation/Project_Kickoff.md`',
    '',
    '_Generated by ERPLaunch — Pack Y (Stabilization Roadmap)._',
    '',
  ].join('\n');

  return { markdown };
}
