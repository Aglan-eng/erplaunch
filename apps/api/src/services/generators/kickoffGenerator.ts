import MarkdownIt from 'markdown-it';
import type { AdaptorContext } from './brdGenerator.js';

/**
 * Project Kickoff generator — produces the consolidated Project_Kickoff
 * document (markdown + HTML) with 6 subsections:
 *   1. Project Charter
 *   2. Stakeholder Map
 *   3. RACI Matrix
 *   4. Governance Plan
 *   5. Communication Plan
 *   6. Suggested Kickoff Meeting Agenda
 *
 * Universal: runs for both NetSuite and Odoo engagements (and any custom
 * adaptor). Prose is adaptor-aware via AdaptorContext, same way BRD /
 * Solution Design / Implementation Plan flex per adaptor.
 *
 * Banlist contract:
 *   - NetSuite kickoff MUST NOT contain "Odoo", "Community", "Enterprise (Odoo)"
 *   - Odoo kickoff MUST NOT contain "NetSuite", "SuiteScript", "SDF",
 *     "OneWorld", "subsidiary"
 * Tests in kickoffGenerator.test.ts pin both directions.
 */

export interface KickoffMember {
  /** Engagement member from db.getMembers — name + role + side. */
  name: string;
  role: string;
  /** 'CLIENT' or 'CONSULTANT'. Drives RACI auto-fill. */
  team: string;
  email?: string | null;
  phone?: string | null;
}

