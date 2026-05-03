/**
 * Cutover Communication Plan generator (Pack V — Component 6).
 *
 * Cross-platform — emits Documentation/Cutover/Communication_Plan.md.
 *
 * Renders pre-cutover / during-cutover / post-cutover comms cascade,
 * escalation contacts, and pre-drafted message templates the consultant
 * customises before send.
 *
 * Sources:
 *   - PMI / PMBOK communication management (stakeholder cascade).
 *   - Standard ERP go-live comms patterns (SuiteSuccess, SAP Activate).
 */

export interface CutoverCommPlanGeneratorInput {
  clientName: string;
  adaptorName?: string;
  /** TEXTAREA cutover.communication.cutoverMilestones. */
  cutoverMilestones?: string | null;
  /** TEXTAREA cutover.communication.escalationContacts. */
  escalationContacts?: string | null;
  /** TEXTAREA cutover.team.cutoverTeamRoster — used for Owner column resolution. */
  cutoverTeamRoster?: string | null;
  /** TEXT kickoff.mandate.targetGoLiveDate. */
  targetGoLiveDate?: string | null;
  /** NUMBER cutoverWindowHours (from Migration flow). */
  cutoverWindowHours?: number;
}

export interface CutoverCommPlanGeneratorOutput {
  markdown: string;
}

interface ParsedMilestone {
  milestone: string;
  recipients: string;
}

interface ParsedEscalation {
  contact: string;
  whenToCall: string;
}

interface ParsedRoster {
  name: string;
  role: string;
}

const MILESTONE_LINE = /^([^:]+):\s*(.+)$/;

function parseMilestones(raw: string): ParsedMilestone[] {
  const out: ParsedMilestone[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(MILESTONE_LINE);
    if (!m) continue;
    out.push({ milestone: m[1].trim(), recipients: m[2].trim() });
  }
  return out;
}

function parseEscalations(raw: string): ParsedEscalation[] {
  const out: ParsedEscalation[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(MILESTONE_LINE);
    if (!m) continue;
    out.push({ contact: m[1].trim(), whenToCall: m[2].trim() });
  }
  return out;
}

function parseRoster(raw: string): ParsedRoster[] {
  const out: ParsedRoster[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const firstColon = trimmed.indexOf(':');
    if (firstColon < 0) continue;
    const name = trimmed.slice(0, firstColon).trim();
    const rest = trimmed.slice(firstColon + 1).trim();
    const secondColon = rest.indexOf(':');
    const role = secondColon < 0 ? rest : rest.slice(0, secondColon).trim();
    out.push({ name, role });
  }
  return out;
}

function findOwner(roster: ParsedRoster[], keywords: string[]): string {
  for (const kw of keywords) {
    const found = roster.find((r) => r.role.toLowerCase().includes(kw.toLowerCase()));
    if (found) return found.name;
  }
  return '_[ASSIGN]_';
}

/**
 * Heuristic milestone-to-phase mapping. Pre-cutover phase contains
 * milestones with "pre-freeze" / "T-" / "before"; during-cutover with
 * "begins" / "complete" / "go declared"; post-cutover with "T+" /
 * "day 1" / "week 1" / "hypercare".
 */
function classifyMilestonePhase(name: string): 'PRE' | 'DURING' | 'POST' {
  const lc = name.toLowerCase();
  if (/pre-freeze|t-\d|before|prep/.test(lc)) return 'PRE';
  if (/post-cutover|day 1|day\s+1|week 1|hypercare|t\+\d|\bbau\b|after/.test(lc)) return 'POST';
  if (/begin|start|complete|go declared|migration done|cutover/.test(lc)) return 'DURING';
  return 'DURING';
}

