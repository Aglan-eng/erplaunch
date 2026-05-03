/**
 * Cutover Runbook generator (Pack V — Cutover & Go-Live, Component 2).
 *
 * Cross-platform — emits Documentation/Cutover/Cutover_Runbook.md (+ .html).
 *
 * The runbook is the hour-by-hour playbook for the cutover weekend.
 * Shape branches on cutoverStyle (from the existing Migration flow):
 *
 *   BIG_BANG (most common — single weekend)
 *     Pre-cutover phase (T-30 → T-1): scheduled checkpoints + dry run
 *     references. Cutover window (T0 → T+windowH): hour-by-hour table
 *     auto-distributed across extract / transform / load / validation
 *     / smoke phases (proportions 20% / 30% / 30% / 10% / 10%).
 *     Post-cutover phase (T+windowH → T+72h): smoke + first-day
 *     monitoring + first-period close.
 *
 *   PARALLEL_RUN
 *     Gradual transition with parallel-system reconciliation per
 *     parallelRunDays. Both legacy + new systems live; daily reconciliation
 *     until parallelRunDays elapsed; legacy retired at end.
 *
 *   PHASED_ENTITY
 *     Per-entity wave timeline. One cutover per entity, staggered.
 *     Useful for OneWorld / multi-company engagements where entity-by-entity
 *     reduces blast radius.
 *
 *   PHASED_MODULE
 *     Per-module wave timeline (Finance first, then Inventory, etc.).
 *     Useful when module dependencies allow staged switchover.
 *
 * Sources:
 *   - ITIL change-management cutover patterns (release weekend coordination).
 *   - SuiteSuccess Go-Live methodology + SAP Activate Realize phase.
 *   - Standard ERP go-live runbooks across regulated + non-regulated industries.
 */

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: true, typographer: true });

export type CutoverStyle = 'BIG_BANG' | 'PARALLEL_RUN' | 'PHASED_ENTITY' | 'PHASED_MODULE';

export interface CutoverRunbookGeneratorInput {
  clientName: string;
  adaptorName?: string;
  /** SELECT odoo.migration.cutoverStyle / equivalent on NS. Defaults to
   *  BIG_BANG when omitted (most common style). */
  cutoverStyle?: CutoverStyle | string | null;
  /** NUMBER odoo.migration.cutoverWindowHours / equivalent. Defaults
   *  to 36h (typical Friday-evening to Monday-morning weekend). */
  cutoverWindowHours?: number;
  /** NUMBER odoo.migration.preFreezeDays / equivalent. Defaults to 3. */
  preFreezeDays?: number;
  /** NUMBER — relevant for PARALLEL_RUN only. Days both systems run
   *  in parallel before legacy retirement. */
  parallelRunDays?: number;
  /** TEXTAREA cutover.team.cutoverTeamRoster — primary name resolution. */
  cutoverTeamRoster?: string | null;
  /** TEXT kickoff.mandate.targetGoLiveDate. */
  targetGoLiveDate?: string | null;
  /** TEXTAREA cutover.team.dryRunDates — embedded in pre-cutover phase. */
  dryRunDates?: string | null;
}

export interface CutoverRunbookGeneratorOutput {
  markdown: string;
  html: string;
  /** Cutover style actually used after normalisation. */
  resolvedStyle: CutoverStyle;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normaliseStyle(raw: string | null | undefined): CutoverStyle {
  const upper = (raw ?? '').toString().toUpperCase();
  if (upper === 'PARALLEL_RUN') return 'PARALLEL_RUN';
  if (upper === 'PHASED_ENTITY') return 'PHASED_ENTITY';
  if (upper === 'PHASED_MODULE') return 'PHASED_MODULE';
  return 'BIG_BANG';
}

function styleLabel(style: CutoverStyle): string {
  switch (style) {
    case 'PARALLEL_RUN':
      return 'Parallel Run';
    case 'PHASED_ENTITY':
      return 'Phased by Entity';
    case 'PHASED_MODULE':
      return 'Phased by Module';
    case 'BIG_BANG':
    default:
      return 'Big Bang';
  }
}

interface RosterRow {
  name: string;
  role: string;
  onCallWindow: string;
}

function parseRoster(raw: string): RosterRow[] {
  const out: RosterRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // Three-segment "<name>: <role>: <on-call>" — split on first two colons.
    const firstColon = trimmed.indexOf(':');
    if (firstColon < 0) continue;
    const name = trimmed.slice(0, firstColon).trim();
    const rest = trimmed.slice(firstColon + 1).trim();
    const secondColon = rest.indexOf(':');
    if (secondColon < 0) {
      out.push({ name, role: rest, onCallWindow: '' });
      continue;
    }
    const role = rest.slice(0, secondColon).trim();
    const onCallWindow = rest.slice(secondColon + 1).trim();
    out.push({ name, role, onCallWindow });
  }
  return out;
}

