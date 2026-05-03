/**
 * Process Improvement Backlog generator (Pack Y — Component 4).
 *
 * Cross-platform — emits Documentation/Stabilization/Process_Improvement_Backlog.md.
 *
 * Three queues: Quick Wins (≤ 2 weeks), Enhancements (≤ 1 quarter),
 * Phase Two (next wave). Quick Wins seed from canonical defaults
 * (common hypercare workarounds); Enhancements from deferredFeatures
 * overlay; Phase Two from phaseTwoScope overlay; Known Limitations
 * from knownLimitations overlay. Triage rules + submission template.
 */

import {
  parseBacklog,
  DEFAULT_QUICK_WIN_SEEDS,
  DEFAULT_PHASE_TWO_SEEDS,
  type ParsedBacklogRow,
} from './stabilizationHelpers.js';

export interface ProcessImprovementBacklogInput {
  clientName: string;
  adaptorName?: string;
  /** TEXTAREA stabilization.backlog.deferredFeatures. */
  deferredFeatures?: string | null;
  /** TEXTAREA stabilization.backlog.knownLimitations. */
  knownLimitations?: string | null;
  /** TEXTAREA stabilization.backlog.phaseTwoScope. */
  phaseTwoScope?: string | null;
}

export interface ProcessImprovementBacklogOutput {
  markdown: string;
}

function backlogTable(
  rows: ReadonlyArray<ParsedBacklogRow>,
  cols: { item: string; context: string; classification: string },
): string {
  if (rows.length === 0) {
    return `| _[ASSIGN ${cols.item.toLowerCase()}]_ | _[ASSIGN ${cols.context.toLowerCase()}]_ | _[ASSIGN ${cols.classification.toLowerCase()}]_ |`;
  }
  return rows
    .map(
      (r) =>
        `| ${r.item} | ${r.context || `_[ASSIGN ${cols.context.toLowerCase()}]_`} | ${r.classification || `_[ASSIGN ${cols.classification.toLowerCase()}]_`} |`,
    )
    .join('\n');
}

