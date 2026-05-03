/**
 * Defect Log Template generator (Pack T — Test Artifacts, Component 4).
 *
 * Cross-platform — single Documentation/Defect_Log_Template.md emitted
 * from the engagement's testing.defectSeverityLevels SELECT answer.
 *
 * The output is a hand-fillable defect register with:
 *   - Severity definitions (one of three schemes — STANDARD_4_LEVEL,
 *     MAJOR_MINOR, NUMERIC_1_5).
 *   - Workflow definitions (status lifecycle).
 *   - 13-column defect register table with one example row.
 *   - Resolution-target table (per severity → SLA).
 *
 * Sources:
 *   - IEEE 1044 Standard Classification for Software Anomalies.
 *   - ISO/IEC 25010 software quality model — defect categorisation.
 *   - Common UAT bug-bash conventions (Atlassian Jira default schemes,
 *     Google SRE error budget framing).
 */

export type DefectSeverityScheme = 'STANDARD_4_LEVEL' | 'MAJOR_MINOR' | 'NUMERIC_1_5';

export interface DefectLogTemplateGeneratorInput {
  clientName: string;
  /** SELECT testing.defectSeverityLevels. Defaults to STANDARD_4_LEVEL
   *  when omitted — that's the recommended scheme. */
  defectSeverityLevels?: DefectSeverityScheme | string | null;
  /** Optional adaptor identity — used to annotate platform-specific
   *  resolution channels (e.g., "log SuiteAnswers ticket" vs "open
   *  Odoo SH ticket"). */
  adaptorName?: string;
}

export interface DefectLogTemplateGeneratorOutput {
  markdown: string;
}

// ─── Severity scheme tables ──────────────────────────────────────────────────

interface SeverityRow {
  level: string;
  definition: string;
  /** SLA target for resolution. */
  resolution: string;
}

const STANDARD_4_LEVEL_ROWS: ReadonlyArray<SeverityRow> = [
  {
    level: 'Critical',
    definition: 'Blocks go-live; system unusable; no workaround. Examples: data corruption, unable to log in, financial transactions failing.',
    resolution: 'Resolve before go-live. 4h initial response.',
  },
  {
    level: 'High',
    definition: 'Major function impaired; workaround exists but slow. Examples: approval workflow misroutes; report wrong data but exportable.',
    resolution: 'Resolve before go-live. 1 business day initial response.',
  },
  {
    level: 'Medium',
    definition: 'Minor function impaired; workaround acceptable. Examples: dashboard portlet refresh delay; non-critical field validation.',
    resolution: 'Resolve in hypercare (first 30 days post-go-live). 3 business day initial response.',
  },
  {
    level: 'Low',
    definition: 'Cosmetic / nice-to-have. Examples: typo, minor UI inconsistency, low-impact UX nits.',
    resolution: 'Backlog. Bundled into next quarterly release.',
  },
];

const MAJOR_MINOR_ROWS: ReadonlyArray<SeverityRow> = [
  {
    level: 'Major',
    definition: 'Anything blocking or impairing core business function. Combines Critical + High in the standard scheme.',
    resolution: 'Resolve before go-live. 4h initial response.',
  },
  {
    level: 'Minor',
    definition: 'Workaround acceptable; does not block UAT sign-off. Combines Medium + Low in the standard scheme.',
    resolution: 'Hypercare or backlog at consultant + client PM discretion.',
  },
];

const NUMERIC_1_5_ROWS: ReadonlyArray<SeverityRow> = [
  {
    level: '1 - Blocker',
    definition: 'System unusable; no workaround. Equivalent to Critical.',
    resolution: 'Resolve before go-live. 4h initial response.',
  },
  {
    level: '2 - Critical',
    definition: 'Major function broken; partial workaround exists. Resolve before go-live.',
    resolution: 'Resolve before go-live. 1 business day initial response.',
  },
  {
    level: '3 - Major',
    definition: 'Important function impaired; reasonable workaround exists.',
    resolution: 'Resolve in hypercare. 3 business day initial response.',
  },
  {
    level: '4 - Minor',
    definition: 'Cosmetic or low-impact issue.',
    resolution: 'Backlog — next sprint or quarterly release.',
  },
  {
    level: '5 - Trivial',
    definition: 'Nice-to-have / typo / spelling fix.',
    resolution: 'Backlog — bundled with future enhancement work.',
  },
];

function rowsFor(scheme: DefectSeverityScheme): ReadonlyArray<SeverityRow> {
  switch (scheme) {
    case 'MAJOR_MINOR':
      return MAJOR_MINOR_ROWS;
    case 'NUMERIC_1_5':
      return NUMERIC_1_5_ROWS;
    case 'STANDARD_4_LEVEL':
    default:
      return STANDARD_4_LEVEL_ROWS;
  }
}