/**
 * Pick a roster member by role keyword. Used to assign owner cells in
 * the runbook table — specificity-first ordering keeps "Migration lead"
 * from matching "Consultant PM" via a stray "lead" keyword.
 */
function findOwner(roster: RosterRow[], keywords: string[]): string {
  for (const kw of keywords) {
    const found = roster.find((r) => r.role.toLowerCase().includes(kw.toLowerCase()));
    if (found) return found.name;
  }
  return '_[ASSIGN]_';
}

interface DryRunRow {
  label: string;
  date: string;
  focus: string;
}

function parseDryRunDates(raw: string): DryRunRow[] {
  const out: DryRunRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const firstColon = trimmed.indexOf(':');
    if (firstColon < 0) continue;
    const label = trimmed.slice(0, firstColon).trim();
    const rest = trimmed.slice(firstColon + 1).trim();
    const secondColon = rest.indexOf(':');
    if (secondColon < 0) {
      out.push({ label, date: rest, focus: '' });
      continue;
    }
    out.push({
      label,
      date: rest.slice(0, secondColon).trim(),
      focus: rest.slice(secondColon + 1).trim(),
    });
  }
  return out;
}

// ─── Hour distribution for BIG_BANG ─────────────────────────────────────────
//
// The cutoverWindowHours total is split across 5 phases by canonical
// proportions: extract 20% / transform 30% / load 30% / validation 10%
// / smoke 10%. We then materialise hour-by-hour rows with sensible
// owner assignments. Output rows display "T+H:MM" timestamps.

interface RunbookRow {
  timeRange: string;
  owner: string;
  activity: string;
  passCriteria: string;
}

function fmtTime(hours: number): string {
  // Convert decimal hours to T+H:MM form.
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  const mm = m < 10 ? `0${m}` : String(m);
  return `T+${h}:${mm}`;
}

function fmtTimeRange(start: number, end: number): string {
  return `${fmtTime(start)} → ${fmtTime(end)}`;
}

function bigBangRows(windowH: number, roster: RosterRow[]): RunbookRow[] {
  const consultantPM = findOwner(roster, ['consultant pm', 'overall command', 'consultant project manager']);
  const itLead = findOwner(roster, ['it lead', 'it admin', 'sysadmin', 'platform admin']);
  const migrationLead = findOwner(roster, [
    'migration lead',
    'migration',
    'data lead',
    'etl lead',
  ]);
  const functionalLead = findOwner(roster, [
    'functional lead',
    'finance lead',
    'r&d finance',
    'workstream lead',
    'client pm',
  ]);

  const extractEnd = windowH * 0.2;
  const transformEnd = windowH * 0.5;
  const loadEnd = windowH * 0.8;
  const validationEnd = windowH * 0.9;
  // Smoke phase ends at windowH.

  return [
    {
      timeRange: 'T+0:00',
      owner: consultantPM,
      activity: 'Cutover commences — final freeze applied to legacy systems',
      passCriteria: 'All legacy systems read-only; comms cascade fired',
    },
    {
      timeRange: fmtTimeRange(0, 0.5),
      owner: itLead,
      activity: 'Take final production snapshot of legacy systems (DB + file shares)',
      passCriteria: 'Snapshot completes; checksum verified',
    },
    {
      timeRange: fmtTimeRange(0.5, extractEnd),
      owner: migrationLead,
      activity:
        'Run data extraction scripts (customers, vendors, items, open AR/AP, opening TB, inventory snapshot)',
      passCriteria: 'All extracts complete; record counts match expected within ±0.1%',
    },
    {
      timeRange: fmtTimeRange(extractEnd, transformEnd),
      owner: migrationLead,
      activity: 'Run data transformation scripts (UoM normalisation, currency normalisation, validation)',
      passCriteria: 'Validation queries return zero discrepancies; transform log clean',
    },
    {
      timeRange: fmtTimeRange(transformEnd, loadEnd),
      owner: migrationLead,
      activity: 'Load transformed data into target system',
      passCriteria: 'All loads complete; row counts match transform stage',
    },
    {
      timeRange: fmtTimeRange(loadEnd, validationEnd),
      owner: functionalLead,
      activity: 'Tie-out validation — TB + AR aging + AP aging + inventory totals vs legacy snapshot',
      passCriteria: 'TB ties to ±$0.01 per entity; aging buckets within tolerance',
    },
    {
      timeRange: fmtTimeRange(validationEnd, windowH),
      owner: functionalLead,
      activity: 'P0 smoke test execution (per Documentation/Cutover/Post_Cutover_Smoke.md)',
      passCriteria: '100% of P0 scenarios green',
    },
    {
      timeRange: fmtTime(windowH),
      owner: consultantPM,
      activity: 'Final go declaration — cutover window closes',
      passCriteria: 'Go-live signed off; comms cascade fired',
    },
  ];
}

