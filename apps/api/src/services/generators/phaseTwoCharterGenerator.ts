/**
 * Phase Two Charter generator (Pack Y — Component 7).
 *
 * Cross-platform — emits Documentation/Stabilization/Phase_Two_Charter.md.
 *
 * The kickoff package for the next major implementation wave. Charter
 * sections (vision, scope candidates, sequencing, dependencies, kickoff
 * window) + decision gate at T+180 (greenlight criteria).
 */

import {
  parseBacklog,
  DEFAULT_PHASE_TWO_SEEDS,
  type ParsedBacklogRow,
} from './stabilizationHelpers.js';

export interface PhaseTwoCharterInput {
  clientName: string;
  adaptorName?: string;
  /** TEXTAREA stabilization.backlog.phaseTwoScope. */
  phaseTwoScope?: string | null;
  /** TEXTAREA stabilization.backlog.deferredFeatures — supplements scope. */
  deferredFeatures?: string | null;
  /** TEXT stabilization.governance.stabilizationOwner — drives sponsorship. */
  stabilizationOwner?: string | null;
  /** TEXT kickoff.mandate.targetGoLiveDate — drives T+180 anchor. */
  targetGoLiveDate?: string | null;
}

export interface PhaseTwoCharterOutput {
  markdown: string;
}

function calcAnchor(goLiveRaw: string | null | undefined, days: number): string {
  if (!goLiveRaw) return `T+${days} (anchor TBD until go-live confirmed)`;
  const m = goLiveRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return `T+${days}`;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return `T+${days}`;
  d.setUTCDate(d.getUTCDate() + days);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `T+${days} (${yyyy}-${mm}-${dd})`;
}

function scopeRow(r: ParsedBacklogRow): string {
  return [
    `| ${r.item}`,
    r.context.length > 0 ? r.context : '_[ASSIGN business case]_',
    r.classification.length > 0 ? r.classification : '_[ASSIGN sequence]_',
    '_[ASSIGN effort]_',
    '',
  ].join(' | ');
}