export function generateCutoverCommPlan(
  input: CutoverCommPlanGeneratorInput,
): CutoverCommPlanGeneratorOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const milestones = parseMilestones((input.cutoverMilestones ?? '').toString());
  const escalations = parseEscalations((input.escalationContacts ?? '').toString());
  const roster = parseRoster((input.cutoverTeamRoster ?? '').toString());
  const windowH = typeof input.cutoverWindowHours === 'number' && input.cutoverWindowHours > 0
    ? input.cutoverWindowHours
    : 36;

  const consultantPM = findOwner(roster, ['consultant pm', 'overall command']);
  const clientPM = findOwner(roster, ['client pm']);
  const sponsor = findOwner(roster, ['sponsor', 'cfo', 'ceo']);
  const migrationLead = findOwner(roster, ['migration lead', 'migration', 'data lead']);

  const preMilestones = milestones.filter((m) => classifyMilestonePhase(m.milestone) === 'PRE');
  const duringMilestones = milestones.filter((m) => classifyMilestonePhase(m.milestone) === 'DURING');
  const postMilestones = milestones.filter((m) => classifyMilestonePhase(m.milestone) === 'POST');

  function renderRows(rows: ParsedMilestone[], defaultOwner: string): string {
    if (rows.length === 0) {
      return `| _[ASSIGN milestone]_ | _[ASSIGN]_ | Email + Slack | ${defaultOwner} | ⏳ |`;
    }
    return rows
      .map(
        (m) =>
          `| ${m.milestone} | ${m.recipients} | Email + Slack | ${defaultOwner} | ⏳ |`,
      )
      .join('\n');
  }

  const escalationRows =
    escalations.length === 0
      ? '| _[ASSIGN escalation contact]_ | _[ASSIGN trigger]_ | _______ |'
      : escalations
          .map((e) => `| ${e.contact} | ${e.whenToCall} | _______ |`)
          .join('\n');

  const goLiveDisplay = input.targetGoLiveDate ?? 'TBD';

  const markdown = [
    `# Cutover Communication Plan — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Target Go-Live:** ${goLiveDisplay}  `,
    `**Cutover Window:** ${windowH}h  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Stakeholder cascade across the cutover weekend. Pre-cutover comms set ',
    'expectations; during-cutover comms keep stakeholders informed of progress; ',
    'post-cutover comms confirm hypercare entry. Templates at the bottom are ',
    'starters — consultant finalises tone + signoff before send.',
    '',
    '## 1. Pre-Cutover Cascade (T-30 → T-1)',
    '',
    '| Milestone | Recipients | Channel | Owner | Status |',
    '|-----------|------------|---------|-------|--------|',
    renderRows(preMilestones, sponsor),
    '',
    `## 2. During Cutover (T+0 → T+${windowH}h)`,
    '',
    '| Milestone | Recipients | Channel | Owner | Status |',
    '|-----------|------------|---------|-------|--------|',
    renderRows(duringMilestones, consultantPM),
    `| Cutover begins | Steering + Sponsor + Department Heads | Email + Slack | ${consultantPM} | ⏳ |`,
    `| Migration complete | Steering + IT | Slack channel | ${migrationLead} | ⏳ |`,
    `| Smoke pass / go declared | All users + Sponsor + Sales | Email + Slack + intranet | ${sponsor} | ⏳ |`,
    `| Smoke fail / rollback | Steering + Sponsor + escalation contacts | Phone + Email | ${consultantPM} | ⏳ |`,
    '',
    '## 3. Post-Cutover (T+1 → T+30)',
    '',
    '| Milestone | Recipients | Channel | Owner | Status |',
    '|-----------|------------|---------|-------|--------|',
    renderRows(postMilestones, clientPM),
    `| Day 1 status | Steering + IT | Daily standup + Slack | ${consultantPM} | ⏳ |`,
    `| Day 7 hypercare review | Steering + Sponsor | Meeting | ${consultantPM} | ⏳ |`,
    `| Day 30 hypercare exit | All stakeholders | Email + final report | ${sponsor} | ⏳ |`,
    '',
    '## 4. Escalation Contacts',
    '',
    'Beyond the cutover team roster — these contacts are reserved for specific trigger ',
    'conditions. The Final Go/No-Go owner authorises any call to a CEO-level escalation.',
    '',
    '| Contact | When to Call | Mobile / Phone |',
    '|---------|--------------|----------------|',
    escalationRows,
    '',
    '## 5. Communication Templates',
    '',
    'Drafted; consultant finalises tone, signature block, and any client-specific phrasing.',
    '',
    '### 5.1 Pre-Freeze Notice (T-1)',
    '',
    '> **Subject:** Pre-Cutover Freeze Begins Tomorrow — Final Reminder',
    '> ',
    `> All ${input.clientName} users,`,
    '> ',
    `> Effective tomorrow at start-of-day, all in-scope master data and transactional `,
    `> systems enter pre-freeze mode in preparation for our ${platformLabel} go-live. `,
    `> Please complete any pending data changes before end-of-day today.`,
    '> ',
    '> **What this means:** [...customise per scope...]',
    '> ',
    '> Cutover begins on [DATE] at [TIME]. Expected duration: ' + windowH + ' hours.',
    '> ',
    `> — ${sponsor}`,
    '',
    '### 5.2 Cutover Begins (T+0)',
    '',
    '> **Subject:** Cutover Started — Status Updates Will Follow',
    '> ',
    `> ${platformLabel} cutover is underway. ${input.clientName} legacy systems are now `,
    `> in read-only mode. Migration scripts are running per the cutover runbook.`,
    '> ',
    `> Next update: at the mid-cutover checkpoint (T+${Math.floor(windowH / 2)}h).`,
    '> ',
    `> — ${consultantPM}`,
    '',
    '### 5.3 Go Declared (T+windowH)',
    '',
    '> **Subject:** Go-Live Declared — System Ready for Use',
    '> ',
    `> ${platformLabel} is now live for ${input.clientName}. All P0 smoke tests passed.`,
    '> ',
    `> **Action for users:** [...login + first-action guidance...]`,
    '> ',
    '> Hypercare team is on-call per the published roster. Issues route via the ',
    'configured channels in `Documentation/Cutover/Cutover_Team_Roster.md`.',
    '> ',
    `> — ${sponsor}`,
    '',
    '## 6. Cross-References',
    '',
    '- Cutover Runbook: `Documentation/Cutover/Cutover_Runbook.md`',
    '- Go/No-Go Matrix: `Documentation/Cutover/Go_No_Go_Matrix.md`',
    '- Cutover Team Roster: `Documentation/Cutover/Cutover_Team_Roster.md`',
    '- Rollback Plan: `Documentation/Cutover/Rollback_Plan.md`',
    '',
    '_Generated by ERPLaunch — Pack V (Cutover Runbook)._',
    '',
  ].join('\n');

  return { markdown };
}
