/**
 * Daily Readiness Checklist generator (Pack X — Component 2).
 *
 * Cross-platform — emits Documentation/Hypercare/Daily_Readiness_Checklist.md.
 *
 * Morning checklist for the hypercare lead to run every business day
 * T+1 → T+hypercareDurationDays. Output is a markdown table with
 * checkboxes that copies cleanly into Confluence/Notion.
 */

export interface DailyReadinessChecklistInput {
  clientName: string;
  adaptorName?: string;
  hypercareDurationDays?: number;
  /** Optional list of integration names — drives the integration-status row. */
  integrationsList?: string | null;
  /** Optional fragile dates list — '<Day-N>: <reason>' lines for known
   *  high-risk dates (period-end, payroll, first month-close). */
  fragileDates?: ReadonlyArray<{ dayN: string; reason: string }>;
}

export interface DailyReadinessChecklistOutput {
  markdown: string;
}

function parseIntegrations(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // Pull the first segment up to '|' or ':' — that's the integration name.
    const m = trimmed.match(/^([^|:]+)/);
    out.push((m ? m[1] : trimmed).trim());
  }
  return out;
}

export function generateDailyReadinessChecklist(
  input: DailyReadinessChecklistInput,
): DailyReadinessChecklistOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const durationDays =
    typeof input.hypercareDurationDays === 'number' && input.hypercareDurationDays > 0
      ? input.hypercareDurationDays
      : 30;
  const integrations = parseIntegrations((input.integrationsList ?? '').toString());

  const integrationRows =
    integrations.length === 0
      ? '| _[ASSIGN integration name]_ | ⏳ | ⏳ | ⏳ | _______ |'
      : integrations
          .map(
            (name) =>
              `| ${name} | ⏳ | ⏳ | ⏳ | _______ |`,
          )
          .join('\n');

  const fragileDateRows =
    (input.fragileDates ?? []).length === 0
      ? '| _[ASSIGN fragile date]_ | _[ASSIGN]_ | ⏳ |'
      : (input.fragileDates ?? [])
          .map((f) => `| ${f.dayN} | ${f.reason} | ⏳ |`)
          .join('\n');

  const markdown = [
    `# Daily Readiness Checklist — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Hypercare Window:** T+1 → T+${durationDays}  `,
    `**Owner:** Hypercare Lead (see \`Documentation/Hypercare/Hypercare_Plan.md\`)  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Morning checklist run by the hypercare lead every business day during the ',
    `${durationDays}-day hypercare window. Copy this template into Confluence or Notion ` +
      'each morning, fill in the day-specific values, then attach to the daily standup notes.',
    '',
    '## 1. Overnight Job Status',
    '',
    'Confirm every scheduled / batch process completed cleanly overnight.',
    '',
    '- [ ] Period-end batch jobs (when in window): ran + completed + no errors',
    '- [ ] Scheduled SuiteScript / cron jobs: success rate ≥ 95% per the audit log',
    '- [ ] Integration scheduled syncs: all green per next section',
    '- [ ] Custom workflow scheduled actions: no stuck instances',
    '',
    '## 2. Open Issues by Severity',
    '',
    '| Severity | Open count | Day-over-day delta | Owner + ETA for each |',
    '|----------|-----------:|-------------------:|----------------------|',
    '| S1 | 0 | — | _(none)_ |',
    '| S2 | 0 | — | _(none)_ |',
    '| S3 | 0 | — | _(none)_ |',
    '| S4 | 0 | — | _(none)_ |',
    '',
    '_Replace placeholder zero / dash values with actuals from `Documentation/Defect_Log_Template.md`._',
    '_S1 + S2 must show owner + ETA on every row — no blank ETA cells allowed._',
    '',
    '## 3. KPIs vs Bands',
    '',
    'Compare today\'s KPIs to green/yellow/red bands defined in `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`. ',
    'Anything red surfaces in the standup.',
    '',
    '- [ ] User adoption (logins, transactions posted) — green band',
    '- [ ] Integration health (success rate, retry depth) — green band',
    '- [ ] Open issues by severity — green band',
    '- [ ] Mean time to acknowledge / resolve — green band',
    '- [ ] Business KPIs (per Solution Doc) — green band',
    '',
    '## 4. Integration Health',
    '',
    '| Integration | Last successful sync | Retry queue depth | Today status | Notes |',
    '|-------------|----------------------|-------------------:|--------------|-------|',
    integrationRows,
    '',
    '## 5. User Feedback Channel Scan',
    '',
    '- [ ] Teams / Slack hypercare channel: scanned + triaged any new posts',
    '- [ ] Email box (hypercare@<client domain>): scanned + triaged',
    '- [ ] Power-user office-hours queue: any escalations from yesterday\'s session captured in defect log',
    '- [ ] Sponsor / steering ad-hoc questions: addressed or queued for end-of-week',
    '',
    '## 6. Capacity Check',
    '',
    '- [ ] All hypercare team members on roster present (no unexpected OOO)',
    '- [ ] Any hypercare team member on planned leave today: backup confirmed and active',
    '- [ ] Power users available for ad-hoc validation requests',
    '',
    '## 7. Standup Agenda Prep',
    '',
    '- [ ] Yesterday\'s resolved issues: 1-line summary per S1/S2',
    '- [ ] Today\'s blockers: identified + owner assigned',
    '- [ ] Walk through every open S1 + S2',
    '- [ ] KPI scan: highlight any red bands',
    '- [ ] Cross-team dependencies: anything client-side blocking us, or vice versa',
    '',
    '## 8. Day-N Specific Watch Items',
    '',
    'Known fragile dates that require extra attention. These come from engagement-specific risk: period-end, payroll runs, first month-close, etc.',
    '',
    '| Day-N | Reason | Status |',
    '|-------|--------|--------|',
    fragileDateRows,
    '',
    '## 9. End-of-Day Wrap',
    '',
    '- [ ] Defect log updated with everything triaged / opened / closed today',
    '- [ ] KPI dashboard refreshed for end-of-day sponsor email',
    '- [ ] Tomorrow\'s standup agenda staged in shared doc',
    '- [ ] Backup hypercare lead briefed (if primary is OOO tomorrow)',
    '',
    '## Cross-References',
    '',
    '- Hypercare plan: `Documentation/Hypercare/Hypercare_Plan.md`',
    '- KPI dashboard: `Documentation/Hypercare/Hypercare_KPI_Dashboard.md`',
    '- Issue escalation matrix: `Documentation/Hypercare/Issue_Escalation_Matrix.md`',
    '- Defect log: `Documentation/Defect_Log_Template.md`',
    '',
    '_Generated by ERPLaunch — Pack X (Hypercare Program)._',
    '',
  ].join('\n');

  return { markdown };
}
