/**
 * Phase 44.1 — engagement-list visibility rules.
 *
 * The matrix governs WHAT a user can do once they're inside an
 * engagement; this module governs WHICH engagements they see in the
 * dashboard list. Two-tier rule:
 *
 *   1. Any firm-level role (APP_ADMIN, SALES_MANAGER, SUPPORT_LEAD,
 *      INTERNAL_ACCOUNTANT) → all engagements in the firm. Even if
 *      the matrix only grants them READ on a few resources, the
 *      dashboard listing is global so they can navigate.
 *
 *   2. Otherwise — engagement-level roles only — they see only the
 *      engagements where (a) they have a role assignment AND (b) the
 *      engagement is at a stage their role still cares about per
 *      VISIBILITY_RULES below.
 *
 * The stage filter mirrors the PO spec: SALES_REP only sees deals
 * still in the sales funnel (PROSPECT/PROPOSED/CONTRACTED), not
 * deals they sold months ago that are now in BUILD or SLA. Support
 * roles only see live SLA customers. Project-implementation roles
 * see across the full lifecycle on their assigned engagements.
 *
 * Result: a user with no roles sees an empty list — same outcome as
 * the matrix returning NONE on every resource.
 */

import { getDb, listFirmRolesForUser } from '../db/index.js';
import type { Stage } from '../types/roles.js';
import { normaliseStage } from '../types/roles.js';

/** Per-engagement-role stage filter for the dashboard list. 'ALL'
 *  means the role sees the engagement regardless of stage. */
export const VISIBILITY_RULES: Record<string, ReadonlyArray<Stage> | 'ALL'> = {
  SALES_REP: ['PROSPECT', 'PROPOSED', 'CONTRACTED'],
  PROJECT_MANAGER: 'ALL',
  PROJECT_LEAD: 'ALL',
  FUNCTIONAL_CONSULTANT: 'ALL',
  TECHNICAL_CONSULTANT: 'ALL',
  // Support roles get visibility starting at CLOSEOUT (they're in the
  // handoff conversation) and through SLA_ACTIVE.
  SUPPORT_ENGINEER: ['CLOSEOUT', 'SLA_ACTIVE'],
  ACCOUNT_MANAGER: ['CLOSEOUT', 'SLA_ACTIVE'],
  // Clients see their own engagement throughout its life — they
  // need access to historical decisions even after go-live.
  CLIENT_SPONSOR: 'ALL',
  CLIENT_LEAD: 'ALL',
  CLIENT_SME: 'ALL',
  CLIENT_REVIEWER: 'ALL',
};

export type VisibilityScope =
  | { kind: 'ALL' }
  | { kind: 'SCOPED'; ids: ReadonlyArray<string> };

interface EngagementAssignmentRow {
  engagementId: string;
  role: string;
  status: string;
}

/**
 * Resolve the visibility scope for a given user. Returns 'ALL' when
 * the user holds any firm-level role; otherwise computes the SCOPED
 * id list from EngagementRole + Engagement.status.
 */
export async function resolveVisibilityScope(args: {
  userId: string;
  firmId: string;
}): Promise<VisibilityScope> {
  const firmRoles = await listFirmRolesForUser(args.userId);
  if (firmRoles.length > 0) return { kind: 'ALL' };

  const db = getDb();
  // JOIN to pull the engagement status alongside the role
  // assignment in a single query — keeps the per-engagement stage
  // check inside JS rather than spinning the SQL N times.
  const rows = await db.execute({
    sql: `
      SELECT er.engagementId AS engagementId, er.role AS role, e.status AS status
      FROM EngagementRole er
      JOIN Engagement e ON e.id = er.engagementId
      WHERE er.userId = ? AND e.firmId = ?
    `,
    args: [args.userId, args.firmId],
  });

  const visible = new Set<string>();
  for (const row of rows.rows) {
    const r = row as unknown as EngagementAssignmentRow;
    if (roleSeesEngagementAtStage(r.role, r.status)) {
      visible.add(r.engagementId);
    }
  }
  return { kind: 'SCOPED', ids: [...visible] };
}

/**
 * Pure helper — true when an engagement-level role keeps the
 * engagement on the user's list at the given stage.
 *
 * Unknown roles (defensive: a custom role might be inserted by a
 * future migration) → false. Unknown stages normalise via
 * normaliseStage so legacy GO_LIVE → GOLIVE keeps working.
 */
export function roleSeesEngagementAtStage(role: string, stage: string): boolean {
  const rule = VISIBILITY_RULES[role];
  if (rule === undefined) return false;
  if (rule === 'ALL') return true;
  return rule.includes(normaliseStage(stage));
}

/**
 * Apply a visibility scope to a list of engagement objects. Used by
 * the route layer after pulling the firm-wide list:
 *
 *   const scope = await resolveVisibilityScope({ userId, firmId });
 *   const visible = applyVisibilityScope(engagements, scope);
 */
export function applyVisibilityScope<T extends { id: string | unknown }>(
  engagements: ReadonlyArray<T>,
  scope: VisibilityScope,
): T[] {
  if (scope.kind === 'ALL') return [...engagements];
  const allowed = new Set(scope.ids);
  return engagements.filter((e) => typeof e.id === 'string' && allowed.has(e.id));
}