// ─── Markdown emission per style ────────────────────────────────────────────

function preCutoverSection(args: {
  preFreezeDays: number;
  dryRuns: DryRunRow[];
}): string {
  const dryRunBlock =
    args.dryRuns.length === 0
      ? '- [ ] _[ASSIGN dry-run schedule once locked — see `Documentation/Cutover/Dry_Run_Plan.md`]_'
      : args.dryRuns
          .map(
            (d) =>
              `- [ ] **${d.label}** — ${d.date}${d.focus.length > 0 ? ` (focus: ${d.focus})` : ''}`,
          )
          .join('\n');

  return [
    '## Pre-Cutover Phase (T-30 → T-1)',
    '',
    '### T-30 → T-14 days',
    '- [ ] Cutover team confirmed + on-call schedule locked (see `Cutover_Team_Roster.md`)',
    '- [ ] Dry run schedule communicated to participants',
    '',
    '### T-14 → T-7 days',
    '- [ ] Performance test against simulated peak — pass benchmarks per `Performance_Test_Plan.md`',
    '- [ ] Final defect triage — no Critical/High open per `Defect_Log_Template.md`',
    '',
    '### T-7 → T-3 days',
    '- [ ] Final dry run executed (identical to production)',
    '- [ ] Communication cascade: pre-freeze notice to all users',
    '- [ ] Sandbox refresh + final config validation',
    '',
    `### T-${args.preFreezeDays} day(s) — Pre-Freeze Window`,
    '- [ ] Pre-freeze IN EFFECT at start-of-day (legacy systems read-only for in-scope masters)',
    '- [ ] Final data migration script dry run on staging snapshot',
    '- [ ] Cutover team final huddle (60 min)',
    '',
    '### Dry Run Schedule (verbatim from wizard)',
    dryRunBlock,
    '',
  ].join('\n');
}

function bigBangBody(args: {
  windowH: number;
  roster: RosterRow[];
}): string {
  const rows = bigBangRows(args.windowH, args.roster);
  const tableRows = rows
    .map(
      (r) =>
        `| ${r.timeRange} | ${r.owner} | ${r.activity} | ${r.passCriteria} | ⏳ |`,
    )
    .join('\n');

  return [
    `## Cutover Window (T+0 → T+${args.windowH}h)`,
    '',
    'Big-bang style: single weekend cut. Hour-by-hour distribution below ',
    'auto-allocates the cutoverWindowHours across extract / transform / load ',
    '/ validation / smoke phases (canonical 20% / 30% / 30% / 10% / 10%). ',
    'Owners are resolved from the Cutover Team Roster — `_[ASSIGN]_` placeholders ',
    'mean the role keyword did not match a roster entry; fix in the wizard.',
    '',
    '| Time (T+) | Owner | Activity | Pass Criteria | Status |',
    '|-----------|-------|----------|---------------|--------|',
    tableRows,
    '',
  ].join('\n');
}

function parallelRunBody(args: {
  windowH: number;
  parallelDays: number;
  roster: RosterRow[];
}): string {
  const consultantPM = findOwner(args.roster, ['consultant pm', 'overall command']);
  const reconLead = findOwner(args.roster, ['migration', 'data lead', 'finance lead', 'controller']);

  return [
    '## Cutover Window — Parallel Run',
    '',
    `Parallel-run style: both legacy and new systems live for **${args.parallelDays} day(s)**. `,
    'Daily reconciliation runs each business day; legacy retires when reconciliation passes ',
    'consistently and stakeholders sign off.',
    '',
    '### Day 0 — Initial Cutover',
    `- T+0:00 → T+${Math.floor(args.windowH / 2)}:00 — Migration scripts run (extract → transform → load) — ${reconLead}`,
    `- T+${Math.floor(args.windowH / 2)}:00 → T+${args.windowH}:00 — Initial smoke + validation — ${reconLead}`,
    `- T+${args.windowH}:00 — Both systems open to users (parallel run begins) — ${consultantPM}`,
    '',
    `### Days 1 → ${args.parallelDays} — Parallel Run Window`,
    '- [ ] Daily reconciliation (TB + AR + AP) at end-of-day per entity',
    '- [ ] Daily defect log review',
    '- [ ] Variance threshold: ±0.1% — anything beyond escalates per Go/No-Go Matrix',
    '- [ ] Daily user feedback gathered + triaged',
    '',
    `### Day ${args.parallelDays + 1} — Legacy Retirement`,
    '- [ ] Final reconciliation pass',
    '- [ ] All Critical/High defects resolved',
    '- [ ] Sponsor go-decision to retire legacy',
    '- [ ] Legacy systems put into archive-only mode',
    '',
  ].join('\n');
}