export interface KickoffData {
  clientName: string;
  /** Adaptor context — required so prose flexes per platform. Build via
   *  services/generation.ts buildAdaptorContext(adaptorId). */
  adaptor: AdaptorContext;
  /** Wizard answers (kickoff.* keys). Same shape services/generation.ts
   *  passes to every generator. */
  answers: Record<string, unknown>;
  /** Engagement project members for Stakeholder Map + RACI auto-fill.
   *  When empty, the document renders templates with explicit
   *  "[ASSIGN — name]" placeholders so the consultant can see the
   *  structure and fill in offline. */
  members?: ReadonlyArray<KickoffMember>;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const PLACEHOLDER = '_[ASSIGN]_';

function val(answers: Record<string, unknown>, key: string, fallback = PLACEHOLDER): string {
  const v = answers[key];
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** Looks up a SINGLE_SELECT label from the kickoff schema if available;
 *  falls back to the raw value. Hardcoded here because the kickoff
 *  flow is universal — same options in both adaptors. */
function selectLabel(rawValue: string | undefined, options: ReadonlyArray<{ value: string; label: string }>): string {
  if (!rawValue) return PLACEHOLDER;
  const match = options.find((o) => o.value === rawValue);
  return match ? match.label : rawValue;
}

const STEERING_CADENCE = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Bi-weekly (typical for mid-market implementations)' },
  { value: 'MONTHLY', label: 'Monthly (typical for small / phased)' },
  { value: 'AD_HOC', label: 'Ad-hoc (high risk — recommend converting to scheduled cadence)' },
];

const WORKING_GROUP_CADENCE = [
  { value: 'DAILY', label: 'Daily standup' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Bi-weekly' },
];

const STATUS_CADENCE = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Bi-weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
];

const ISSUE_CHANNEL = [
  { value: 'EMAIL', label: 'Email to PM' },
  { value: 'SHARED_DOC', label: 'Shared issue log (Google Sheet / Notion / Jira)' },
  { value: 'WORKING_GROUP', label: 'Surface at working-group meeting' },
  { value: 'MIXED', label: 'Mixed — different channels per severity' },
];

/** Find the first member matching a side + role-substring. Used for
 *  RACI auto-fill — e.g. find the consultant PM for "Responsible". */
function findMember(
  members: ReadonlyArray<KickoffMember>,
  side: 'CLIENT' | 'CONSULTANT',
  rolePattern: RegExp,
): KickoffMember | undefined {
  return members.find((m) => m.team === side && rolePattern.test(m.role));
}

function memberLabel(m: KickoffMember | undefined, fallback: string): string {
  if (!m) return `_${fallback}_`;
  return `${m.name} (${m.role})`;
}

// ─── Core kickoff generation ─────────────────────────────────────────────────

export function generateKickoff(data: KickoffData): string {
  const { clientName, adaptor, answers } = data;
  const members = data.members ?? [];
  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // RACI auto-fill: best-effort match against role labels. Falls back to
  // explicit placeholders when the engagement doesn't have a member with
  // a recognizable role yet.
  const consultantPM = findMember(members, 'CONSULTANT', /pm|project manager|lead/i);
  const clientPM = findMember(members, 'CLIENT', /pm|project manager|lead/i);
  const sponsor = findMember(members, 'CLIENT', /sponsor|cfo|coo|cio|director|executive/i);

  let md = '';

  // ── Cover ──
  md += `# Project Kickoff\n\n`;
  md += `| | |\n`;
  md += `|---|---|\n`;
  md += `| **Client** | ${clientName} |\n`;
  md += `| **Project** | ${adaptor.name} implementation |\n`;
  md += `| **Date** | ${now} |\n`;
  md += `| **Status** | Draft for kickoff meeting |\n`;
  md += `| **Prepared by** | ERPLaunch |\n`;
  md += `\n---\n\n`;

  // ── 1. Project Charter ──
  md += `## 1. Project Charter\n\n`;
  md += `This charter frames the ${adaptor.name} implementation at **${clientName}** before Discovery starts. `;
  md += `It captures the mandate, success criteria, target go-live, and the named accountable executive. `;
  md += `Sign-off on this section establishes the baseline against which all subsequent scope changes will be measured.\n\n`;

  md += `**Project sponsor**\n${val(answers, 'kickoff.mandate.sponsor')}\n\n`;
  md += `**Business case**\n${val(answers, 'kickoff.mandate.businessCase')}\n\n`;
  md += `**Top 3 measurable success criteria**\n`;
  const successRaw = answers['kickoff.mandate.successCriteria'];
  if (typeof successRaw === 'string' && successRaw.trim()) {
    successRaw.split('\n').filter((l) => l.trim()).forEach((line) => {
      md += `- ${line.trim()}\n`;
    });
  } else {
    md += `- ${PLACEHOLDER}\n`;
  }
  md += `\n`;
  md += `**Target go-live date**\n${val(answers, 'kickoff.mandate.targetGoLiveDate')}\n\n`;
  md += `**Platform & edition**\n${adaptor.editionLabel}\n\n`;

  // ── 2. Stakeholder Map ──
  md += `## 2. Stakeholder Map\n\n`;
  md += `_Everyone with a stake in the outcome — both the engagement-team list and the wider audience captured under stakeholder notes._\n\n`;

  md += `| Name | Role | Side | Comms preference |\n`;
  md += `|---|---|---|---|\n`;
  if (members.length === 0) {
    md += `| _[ASSIGN — sponsor]_ | Project Sponsor | Client | _[ASSIGN]_ |\n`;
    md += `| _[ASSIGN — client PM]_ | Client Project Manager | Client | _[ASSIGN]_ |\n`;
    md += `| _[ASSIGN — consultant PM]_ | Consultant Project Manager | Consultant | _[ASSIGN]_ |\n`;
  } else {
    for (const m of members) {
      const side = m.team === 'CLIENT' ? 'Client' : m.team === 'CONSULTANT' ? 'Consultant' : m.team;
      const comms = m.email ? `Email: ${m.email}` : '_[ASSIGN]_';
      md += `| ${m.name} | ${m.role} | ${side} | ${comms} |\n`;
    }
  }
  md += `\n`;

  const stakeholderNotes = val(answers, 'kickoff.communication.stakeholderNotes', '');
  if (stakeholderNotes && stakeholderNotes !== PLACEHOLDER) {
    md += `**Additional stakeholders (visibility-only, not on the engagement team):**\n\n`;
    stakeholderNotes.split('\n').filter((l) => l.trim()).forEach((line) => {
      md += `- ${line.trim()}\n`;
    });
    md += `\n`;
  }

  // ── 3. RACI Matrix ──
  md += `## 3. RACI Matrix\n\n`;
  md += `_R = Responsible (does the work) · A = Accountable (single owner; signs off) · C = Consulted (input before) · I = Informed (notified after)._\n\n`;
  md += `_Activities below are the standard ${adaptor.name} implementation lifecycle. Refine per engagement during the kickoff meeting._\n\n`;

  const consultantPMLabel = memberLabel(consultantPM, 'ASSIGN — consultant PM');
  const clientPMLabel = memberLabel(clientPM, 'ASSIGN — client PM');
  const sponsorLabel = memberLabel(sponsor, 'ASSIGN — sponsor');

  md += `| Activity | Responsible | Accountable | Consulted | Informed |\n`;
  md += `|---|---|---|---|---|\n`;
  md += `| Discovery interviews | ${consultantPMLabel} | ${clientPMLabel} | Workstream leads | ${sponsorLabel} |\n`;
  md += `| Solution design | ${consultantPMLabel} | ${clientPMLabel} | Workstream leads | ${sponsorLabel} |\n`;
  md += `| Configuration build | ${consultantPMLabel} | ${clientPMLabel} | Workstream leads | ${sponsorLabel} |\n`;
  md += `| Data migration | ${consultantPMLabel} | ${clientPMLabel} | Workstream leads + IT | ${sponsorLabel} |\n`;
  md += `| User Acceptance Testing | ${clientPMLabel} | ${clientPMLabel} | ${consultantPMLabel} + workstream leads | ${sponsorLabel} |\n`;
  md += `| Training | ${consultantPMLabel} | ${clientPMLabel} | End-user representatives | ${sponsorLabel} |\n`;
  md += `| Cutover | ${consultantPMLabel} | ${sponsorLabel} | ${clientPMLabel} + workstream leads + IT | All stakeholders |\n`;
  md += `| Hypercare | ${consultantPMLabel} | ${clientPMLabel} | Workstream leads | ${sponsorLabel} |\n`;
  md += `\n`;

  // ── 4. Governance Plan ──
  md += `## 4. Governance Plan\n\n`;

  const steeringCadence = selectLabel(answers['kickoff.governance.steeringCadence'] as string | undefined, STEERING_CADENCE);
  const workingCadence = selectLabel(answers['kickoff.governance.workingGroupCadence'] as string | undefined, WORKING_GROUP_CADENCE);

  md += `**Steering committee**\n`;
  md += `- Cadence: ${steeringCadence}\n`;
  md += `- Participants: project sponsor, client PM, consultant PM\n`;
  md += `- Purpose: scope decisions, budget approvals, escalations from working group\n\n`;

  md += `**Working group**\n`;
  md += `- Cadence: ${workingCadence}\n`;
  md += `- Participants: client PM, consultant PM, workstream leads\n`;
  md += `- Purpose: day-to-day project execution, blocker triage, status sync\n\n`;

  md += `**Decision authority thresholds**\n`;
  const decisionRaw = answers['kickoff.governance.decisionThresholds'];
  if (typeof decisionRaw === 'string' && decisionRaw.trim()) {
    decisionRaw.split('\n').filter((l) => l.trim()).forEach((line) => {
      md += `- ${line.trim()}\n`;
    });
  } else {
    md += `- ${PLACEHOLDER}\n`;
  }
  md += `\n`;

  md += `**Escalation path**\n${val(answers, 'kickoff.governance.escalationPath')}\n\n`;

  // ── 5. Communication Plan ──
  md += `## 5. Communication Plan\n\n`;

  const statusCadence = selectLabel(answers['kickoff.communication.statusReportCadence'] as string | undefined, STATUS_CADENCE);
  const issueChannel = selectLabel(answers['kickoff.communication.issueReportingChannel'] as string | undefined, ISSUE_CHANNEL);

  md += `**Status reports**\n`;
  md += `- Cadence: ${statusCadence}\n`;
  md += `- Audience:\n`;
  const audienceRaw = answers['kickoff.communication.statusReportAudience'];
  if (typeof audienceRaw === 'string' && audienceRaw.trim()) {
    audienceRaw.split('\n').filter((l) => l.trim()).forEach((line) => {
      md += `  - ${line.trim()}\n`;
    });
  } else {
    md += `  - ${PLACEHOLDER}\n`;
  }
  md += `\n`;

  md += `**Issue & risk reporting**\n`;
  md += `- Primary channel: ${issueChannel}\n`;
  md += `- Severity convention: BLOCK conflicts surface in status reports immediately; WARN conflicts are reviewed at working group; INFO logged for sprint retrospective.\n\n`;

  // ── 6. Suggested Kickoff Meeting Agenda ──
  md += `## 6. Suggested Kickoff Meeting Agenda (90 minutes)\n\n`;
  md += `| Time | Topic | Owner |\n`;
  md += `|---|---|---|\n`;
  md += `| 0:00–0:10 | Welcome + introductions | All attendees |\n`;
  md += `| 0:10–0:20 | Project context + business case | ${sponsorLabel} |\n`;
  md += `| 0:20–0:35 | Scope walkthrough (slides referencing the BRD) | ${consultantPMLabel} |\n`;
  md += `| 0:35–0:50 | Team + roles (RACI walkthrough — section 3 above) | ${consultantPMLabel} + ${clientPMLabel} |\n`;
  md += `| 0:50–1:05 | Timeline overview (phases + target go-live) | ${consultantPMLabel} |\n`;
  md += `| 1:05–1:20 | Governance + communication (cadence, escalation, status reports) | ${clientPMLabel} |\n`;
  md += `| 1:20–1:30 | Open Q&A + next steps | All attendees |\n`;
  md += `\n`;

  // ── Sign-off ──
  md += `## Sign-off\n\n`;
  md += `By signing below, the named individuals confirm the project mandate, governance, and communication plan captured above.\n\n`;
  md += `| Role | Name | Signature | Date |\n`;
  md += `|---|---|---|---|\n`;
  md += `| Project Sponsor (Client) | ${sponsor?.name ?? PLACEHOLDER} | | |\n`;
  md += `| Client Project Manager | ${clientPM?.name ?? PLACEHOLDER} | | |\n`;
  md += `| Consultant Project Manager | ${consultantPM?.name ?? PLACEHOLDER} | | |\n`;
  md += `\n`;

  // ── Disclaimer ──
  md += `---\n\n`;
  md += `_This document was automatically generated by ERPLaunch from the project-kickoff wizard answers. `;
  md += `It is intended as the foundation for the kickoff meeting and should be validated by a certified ${adaptor.consultantQualifier} consultant before sign-off._\n`;

  return md;
}

// ─── HTML wrapper ────────────────────────────────────────────────────────────

const mdRenderer = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

export function generateKickoffHtml(data: KickoffData): string {
  const markdown = generateKickoff(data);
  const content = mdRenderer.render(markdown);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Project Kickoff — ${data.clientName}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.75;
      color: #1e293b;
      max-width: 920px;
      margin: 0 auto;
      padding: 48px 32px 80px;
      background: #ffffff;
    }

