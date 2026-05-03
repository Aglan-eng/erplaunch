/**
 * Hypercare Plan generator (Pack X — Hypercare Program, Component 1).
 *
 * Cross-platform — emits Documentation/Hypercare/Hypercare_Plan.md.
 *
 * The hypercare plan is the consolidated reference for the post-go-live
 * triage program. Sections: Overview / Team / Coverage / Cadence /
 * Severity / SLAs / Exit Criteria / Transition. Reads the full HYPERCARE
 * flow + targetGoLiveDate from KICKOFF.
 *
 * Sources:
 *   - SuiteSuccess Hypercare playbook + SAP Activate Run phase.
 *   - ITIL service-transition + ELS patterns.
 */

import {
  parseRoster,
  parseSeverity,
  parseSla,
  parseExitCriteria,
  augmentExitCriteria,
  DEFAULT_SEVERITY_ROWS,
  DEFAULT_SLA_ROWS,
  type ParsedRosterRow,
  type ParsedSeverityRow,
  type ParsedSlaRow,
} from './hypercareHelpers.js';

export interface HypercarePlanGeneratorInput {
  clientName: string;
  adaptorName?: string;
  /** TEXT hypercare.team.hypercareLeadName. */
  hypercareLeadName?: string | null;
  /** TEXTAREA hypercare.team.hypercareTeamRoster. */
  hypercareTeamRoster?: string | null;
  /** TEXT hypercare.team.sustainmentOwner. */
  sustainmentOwner?: string | null;
  /** NUMBER hypercare.sla.hypercareDurationDays (default 30). */
  hypercareDurationDays?: number;
  /** TEXTAREA hypercare.sla.severityDefinitions. */
  severityDefinitions?: string | null;
  /** TEXTAREA hypercare.sla.responseTimeBySeverity. */
  responseTimeBySeverity?: string | null;
  /** TEXT hypercare.sla.businessHoursDefinition. */
  businessHoursDefinition?: string | null;
  /** TEXT hypercare.cadence.dailyStandupTime. */
  dailyStandupTime?: string | null;
  /** TEXT hypercare.cadence.weeklyReviewTime. */
  weeklyReviewTime?: string | null;
  /** TEXT hypercare.cadence.warRoomHours. */
  warRoomHours?: string | null;
  /** TEXTAREA hypercare.cadence.hypercareExitCriteria. */
  hypercareExitCriteria?: string | null;
  /** TEXT kickoff.mandate.targetGoLiveDate — drives T+0 anchor. */
  targetGoLiveDate?: string | null;
}

export interface HypercarePlanGeneratorOutput {
  markdown: string;
}