function phasedEntityBody(args: { roster: RosterRow[] }): string {
  const consultantPM = findOwner(args.roster, ['consultant pm', 'overall command']);

  return [
    '## Cutover Window — Phased by Entity',
    '',
    'Phased-entity style: each legal entity cuts over in its own wave. Useful when ',
    'OneWorld / multi-company engagements need to reduce blast radius. Per-wave ',
    'cycle below repeats for every entity in the migration scope.',
    '',
    '### Per-Entity Wave Pattern',
    '',
    '1. **Wave Pre-Check (T-1 day per wave)** — Entity-specific pre-freeze + reconciliation snapshot.',
    '2. **Wave Cutover (T+0 → T+windowH per wave)** — Run extract → transform → load → validate → smoke for the entity.',
    '3. **Wave Post-Cutover (T+windowH → next wave start)** — Entity goes live; close monitoring + reconciliation against legacy snapshot.',
    '4. **Inter-Wave Gap (typically 1 week)** — Lessons learned + remediation before next entity.',
    '',
    '### Wave Schedule',
    '',
    '| Wave | Entity | Cutover Date | Owner | Status |',
    '|------|--------|--------------|-------|--------|',
    `| 1 | _[ASSIGN entity 1]_ | _[ASSIGN]_ | ${consultantPM} | ⏳ |`,
    `| 2 | _[ASSIGN entity 2]_ | _[ASSIGN]_ | ${consultantPM} | ⏳ |`,
    `| 3 | _[ASSIGN entity 3]_ | _[ASSIGN]_ | ${consultantPM} | ⏳ |`,
    `| 4 | _[ASSIGN entity 4]_ | _[ASSIGN]_ | ${consultantPM} | ⏳ |`,
    '',
    '_(Replace placeholder rows with the actual entity list from the engagement\'s migration scope. Each row triggers a copy of the per-wave pattern above.)_',
    '',
  ].join('\n');
}

function phasedModuleBody(args: { roster: RosterRow[] }): string {
  const consultantPM = findOwner(args.roster, ['consultant pm', 'overall command']);

  return [
    '## Cutover Window — Phased by Module',
    '',
    'Phased-module style: modules cut over in dependency order. Typical sequence: ',
    'Finance + Master Data → Inventory + Procurement → Sales + AR → Manufacturing + Returns. ',
    'Useful when downstream modules can wait until upstream is stable.',
    '',
    '### Wave Schedule',
    '',
    '| Wave | Modules | Dependencies | Owner | Status |',
    '|------|---------|--------------|-------|--------|',
    `| 1 | Finance + Master Data | Foundation only | ${consultantPM} | ⏳ |`,
    `| 2 | Inventory + Procurement | Wave 1 stable | ${consultantPM} | ⏳ |`,
    `| 3 | Sales + AR | Wave 1 + 2 stable | ${consultantPM} | ⏳ |`,
    `| 4 | Manufacturing + Returns | Waves 1-3 stable | ${consultantPM} | ⏳ |`,
    '',
    '_(Adjust the sequence per the engagement\'s actual module dependencies. Each wave goes through extract / transform / load / validate / smoke.)_',
    '',
  ].join('\n');
}

