/**
 * Phase 43.3 — lifecycle stage transition rules + handoff events.
 *
 * Pure helpers shared by the /advance and /regress route handlers so
 * the policy is testable without standing up Fastify.
 *
 * Stages, in canonical order:
 *   PROSPECT → PROPOSED → CONTRACTED → DISCOVERY → SCOPING → BUILD →
 *   UAT → GOLIVE → CLOSEOUT → SLA_ACTIVE → ARCHIVED
 *
 * `nextStage(current)` advances by one, `previousStage(current)`
 * regresses by one, both clamping at the ends.
 *
 * `handoffEventFor(from, to)` returns the named handoff (or null) the
 * route should fire as an activity log entry on a successful
 * transition. Handoff names match the audit vocabulary the PO
 * specified — STAGE_ADVANCED, HANDOFF_TO_IMPLEMENTATION,
 * HANDOFF_TO_SLA, ENGAGEMENT_REGRESSED — plus a generic
 * STAGE_ADVANCED fallback for any non-handoff transition.
 *
 * Notification routing (which roles get pinged) lives at the route
 * layer because it needs DB access; this module just declares the
 * transition rules.
 */

import {
  LIFECYCLE_STAGES,
  type Stage,
  normaliseStage,
  isSalesOutcomeStage,
} from '../types/roles.js';

// nextStage/previousStage walk the LINEAR lifecycle only — WON and
// LOST are off-flow branches that the sales pipeline routes
// (Phase 46.x) transition to explicitly, not via the linear advance.
const ORDER: ReadonlyArray<(typeof LIFECYCLE_STAGES)[number]> = LIFECYCLE_STAGES;
const INDEX: Record<(typeof LIFECYCLE_STAGES)[number], number> = ORDER.reduce(
  (acc, s, i) => {
    acc[s] = i;
    return acc;
  },
  {} as Record<(typeof LIFECYCLE_STAGES)[number], number>,
);

export type StageOrLegacy = string;

/** Resolve any stage string to the canonical Stage union. */
export function toStage(s: StageOrLegacy): Stage {
  return normaliseStage(s);
}

export function nextStage(current: StageOrLegacy): Stage | null {
  const c = toStage(current);
  // Sales outcomes don't participate in linear advance — they require
  // the explicit sales pipeline routes (Phase 46.6 auto-converts WON
  // to DISCOVERY; LOST is terminal).
  if (isSalesOutcomeStage(c)) return null;
  const i = INDEX[c];
  if (i === ORDER.length - 1) return null;
  return ORDER[i + 1];
}

export function previousStage(current: StageOrLegacy): Stage | null {
  const c = toStage(current);
  if (isSalesOutcomeStage(c)) return null;
  const i = INDEX[c];
  if (i === 0) return null;
  return ORDER[i - 1];
}

// ─── Handoff event vocabulary ────────────────────────────────────────────────

export type HandoffEvent =
  | 'STAGE_ADVANCED'
  | 'HANDOFF_TO_IMPLEMENTATION'
  | 'HANDOFF_TO_SLA'
  | 'HANDOFF_TO_CLOSEOUT'
  | 'ENGAGEMENT_REGRESSED';

/**
 * Pick the right activity action for a transition. Three named handoffs
 * trigger when the team boundary changes (sales → implementation,
 * implementation → closeout, closeout → support); everything else is
 * a plain STAGE_ADVANCED. Backwards moves are ENGAGEMENT_REGRESSED
 * regardless of the from/to pair.
 */
export function handoffEventFor(from: StageOrLegacy, to: StageOrLegacy): HandoffEvent {
  const f = toStage(from);
  const t = toStage(to);
  // Linear regression check requires both stages to be on the linear
  // ORDER. Sales-outcome stages (WON/LOST) aren't on the index, so
  // skip the regress detection when either side is off-flow.
  if (!isSalesOutcomeStage(f) && !isSalesOutcomeStage(t)) {
    const fi = INDEX[f as (typeof LIFECYCLE_STAGES)[number]];
    const ti = INDEX[t as (typeof LIFECYCLE_STAGES)[number]];
    if (ti < fi) return 'ENGAGEMENT_REGRESSED';
  }
  if (f === 'PROPOSED' && t === 'CONTRACTED') return 'HANDOFF_TO_IMPLEMENTATION';
  if (f === 'CONTRACTED' && t === 'DISCOVERY') return 'HANDOFF_TO_IMPLEMENTATION';
  if (f === 'GOLIVE' && t === 'CLOSEOUT') return 'HANDOFF_TO_CLOSEOUT';
  if (f === 'CLOSEOUT' && t === 'SLA_ACTIVE') return 'HANDOFF_TO_SLA';
  return 'STAGE_ADVANCED';
}

/**
 * Which engagement-level role(s) a handoff event should "ping". The
 * route layer resolves the actual user assignments and writes the
 * activity message on their behalf — this is the policy.
 */
export interface HandoffNotificationTargets {
  /** Engagement-level role keys to look up via EngagementRole. */
  engagementRoles: ReadonlyArray<string>;
  /** Firm-level role keys to look up via FirmRole. */
  firmRoles: ReadonlyArray<string>;
}

export function handoffNotificationTargets(event: HandoffEvent): HandoffNotificationTargets {
  switch (event) {
    case 'HANDOFF_TO_IMPLEMENTATION':
      return { engagementRoles: ['PROJECT_MANAGER', 'PROJECT_LEAD'], firmRoles: [] };
    case 'HANDOFF_TO_CLOSEOUT':
      return { engagementRoles: ['ACCOUNT_MANAGER'], firmRoles: ['SUPPORT_LEAD'] };
    case 'HANDOFF_TO_SLA':
      return { engagementRoles: ['SUPPORT_ENGINEER', 'ACCOUNT_MANAGER'], firmRoles: ['SUPPORT_LEAD'] };
    case 'STAGE_ADVANCED':
    case 'ENGAGEMENT_REGRESSED':
    default:
      return { engagementRoles: [], firmRoles: [] };
  }
}

/**
 * Human-readable activity message body for the audit log. The route
 * layer prepends the actor info so this is just the descriptive
 * sentence.
 */
export function handoffMessageFor(event: HandoffEvent, from: Stage, to: Stage): string {
  switch (event) {
    case 'HANDOFF_TO_IMPLEMENTATION':
      return `Engagement contracted — ready for kickoff (${from} → ${to})`;
    case 'HANDOFF_TO_CLOSEOUT':
      return `Engagement going live, prepare for handoff (${from} → ${to})`;
    case 'HANDOFF_TO_SLA':
      return `Engagement now in SLA — assigned engineers take over (${from} → ${to})`;
    case 'ENGAGEMENT_REGRESSED':
      return `Engagement moved backwards: ${from} → ${to}`;
    case 'STAGE_ADVANCED':
    default:
      return `Stage advanced: ${from} → ${to}`;
  }
}
