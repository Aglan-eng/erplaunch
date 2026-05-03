/**
 * Stabilization Roadmap generator (Pack Y — Component 1).
 *
 * Cross-platform — emits Documentation/Stabilization/Stabilization_Roadmap.md.
 *
 * The 12-month outlook from hypercare exit (T+30) to year-1 maturity
 * (T+360). Defines the four phases of stabilization (Settle / Optimize
 * / Expand / Mature), quarterly milestones derived from phaseTwoScope
 * overlay + canonical defaults, owner roster from governanceCommittee,
 * cadence calendar from decisionCadence.
 *
 * Sources:
 *   - PMI / PMBOK transition + sustain phase guidance.
 *   - SuiteSuccess Sustain methodology.
 *   - SAP Activate Run + benefits review framework.
 */

import {
  parseCommittee,
  parseBacklog,
  DEFAULT_COMMITTEE_ROWS,
  type ParsedCommitteeRow,
} from './stabilizationHelpers.js';

export interface StabilizationRoadmapInput {
  clientName: string;
  adaptorName?: string;
  /** TEXT stabilization.governance.stabilizationOwner. */
  stabilizationOwner?: string | null;
  /** TEXTAREA stabilization.governance.governanceCommittee. */
  governanceCommittee?: string | null;
  /** TEXT stabilization.governance.decisionCadence. */
  decisionCadence?: string | null;
  /** TEXTAREA stabilization.backlog.phaseTwoScope — drives quarterly milestones. */
  phaseTwoScope?: string | null;
  /** TEXT kickoff.mandate.targetGoLiveDate — drives T+ anchors. */
  targetGoLiveDate?: string | null;
}

export interface StabilizationRoadmapOutput {
  markdown: string;
}

function calcAnchor(goLiveRaw: string | null | undefined, days: number): string {
  if (!goLiveRaw) return `T+${days} (anchor TBD until go-live confirmed)`;
  const m = goLiveRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return `T+${days}`;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return `T+${days}`;
  d.setUTCDate(d.getUTCDate() + days);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `T+${days} (${yyyy}-${mm}-${dd})`;
}

function committeeTable(rows: ReadonlyArray<ParsedCommitteeRow>): string {
  if (rows.length === 0) {
    return DEFAULT_COMMITTEE_ROWS.map(
      (r) => `| ${r.name} | ${r.role} | ${r.function} |`,
    ).join('\n');
  }
  return rows
    .map(
      (r) =>
        `| ${r.name} | ${r.role || '_[ASSIGN role]_'} | ${r.function || '_[ASSIGN function]_'} |`,
    )
    .join('\n');
}

