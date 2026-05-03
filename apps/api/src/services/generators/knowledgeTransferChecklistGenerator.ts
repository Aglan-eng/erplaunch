/**
 * Knowledge Transfer Checklist generator (Pack U — Training Collateral,
 * Component 6).
 *
 * Cross-platform — emits Documentation/KT_Checklist.md.
 *
 * The KT checklist is the formal transition gate from consultant team
 * to client-internal BAU support. Pack U emits a hand-fillable shell
 * with tickbox lists per area:
 *   1. Documentation handoff
 *   2. Configuration knowledge transfer (custom records / workflows /
 *      permissions / tax)
 *   3. Operational run-books
 *   4. Training cascade status (conditional on cascadeStrategy)
 *   5. BAU transition (on-call rotation, SLAs, quarterly review cadence)
 *
 * Sources:
 *   - PMI / PMBOK transition-and-closeout knowledge area.
 *   - SuiteSuccess + SAP Activate hypercare-to-BAU handoff patterns.
 *   - ITIL service-transition handoff checklist conventions.
 */

export type KTCascadeStrategy = 'TRAIN_EVERYONE' | 'TRAIN_THE_TRAINER' | 'HYBRID';

export interface KnowledgeTransferChecklistInput {
  clientName: string;
  adaptorName?: string;
  cascadeStrategy?: KTCascadeStrategy | string | null;
  /** Optional list of workstreams in scope — drives the operational
   *  run-book section. */
  workstreamsInScope?: ReadonlyArray<string>;
  /** Optional integrations list — drives the configuration handoff
   *  section. Free-form one-per-line strings. */
  integrationsList?: string | null;
}

export interface KnowledgeTransferChecklistOutput {
  markdown: string;
}

// ─── Cascade-section rendering ──────────────────────────────────────────────

function normaliseCascade(raw: string | null | undefined): KTCascadeStrategy {
  const upper = (raw ?? '').toString().toUpperCase();
  if (upper === 'TRAIN_EVERYONE') return 'TRAIN_EVERYONE';
  if (upper === 'TRAIN_THE_TRAINER') return 'TRAIN_THE_TRAINER';
  return 'HYBRID';
}

function cascadeSection(strategy: KTCascadeStrategy): string {
  switch (strategy) {
    case 'TRAIN_THE_TRAINER':
      return [
        '## 4. Training Cascade Status (Train-the-Trainer)',
        '',
        '- [ ] Champion list confirmed in `Documentation/Training_Matrix.md`',
        '- [ ] Champions completed full curriculum',
        '- [ ] Champion-led cascade sessions scheduled in `Documentation/Training_Schedule.md`',
        '- [ ] Cascade attendance sign-off captured in `Documentation/Sign_Off_Matrix.md`',
        '- [ ] Refresher / Q&A office-hours cadence agreed (typically weekly for first 30 days)',
      ].join('\n');
    case 'TRAIN_EVERYONE':
      return [
        '## 4. Training Cascade Status (Train-Everyone)',
        '',
        '- [ ] All end users completed direct consultant-led training',
        '- [ ] Per-role assessment results recorded in `Documentation/Sign_Off_Matrix.md`',
        '- [ ] No outstanding production-access blocks (every Required-coverage user has signed off)',
        '- [ ] Training feedback collected from each cohort — issues logged in `Documentation/Defect_Log_Template.md` if relevant',
      ].join('\n');
    case 'HYBRID':
    default:
      return [
        '## 4. Training Cascade Status (Hybrid)',
        '',
        '- [ ] Per-role mix confirmed in `Documentation/Training_Matrix.md` (which roles trained directly vs cascaded via champions)',
        '- [ ] Direct-trained role users completed assessment',
        '- [ ] Champion-cascaded role users completed assessment',
        '- [ ] All Required-coverage roles signed off in `Documentation/Sign_Off_Matrix.md`',
        '- [ ] Mixed-mode lessons-learned captured for future engagements',
      ].join('\n');
  }
}

// ─── Optional workstream-driven run-book lines ──────────────────────────────

function workstreamRunbookLines(workstreams: ReadonlyArray<string>): string {
  if (workstreams.length === 0) return '';
  // Emit a "documented + walkthrough done" line per major workstream.
  const map: Record<string, string> = {
    R2R: 'Period close + reporting procedure',
    P2P: 'Procurement + payables + payment-run procedure',
    O2C: 'Sales + invoicing + collections procedure',
    INV: 'Inventory adjustments + cycle counting procedure',
    MFG: 'Production + work-order + quality procedure',
    RTN: 'Returns + RMA processing procedure',
    CRM: 'CRM + lead management procedure',
    HR: 'HR + payroll + EOSB procedure',
  };
  const out: string[] = [];
  for (const ws of workstreams) {
    const upper = ws.toUpperCase();
    const desc = map[upper] ?? `${ws} procedure`;
    out.push(`- [ ] ${desc} documented + walkthrough done with client BAU lead`);
  }
  return out.join('\n');
}

