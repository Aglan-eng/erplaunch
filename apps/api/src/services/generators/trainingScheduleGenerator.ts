/**
 * Training Schedule generator (Pack U — Training Collateral, Component 5).
 *
 * Cross-platform — emits Documentation/Training_Schedule.md (+ .html).
 *
 * Reads:
 *   - training.schedule.trainingSessions (TEXTAREA — one session per
 *     line: "<session_name>: <duration>: <target_audience>")
 *   - training.schedule.deliveryMode (SELECT)
 *   - kickoff.mandate.targetGoLiveDate (TEXT — ISO yyyy-mm-dd or 'TBD')
 *
 * Auto-schedule strategy: training completes 1 week pre-go-live.
 * Sessions stagger from 4 weeks pre-go-live in declared order (the
 * consultant's order on the input is the dependency order — front-line
 * end-user training first, train-the-trainer cascade later, etc.).
 *
 * If the target go-live date is missing or unparseable, render relative
 * "Week N pre-go-live" placeholders instead of absolute dates so the
 * consultant fills them after the date is locked.
 *
 * Sources:
 *   - Standard ERP go-live planning practice — training closes 1-2
 *     weeks before cutover so users practice in sandbox without prod
 *     interference.
 *   - SuiteSuccess + SAP Activate cutover-readiness checklists.
 */

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: true, typographer: true });

export type ScheduleDeliveryMode = 'IN_PERSON' | 'VIRTUAL_LIVE' | 'HYBRID' | 'SELF_PACED_VIDEO';

export interface TrainingScheduleGeneratorInput {
  clientName: string;
  adaptorName?: string;
  /** TEXTAREA training.schedule.trainingSessions. */
  trainingSessions?: string | null;
  /** SELECT training.schedule.deliveryMode. */
  deliveryMode?: ScheduleDeliveryMode | string | null;
  /** TEXT kickoff.mandate.targetGoLiveDate — ISO yyyy-mm-dd or 'TBD'. */
  targetGoLiveDate?: string | null;
}

export interface TrainingScheduleGeneratorOutput {
  markdown: string;
  html: string;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

interface ParsedSession {
  name: string;
  duration: string;
  audience: string;
}

const SESSION_LINE = /^([^:]+):\s*([^:]+):\s*(.+)$/;

function parseSessions(raw: string): ParsedSession[] {
  const out: ParsedSession[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(SESSION_LINE);
    if (!m) continue;
    out.push({
      name: m[1].trim(),
      duration: m[2].trim(),
      audience: m[3].trim(),
    });
  }
  return out;
}

// ─── Schedule planning ──────────────────────────────────────────────────────

interface ScheduledSession extends ParsedSession {
  /** Week number relative to go-live (negative = pre-go-live, e.g. -3 = 3 weeks before). */
  weekRelativeToGoLive: number;
  /** Absolute date range (ISO yyyy-mm-dd .. yyyy-mm-dd) when go-live is parseable. Empty when not. */
  dateRange: string;
}

function parseGoLiveDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.toString().trim();
  if (s.length === 0 || /^TBD$/i.test(s)) return null;
  // Match yyyy-mm-dd.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Strategy: training completes 1 week pre-go-live (weekRelativeToGoLive = -1).
 * Sessions stagger from -4 (4 weeks pre-go-live) onwards in declared
 * order. We pace 1 session per week; if more than 4 sessions are
 * declared, we stack two per week starting at -4.
 */
function planSchedule(
  sessions: ParsedSession[],
  goLive: Date | null,
): ScheduledSession[] {
  const out: ScheduledSession[] = [];
  const weeks = [-4, -3, -2, -1];
  for (let i = 0; i < sessions.length; i++) {
    const week = weeks[i % weeks.length] ?? -1;
    let dateRange = '';
    if (goLive) {
      // Compute ISO Mon..Fri week start at this offset.
      const weekStart = new Date(goLive);
      weekStart.setUTCDate(weekStart.getUTCDate() + week * 7);
      // Roll back to Monday of that week.
      const day = weekStart.getUTCDay();
      const diffToMonday = (day === 0 ? -6 : 1 - day);
      weekStart.setUTCDate(weekStart.getUTCDate() + diffToMonday);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekStart.getUTCDate() + 4);
      dateRange = `${formatDate(weekStart)} → ${formatDate(weekEnd)}`;
    }
    out.push({
      ...sessions[i],
      weekRelativeToGoLive: week,
      dateRange,
    });
  }
  return out;
}

// ─── Format strings per delivery mode ───────────────────────────────────────

function formatLabel(mode: ScheduleDeliveryMode): string {
  switch (mode) {
    case 'IN_PERSON':
      return 'In-person';
    case 'VIRTUAL_LIVE':
      return 'Virtual live';
    case 'SELF_PACED_VIDEO':
      return 'Self-paced video';
    case 'HYBRID':
    default:
      return 'Hybrid';
  }
}

function normaliseMode(raw: string | null | undefined): ScheduleDeliveryMode {
  const upper = (raw ?? '').toString().toUpperCase();
  if (upper === 'IN_PERSON') return 'IN_PERSON';
  if (upper === 'VIRTUAL_LIVE') return 'VIRTUAL_LIVE';
  if (upper === 'SELF_PACED_VIDEO') return 'SELF_PACED_VIDEO';
  return 'HYBRID';
}

