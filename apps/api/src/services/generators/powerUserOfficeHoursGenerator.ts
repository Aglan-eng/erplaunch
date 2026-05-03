/**
 * Power-User Office Hours generator (Pack X — Component 7).
 *
 * Cross-platform — emits Documentation/Hypercare/Power_User_Office_Hours.md.
 *
 * Schedule + format for the drop-in office hours during hypercare.
 * Topics derive from in-scope workstreams; cadence is 2/week early,
 * tapers to 1/week late hypercare. Includes a log template.
 */

export interface PowerUserOfficeHoursInput {
  clientName: string;
  adaptorName?: string;
  hypercareDurationDays?: number;
  /** TEXT hypercare.team.hypercareLeadName. */
  hypercareLeadName?: string | null;
  /** Optional list of workstream IDs in scope (e.g., ['R2R', 'P2P']). */
  workstreamsInScope?: ReadonlyArray<string>;
}

export interface PowerUserOfficeHoursOutput {
  markdown: string;
}

const WORKSTREAM_TOPIC_LABELS: Record<string, string> = {
  R2R: 'R2R: trial balance, period close, journal entries, multi-currency revaluation',
  P2P: 'P2P: vendor master, PO + 3-way match, payment runs, expense approval',
  O2C: 'O2C: customer master, sales orders, invoicing, cash application, dunning',
  INV: 'Inventory: item master, cycle counts, lot/serial tracking, warehouse transfers',
  MFG: 'Manufacturing: BOM, work orders, production reporting, quality checks, backflushing',
  RTN: 'Returns: RMA processing, credit memos, restocking workflow',
  CRM: 'CRM: lead-to-quote, pipeline reports, opportunity stages',
  HR: 'HR: payroll, time-off, end-of-service calculations',
  IT: 'IT admin: user provisioning, custom-script deployment, sandbox refresh',
};

export function generatePowerUserOfficeHours(
  input: PowerUserOfficeHoursInput,
): PowerUserOfficeHoursOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const durationDays =
    typeof input.hypercareDurationDays === 'number' && input.hypercareDurationDays > 0
      ? input.hypercareDurationDays
      : 30;
  const lead = input.hypercareLeadName?.trim().length
    ? input.hypercareLeadName.trim()
    : '_[ASSIGN hypercare lead]_';
  const workstreams = (input.workstreamsInScope ?? []).filter((w) => w.length > 0);

  const topicLines =
    workstreams.length === 0
      ? '- _[ASSIGN — populate workstreams in scope to auto-fill topic list]_'
      : workstreams
          .map((ws) => `- ${WORKSTREAM_TOPIC_LABELS[ws.toUpperCase()] ?? `${ws}: workstream-specific topics`}`)
          .join('\n');

  // Compute taper transition mid-window. Default 30 → taper at T+15.
  // Custom durations: taper at midpoint.
  const taperPoint = Math.max(1, Math.floor(durationDays / 2));

  const markdown = [
    `# Power-User Office Hours — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Host:** ${lead} + workstream functional lead  `,
    `**Hypercare Window:** T+1 to T+${durationDays}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Drop-in office hours during hypercare for power users + business champions to ',
    'ask questions, report issues that don\'t fit the formal defect log, and shortcut ',
    'common-pattern solutions. Sessions feed straight back into the war-room issue ',
    'log when something surfaces that needs triage.',
    '',
    '## 1. Schedule',
    '',
    `| Phase | Window | Cadence | Notes |`,
    `|-------|--------|---------|-------|`,
    `| Early hypercare | T+1 to T+${taperPoint} | **2 sessions per week minimum** | Highest demand window — power users acclimate to the new platform |`,
    `| Late hypercare | T+${taperPoint + 1} to T+${durationDays} | **1 session per week** | Demand tapers as adoption stabilises; switches to drop-in only if no agenda |`,
    '',
    '_(Schedule re-baselines if KPI dashboard shows red bands on User Adoption — extra sessions added in that case.)_',
    '',
    '## 2. Format',
    '',
    '- **Duration:** 60 minutes',
    '- **Style:** Open Q&A — no fixed agenda',
    `- **Hosts:** ${lead} (hypercare lead) + workstream functional lead (rotating per session)`,
    '- **Channel:** Standing Zoom / Teams / Google Meet bridge (link pinned in the hypercare Slack channel)',
    '- **Recording:** Always recorded; uploaded to client KB within 24h',
    '',
    '## 3. Topics',
    '',
    'Workstream-specific — covers everything in-scope for the engagement. ',
    'Topics derive from the wizard\'s flow scope.',
    '',
    topicLines,
    '',
    '## 4. Recording & Topic Log',
    '',
    'Every session produces a dated entry in `Documentation/Hypercare/Power_User_Office_Hours_Log.md`. ',
    'Template:',
    '',
    '```markdown',
    '## Session: <Date> — <Workstream / open>',
    '',
    '**Host:** <Hypercare Lead + Functional Lead name>',
    '**Attendees:** <count> (named champions: <list>)',
    '',
    '### Topics covered',
    '- <Question 1> → <answer / pointer / follow-up>',
    '- <Question 2> → ...',
    '',
    '### Defect-log entries created',
    '- <D-NNN ID> → <one-line description>',
    '',
    '### Recording link',
    '<URL>',
    '```',
    '',
    '## 5. Escalation From Office Hours',
    '',
    'Questions raised in office hours that surface real issues feed straight into the war-room ',
    'issue log per `Documentation/Hypercare/War_Room_SOP.md` — same 8-field issue card. ',
    'Hypercare lead logs the entry within 1 business hour of session end so nothing falls through.',
    '',
    'Questions that surface a TRAINING gap (vs an actual defect) feed back into ',
    '`Documentation/Training/<Role>_Training_Guide.md` updates for the next engagement.',
    '',
    '## 6. Cross-References',
    '',
    '- Hypercare plan: `Documentation/Hypercare/Hypercare_Plan.md`',
    '- War-room SOP: `Documentation/Hypercare/War_Room_SOP.md`',
    '- Daily readiness checklist: `Documentation/Hypercare/Daily_Readiness_Checklist.md`',
    '- KPI dashboard: `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`',
    '- Per-role training guides (Pack U): `Documentation/Training/<Role>_Training_Guide.md`',
    '- Defect log: `Documentation/Defect_Log_Template.md`',
    '',
    '_Generated by ERPLaunch — Pack X (Hypercare Program)._',
    '',
  ].join('\n');

  return { markdown };
}