export function generateStabilizationRoadmap(
  input: StabilizationRoadmapInput,
): StabilizationRoadmapOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const owner = input.stabilizationOwner?.trim().length
    ? input.stabilizationOwner.trim()
    : '_[ASSIGN stabilization owner]_';
  const cadence = input.decisionCadence?.trim().length
    ? input.decisionCadence.trim()
    : 'Monthly steering committee, quarterly business review, annual board readout (default cadence — populate `stabilization.governance.decisionCadence` to customise)';
  const committee = parseCommittee((input.governanceCommittee ?? '').toString());
  const phaseTwoSeeds = parseBacklog((input.phaseTwoScope ?? '').toString());

  const t30 = calcAnchor(input.targetGoLiveDate, 30);
  const t90 = calcAnchor(input.targetGoLiveDate, 90);
  const t180 = calcAnchor(input.targetGoLiveDate, 180);
  const t270 = calcAnchor(input.targetGoLiveDate, 270);
  const t360 = calcAnchor(input.targetGoLiveDate, 360);

  const phaseTwoMilestones =
    phaseTwoSeeds.length === 0
      ? [
          '- _[ASSIGN — populate `stabilization.backlog.phaseTwoScope` to render the scope candidates here]_',
        ].join('\n')
      : phaseTwoSeeds
          .map(
            (m) =>
              `- **${m.item}** — ${m.context}${m.classification.length > 0 ? ` (target: ${m.classification})` : ''}`,
          )
          .join('\n');

  const markdown = [
    `# Stabilization Roadmap — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Stabilization Owner:** ${owner}  `,
    `**Window:** T+30 (hypercare exit) → T+360 (year-1 maturity)  `,
    `**Cadence:** ${cadence}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    '## 1. Overview',
    '',
    `Stabilization is the 11-month window after hypercare exit. The platform shifts `,
    `from "implementation project" to "managed product." Three things change vs. hypercare:`,
    '',
    '1. **Time horizon** — hypercare measured days, stabilization measures months.',
    '2. **Decision rights** — hypercare lead hands the wheel to the steady-state governance body.',
    '3. **Success criterion** — hypercare measured "no fires," stabilization measures "did we get the benefits we promised."',
    '',
    `T+0 = go-live. T+30 = hypercare exit. T+360 = year-1 maturity gate.`,
    '',
    '## 2. The Four Phases of Stabilization',
    '',
    `### Phase 1 — Settle (${t30} → ${t90})`,
    '',
    'Process adherence + ticket-volume normalisation + monthly close cadence stable.',
    '',
    '- Daily standups end (per Hypercare exit), weekly ops review begins',
    '- First two month-end closes complete cleanly within 5 business days',
    '- Defect log triage cadence stabilises (weekly — no more daily standup)',
    '- Power users acclimatise; office-hours demand drops to 1/week then ad-hoc',
    '- Integration retry depth holds steady < 5 for 3 consecutive periods',
    '',
    `### Phase 2 — Optimize (${t90} → ${t180})`,
    '',
    'Kill workarounds. Automate the top 5 manual steps surfaced in hypercare. Retire any bridge integrations stood up for cutover.',
    '',
    '- Process Improvement Backlog (`Process_Improvement_Backlog.md`) Quick Wins all delivered',
    '- Top 5 hypercare-period workarounds eliminated via config or scripts',
    '- Bridge integrations from cutover retired (data flows through native paths)',
    '- Saved searches / dashboards refined based on first 3 months of usage data',
    '- First quarterly Benefits Review completed — Benefits Realization Tracker green on at least 3 metrics',
    '',
    `### Phase 3 — Expand (${t180} → ${t270})`,
    '',
    'Deliver phase-two scope items in priority order. Onboard any deferred entities or modules.',
    '',
    phaseTwoMilestones,
    '',
    '_(Above pulled from `stabilization.backlog.phaseTwoScope` overlay + `Phase_Two_Charter.md`. Sequencing per business-case strength + dependency map.)_',
    '',
    `### Phase 4 — Mature (${t270} → ${t360})`,
    '',
    'Full benefits realisation measurement. KPI re-baseline. Plan year-2 roadmap.',
    '',
    '- All business-case metrics measured for full quarter (per Benefits Realization Tracker)',
    '- KPI thresholds re-baselined for steady-state (no longer hypercare-tight bands)',
    '- Year-2 roadmap drafted (informed by lessons-learned + benefits gap analysis)',
    '- Annual external review / audit completed without remediation findings',
    '- Sponsor sign-off on year-1 outcomes',
    '',
    '## 3. Quarterly Milestones',
    '',
    '| Anchor | Phase | Milestone Criteria |',
    '|--------|-------|--------------------|',
    `| ${t30} | Settle starts | Hypercare exit gates met (per \`Hypercare_Plan.md\` section 7) |`,
    `| ${t90} | Settle complete / Optimize starts | First quarterly Benefits Review held |`,
    `| ${t180} | Optimize complete / Expand starts | Phase-two greenlight gate (see \`Phase_Two_Charter.md\`) |`,
    `| ${t270} | Expand complete / Mature starts | Phase-two wave-1 deliveries live |`,
    `| ${t360} | Mature complete / Year-2 starts | Year-1 outcomes signed off; year-2 roadmap approved |`,
    '',
    '## 4. Steady-State Governance Body',
    '',
    'See `Continuous_Improvement_Governance.md` for the full RACI matrix + change-request lifecycle. ',
    'Roster (committee + sustainment owner):',
    '',
    '| Name | Role | Function Represented |',
    '|------|------|----------------------|',
    committeeTable(committee),
    '',
    `**Sustainment Owner:** ${owner}`,
    '',
    '## 5. Cadence Calendar',
    '',
    `**Default cadence:** ${cadence}`,
    '',
    '- **Monthly steering** — backlog priority + change requests + KPI snapshot',
    '- **Quarterly business review** — Benefits Realization Tracker + steering decisions + phase-two gating',
    '- **Annual board readout** — year-1 outcomes vs. business case + year-2 roadmap',
    '',
    '## 6. Cross-References',
    '',
    '- Lessons-learned register: `Documentation/Stabilization/Lessons_Learned_Register.md`',
    '- Benefits realization tracker: `Documentation/Stabilization/Benefits_Realization_Tracker.md`',
    '- Process-improvement backlog: `Documentation/Stabilization/Process_Improvement_Backlog.md`',
    '- Continuous-improvement governance: `Documentation/Stabilization/Continuous_Improvement_Governance.md`',
    '- KPI evolution plan: `Documentation/Stabilization/KPI_Evolution_Plan.md`',
    '- Phase-two charter: `Documentation/Stabilization/Phase_Two_Charter.md`',
    '- Hypercare plan (precedes this): `Documentation/Hypercare/Hypercare_Plan.md`',
    '- Transition-to-support plan: `Documentation/Hypercare/Transition_To_Support_Plan.md`',
    '',
    '_Generated by ERPLaunch — Pack Y (Stabilization Roadmap)._',
    '',
  ].join('\n');

  return { markdown };
}