export function generatePhaseTwoCharter(
  input: PhaseTwoCharterInput,
): PhaseTwoCharterOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const owner = input.stabilizationOwner?.trim().length
    ? input.stabilizationOwner.trim()
    : '_[ASSIGN stabilization owner / phase-two sponsor]_';
  const phaseTwoFromOverlay = parseBacklog((input.phaseTwoScope ?? '').toString());
  const deferredFromOverlay = parseBacklog((input.deferredFeatures ?? '').toString());

  // Phase Two scope = consultant phaseTwoScope overlay (primary) +
  // selected deferredFeatures rows tagged for phase-two waves +
  // canonical defaults when overlay sparse.
  const overlayCandidates = phaseTwoFromOverlay.length > 0 ? phaseTwoFromOverlay : DEFAULT_PHASE_TWO_SEEDS;
  const overlaySource =
    phaseTwoFromOverlay.length > 0
      ? '_(Source: parsed `stabilization.backlog.phaseTwoScope` overlay.)_'
      : '_(Source: canonical default phase-two seeds — overlay sparse. Customise via `stabilization.backlog.phaseTwoScope`.)_';

  const t180 = calcAnchor(input.targetGoLiveDate, 180);
  const t270 = calcAnchor(input.targetGoLiveDate, 270);

  const markdown = [
    `# Phase Two Charter — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Sponsor (proposed):** ${owner}  `,
    `**Greenlight Gate:** ${t180}  `,
    `**Suggested Kickoff Window:** ${t180} → ${t270}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'The kickoff package for the next major implementation wave. Phase two captures ',
    'everything that was deferred from the initial implementation, plus opportunities ',
    'that surfaced during stabilization. Charter approval at the greenlight gate ',
    `(${t180}) gates the transition from steady-state operations into a fresh ` +
      'implementation cycle.',
    '',
    '## 1. Why a Phase Two Exists',
    '',
    'Two reasons:',
    '',
    '1. **Deferred scope** — items dropped from the initial implementation to hit go-live, ',
    '   tracked via `stabilization.backlog.deferredFeatures` overlay.',
    '2. **Discovered opportunity** — items the team identified during hypercare and ',
    '   stabilization that justify their own project (vs. fitting in the change-request queue).',
    '',
    deferredFromOverlay.length > 0
      ? '**Deferred-features-driven candidates** (from `stabilization.backlog.deferredFeatures` overlay):\n' +
          deferredFromOverlay
            .map(
              (r) =>
                `- **${r.item}** — deferred because: ${r.context || 'reason TBD'} — target wave: ${r.classification || 'TBD'}`,
            )
            .join('\n')
      : '_(Deferred-features overlay is empty — no auto-imported candidates. Populate `stabilization.backlog.deferredFeatures` to surface them here.)_',
    '',
    '## 2. Vision',
    '',
    `Phase Two takes ${input.clientName}'s ${platformLabel} platform from "stable run-rate ` +
      'system" to "competitive advantage." Where the initial implementation focused on ' +
      'replacing legacy + clearing the audit floor, phase two focuses on automating the ' +
      'manual edges, expanding to deferred scope, and unlocking analytics that weren\'t ' +
      'possible on the legacy stack.',
    '',
    '## 3. Scope Candidates Ranked by Business Case',
    '',
    overlaySource,
    '',
    '| Initiative | Business case headline | Sequence | Estimated effort |',
    '|------------|------------------------|----------|------------------|',
    overlayCandidates.map(scopeRow).join('\n'),
    '',
    '## 4. Sequencing Rationale',
    '',
    'Phase Two waves typically run in dependency order:',
    '',
    '1. **First wave (T+180 → T+270):** Items that reduce the most manual effort — the ',
    '   ROI is fastest + frees power-user attention for later waves.',
    '2. **Second wave (T+270 → T+360):** Items that build on first-wave automations + ',
    '   any new module rollouts.',
    '3. **Third wave (T+360+):** Strategic items requiring full year of run-rate data ',
    '   (e.g., advanced analytics, predictive forecasting).',
    '',
    '## 5. Dependencies on Stabilization Milestones',
    '',
    'Phase Two cannot kick off until ALL of the following are true at the greenlight gate:',
    '',
    '- [ ] Benefits Realization Tracker GREEN on **at least 4 of 6** core metrics (per `Documentation/Stabilization/Benefits_Realization_Tracker.md`)',
    '- [ ] Hypercare exit clean (per `Documentation/Hypercare/Hypercare_Plan.md` section 7 exit gates)',
    '- [ ] Steady-state governance body operational for at least 3 monthly cycles',
    '- [ ] Sponsor still bought in — explicit re-affirmation at T+180 quarterly business review',
    '- [ ] No unresolved critical defects from initial implementation',
    '- [ ] Lessons-learned register signed off + actions backlog incorporated (per `Documentation/Stabilization/Lessons_Learned_Register.md`)',
    '',
    `## 6. Suggested Kickoff Window: ${t180} → ${t270}`,
    '',
    'First wave starts at the greenlight gate. The kickoff package mirrors the initial ',
    'implementation kickoff (see `Documentation/Project_Kickoff.md`):',
    '',
    '- Sponsor + steering re-confirmation',
    '- Updated business case (deltas vs. phase one targets)',
    '- Kickoff workshop',
    '- Sprint zero — design + sandbox setup',
    '- First sprint demo at +30 days',
    '',
    '## 7. Greenlight Decision Gate',
    '',
    `The greenlight decision is made at the ${t180} quarterly business review. ` +
      'Decision authority: Sponsor + Sustainment Owner + CFO joint approval, with input from ' +
      'the full governance body.',
    '',
    'Decision options:',
    '',
    '- **Greenlight all** — kick off first wave immediately',
    '- **Greenlight selectively** — pick 1-2 items, defer the rest to T+270',
    '- **Defer entirely** — extend stabilization, re-evaluate at T+270',
    '- **Cancel** — phase two not justified given current run-rate; absorb candidates into the change-request backlog instead',
    '',
    '## 8. Cross-References',
    '',
    '- Stabilization roadmap: `Documentation/Stabilization/Stabilization_Roadmap.md`',
    '- Process-improvement backlog: `Documentation/Stabilization/Process_Improvement_Backlog.md`',
    '- Benefits realization tracker: `Documentation/Stabilization/Benefits_Realization_Tracker.md`',
    '- Lessons-learned register: `Documentation/Stabilization/Lessons_Learned_Register.md`',
    '- Continuous-improvement governance: `Documentation/Stabilization/Continuous_Improvement_Governance.md`',
    '- Hypercare exit gates: `Documentation/Hypercare/Hypercare_Plan.md`',
    '- Initial implementation kickoff (template for phase-two kickoff): `Documentation/Project_Kickoff.md`',
    '',
    '_Generated by ERPLaunch — Pack Y (Stabilization Roadmap)._',
    '',
  ].join('\n');

  return { markdown };
}