export function generateProcessImprovementBacklog(
  input: ProcessImprovementBacklogInput,
): ProcessImprovementBacklogOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';

  const deferred = parseBacklog((input.deferredFeatures ?? '').toString());
  const knownLim = parseBacklog((input.knownLimitations ?? '').toString());
  const phaseTwo = parseBacklog((input.phaseTwoScope ?? '').toString());

  // Quick Wins always seeds from defaults — these are common hypercare-
  // period workarounds the consultant probably hit. Engagements can
  // delete rows that don't apply.
  const quickWinsTable = DEFAULT_QUICK_WIN_SEEDS.map(
    (r) => `| ${r.item} | ${r.context} | ${r.classification} |`,
  ).join('\n');

  const enhancementsTable = backlogTable(deferred, {
    item: 'Feature',
    context: 'Reason deferred',
    classification: 'Target wave',
  });

  const effectivePhaseTwo = phaseTwo.length > 0 ? phaseTwo : DEFAULT_PHASE_TWO_SEEDS;
  const phaseTwoTable = backlogTable(effectivePhaseTwo, {
    item: 'Initiative',
    context: 'Business case headline',
    classification: 'Sequence',
  });

  const limitationsTable = backlogTable(knownLim, {
    item: 'Limitation',
    context: 'Workaround',
    classification: 'Permanent or temporary',
  });

  const markdown = [
    `# Process Improvement Backlog — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Three queues track every improvement opportunity that surfaces post-go-live: ',
    '**Quick Wins** (deliver within 2 weeks), **Enhancements** (deliver within 1 quarter), ',
    'and **Phase Two** (the next major wave). Known limitations + workarounds get a ',
    'separate section so the team distinguishes "by-design" from "to-fix."',
    '',
    '## 1. Quick Wins (≤ 2 weeks)',
    '',
    'Common hypercare-period workarounds that can be eliminated immediately post-hypercare. ',
    'Quick Wins are the highest-leverage queue — they free up power-user attention and ',
    'restore confidence that "the system actually works for us, not the other way around."',
    '',
    '| Item | Context / Implementation | Effort |',
    '|------|--------------------------|--------|',
    quickWinsTable,
    '',
    '_(Seed from canonical hypercare-workaround library. Delete rows that don\'t apply to this engagement; add engagement-specific rows underneath.)_',
    '',
    '## 2. Enhancements (≤ 1 quarter)',
    '',
    'Deferred features from the initial implementation. Larger than Quick Wins (typically ',
    '2-12 weeks of effort), smaller than Phase Two (don\'t need a charter).',
    '',
    '| Feature | Reason deferred | Target wave |',
    '|---------|-----------------|-------------|',
    enhancementsTable,
    '',
    deferred.length === 0
      ? '_(Source: empty `stabilization.backlog.deferredFeatures` overlay. Populate the wizard with deferred-feature rows.)_'
      : '_(Source: parsed `stabilization.backlog.deferredFeatures` overlay.)_',
    '',
    '## 3. Phase Two (next wave)',
    '',
    'Multi-month initiatives requiring their own charter. See `Documentation/Stabilization/Phase_Two_Charter.md` ',
    'for the full kickoff package.',
    '',
    '| Initiative | Business case headline | Sequence |',
    '|------------|------------------------|----------|',
    phaseTwoTable,
    '',
    phaseTwo.length === 0
      ? '_(Source: canonical default Phase Two seeds — overlay sparse. Populate `stabilization.backlog.phaseTwoScope` with engagement-specific candidates.)_'
      : '_(Source: parsed `stabilization.backlog.phaseTwoScope` overlay.)_',
    '',
    '## 4. Known Limitations',
    '',
    'Distinct from the queues above — these are aspects of the live system that are EITHER ',
    'permanently by-design OR temporarily limited (with a planned fix). Workaround documented ',
    'so power users know the path of least resistance.',
    '',
    '| Limitation | Workaround | Permanent or temporary |',
    '|------------|------------|------------------------|',
    limitationsTable,
    '',
    knownLim.length === 0
      ? '_(Source: empty `stabilization.backlog.knownLimitations` overlay. Populate as limitations are discovered.)_'
      : '_(Source: parsed `stabilization.backlog.knownLimitations` overlay.)_',
    '',
    '## 5. Triage Rules — Value-vs-Effort 2×2',
    '',
    'New items propose-in via the change-request lifecycle (see `Continuous_Improvement_Governance.md`) ',
    'and land in the appropriate queue per these rules:',
    '',
    '| Effort \\\\ Value | Low Value | High Value |',
    '|-----------------|-----------|------------|',
    '| **Low Effort (≤ 2 weeks)** | Quick Win OR drop | Quick Win — top priority |',
    '| **High Effort (> 2 weeks)** | Backlog only — no commitment | Enhancement OR Phase Two depending on scope |',
    '',
    '**Stays in steady-state queues** — Low-effort items + bounded enhancements within budget.',
    '**Promotes to a project (Phase Two)** — Multi-month + multi-stakeholder + cross-module.',
    '',
    '## 6. Submission Template',
    '',
    'End users / power users / champions submit new items via the change-request process ',
    'in `Continuous_Improvement_Governance.md` section 3. Required fields:',
    '',
    '- **Title** — one-line description',
    '- **Problem statement** — what isn\'t working today',
    '- **Proposed solution** — how the change addresses the problem',
    '- **Business value** — quantified impact if known',
    '- **Risk if not done** — what happens if we defer',
    '- **Submitter + workstream** — name + functional area',
    '',
    'Triage at the next monthly steering meeting. Decision recorded in this backlog ',
    'within 5 business days of submission.',
    '',
    '## 7. Cross-References',
    '',
    '- Continuous-improvement governance: `Documentation/Stabilization/Continuous_Improvement_Governance.md`',
    '- Stabilization roadmap: `Documentation/Stabilization/Stabilization_Roadmap.md`',
    '- Phase-two charter: `Documentation/Stabilization/Phase_Two_Charter.md`',
    '- Benefits realization tracker: `Documentation/Stabilization/Benefits_Realization_Tracker.md`',
    '- Lessons-learned register: `Documentation/Stabilization/Lessons_Learned_Register.md`',
    '',
    '_Generated by ERPLaunch — Pack Y (Stabilization Roadmap)._',
    '',
  ].join('\n');

  return { markdown };
}