function postCutoverSection(): string {
  return [
    '## Post-Cutover Phase (T+windowH → T+72h)',
    '',
    '- [ ] Smoke test execution (per `Documentation/Cutover/Post_Cutover_Smoke.md`)',
    '- [ ] First business day open — close monitoring + on-call team active',
    '- [ ] Defect log triage every 4h for the first 24h',
    '- [ ] First period close validation (within 3 business days)',
    '- [ ] Hypercare team transition (per `Documentation/Hypercare_Plan.md` — Pack X)',
    '- [ ] Lessons-learned session within T+5 business days',
    '',
    '## Cross-References',
    '',
    '- Go/No-Go Matrix: `Documentation/Cutover/Go_No_Go_Matrix.md`',
    '- Rollback Plan: `Documentation/Cutover/Rollback_Plan.md`',
    '- Post-Cutover Smoke: `Documentation/Cutover/Post_Cutover_Smoke.md`',
    '- Communication Plan: `Documentation/Cutover/Communication_Plan.md`',
    '- Dry Run Plan: `Documentation/Cutover/Dry_Run_Plan.md`',
    '- Cutover Team Roster: `Documentation/Cutover/Cutover_Team_Roster.md`',
    '',
    '_Generated by ERPLaunch — Pack V (Cutover Runbook)._',
    '',
  ].join('\n');
}

// ─── HTML wrapper ───────────────────────────────────────────────────────────

function buildHtml(markdown: string, clientName: string, adaptorName: string): string {
  const body = md.render(markdown);
  const platform = adaptorName.length > 0 ? adaptorName : 'ERP';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cutover Runbook — ${clientName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 1100px; margin: 40px auto; padding: 0 24px 80px; }
    h1 { font-size: 28px; font-weight: 800; color: #0f172a; margin-bottom: 12px; }
    h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin: 28px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
    h3 { font-size: 15px; font-weight: 700; color: #b91c1c; margin: 20px 0 8px; }
    p { color: #475569; line-height: 1.7; margin-bottom: 12px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 20px; }
    thead { background: #b91c1c; color: white; }
    thead th { padding: 12px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody td { padding: 11px 16px; vertical-align: top; color: #334155; line-height: 1.5; }
    tbody td:first-child { font-weight: 700; color: #b91c1c; white-space: nowrap; }
    ul { margin: 12px 0 16px 24px; }
    li { color: #475569; line-height: 1.7; font-size: 14px; }
    .footer { margin-top: 60px; text-align: center; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="page">
    <p style="font-size: 12px; color: #64748b; margin-bottom: 8px;">${platform} cutover</p>
    ${body}
    <div class="footer">Generated by ERPLaunch &copy; ${new Date().getFullYear()}</div>
  </div>
</body>
</html>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function generateCutoverRunbook(
  input: CutoverRunbookGeneratorInput,
): CutoverRunbookGeneratorOutput {
  const adaptorName = (input.adaptorName ?? '').toString();
  const platform = adaptorName.length > 0 ? adaptorName : 'ERP';
  const style = normaliseStyle(input.cutoverStyle);
  const windowH = typeof input.cutoverWindowHours === 'number' && input.cutoverWindowHours > 0
    ? input.cutoverWindowHours
    : 36;
  const preFreezeDays = typeof input.preFreezeDays === 'number' && input.preFreezeDays > 0
    ? input.preFreezeDays
    : 3;
  const parallelDays = typeof input.parallelRunDays === 'number' && input.parallelRunDays > 0
    ? input.parallelRunDays
    : 14;

  const roster = parseRoster((input.cutoverTeamRoster ?? '').toString());
  const dryRuns = parseDryRunDates((input.dryRunDates ?? '').toString());

  let body = '';
  switch (style) {
    case 'PARALLEL_RUN':
      body = parallelRunBody({ windowH, parallelDays, roster });
      break;
    case 'PHASED_ENTITY':
      body = phasedEntityBody({ roster });
      break;
    case 'PHASED_MODULE':
      body = phasedModuleBody({ roster });
      break;
    case 'BIG_BANG':
    default:
      body = bigBangBody({ windowH, roster });
      break;
  }

  const markdown = [
    `# Cutover Runbook — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Cutover Style:** ${styleLabel(style)}  `,
    `**Target Go-Live:** ${input.targetGoLiveDate ?? 'TBD'}  `,
    `**Cutover Window:** ${windowH}h  `,
    `**Pre-Freeze:** ${preFreezeDays} business day(s)  `,
    style === 'PARALLEL_RUN' ? `**Parallel Run Days:** ${parallelDays}  ` : '',
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    preCutoverSection({ preFreezeDays, dryRuns }),
    body,
    postCutoverSection(),
  ]
    .filter((line) => line !== '')
    .join('\n');

  // Re-introduce blank lines between major blocks; the filter above
  // collapsed only the conditional `**Parallel Run Days:**` line when
  // empty. Markdown is forgiving enough to render correctly even
  // without strict blank-line separators after the metadata block.
  const html = buildHtml(markdown, input.clientName, adaptorName);

  return { markdown, html, resolvedStyle: style };
}
