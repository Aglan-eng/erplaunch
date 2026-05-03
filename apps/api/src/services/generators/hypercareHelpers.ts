/**
 * Shared helpers for Pack X — Hypercare Program generators.
 *
 * Pipe-delimited parsing for roster / severity / SLA tables. Each
 * generator imports what it needs.
 *
 * Sources:
 *   - ITIL severity classification (S1-S4 standard four-level scheme).
 *   - Standard incident-management table conventions (ITSM playbooks).
 */

export interface ParsedRosterRow {
  name: string;
  role: string;
  coverage: string;
  phone: string;
}

export interface ParsedSeverityRow {
  severity: string;
  description: string;
  example: string;
}

export interface ParsedSlaRow {
  severity: string;
  responseSla: string;
  resolutionTarget: string;
}

/**
 * Pipe-delimited parser. Splits on '|' and trims segments. Returns
 * rows that have at least `minSegments` non-empty fields.
 */
function pipeSplit(line: string): string[] {
  return line.split('|').map((s) => s.trim());
}

export function parseRoster(raw: string): ParsedRosterRow[] {
  const out: ParsedRosterRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      name: segs[0],
      role: segs[1] ?? '',
      coverage: segs[2] ?? '',
      phone: segs[3] ?? '',
    });
  }
  return out;
}

export function parseSeverity(raw: string): ParsedSeverityRow[] {
  const out: ParsedSeverityRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      severity: segs[0],
      description: segs[1] ?? '',
      example: segs[2] ?? '',
    });
  }
  return out;
}

export function parseSla(raw: string): ParsedSlaRow[] {
  const out: ParsedSlaRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      severity: segs[0],
      responseSla: segs[1] ?? '',
      resolutionTarget: segs[2] ?? '',
    });
  }
  return out;
}

/**
 * Parse an exit-criteria TEXTAREA (one criterion per line, free-form
 * text). Returns the trimmed lines.
 */
export function parseExitCriteria(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

/**
 * Default severity definitions for engagements that don't populate
 * severity in the wizard. Industry-standard 4-level scheme.
 */
export const DEFAULT_SEVERITY_ROWS: ReadonlyArray<ParsedSeverityRow> = [
  {
    severity: 'S1',
    description: 'Production halted, no workaround',
    example: 'Period-end close blocked, sub-ledger to GL stuck',
  },
  {
    severity: 'S2',
    description: 'Major function impaired, workaround exists',
    example: 'Reports broken, batch job failing but rerunnable',
  },
  {
    severity: 'S3',
    description: 'Minor function impaired or single-user',
    example: 'Field validation issue, individual user permission gap',
  },
  {
    severity: 'S4',
    description: 'Cosmetic or enhancement',
    example: 'Label typo, dashboard color',
  },
];

export const DEFAULT_SLA_ROWS: ReadonlyArray<ParsedSlaRow> = [
  { severity: 'S1', responseSla: '15 minutes', resolutionTarget: '4 hours' },
  { severity: 'S2', responseSla: '1 business hour', resolutionTarget: '1 business day' },
  { severity: 'S3', responseSla: '1 business day', resolutionTarget: '5 business days' },
  { severity: 'S4', responseSla: '5 business days', resolutionTarget: 'Backlog' },
];

/**
 * Default exit criteria when consultant doesn't supply any. These are
 * Pack X's minimum-bar gates — every engagement should be measured
 * against at least these regardless of consultant input.
 */
export const DEFAULT_EXIT_CRITERIA: ReadonlyArray<string> = [
  'Zero S1 open for 5 consecutive business days',
  'Zero S2 open more than 5 business days',
  'First month-end close completed within 5 business days of period close',
  'Integration retry queue depth < 5 for 5 consecutive business days',
  'User adoption ≥ 90% of named users posting at least 1 transaction in trailing 7 days',
  'Sponsor sign-off captured',
];

/**
 * Augment consultant-provided exit criteria with the default minimum
 * gates. Dedup against consultant's own criteria by case-insensitive
 * substring match (so "Zero S1 open" the consultant wrote matches
 * the default "Zero S1 open for 5 consecutive business days" — we
 * keep the consultant's wording and skip the default).
 */
export function augmentExitCriteria(consultantCriteria: ReadonlyArray<string>): {
  consultant: ReadonlyArray<string>;
  defaults: ReadonlyArray<string>;
} {
  const consultantLower = consultantCriteria.map((c) => c.toLowerCase());
  const supplementaryDefaults = DEFAULT_EXIT_CRITERIA.filter((def) => {
    const defLower = def.toLowerCase();
    // Check if consultant covered this gate via substring overlap on
    // first 3 words.
    const defKey = defLower.split(/\s+/).slice(0, 3).join(' ');
    return !consultantLower.some((c) => c.includes(defKey));
  });
  return { consultant: consultantCriteria, defaults: supplementaryDefaults };
}