// ─── Integration walk-through lines ─────────────────────────────────────────

function integrationLines(raw: string | null | undefined): string {
  const text = (raw ?? '').toString();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // Pull the first segment up to "|" or ":" — that's the integration name.
    const m = trimmed.match(/^([^|:]+)/);
    const name = (m ? m[1] : trimmed).trim();
    out.push(`- [ ] ${name} integration walk-through with client IT lead + run-book reviewed`);
  }
  return out.join('\n');
}

// ─── Markdown emission ──────────────────────────────────────────────────────

export function generateKnowledgeTransferChecklist(
  input: KnowledgeTransferChecklistInput,
): KnowledgeTransferChecklistOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const cascade = normaliseCascade(input.cascadeStrategy);
  const workstreamLines = workstreamRunbookLines(input.workstreamsInScope ?? []);
  const integrationsBlock = integrationLines(input.integrationsList);

  const markdown = [
    `# Knowledge Transfer Checklist — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Cascade Strategy:** ${cascade}  `,
    `**Date:** ${new Date().toLocaleDateString()}  `,
    `**Prepared by:** ERPLaunch`,
    '',
    'Final transition gate from consultant team to client-internal BAU support. ',
    'Complete BEFORE go-live + 30 days. Each section maps to an artefact in the ',
    'engagement bundle so the client team has a self-serve reference after ',
    'consultant disengagement.',
    '',
    '## 1. Documentation Handoff',
    '',
    '- [ ] All generated bundles archived in client SharePoint / Drive / GitHub repo',
    '- [ ] Run-books for each integration reviewed with client IT (see section 2)',
    '- [ ] Custom-script repos transferred to client GitHub / GitLab / equivalent',
    '- [ ] Saved searches + dashboards published to client roles (`Documentation/Test_Scripts/` references the saved-search ids)',
    '- [ ] Sign-off Matrix (`Documentation/Sign_Off_Matrix.md`) archived + final signatures captured',
    '- [ ] Defect Log (`Documentation/Defect_Log_Template.md`) handed to client PM with all open / resolved / accepted defects classified',
    '',
    '## 2. Configuration Knowledge Transfer',
    '',
    '- [ ] Custom record schemas walked through with client admin (1 session — record schema + lifecycle + permission mapping)',
    '- [ ] Workflow XMLs explained with state-machine diagrams (cross-ref `Documentation/Solution_Design.html`)',
    '- [ ] Permission sets walked through with client SoD owner (cross-ref Pack C role outputs)',
    '- [ ] Tax codes + schedules explained with client tax team (cross-ref Pack D outputs)',
    integrationsBlock.length > 0 ? integrationsBlock : '- [ ] _[ASSIGN integration walk-throughs once integration list is populated in the wizard]_',
    '',
    '## 3. Operational Run-Books',
    '',
    workstreamLines.length > 0 ? workstreamLines : '- [ ] Per-workstream run-books documented + walkthrough done',
    '- [ ] Cutover procedure documented + walkthrough done (Pack V will emit `Documentation/Cutover_Runbook.md`)',
    '- [ ] Hypercare escalation matrix in place (Pack X will emit `Documentation/Hypercare_Plan.md`)',
    '- [ ] Bug-bash / triage protocol established (severity definitions per `Documentation/Defect_Log_Template.md`)',
    '- [ ] Performance monitoring baseline transferred (cross-ref `Documentation/Performance_Test_Plan.md` Hypercare Handoff section)',
    '',
    cascadeSection(cascade),
    '',
    '## 5. BAU Transition',
    '',
    '- [ ] On-call rotation defined: consultant week 1-30 (full ownership), joint week 31-60 (shadowed), client-only week 61+',
    '- [ ] Triage SLA agreed (Critical = 2h response, High = 8h, Medium = 24h, Low = backlog)',
    '- [ ] Quarterly health-check cadence established with consultant team',
    '- [ ] Annual roadmap review cadence established (typically Q4 of fiscal year)',
    '- [ ] Knowledge-base location agreed (client wiki / SharePoint folder / dedicated portal section)',
    '- [ ] Final consultant-team contact list shared with client PM',
    '',
    '## 6. Sign-off',
    '',
    '- **Consultant PM:** ___________________________  Date: __________',
    '- **Client PM:** _______________________________  Date: __________',
    '- **Project Sponsor:** _________________________  Date: __________',
    '',
    '_Generated by ERPLaunch — Pack U (Training Collateral)._',
    '',
  ].join('\n');

  return { markdown };
}
