/**
 * Migration Runbook generator (Pack Z — Component 6).
 *
 * Cross-platform — emits Documentation/Data_Migration/Migration_Runbook.md.
 *
 * The migration lead's hour-by-hour playbook for the cutover load. Cross-
 * references the Cutover_Runbook (Pack V) for the surrounding cutover
 * sequence — this runbook covers the data-migration window specifically.
 *
 * Phases:
 *   1. Pre-cutover prep (T-30 / T-14 / T-7 / T-3 / T-1) — readiness gates
 *   2. Cutover window — Sat 18:00 → Mon 06:00 typical 36h window
 *   3. Post-cutover validation + sign-off
 *   4. Rollback decision tree
 */

import {
  objectsInScope,
  loadOrder,
  DEFAULT_DRY_RUN_PASS_THRESHOLD,
  DEFAULT_HISTORICAL_DEPTH,
  type MigrationObject,
} from './migrationHelpers.js';

export interface MigrationRunbookInput {
  clientName: string;
  adaptorName: string;
  answers: Record<string, unknown>;
  /** TEXT migration.details.historicalDataDepth. */
  historicalDataDepth?: string | null;
  /** TEXT migration.readiness.dryRunPassThreshold. */
  dryRunPassThreshold?: string | null;
  /** TEXT migration.readiness.migrationCutoffDate. */
  migrationCutoffDate?: string | null;
  /** TEXT kickoff.mandate.targetGoLiveDate. */
  targetGoLiveDate?: string | null;
}

export interface MigrationRunbookOutput {
  markdown: string;
}

function loadStepLine(idx: number, obj: MigrationObject): string {
  return `${String(idx + 1).padStart(2, '0')}. **${obj.label}** (\`${obj.csvFilename}\`) — load, then run reconciliation queries; sign off before proceeding.`;
}

