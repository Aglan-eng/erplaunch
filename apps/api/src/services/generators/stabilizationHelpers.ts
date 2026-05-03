/**
 * Shared helpers for Pack Y — Stabilization Roadmap generators.
 *
 * Pipe-delimited parsers for committee / business-case / backlog /
 * lessons-learned tables. Each generator imports what it needs.
 *
 * Sources:
 *   - PMI / PMBOK benefits realization management.
 *   - Standard ERP stabilization playbooks (SuiteSuccess Sustain,
 *     SAP Activate Run + benefits review).
 *   - Lessons-learned register conventions (PMBOK + ITIL).
 */

export interface ParsedCommitteeRow {
  name: string;
  role: string;
  function: string;
}

export interface ParsedBusinessCaseRow {
  metric: string;
  baseline: string;
  target: string;
  timing: string;
}

export interface ParsedBacklogRow {
  /** Feature name OR Limitation OR Initiative — column 1. */
  item: string;
  /** Reason deferred OR Workaround OR Business case — column 2. */
  context: string;
  /** Target wave OR Permanent/Temporary OR Sequence — column 3. */
  classification: string;
}

export interface ParsedLessonRow {
  theme: string;
  what: string;
  soWhat: string;
  nowWhat: string;
}

function pipeSplit(line: string): string[] {
  return line.split('|').map((s) => s.trim());
}

export function parseCommittee(raw: string): ParsedCommitteeRow[] {
  const out: ParsedCommitteeRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      name: segs[0],
      role: segs[1] ?? '',
      function: segs[2] ?? '',
    });
  }
  return out;
}

export function parseBusinessCase(raw: string): ParsedBusinessCaseRow[] {
  const out: ParsedBusinessCaseRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      metric: segs[0],
      baseline: segs[1] ?? '',
      target: segs[2] ?? '',
      timing: segs[3] ?? '',
    });
  }
  return out;
}

export function parseBacklog(raw: string): ParsedBacklogRow[] {
  const out: ParsedBacklogRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 1 || segs[0].length === 0) continue;
    out.push({
      item: segs[0],
      context: segs[1] ?? '',
      classification: segs[2] ?? '',
    });
  }
  return out;
}

export function parseLessons(raw: string): ParsedLessonRow[] {
  const out: ParsedLessonRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      theme: segs[0],
      what: segs[1] ?? '',
      soWhat: segs[2] ?? '',
      nowWhat: segs[3] ?? '',
    });
  }
  return out;
}

/**
 * Steady-state governance committee — default canonical roles when
 * consultant input is sparse (< 4 members).
 */
export const DEFAULT_COMMITTEE_ROWS: ReadonlyArray<ParsedCommitteeRow> = [
  { name: '_[ASSIGN]_', role: 'Sustainment Owner', function: 'IT chair / accountable for ongoing platform' },
  { name: '_[ASSIGN]_', role: 'Finance lead', function: 'Finance representation + sponsor proxy' },
  { name: '_[ASSIGN]_', role: 'Operations lead', function: 'Operations representation' },
  { name: '_[ASSIGN]_', role: 'IT lead', function: 'Technical delivery + integrations' },
  { name: '_[ASSIGN]_', role: 'Power-user representative', function: 'End-user voice + business champion' },
  { name: '_[ASSIGN]_', role: 'Vendor account manager', function: 'Platform vendor relationship + roadmap input' },
];

/**
 * Default business-case rows used when consultant overlay is sparse
 * (< 3 rows). Industry-canonical ERP business-case metrics.
 */
export const DEFAULT_BUSINESS_CASE_ROWS: ReadonlyArray<ParsedBusinessCaseRow> = [
  { metric: 'Close cycle days', baseline: '_[ASSIGN baseline]_', target: '_[ASSIGN target]_', timing: 'T+180' },
  { metric: 'AP days-payable-outstanding', baseline: '_[ASSIGN]_', target: '_[ASSIGN]_', timing: 'T+180' },
  { metric: 'AR days-sales-outstanding', baseline: '_[ASSIGN]_', target: '_[ASSIGN]_', timing: 'T+270' },
  { metric: 'Manual journal count per period', baseline: '_[ASSIGN]_', target: '_[ASSIGN]_', timing: 'T+180' },
  { metric: 'Audit prep hours', baseline: '_[ASSIGN]_', target: '_[ASSIGN]_', timing: 'T+270' },
  { metric: 'Headcount avoided in finance ops', baseline: '_[ASSIGN]_', target: '_[ASSIGN]_', timing: 'T+360' },
];

/**
 * Canonical lessons-learned themes that always render with empty rows
 * when consultant doesn't seed them — gives the retro facilitator a
 * starting structure.
 */
export const DEFAULT_LESSON_THEMES: ReadonlyArray<string> = [
  'Scope discipline',
  'Change management',
  'Data quality',
  'Integration testing',
  'Sponsor engagement',
  'Training depth',
  'Hypercare staffing',
];

/**
 * Default Quick-Wins seed for the Process Improvement Backlog. These
 * are common hypercare-period workarounds that can typically be
 * eliminated within 2 weeks post-hypercare.
 */
export const DEFAULT_QUICK_WIN_SEEDS: ReadonlyArray<ParsedBacklogRow> = [
  {
    item: 'Automate manual reclass JE for cost-center misposts',
    context: 'Workflow rule + saved-search trigger',
    classification: '≤ 2 weeks',
  },
  {
    item: 'Add field validator on supplier bank account format',
    context: 'Custom field validation script',
    classification: '≤ 1 week',
  },
  {
    item: 'Saved search alerts for stuck approval transactions > 48h',
    context: 'Email alert via saved search + scheduled refresh',
    classification: '≤ 1 week',
  },
  {
    item: 'Standardise period-close checklist into a custom record',
    context: 'Replaces shared spreadsheet',
    classification: '≤ 2 weeks',
  },
  {
    item: 'Template common journal-entry corrections',
    context: 'Saved JE templates + role permissions',
    classification: '≤ 1 week',
  },
];

/**
 * Default Phase Two seeds when consultant doesn't supply phaseTwoScope.
 * Drawn from the implementation library — common phase-two candidates.
 */
export const DEFAULT_PHASE_TWO_SEEDS: ReadonlyArray<ParsedBacklogRow> = [
  {
    item: 'WhatsApp / Telegram supplier portal integration',
    context: 'Reduce inbound email volume + structured supplier comms',
    classification: 'T+180',
  },
  {
    item: 'Advanced revenue recognition deepening',
    context: 'ASC 606 / IFRS 15 — multi-element arrangement support',
    classification: 'T+270',
  },
  {
    item: 'Fixed asset module rollout',
    context: 'Replace separate FA spreadsheet — depreciation automation',
    classification: 'T+270',
  },
  {
    item: 'Intercompany automation enhancement',
    context: 'Eliminate manual IC entries via auto-mirror',
    classification: 'T+270',
  },
  {
    item: 'Additional entity rollout',
    context: 'Reuse template — accelerated onboarding for new acquisitions',
    classification: 'T+360',
  },
  {
    item: 'Mobile dashboards rollout',
    context: 'Sales + ops field access',
    classification: 'T+360',
  },
];