function normaliseScheme(raw: string | null | undefined): DefectSeverityScheme {
  const upper = (raw ?? '').toString().toUpperCase();
  if (upper === 'MAJOR_MINOR') return 'MAJOR_MINOR';
  if (upper === 'NUMERIC_1_5') return 'NUMERIC_1_5';
  return 'STANDARD_4_LEVEL';
}

function schemeLabel(scheme: DefectSeverityScheme): string {
  switch (scheme) {
    case 'MAJOR_MINOR':
      return 'Major / Minor (lightweight 2-level)';
    case 'NUMERIC_1_5':
      return 'Numeric 1-5 (Jira-default style)';
    case 'STANDARD_4_LEVEL':
    default:
      return 'Standard 4-level (Critical / High / Medium / Low)';
  }
}

function exampleSeverity(scheme: DefectSeverityScheme): string {
  switch (scheme) {
    case 'MAJOR_MINOR':
      return 'Major';
    case 'NUMERIC_1_5':
      return '1 - Blocker';
    case 'STANDARD_4_LEVEL':
    default:
      return 'Critical';
  }
}

// ─── Markdown emission ───────────────────────────────────────────────────────

export function generateDefectLogTemplate(
  input: DefectLogTemplateGeneratorInput,
): DefectLogTemplateGeneratorOutput {
  const scheme = normaliseScheme(input.defectSeverityLevels);
  const rows = rowsFor(scheme);
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const exampleSev = exampleSeverity(scheme);

  const severityRowsMd = rows
    .map((r) => `| **${r.level}** | ${r.definition} |`)
    .join('\n');

  const slaRowsMd = rows
    .map((r) => `| ${r.level} | ${r.resolution} |`)
    .join('\n');

  const markdown = [
    `# Defect Log Template — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Severity scheme:** ${schemeLabel(scheme)}  `,
    `**Date:** ${new Date().toLocaleDateString()}  `,
    `**Prepared by:** ERPLaunch`,
    '',
    'This is the canonical defect register for the implementation. Every defect',
    'logged during UAT, hypercare, or post-go-live regression is added here. The',
    'severity definitions below drive triage, the workflow defines the lifecycle,',
    'and the resolution-target table sets SLAs.',
    '',
    '## 1. Severity Definitions',
    '',
    '| Severity | Definition |',
    '|----------|------------|',
    severityRowsMd,
    '',
    '## 2. Defect Lifecycle',
    '',
    '`OPEN` → `TRIAGE` → `IN_PROGRESS` → `READY_FOR_RETEST` → `RESOLVED` → `CLOSED`',
    '',
    'Edge transitions:',
    '- `OPEN → REJECTED` — defect is invalid, duplicate, or out of scope.',
    '- `READY_FOR_RETEST → REOPENED` — fix did not work; back to `IN_PROGRESS`.',
    '- `RESOLVED → ACCEPTED_AS_KNOWN` — sponsor signs off on accepting the issue without resolving (rare; for Low/Trivial only).',
    '',
    '## 3. Defect Register',
    '',
    '| Defect ID | Test Case | Severity | Title | Description | Steps to Reproduce | Expected | Actual | Status | Owner | Date Logged | Date Resolved | Resolution |',
    '|-----------|-----------|----------|-------|-------------|--------------------|----------|--------|--------|-------|-------------|---------------|------------|',
    `| D-001 | TC-P2P-01 | ${exampleSev} | _[example: PO approval routes to wrong tier]_ | _[describe what is broken]_ | _[1. ... 2. ... 3. ...]_ | _[what should happen]_ | _[what actually happens]_ | OPEN | _[ASSIGN]_ | ${new Date().toLocaleDateString()} |  |  |`,
    '| D-002 |           |           |       |             |                    |          |        |        |       |             |               |            |',
    '',
    '## 4. Resolution Targets (SLA)',
    '',
    '| Severity | Resolution Target |',
    '|----------|-------------------|',
    slaRowsMd,
    '',
    '## 5. Reporting Cadence',
    '',
    '- **Daily during UAT:** Defect stand-up (10 min) — review new + in-progress defects.',
    '- **Weekly during UAT + hypercare:** Defect summary report to steering (counts by severity + status, ageing analysis).',
    '- **Pre go-live:** Critical/High close-out report — every Critical/High either RESOLVED or accepted by sponsor.',
    '',
    '_Generated by ERPLaunch — Pack T (Test Artifacts)._',
    '',
  ].join('\n');

  return { markdown };
}
