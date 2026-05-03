/**
 * Data Quality Scorecard generator (Pack Z — Component 8).
 *
 * Cross-platform — emits Documentation/Data_Migration/Data_Quality_Scorecard.md.
 *
 * Tracks dry-run pass-rates against the readiness gate at T-30 / T-14 /
 * T-7 / T-3 / T-1. Per-object scorecard table forces visibility of any
 * object that's not converging.
 *
 * The scorecard is the data-migration sign-off artefact: at T-1, the
 * pass-rate column drives the go/no-go decision the sponsor reads from
 * the Cutover_Runbook (Pack V).
 */

import {
  objectsInScope,
  parseDataQualityOwners,
  DEFAULT_DRY_RUN_PASS_THRESHOLD,
  type MigrationObject,
} from './migrationHelpers.js';

export interface DataQualityScorecardInput {
  clientName: string;
  adaptorName: string;
  answers: Record<string, unknown>;
  /** TEXT migration.readiness.dryRunPassThreshold. */
  dryRunPassThreshold?: string | null;
  /** TEXTAREA migration.readiness.dataQualityOwners. */
  dataQualityOwners?: string | null;
  /** TEXT migration.readiness.migrationCutoffDate. */
  migrationCutoffDate?: string | null;
  /** TEXT kickoff.mandate.targetGoLiveDate. */
  targetGoLiveDate?: string | null;
}

export interface DataQualityScorecardOutput {
  markdown: string;
}

function objectScorecardRow(obj: MigrationObject, owner: string): string {
  return `| ${obj.label} | ${owner} | _[%]_ | _[%]_ | _[%]_ | _[%]_ | _[%]_ | _[Open/Closed]_ |`;
}

export function generateDataQualityScorecard(
  input: DataQualityScorecardInput,
): DataQualityScorecardOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const inScope = objectsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });
  const owners = parseDataQualityOwners((input.dataQualityOwners ?? '').toString());
  const ownerByObject = new Map<string, string>();
  for (const o of owners) {
    ownerByObject.set(o.object.toLowerCase(), o.owner);
  }

  const passThreshold = input.dryRunPassThreshold?.trim().length
    ? input.dryRunPassThreshold.trim()
    : DEFAULT_DRY_RUN_PASS_THRESHOLD;
  const goLive = input.targetGoLiveDate?.trim().length
    ? input.targetGoLiveDate.trim()
    : '_[ASSIGN target go-live]_';
  const cutoff = input.migrationCutoffDate?.trim().length
    ? input.migrationCutoffDate.trim()
    : '_[ASSIGN migration cut-off]_';

  const objectRows = inScope
    .map((obj) => {
      const owner =
        ownerByObject.get(obj.label.toLowerCase()) ??
        ownerByObject.get(obj.id.toLowerCase()) ??
        '_[ASSIGN]_';
      return objectScorecardRow(obj, owner);
    })
    .join('\n');

  const markdown = [
    `# Data Quality Scorecard — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Target go-live:** ${goLive}  `,
    `**Migration cut-off:** ${cutoff}  `,
    `**Pass threshold:** ${passThreshold}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Per-object pass-rate tracker across the five dry-run / readiness checkpoints. ',
    'The migration lead updates this scorecard after every dry-run and at every ',
    'pre-cutover gate. The pass-rate column at T-1 drives the go/no-go decision the ',
    'sponsor reads from `Documentation/Cutover/Cutover_Runbook.md` and ',
    '`Documentation/Cutover/Go_NoGo_Matrix.md`.',
    '',
    '## Readiness Gates',
    '',
    'The scorecard is sampled at five wall-clock checkpoints:',
    '',
    '| Gate | Wall-clock | What it gates |',
    '|------|-----------|---------------|',
    '| **T-30** | 30 days before go-live | Cleansing-rule closure + dry-run #1 |',
    '| **T-14** | 14 days before go-live | Dry-run #2 — must hit pass threshold |',
    '| **T-7**  | 7 days before go-live  | Dry-run #3 — full dress rehearsal |',
    '| **T-3**  | 3 days before go-live  | Source freeze decision |',
    '| **T-1**  | 1 day before go-live   | Final go/no-go gate |',
    '',
    `Pass threshold across all gates: **${passThreshold}**.`,
    '',
    '## Per-Object Scorecard',
    '',
    'Update the cells with the actual pass-rate observed at each gate (e.g. ',
    '`99.7%`). Status flips to `Closed` when the object is signed off; otherwise ',
    'stays `Open` and is tracked weekly.',
    '',
    '| Object | Owner | T-30 pass-rate | T-14 pass-rate | T-7 pass-rate | T-3 pass-rate | T-1 pass-rate | Status |',
    '|--------|-------|----------------|----------------|---------------|----------------|----------------|--------|',
    objectRows,
    '',
    '## Aggregate Pass-Rate',
    '',
    'Roll-up: weighted average of per-object pass-rate, weighted by record count ',
    'in the source extract. Tracked per gate.',
    '',
    '| Gate | Aggregate pass-rate | Threshold | Decision |',
    '|------|---------------------|-----------|----------|',
    '| T-30 | _[%]_ | ' + passThreshold + ' | Cleansing fully closed? |',
    '| T-14 | _[%]_ | ' + passThreshold + ' | Dry-run #2 acceptable? |',
    '| T-7  | _[%]_ | ' + passThreshold + ' | Dry-run #3 acceptable? |',
    '| T-3  | _[%]_ | ' + passThreshold + ' | Approve source freeze? |',
    '| T-1  | _[%]_ | ' + passThreshold + ' | **GO / NO-GO** |',
    '',
    '## Decision Rules',
    '',
    '1. **At T-1 below threshold** — escalate to sponsor immediately. Likely ',
    '   outcomes: defer go-live by 1 week OR convene war room to triage worst-',
    '   performing objects in-flight.',
    '2. **Trend declining across T-30 → T-14 → T-7** — early-warning signal even ',
    '   if absolute pass-rate is acceptable. Convene migration-lead review.',
    '3. **Single object stuck below threshold while others pass** — exclude that ',
    '   object from the cutover load if business-feasible (e.g. fixed assets often ',
    '   defer one week post-cutover); otherwise full no-go.',
    '4. **Financial-object pass-rate < 100% at T-1** — automatic NO-GO unless ',
    '   finance controller signs off in writing.',
    '',
    '## Cross-References',
    '',
    '- Cutover runbook: `Documentation/Cutover/Cutover_Runbook.md`',
    '- Go/no-go matrix: `Documentation/Cutover/Go_NoGo_Matrix.md`',
    '- Migration runbook: `./Migration_Runbook.md`',
    '- Reconciliation queries: `./Reconciliation_Queries.md`',
    '- Reject handling: `./Reject_Handling_Playbook.md`',
    '- Cleansing rules: `./Cleansing_Rules.md`',
    '- CSV import templates: `./Templates/`',
    '',
    '_Generated by ERPLaunch — Pack Z (Data Migration Assets)._',
    '',
  ].join('\n');

  return { markdown };
}