export function generateMigrationRunbook(
  input: MigrationRunbookInput,
): MigrationRunbookOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const inScope = objectsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });
  const order = loadOrder(inScope);

  const goLive = input.targetGoLiveDate?.trim().length
    ? input.targetGoLiveDate.trim()
    : '_[ASSIGN target go-live]_';
  const cutoff = input.migrationCutoffDate?.trim().length
    ? input.migrationCutoffDate.trim()
    : '_[ASSIGN — last business day before go-live]_';
  const passThreshold = input.dryRunPassThreshold?.trim().length
    ? input.dryRunPassThreshold.trim()
    : DEFAULT_DRY_RUN_PASS_THRESHOLD;
  const historicalDepth = input.historicalDataDepth?.trim().length
    ? input.historicalDataDepth.trim()
    : DEFAULT_HISTORICAL_DEPTH;

  const loadSteps = order.map((obj, idx) => loadStepLine(idx, obj)).join('\n');

  const markdown = [
    `# Migration Runbook — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Target go-live:** ${goLive}  `,
    `**Migration cut-off:** ${cutoff}  `,
    `**Pass threshold:** ${passThreshold}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Hour-by-hour playbook for the data-migration window. The surrounding cutover ',
    'sequence (system freeze, comms, go-live decision, post-cutover smoke) lives in ',
    '`Documentation/Cutover/Cutover_Runbook.md`. This runbook is the data-migration ',
    'slice that the Cutover Runbook references for the data-load window.',
    '',
    '## Historical Data Depth',
    '',
    historicalDepth,
    '',
    '## Phase 1 — Pre-Cutover Readiness Gates',
    '',
    'The migration lead is the gate-keeper for each readiness checkpoint. Going ',
    'live with a failed gate is a sponsor-only decision.',
    '',
    '### T-30 — Cleansing complete',
    '',
    '- [ ] All cleansing rules in `./Cleansing_Rules.md` are **Closed**.',
    '- [ ] Source-extract scripts are reviewable, tested, and version-controlled.',
    '- [ ] Field mapping workbook (`./Field_Mapping_Workbook.md`) is signed off by ',
    '      finance + ops + IT leads.',
    '- [ ] Dry-run #1 has run end-to-end on full-volume data.',
    '',
    '### T-14 — Dry-run #2',
    '',
    '- [ ] Dry-run #2 results recorded in `./Data_Quality_Scorecard.md`.',
    '- [ ] Pass-rate ≥ ' + passThreshold + '.',
    '- [ ] All financial-total reconciliations balance to source extract within tolerance.',
    '- [ ] Rejects from #1 have been categorised + fixed; #2 rejects logged for #3.',
    '',
    '### T-7 — Dry-run #3 (final dress rehearsal)',
    '',
    '- [ ] Dry-run #3 executed in a refresh of production-equivalent target.',
    '- [ ] End-to-end timing recorded — informs the cutover-window go/no-go.',
    '- [ ] Rollback procedure rehearsed (pre-load snapshot → restore → verify).',
    '',
    '### T-3 — Source-system freeze decision',
    '',
    '- [ ] Migration cut-off (' + cutoff + ') agreed with finance + sponsor.',
    '- [ ] Final source extract scheduled.',
    '- [ ] War-room participants confirmed (see `Documentation/Hypercare/War_Room_SOP.md`).',
    '',
    '### T-1 — Pre-flight',
    '',
    '- [ ] Final pre-cutover snapshot of source taken + archived.',
    '- [ ] Target environment frozen for new configuration changes.',
    '- [ ] All migration-team members on-call confirmed.',
    '',
    '## Phase 2 — Cutover Window',
    '',
    `Typical window: Sat 18:00 → Mon 06:00 (36h). Adjust per the cut-off date `,
    `(${cutoff}) + go-live (${goLive}). Detailed wall-clock timeline lives in the `,
    'Cutover Runbook — this section captures the data-migration steps within that window.',
    '',
    '### Step 1 — Snapshot target',
    '',
    `Take a database snapshot of the target ${platform} environment immediately before `,
    'load step 1. Tag with the cutover ID. This is the rollback anchor.',
    '',
    '### Step 2 — Final source extract',
    '',
    'Pull the final extract from source per the cut-off date. Cleansing rules from ',
    '`./Cleansing_Rules.md` re-apply automatically (the cleansing pipeline runs as ',
    'part of the extract).',
    '',
    '### Step 3 — Load in canonical order',
    '',
    'Run the loads in catalog order. After each load, run the count + financial-total ',
    'check from `./Reconciliation_Queries.md` and score in `./Data_Quality_Scorecard.md`.',
    '',
    loadSteps,
    '',
    '### Step 4 — Cumulative trial balance',
    '',
    'After step ' + order.length + ', run the cumulative trial-balance check on every ',
    `${platform.toLowerCase().includes('netsuite') ? 'subsidiary' : 'company'} × currency `,
    'pair. Net must equal zero. Investigate any non-zero balance before proceeding.',
    '',
    '## Phase 3 — Post-Load Validation + Sign-Off',
    '',
    '- [ ] All reconciliation queries return matched results.',
    '- [ ] Power-user spot checks: 5-10 randomly-selected records per object opened ',
    '      and visually verified against source.',
    '- [ ] Finance controller signs off on opening balances.',
    '- [ ] Migration lead signs off on overall load.',
    '- [ ] Sign-off lands in `Documentation/Cutover/Cutover_Runbook.md` checkpoint table.',
    '',
    '## Phase 4 — Rollback Decision Tree',
    '',
    '| Trigger | Action | Decision authority |',
    '|---------|--------|---------------------|',
    '| > 5% rejects on financial objects (AR / AP / GL) | HALT load; investigate | Migration lead |',
    '| Trial balance does not net to zero | HALT load; investigate | Finance controller |',
    '| Cumulative load time > 1.5× dry-run #3 estimate | Convene war room; assess go/no-go | Sponsor |',
    '| Unrecoverable target-system error | EXECUTE ROLLBACK (snapshot restore) | Sponsor |',
    '',
    'Rollback procedure (high-level):',
    '',
    '1. Halt all running loads.',
    `2. Restore the target ${platform} environment from the pre-load snapshot.`,
    '3. Validate the restore via reconciliation queries (count = 0 for every loaded object).',
    '4. Notify the war room. Convene go-live deferral decision per the Cutover Runbook.',
    '',
    '## Cross-References',
    '',
    '- Cutover runbook (parent): `Documentation/Cutover/Cutover_Runbook.md`',
    '- Rollback plan: `Documentation/Cutover/Rollback_Plan.md`',
    '- Go/no-go matrix: `Documentation/Cutover/Go_NoGo_Matrix.md`',
    '- War-room SOP: `Documentation/Hypercare/War_Room_SOP.md`',
    '- CSV import templates: `./Templates/`',
    '- Field mapping workbook: `./Field_Mapping_Workbook.md`',
    '- Reconciliation queries: `./Reconciliation_Queries.md`',
    '- Cleansing rules: `./Cleansing_Rules.md`',
    '- Load sequencing: `./Load_Sequencing.md`',
    '- Reject handling: `./Reject_Handling_Playbook.md`',
    '- Data quality scorecard: `./Data_Quality_Scorecard.md`',
    '',
    '_Generated by ERPLaunch — Pack Z (Data Migration Assets)._',
    '',
  ].join('\n');

  return { markdown };
}
