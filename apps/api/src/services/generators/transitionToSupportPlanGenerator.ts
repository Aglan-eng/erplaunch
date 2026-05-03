/**
 * Transition To Support Plan generator (Pack X — Component 5).
 *
 * Cross-platform — emits Documentation/Hypercare/Transition_To_Support_Plan.md.
 *
 * Defines the formal handover from hypercare team to BAU support
 * organization. KT agenda + ticket-category mapping + standing
 * artefacts handover + post-transition cadence (weekly → monthly).
 */

export interface TransitionToSupportPlanInput {
  clientName: string;
  adaptorName?: string;
  /** TEXT hypercare.team.sustainmentOwner — verbatim in plan. */
  sustainmentOwner?: string | null;
  /** TEXT hypercare.team.hypercareLeadName — drives engagement-side
   *  signoff line. */
  hypercareLeadName?: string | null;
  /** NUMBER hypercare.sla.hypercareDurationDays — drives transition date. */
  hypercareDurationDays?: number;
  /** TEXT kickoff.mandate.targetGoLiveDate — drives transition date. */
  targetGoLiveDate?: string | null;
}

export interface TransitionToSupportPlanOutput {
  markdown: string;
}

function calcTransitionDate(
  goLiveRaw: string | null | undefined,
  durationDays: number,
): string {
  if (!goLiveRaw) return '_[ASSIGN — go-live + ' + durationDays + ' days]_';
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

export function generateTransitionToSupportPlan(
  input: TransitionToSupportPlanInput,
): TransitionToSupportPlanOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const durationDays =
    typeof input.hypercareDurationDays === 'number' && input.hypercareDurationDays > 0
      ? input.hypercareDurationDays
      : 30;
  const transitionDate = calcTransitionDate(input.targetGoLiveDate, durationDays);
  const sustainment = input.sustainmentOwner?.trim().length
    ? input.sustainmentOwner.trim()
    : '_[ASSIGN sustainment owner]_';
  const lead = input.hypercareLeadName?.trim().length
    ? input.hypercareLeadName.trim()
    : '_[ASSIGN hypercare lead]_';

  const markdown = [
    `# Transition To Support Plan — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Transition Date:** ${transitionDate} (T+${durationDays} from go-live)  `,
    `**Sustainment Owner:** ${sustainment}  `,
    `**Hypercare Lead (handing over):** ${lead}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Formal handover from the hypercare team to BAU support. The transition is a ',
    'cliff date — after T+' + durationDays + ', incidents route via the sustainment owner ' +
      '(' + sustainment + '), not the hypercare team. The work below is completed BEFORE ',
    'the transition date so nothing falls through.',
    '',
    '## 1. Knowledge Transfer Agenda',
    '',
    'Five 90-minute sessions held during the final week of hypercare. Sustainment ',
    'owner + their on-call team attend; hypercare lead facilitates.',
    '',
    '| Session | Topic | Recordings | Owner |',
    '|---------|-------|------------|-------|',
    '| 1 | Modules covered + business processes per workstream | Recorded + uploaded to client KB | Hypercare Lead + Workstream Leads |',
    '| 2 | Custom record + custom field inventory | Recorded + slide deck | Hypercare Lead |',
    '| 3 | Workflow + script walk-through (per `Documentation/Solution_Design.html`) | Recorded | Functional Lead |',
    '| 4 | Integration topology + monitoring + retry handling | Recorded + integration runbooks | Integration Engineer |',
    '| 5 | Customisation registry + role mapping + permission boundaries | Recorded + slide deck | Hypercare Lead |',
    '',
    '## 2. Ticket Category Mapping',
    '',
    'During hypercare, issues land in `Documentation/Defect_Log_Template.md` per workstream. ',
    'After transition, they route into the sustainment team\'s queue taxonomy. The mapping ',
    'below ensures no issue type loses its triage path.',
    '',
    '| Hypercare Category | Sustainment Queue | SLA Target |',
    '|--------------------|-------------------|------------|',
    '| S1 — Production halted | "Critical / P1 incident" | Per support contract (typically same-day) |',
    '| S2 — Major impaired | "High / P2 incident" | Per support contract (typically 1-2 business days) |',
    '| S3 — Minor / single-user | "Standard / P3 incident" | Per support contract (5-10 business days) |',
    '| S4 — Cosmetic / enhancement | "Enhancement backlog" | Quarterly review |',
    '| Integration retry / failure | "Integration ops" | Per integration retry policy |',
    '| Custom-record / workflow | "Customisation" | Per change-management policy |',
    '| Tax / financial-reporting | "Finance support" | Per finance-team SLA |',
    '',
    '## 3. Standing Artefacts to Hand Over',
    '',
    'Every artefact listed below transfers into the sustainment team\'s knowledge base ',
    'on the transition date. Hypercare lead confirms receipt + accessibility from ',
    'sustainment side before the cliff.',
    '',
    '- [ ] Solution Design document — `Documentation/Solution_Design.html`',
    '- [ ] Training Manual — `Documentation/Training_Manual.html`',
    '- [ ] Per-role training guides — `Documentation/Training/<Role>_Training_Guide.md`',
    '- [ ] Quick Reference Cards — `Documentation/Training/Quick_Reference_Cards/`',
    '- [ ] Cutover Runbook + post-mortem — `Documentation/Cutover/Cutover_Runbook.md`',
    '- [ ] Defect log (full hypercare history) — `Documentation/Defect_Log_Template.md`',
    '- [ ] Integration runbooks (one per integration in scope)',
    '- [ ] Customisation registry (custom records / fields / workflows / scripts)',
    '- [ ] Role / permission mapping — Pack C outputs (`SDF/Objects/customrole_*.xml` for NetSuite; equivalent for Odoo)',
    '- [ ] Tax + accounting configuration — Pack D outputs',
    '- [ ] Hypercare KPI dashboard — `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`',
    '- [ ] Open-issues snapshot at transition (defect log filtered to OPEN + IN_PROGRESS)',
    '- [ ] All RCAs completed during hypercare',
    '',
    '## 4. First 30 Days Post-Transition Cadence',
    '',
    'After the cliff, light-touch engagement continues for 30 days to catch anything ',
    'that surfaces only after the formal handover.',
    '',
    '- **Weekly check-in (T+' + durationDays + ' to T+' + (durationDays + 30) + '):** 30-minute call between hypercare lead and sustainment lead. Topics: any new incidents, KPI trends, anything escalated.',
    '- **Office-hours availability (T+' + durationDays + ' to T+' + (durationDays + 30) + '):** hypercare lead is reachable for ad-hoc questions during business hours.',
    '- **Reduces to monthly (T+' + (durationDays + 30) + ' onwards):** quarterly health-check thereafter.',
    '',
    '## 5. Sign-off',
    '',
    `- **Hypercare Lead (handing over):** ${lead} — Date: __________`,
    `- **Sustainment Owner (receiving):** ${sustainment} — Date: __________`,
    '- **Project Sponsor:** ___________________________ — Date: __________',
    '',
    '## 6. Cross-References',
    '',
    '- Hypercare plan: `Documentation/Hypercare/Hypercare_Plan.md`',
    '- KPI dashboard: `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`',
    '- Issue escalation matrix: `Documentation/Hypercare/Issue_Escalation_Matrix.md`',
    '- War-room SOP: `Documentation/Hypercare/War_Room_SOP.md`',
    '- KT checklist (Pack U) — completed BEFORE this transition: `Documentation/KT_Checklist.md`',
    '',
    '_Generated by ERPLaunch — Pack X (Hypercare Program)._',
    '',
  ].join('\n');

  return { markdown };
}