// ─── Markdown emission ──────────────────────────────────────────────────────

function buildMarkdown(args: {
  clientName: string;
  adaptorName: string;
  goLive: Date | null;
  goLiveDisplay: string;
  scheduled: ScheduledSession[];
  mode: ScheduleDeliveryMode;
}): string {
  const platform = args.adaptorName.length > 0 ? args.adaptorName : 'ERP';
  const modeLabel = formatLabel(args.mode);
  const trainingWindowLine = args.goLive
    ? `**Training Window:** Week -4 to Week -1 (closing 1 week pre-go-live)`
    : `**Training Window:** Week -4 to Week -1 (relative — set absolute dates once go-live confirmed)`;

  const sessionRows =
    args.scheduled.length === 0
      ? '| _(no sessions captured)_ | — | — | — | — | — | _[ASSIGN]_ |'
      : args.scheduled
          .map((s) => {
            const week = `Week ${s.weekRelativeToGoLive}`;
            const dateRange = s.dateRange.length > 0 ? s.dateRange : '_[ASSIGN once go-live locked]_';
            return `| ${week} | ${dateRange} | ${s.name} | ${s.duration} | ${s.audience} | ${modeLabel} | _[ASSIGN trainer]_ |`;
          })
          .join('\n');

  return [
    `# Training Schedule — ${args.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Target Go-Live:** ${args.goLiveDisplay}  `,
    trainingWindowLine + '  ',
    `**Delivery Mode:** ${modeLabel}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    '## 1. Sessions',
    '',
    'Sessions stagger from 4 weeks pre-go-live to 1 week pre-go-live so users have ',
    'sandbox practice time before the production cutover. Order below preserves the ',
    'consultant-declared order in the wizard answer.',
    '',
    '| Week | Date Range | Session | Duration | Audience | Format | Owner |',
    '|------|------------|---------|----------|----------|--------|-------|',
    sessionRows,
    '',
    '## 2. Pre-Training Prerequisites',
    '',
    '- [ ] Sandbox refreshed with production-shaped data',
    '- [ ] Training accounts provisioned for all attendees',
    '- [ ] Training environment login tested',
    '- [ ] Quick reference cards distributed (`Documentation/Training/Quick_Reference_Cards/`)',
    '- [ ] Pre-reading sent per role (`Documentation/Solution_Design.html` extracts)',
    '',
    '## 3. Post-Training Validation',
    '',
    '- [ ] All Required-coverage role users completed assessment',
    '- [ ] Champions completed cascade-training prep',
    '- [ ] Sign-off Matrix updated with training completion per role (`Documentation/Sign_Off_Matrix.md`)',
    '- [ ] Defect log opened for any training-discovered issues (`Documentation/Defect_Log_Template.md`)',
    '',
    '## 4. Cross-References',
    '',
    '- Per-role detail: `Documentation/Training/<Role>_Training_Guide.md`',
    '- Coverage matrix: `Documentation/Training_Matrix.md`',
    '- Quick reference cards: `Documentation/Training/Quick_Reference_Cards/`',
    '- Knowledge transfer checklist: `Documentation/KT_Checklist.md`',
    '',
    '_Generated by ERPLaunch — Pack U (Training Collateral)._',
    '',
  ].join('\n');
}

function buildHtml(markdown: string, clientName: string, adaptorName: string): string {
  const body = md.render(markdown);
  const platform = adaptorName.length > 0 ? adaptorName : 'ERP';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Training Schedule — ${clientName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 1100px; margin: 40px auto; padding: 0 24px 80px; }
    h1 { font-size: 28px; font-weight: 800; color: #0f172a; margin-bottom: 12px; }
    h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin: 28px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
    p { color: #475569; line-height: 1.7; margin-bottom: 12px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 20px; }
    thead { background: #065f46; color: white; }
    thead th { padding: 12px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody td { padding: 11px 16px; vertical-align: top; color: #334155; line-height: 1.5; }
    ul { margin: 12px 0 16px 24px; }
    li { color: #475569; line-height: 1.7; font-size: 14px; }
    .footer { margin-top: 60px; text-align: center; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="page">
    <p style="font-size: 12px; color: #64748b; margin-bottom: 8px;">${platform} implementation</p>
    ${body}
    <div class="footer">Generated by ERPLaunch &copy; ${new Date().getFullYear()}</div>
  </div>
</body>
</html>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function generateTrainingSchedule(
  input: TrainingScheduleGeneratorInput,
): TrainingScheduleGeneratorOutput {
  const sessions = parseSessions((input.trainingSessions ?? '').toString());
  const goLive = parseGoLiveDate(input.targetGoLiveDate);
  const goLiveDisplay = goLive ? formatDate(goLive) : (input.targetGoLiveDate ?? 'TBD').toString();
  const mode = normaliseMode(input.deliveryMode);
  const adaptorName = (input.adaptorName ?? '').toString();

  const scheduled = planSchedule(sessions, goLive);

  const markdown = buildMarkdown({
    clientName: input.clientName,
    adaptorName,
    goLive,
    goLiveDisplay,
    scheduled,
    mode,
  });
  const html = buildHtml(markdown, input.clientName, adaptorName);

  return { markdown, html };
}