    h1 {
      font-size: 28px;
      font-weight: 800;
      color: #0f172a;
      border-bottom: 3px solid #0ea5e9;
      padding-bottom: 12px;
      margin-bottom: 24px;
      letter-spacing: -0.4px;
    }

    h2 {
      font-size: 19px;
      font-weight: 700;
      color: #0c4a6e;
      margin-top: 48px;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e0f2fe;
    }

    h3 {
      font-size: 15px;
      font-weight: 700;
      color: #075985;
      margin-top: 28px;
      margin-bottom: 8px;
    }

    p { margin: 8px 0 12px; }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0 28px;
      font-size: 13px;
    }
    th, td {
      border: 1px solid #e2e8f0;
      padding: 8px 12px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f0f9ff;
      font-weight: 600;
      color: #0c4a6e;
    }
    tr:nth-child(even) td { background: #f8fafc; }

    ul, ol { padding-left: 24px; margin: 8px 0 16px; }
    li { margin: 4px 0; }

    code {
      background: #f1f5f9;
      padding: 1px 6px;
      border-radius: 3px;
      font-family: 'Menlo', 'Consolas', monospace;
      font-size: 12px;
    }

    em { color: #64748b; font-style: italic; }
    strong { color: #0f172a; }

    hr { border: none; border-top: 1px solid #e2e8f0; margin: 36px 0; }

    .footer {
      margin-top: 48px;
      padding-top: 18px;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #64748b;
      text-align: center;
    }
  </style>
</head>
<body>
${content}
<div class="footer">Generated by ERPLaunch · Project Kickoff for ${data.clientName} (${data.adaptor.name})</div>
</body>
</html>`;
}
