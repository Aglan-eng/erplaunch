/**
 * Rollback Plan generator (Pack V — Cutover, Component 4).
 *
 * Cross-platform — emits Documentation/Cutover/Rollback_Plan.md.
 *
 * Reads cutover.decisions.rollbackTriggers + cutoverStyle (from Migration
 * flow) + adaptorName. Renders a 3-phase rollback procedure (halt forward
 * progress / restore legacy / communicate) plus post-rollback recovery
 * checklist.
 *
 * Sources:
 *   - ITIL change-management rollback patterns (back-out plan).
 *   - Standard ERP cutover playbooks (rollback decision tree + restoration steps).
 */

export type RollbackCutoverStyle =
  | 'BIG_BANG'
  | 'PARALLEL_RUN'
  | 'PHASED_ENTITY'
  | 'PHASED_MODULE';

export interface RollbackPlanGeneratorInput {
  clientName: string;
  adaptorName?: string;
  /** TEXTAREA cutover.decisions.rollbackTriggers. */
  rollbackTriggers?: string | null;
  /** SELECT cutoverStyle — drives the platform-specific restoration steps. */
  cutoverStyle?: RollbackCutoverStyle | string | null;
}

export interface RollbackPlanGeneratorOutput {
  markdown: string;
}

function normaliseStyle(raw: string | null | undefined): RollbackCutoverStyle {
  const upper = (raw ?? '').toString().toUpperCase();
  if (upper === 'PARALLEL_RUN') return 'PARALLEL_RUN';
  if (upper === 'PHASED_ENTITY') return 'PHASED_ENTITY';
  if (upper === 'PHASED_MODULE') return 'PHASED_MODULE';
  return 'BIG_BANG';
}

function parseTriggers(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

function styleSpecificRestoration(style: RollbackCutoverStyle): string {
  switch (style) {
    case 'PARALLEL_RUN':
      return [
        '- For PARALLEL_RUN: legacy is already live — direct users back to legacy as the system of record.',
        '- Halt the new-system data load if mid-flight.',
        '- Reconcile any post-cutover transactions written to the new system back into legacy.',
      ].join('\n');
    case 'PHASED_ENTITY':
      return [
        '- For PHASED_ENTITY: rollback is per-wave — only the entity that triggered the rollback unwinds.',
        '- Already-cut-over entities continue running on the new system unless their data is implicated.',
        '- Restore the failed entity\'s legacy snapshot; resume legacy mode for that entity only.',
      ].join('\n');
    case 'PHASED_MODULE':
      return [
        '- For PHASED_MODULE: rollback unwinds only the affected module wave.',
        '- Earlier-completed module waves remain live on the new system.',
        '- Restore the failed module\'s legacy state; resume legacy mode for that module.',
      ].join('\n');
    case 'BIG_BANG':
    default:
      return [
        '- For BIG_BANG: full restoration of the legacy systems from the snapshot taken at T+0:00.',
        '- Verify each legacy system can accept transactions normally.',
        '- Re-enable legacy authentication if it was disabled at the start of the cutover window.',
      ].join('\n');
  }
}

export function generateRollbackPlan(
  input: RollbackPlanGeneratorInput,
): RollbackPlanGeneratorOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const style = normaliseStyle(input.cutoverStyle);
  const triggers = parseTriggers((input.rollbackTriggers ?? '').toString());

  const triggersBlock =
    triggers.length === 0
      ? '_[ASSIGN rollback triggers — populate `cutover.decisions.rollbackTriggers` in the wizard]_'
      : triggers
          .map((t, i) => `${i + 1}. **${t}** — declared by: Consultant PM (with Final go/no-go owner sign-off)`)
          .join('\n');

  const markdown = [
    `# Rollback Plan — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Cutover Style:** ${style}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'A rollback returns the engagement to its pre-cutover state. Decision authority sits ',
    'with the Final go/no-go owner (see `Documentation/Cutover/Go_No_Go_Matrix.md`). This ',
    'document defines WHEN to roll back, the procedure to follow, and the recovery work ',
    'after the rollback completes.',
    '',
    '## 1. When to Roll Back',
    '',
    'A rollback is declared if ANY of the following triggers fire:',
    '',
    triggersBlock,
    '',
    'Additionally, the rollback option remains open until the **Final Go Declaration** at ',
    `T+windowH (see Go/No-Go Matrix). Past that point, defects are handled via the hypercare `,
    'process — not via rollback.',
    '',
    '## 2. Rollback Procedure',
    '',
    '### Phase 1 — Halt Forward Progress (0-15 min)',
    '',
    '- [ ] STOP all in-flight cutover scripts immediately',
    '- [ ] Notify cutover team via the engagement Slack channel: `ROLLBACK INITIATED`',
    `- [ ] Lock ${platformLabel} production from end users (if any have been admitted)`,
    '- [ ] Pause all integration jobs / scheduled scripts / batch processes',
    '- [ ] Capture state of the in-flight migration (logs + last-applied checkpoint)',
    '',
    '### Phase 2 — Restore Legacy (15-90 min)',
    '',
    styleSpecificRestoration(style),
    '- [ ] Smoke-check legacy: log in as 2-3 representative roles; verify core flows work',
    '- [ ] Verify integrations writing to legacy are flowing again',
    '- [ ] Confirm reporting against legacy returns expected balances',
    '',
    '### Phase 3 — Communicate (60-120 min, runs in parallel with Phase 2)',
    '',
    '- [ ] Per `Documentation/Cutover/Communication_Plan.md`: notify all stakeholders',
    '  that rollback is in progress',
    '- [ ] Email + Slack cascade to Steering + Sponsor + Department Heads',
    '- [ ] If contractually required: notify external auditors / regulators',
    '- [ ] Schedule lessons-learned session within 48h',
    '- [ ] Confirm with users that legacy is operational + accepting transactions',
    '- [ ] Reschedule cutover (target: T+14 to T+30 days, depending on remediation scope)',
    '',
    '## 3. Post-Rollback Recovery',
    '',
    '- [ ] Root-cause analysis within 48h (RCA owner: Consultant PM + Migration lead)',
    '- [ ] Defect log review — every trigger that fired gets a remediation ticket',
    '- [ ] Remediation plan with new cutover target date',
    '- [ ] Re-run dry runs (do NOT skip — even if remediation feels small)',
    '- [ ] Re-validate every Go/No-Go criterion before scheduling new cutover',
    '- [ ] Update this Rollback Plan with lessons-learned for the next attempt',
    '',
    '## 4. What Counts as Mid-Cutover vs Hypercare',
    '',
    'During the cutover window (T+0 → T+windowH): defects = potential rollback trigger.',
    '',
    'After Final Go Declaration: defects flow through the standard defect process per ',
    '`Documentation/Defect_Log_Template.md`. Hypercare team handles per `Documentation/Hypercare_Plan.md` ',
    '(Pack X). Rollback after this point is exceptionally rare and requires Project Sponsor + ',
    'Group COO joint approval.',
    '',
    '## 5. Sign-off',
    '',
    '- **Consultant PM:** ___________________________  Date: __________',
    '- **Client PM:** _______________________________  Date: __________',
    '- **Final Go/No-Go owner:** ____________________  Date: __________',
    '',
    '_Generated by ERPLaunch — Pack V (Cutover Runbook)._',
    '',
  ].join('\n');

  return { markdown };
}