function calcExitDate(goLiveRaw: string | null | undefined, durationDays: number): string {
  if (!goLiveRaw) return 'TBD (set when go-live confirmed)';
  const m = goLiveRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return goLiveRaw;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return goLiveRaw;
  d.setUTCDate(d.getUTCDate() + durationDays);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function rosterTable(rows: ParsedRosterRow[]): string {
  if (rows.length === 0) {
    return '| _[ASSIGN]_ | _[ASSIGN]_ | _[ASSIGN]_ | _[ASSIGN]_ |';
  }
  return rows
    .map(
      (r) =>
        `| ${r.name} | ${r.role || '_[ASSIGN role]_'} | ${r.coverage || '_[ASSIGN coverage]_'} | ${r.phone || '_[ASSIGN phone]_'} |`,
    )
    .join('\n');
}

function severityTable(rows: ReadonlyArray<ParsedSeverityRow>): string {
  return rows
    .map((r) => `| **${r.severity}** | ${r.description} | ${r.example} |`)
    .join('\n');
}

function slaTable(rows: ReadonlyArray<ParsedSlaRow>): string {
  return rows
    .map((r) => `| **${r.severity}** | ${r.responseSla} | ${r.resolutionTarget} |`)
    .join('\n');
}

export function generateHypercarePlan(
  input: HypercarePlanGeneratorInput,
): HypercarePlanGeneratorOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const durationDays =
    typeof input.hypercareDurationDays === 'number' && input.hypercareDurationDays > 0
      ? input.hypercareDurationDays
      : 30;
  const exitDate = calcExitDate(input.targetGoLiveDate, durationDays);

  const roster = parseRoster((input.hypercareTeamRoster ?? '').toString());
  const declaredSeverity = parseSeverity((input.severityDefinitions ?? '').toString());
  const severity = declaredSeverity.length > 0 ? declaredSeverity : DEFAULT_SEVERITY_ROWS;
  const declaredSla = parseSla((input.responseTimeBySeverity ?? '').toString());
  const sla = declaredSla.length > 0 ? declaredSla : DEFAULT_SLA_ROWS;

  const consultantCriteria = parseExitCriteria((input.hypercareExitCriteria ?? '').toString());
  const { consultant, defaults: defaultGates } = augmentExitCriteria(consultantCriteria);

  const exitCriteriaBlock = [
    ...consultant.map((c) => `- ${c}`),
    ...(defaultGates.length > 0
      ? ['', '_Default minimum gates (added when not covered by consultant input):_', ...defaultGates.map((c) => `- ${c}`)]
      : []),
  ].join('\n');

  const lead = input.hypercareLeadName?.trim().length
    ? input.hypercareLeadName.trim()
    : '_[ASSIGN hypercare lead]_';
  const sustainment = input.sustainmentOwner?.trim().length
    ? input.sustainmentOwner.trim()
    : '_[ASSIGN sustainment owner]_';

  const markdown = [
    `# Hypercare Plan — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Hypercare Lead:** ${lead}  `,
    `**Duration:** ${durationDays} days  `,
    `**T+0 (Go-Live):** ${input.targetGoLiveDate ?? 'TBD'}  `,
    `**T+${durationDays} (Hypercare Exit):** ${exitDate}  `,
    `**Sustainment Owner:** ${sustainment}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    '## 1. Overview',
    '',
    `Hypercare is the post-go-live window during which the implementation team stays `,
    `mobilized to triage issues, hold daily standups, and gradually hand off to ongoing `,
    `support. ${input.clientName}'s hypercare runs ${durationDays} days from go-live; `,
    `exit gates are measurable and documented below in section 7.`,
    '',
    '## 2. Hypercare Team',
    '',
    '| Name | Role | Coverage | Phone |',
    '|------|------|----------|-------|',
    rosterTable(roster),
    '',
    '## 3. Coverage Model',
    '',
    `**War-room hours:** ${input.warRoomHours ?? '_[ASSIGN war-room schedule]_'}`,
    '',
    `**Business hours:** ${input.businessHoursDefinition ?? '_[ASSIGN business-hours definition]_'}`,
    '',
    '**After-hours rotation:** S1 incidents only — escalate via the on-call phone in the team roster (section 2). S2 and below wait for next business day.',
    '',
    '## 4. Cadence',
    '',
    `- **Daily standup:** ${input.dailyStandupTime ?? '_[ASSIGN daily standup time]_'}`,
    `- **Weekly review:** ${input.weeklyReviewTime ?? '_[ASSIGN weekly review time]_'}`,
    '- **Exec checkpoint:** End-of-week summary email to sponsor + steering (per `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`)',
    '- **War-room:** See section 3 above for tapering schedule',
    '',
    '## 5. Severity Definitions',
    '',
    '| Severity | Description | Example |',
    '|----------|-------------|---------|',
    severityTable(severity),
    '',
    '## 6. Response & Resolution SLAs',
    '',
    '| Severity | Response SLA | Resolution Target |',
    '|----------|--------------|-------------------|',
    slaTable(sla),
    '',
    'SLAs apply during business hours per section 3. After-hours response only for S1.',
    '',
    '## 7. Exit Criteria',
    '',
    'Hypercare exits when ALL of the following are met:',
    '',
    exitCriteriaBlock.length > 0
      ? exitCriteriaBlock
      : '_[ASSIGN exit criteria — at minimum, populate hypercare.cadence.hypercareExitCriteria in the wizard]_',
    '',
    '## 8. Transition to BAU Support',
    '',
    `On **${exitDate}** (T+${durationDays}), the engagement transitions from hypercare to `,
    `business-as-usual support. Sustainment owner: **${sustainment}**.`,
    '',
    'Detailed handoff steps are in `Documentation/Hypercare/Transition_To_Support_Plan.md`.',
    '',
    '## 9. Cross-References',
    '',
    '- Daily readiness checklist: `Documentation/Hypercare/Daily_Readiness_Checklist.md`',
    '- Issue escalation matrix: `Documentation/Hypercare/Issue_Escalation_Matrix.md`',
    '- War-room SOP: `Documentation/Hypercare/War_Room_SOP.md`',
    '- Transition-to-support plan: `Documentation/Hypercare/Transition_To_Support_Plan.md`',
    '- KPI dashboard: `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`',
    '- Power-user office hours: `Documentation/Hypercare/Power_User_Office_Hours.md`',
    '- Cutover runbook (precedes hypercare): `Documentation/Cutover/Cutover_Runbook.md`',
    '- Defect log: `Documentation/Defect_Log_Template.md`',
    '',
    '_Generated by ERPLaunch — Pack X (Hypercare Program)._',
    '',
  ].join('\n');

  return { markdown };
}
