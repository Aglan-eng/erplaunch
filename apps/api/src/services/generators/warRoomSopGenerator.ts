/**
 * War-Room SOP generator (Pack X — Component 4).
 *
 * Cross-platform — emits Documentation/Hypercare/War_Room_SOP.md.
 *
 * Defines the war-room operating procedure: hours/setup/standup format
 * /issue-logging template/RCA template/decision-rights matrix.
 */

export interface WarRoomSopInput {
  clientName: string;
  adaptorName?: string;
  hypercareDurationDays?: number;
  /** TEXT hypercare.cadence.warRoomHours. */
  warRoomHours?: string | null;
  /** TEXT hypercare.team.hypercareLeadName. */
  hypercareLeadName?: string | null;
  /** TEXT hypercare.cadence.dailyStandupTime. */
  dailyStandupTime?: string | null;
}

export interface WarRoomSopOutput {
  markdown: string;
}

export function generateWarRoomSop(input: WarRoomSopInput): WarRoomSopOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const lead = input.hypercareLeadName?.trim().length
    ? input.hypercareLeadName.trim()
    : '_[ASSIGN hypercare lead]_';
  const standupTime = input.dailyStandupTime?.trim().length
    ? input.dailyStandupTime.trim()
    : '_[ASSIGN daily standup time]_';
  const warRoomSchedule = input.warRoomHours?.trim().length
    ? input.warRoomHours.trim()
    : '_[ASSIGN war-room schedule — populate `hypercare.cadence.warRoomHours` in the wizard]_';
  const slug = input.clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const markdown = [
    `# War-Room Standard Operating Procedure — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**War-Room Lead:** ${lead}  `,
    `**Daily Standup:** ${standupTime}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Defines how the hypercare war-room operates: when it convenes, what gets ',
    'discussed, who decides what, and how every issue is logged. The SOP applies for ',
    `the full hypercare window (${input.hypercareDurationDays ?? 30} days) with the tapering schedule below.`,
    '',
    '## 1. War-Room Dates & Hours',
    '',
    warRoomSchedule,
    '',
    '## 2. Physical / Virtual Setup',
    '',
    `- **Teams / Slack channel:** \`#hypercare-${slug}\` (or engagement equivalent)`,
    '- **Standing meeting bridge:** Zoom / Teams / Google Meet (provisioned T-1 days, link pinned in channel)',
    '- **Shared issue log:** `Documentation/Defect_Log_Template.md` (live-edited via shared spreadsheet during war-room hours; reconciled into the canonical defect register at end-of-day)',
    '- **Status board:** Confluence / Notion / SharePoint page — daily status posted by hypercare lead',
    '',
    '## 3. Daily Standup Structure (15 minutes)',
    '',
    `Held at **${standupTime}** every business day.`,
    '',
    'Strict 15-minute format — anything that runs longer gets parked and follow-up scheduled.',
    '',
    '1. **Yesterday\'s resolved (3 min):** quick walk through every S1/S2 closed since last standup.',
    '2. **Today\'s blockers (3 min):** anything blocking the team — internal or client-side.',
    '3. **S1-S2 walk (5 min):** every open S1 and S2 — owner gives 30-second update, ETA confirmed or revised.',
    '4. **KPI scan (3 min):** any red bands on the KPI dashboard surfaced for follow-up.',
    '5. **Cross-team dependencies (1 min):** anything client-side blocking us, or anything we\'re blocking on client side.',
    '',
    '## 4. Issue Logging Template',
    '',
    'Every reported issue gets logged within 30 minutes of receipt using this 8-field card:',
    '',
    '| Field | Description |',
    '|-------|-------------|',
    '| **ID** | `D-NNN` per `Documentation/Defect_Log_Template.md` numbering |',
    '| **Severity** | S1 / S2 / S3 / S4 per `Documentation/Hypercare/Issue_Escalation_Matrix.md` |',
    '| **Raiser** | Person / role who reported it |',
    '| **Area** | Workstream / module / integration |',
    '| **Description** | One-line summary + repro steps if known |',
    '| **Owner** | Hypercare team member assigned |',
    '| **ETA** | Resolution target (mandatory for S1 / S2) |',
    '| **Status** | OPEN / IN_PROGRESS / RESOLVED / DEFERRED |',
    '',
    '## 5. Root Cause Analysis (RCA) Template',
    '',
    'RCA is mandatory for any issue that is:',
    '- S1 or S2',
    '- Marked "fixed but recurring" within 5 business days',
    '- Took longer than the resolution-target SLA',
    '',
    '5-Whys structure:',
    '',
    '1. **What happened** — symptom in plain English',
    '2. **Why did it happen?** — direct cause',
    '3. **Why did THAT happen?** — secondary cause',
    '4. **Why did THAT happen?** — tertiary cause',
    '5. **Why did THAT happen?** — root cause',
    '6. **Final why** — what allowed the root cause to exist',
    '',
    'RCA output appended to the defect log entry. Closure requires the RCA + ',
    'remediation plan + verification step.',
    '',
    '## 6. Decision-Rights Matrix',
    '',
    '| Decision | Authority |',
    '|----------|-----------|',
    `| Approve hot-fix deploy (config or script) | ${lead} (Hypercare Lead) |`,
    `| Approve workaround as interim resolution | ${lead} + Functional Lead (joint) |`,
    `| Declare an issue "known issue, deferred to backlog" | ${lead} + Sponsor (joint) |`,
    `| Escalate to vendor (L4 in escalation matrix) | ${lead} |`,
    `| Roll back a deployed change | ${lead} + Sponsor (joint, in writing) |`,
    `| Adjust SLA or response window | Sponsor only |`,
    '',
    '## 7. Cross-References',
    '',
    '- Hypercare plan: `Documentation/Hypercare/Hypercare_Plan.md`',
    '- Daily readiness checklist: `Documentation/Hypercare/Daily_Readiness_Checklist.md`',
    '- Issue escalation matrix: `Documentation/Hypercare/Issue_Escalation_Matrix.md`',
    '- KPI dashboard: `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`',
    '- Defect log: `Documentation/Defect_Log_Template.md`',
    '',
    '_Generated by ERPLaunch — Pack X (Hypercare Program)._',
    '',
  ].join('\n');

  return { markdown };
}
