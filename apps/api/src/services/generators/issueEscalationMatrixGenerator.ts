/**
 * Issue Escalation Matrix generator (Pack X — Component 3).
 *
 * Cross-platform — emits Documentation/Hypercare/Issue_Escalation_Matrix.md.
 *
 * The L4 vendor row is ADAPTOR-CONDITIONAL: NetSuite engagements get
 * "NetSuite Customer Care" instructions; Odoo engagements get "OdooSH
 * Support" instructions. This is the canonical pattern from Pack T's
 * performanceTestPlanGenerator (tooling per platform) and Pack U's
 * QRC menu paths.
 *
 * Sources:
 *   - ITIL incident-management 4-tier escalation pattern.
 *   - SuiteCloud Customer Support escalation procedure.
 *   - OdooSH support ticket protocol.
 */

import {
  parseSeverity,
  parseSla,
  DEFAULT_SEVERITY_ROWS,
  DEFAULT_SLA_ROWS,
  type ParsedSeverityRow,
  type ParsedSlaRow,
} from './hypercareHelpers.js';

export interface IssueEscalationMatrixInput {
  clientName: string;
  /** "NetSuite" / "Odoo" — drives the L4 vendor row content. */
  adaptorName?: string;
  /** TEXT hypercare.team.hypercareLeadName — drives L3 escalation. */
  hypercareLeadName?: string | null;
  /** TEXTAREA hypercare.sla.severityDefinitions. */
  severityDefinitions?: string | null;
  /** TEXTAREA hypercare.sla.responseTimeBySeverity. */
  responseTimeBySeverity?: string | null;
}

export interface IssueEscalationMatrixOutput {
  markdown: string;
}

interface VendorChannel {
  vendorName: string;
  ticketUrl: string;
  /** Verbatim instructions for opening a support case — must include
   *  what to attach to the case. */
  caseInstructions: string;
}

function vendorChannelFor(adaptorName: string): VendorChannel {
  const lower = adaptorName.toLowerCase();
  if (lower === 'netsuite') {
    return {
      vendorName: 'NetSuite Customer Care',
      ticketUrl: 'https://system.netsuite.com',
      caseInstructions:
        'Open NetSuite Customer Care case at https://system.netsuite.com — include account ID, environment (production / sandbox), transaction internal IDs, exact reproduction steps, and SuiteScript / WFA log excerpts if relevant. Attach screen recordings for UI defects.',
    };
  }
  if (lower === 'odoo') {
    return {
      vendorName: 'OdooSH Support',
      ticketUrl: 'https://www.odoo.sh',
      caseInstructions:
        'Open Odoo Support ticket via the OdooSH dashboard — include database name, module(s) involved, traceback if available, exact reproduction steps, and any relevant model.field references. Attach screen recordings for UI defects.',
    };
  }
  return {
    vendorName: '_[ASSIGN platform vendor support channel]_',
    ticketUrl: '_[ASSIGN]_',
    caseInstructions:
      '_[ASSIGN platform-specific case-opening instructions — populate adaptorName for auto-fill]_',
  };
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

export function generateIssueEscalationMatrix(
  input: IssueEscalationMatrixInput,
): IssueEscalationMatrixOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const vendor = vendorChannelFor(platform);

  const declaredSeverity = parseSeverity((input.severityDefinitions ?? '').toString());
  const severity = declaredSeverity.length > 0 ? declaredSeverity : DEFAULT_SEVERITY_ROWS;
  const declaredSla = parseSla((input.responseTimeBySeverity ?? '').toString());
  const sla = declaredSla.length > 0 ? declaredSla : DEFAULT_SLA_ROWS;

  const lead = input.hypercareLeadName?.trim().length
    ? input.hypercareLeadName.trim()
    : '_[ASSIGN hypercare lead]_';

  const markdown = [
    `# Issue Escalation Matrix — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Hypercare Lead (L3):** ${lead}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Defines the response SLA, resolution target, and escalation tier for every issue ',
    'logged during hypercare. The 4-tier model (L1 → L4) routes issues from power-user / ',
    'hypercare-team triage all the way through to vendor support when platform-level ',
    'remediation is required.',
    '',
    '## 1. Severity Definitions',
    '',
    '| Severity | Description | Example |',
    '|----------|-------------|---------|',
    severityTable(severity),
    '',
    '## 2. Response & Resolution SLAs',
    '',
    '| Severity | Response SLA | Resolution Target |',
    '|----------|--------------|-------------------|',
    slaTable(sla),
    '',
    '## 3. Escalation Tiers',
    '',
    '| Tier | Owner | Scope |',
    '|------|-------|-------|',
    '| **L1** | Power user / hypercare team member | Triage, reproduce, log in defect register, attempt workaround |',
    '| **L2** | Functional lead (workstream-specific) | Diagnose root cause, design fix, write/test workaround if no immediate fix |',
    `| **L3** | Consultant lead — ${lead} | Hot-fix authorisation, decision to escalate to vendor, RCA approval |`,
    `| **L4** | Vendor: ${vendor.vendorName} | Platform-level defect, performance issue beyond config control, undocumented behaviour |`,
    '',
    '## 4. Escalation Triggers',
    '',
    'Auto-escalate to the next tier when ANY of the following fires:',
    '',
    '- Response SLA breached (per section 2)',
    '- Resolution target missed without documented mitigation',
    '- Issue impact widens (more users / more workstreams affected after initial logging)',
    '- Workaround exhausted (every attempted workaround failed or not applicable)',
    '- Vendor-level defect suspected (L3 → L4 only)',
    '',
    '## 5. Communications by Severity',
    '',
    '| Severity | Notify on Open | Notify on Update | Notify on Close |',
    '|----------|----------------|------------------|------------------|',
    `| **S1** | Hypercare team + Sponsor + Steering | Every 30 min until resolved | Sponsor + Steering + impacted users |`,
    `| **S2** | Hypercare team + impacted workstream lead | Every 4 business hours | Impacted workstream + Sponsor end-of-day |`,
    `| **S3** | Hypercare team + impacted user | At resolution | Impacted user |`,
    `| **S4** | Defect log entry only | Weekly review | Closed at sprint / quarterly review |`,
    '',
    `## 6. ${vendor.vendorName} (L4 Vendor Channel)`,
    '',
    `**Channel:** ${vendor.vendorName} — ${vendor.ticketUrl}`,
    '',
    `**How to open a case:** ${vendor.caseInstructions}`,
    '',
    'Track every L4 case ID in the defect-log entry it relates to. ',
    'A vendor-side fix often returns to L3 for retest before L1 closes the ticket.',
    '',
    '## 7. Cross-References',
    '',
    '- Hypercare plan: `Documentation/Hypercare/Hypercare_Plan.md`',
    '- Daily readiness checklist: `Documentation/Hypercare/Daily_Readiness_Checklist.md`',
    '- War-room SOP: `Documentation/Hypercare/War_Room_SOP.md`',
    '- Defect log: `Documentation/Defect_Log_Template.md`',
    '- Pack T defect severity scheme: `Documentation/Defect_Log_Template.md`',
    '',
    '_Generated by ERPLaunch — Pack X (Hypercare Program)._',
    '',
  ].join('\n');

  return { markdown };
}
