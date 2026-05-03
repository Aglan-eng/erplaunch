/**
 * Dry Run Plan generator (Pack V — Component 7a).
 *
 * Cross-platform — emits Documentation/Cutover/Dry_Run_Plan.md.
 *
 * Reads cutover.team.dryRunCount + cutover.team.dryRunDates +
 * cutoverStyle. Renders one section per declared dry run with
 * focus / participants / pass criteria + a pass-to-production checklist.
 *
 * Sources:
 *   - SuiteSuccess + SAP Activate dry-run conventions (typically 2-3
 *     dry runs before production cutover).
 *   - Standard ERP migration playbook — dry-run #1 = data only,
 *     dry-run #2 = full E2E, dry-run #3 = identical-to-production rehearsal.
 */

export interface DryRunPlanGeneratorInput {
  clientName: string;
  adaptorName?: string;
  /** NUMBER cutover.team.dryRunCount. */
  dryRunCount?: number;
  /** TEXTAREA cutover.team.dryRunDates. */
  dryRunDates?: string | null;
  /** SELECT cutoverStyle. */
  cutoverStyle?: string | null;
}

export interface DryRunPlanGeneratorOutput {
  markdown: string;
}

interface ParsedDryRun {
  label: string;
  date: string;
  focus: string;
}

function parseDryRuns(raw: string): ParsedDryRun[] {
  const out: ParsedDryRun[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const firstColon = trimmed.indexOf(':');
    if (firstColon < 0) continue;
    const label = trimmed.slice(0, firstColon).trim();
    const rest = trimmed.slice(firstColon + 1).trim();
    const secondColon = rest.indexOf(':');
    const date = secondColon < 0 ? rest : rest.slice(0, secondColon).trim();
    const focus = secondColon < 0 ? '' : rest.slice(secondColon + 1).trim();
    out.push({ label, date, focus });
  }
  return out;
}

const DEFAULT_FOCI: ReadonlyArray<{ focus: string; duration: string; participants: string; passCriteria: string[] }> = [
  {
    focus: 'Data migration only (extract → transform → load)',
    duration: '~12h on Saturday',
    participants: 'Migration lead + IT + 2 functional testers',
    passCriteria: [
      'All extracts complete',
      'Validation queries pass',
      'TB tie-out within $0.01 per entity',
    ],
  },
  {
    focus: 'Full end-to-end with user testing',
    duration: 'Full cutover-window length',
    participants: 'Full cutover team + key power users',
    passCriteria: [
      'Migration tie-out passes',
      'P0 smoke scenarios all green',
      'All in-scope role logins succeed',
    ],
  },
  {
    focus: 'Final rehearsal — identical to production',
    duration: 'Full cutover-window length',
    participants: 'Full cutover team + sponsor + executive observers',
    passCriteria: [
      'All Go/No-Go criteria pass',
      'Comms cascade fires correctly at every milestone',
      'No findings beyond minor cosmetic issues',
    ],
  },
];

export function generateDryRunPlan(input: DryRunPlanGeneratorInput): DryRunPlanGeneratorOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const declared = parseDryRuns((input.dryRunDates ?? '').toString());
  const declaredCount =
    typeof input.dryRunCount === 'number' && input.dryRunCount > 0
      ? input.dryRunCount
      : Math.max(declared.length, 0);
  const effectiveCount = declaredCount > 0 ? declaredCount : 3;

  const sections: string[] = [];
  for (let i = 0; i < effectiveCount; i++) {
    const declaredEntry = declared[i];
    const defaultFocus = DEFAULT_FOCI[i] ?? DEFAULT_FOCI[DEFAULT_FOCI.length - 1];
    const date = declaredEntry?.date.length ? declaredEntry.date : '_[ASSIGN date]_';
    const focus =
      declaredEntry?.focus && declaredEntry.focus.length > 0
        ? declaredEntry.focus
        : defaultFocus.focus;
    const label = declaredEntry?.label && declaredEntry.label.length > 0
      ? declaredEntry.label
      : `Dry Run ${i + 1}`;

    sections.push(
      [
        `### ${label}: ${date}`,
        '',
        `- **Focus:** ${focus}`,
        `- **Duration:** ${defaultFocus.duration}`,
        `- **Participants:** ${defaultFocus.participants}`,
        '- **Pass Criteria:**',
        ...defaultFocus.passCriteria.map((c) => `  - ${c}`),
        '',
      ].join('\n'),
    );
  }

  const markdown = [
    `# Cutover Dry Run Plan — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Dry Run Count:** ${effectiveCount}  `,
    `**Cutover Style:** ${input.cutoverStyle ?? 'BIG_BANG'}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    '## 1. Why Dry Run',
    '',
    'Dry runs validate the cutover procedure end-to-end against a snapshot of ',
    'production data, BEFORE the real cutover weekend. Every defect found in a dry ',
    'run is one fewer in production. Industry consensus is **2-3 dry runs minimum** ',
    'for any non-trivial ERP cutover; regulated industries typically run 3+.',
    '',
    `${effectiveCount} dry run(s) scheduled for this engagement.`,
    '',
    '## 2. Dry Run Schedule',
    '',
    sections.join('\n'),
    '## 3. Dry Run Pass-To-Production Checklist',
    '',
    'After each dry run:',
    '',
    '- [ ] All findings logged in defect register (per `Documentation/Defect_Log_Template.md`)',
    '- [ ] Critical/High findings remediated before next dry run',
    '- [ ] Re-run failed steps to verify fix',
    '- [ ] Update `Documentation/Cutover/Cutover_Runbook.md` with lessons learned',
    '- [ ] Communicate findings to Steering at next gate review',
    '',
    '## 4. What Counts as Production-Ready',
    '',
    'Final dry run must pass with:',
    '- Zero Critical defects open',
    '- ≤ 2 High defects open with documented workarounds',
    '- 100% of P0 smoke scenarios green',
    '- All Go/No-Go criteria validated',
    '',
    'Anything below this threshold = the production cutover gets rescheduled, NOT ',
    'forced through. Track the decision via the Go/No-Go matrix sign-off.',
    '',
    '## 5. Cross-References',
    '',
    '- Cutover Runbook: `Documentation/Cutover/Cutover_Runbook.md`',
    '- Go/No-Go Matrix: `Documentation/Cutover/Go_No_Go_Matrix.md`',
    '- Post-Cutover Smoke: `Documentation/Cutover/Post_Cutover_Smoke.md`',
    '- Defect Log Template: `Documentation/Defect_Log_Template.md`',
    '',
    '_Generated by ERPLaunch — Pack V (Cutover Runbook)._',
    '',
  ].join('\n');

  return { markdown };
}
