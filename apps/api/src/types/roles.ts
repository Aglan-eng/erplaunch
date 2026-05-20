/**
 * Phase 43.1 — RBAC type system.
 *
 * 15 roles split across firm-level (4) and engagement-level (11). Roles
 * stack: a single user can hold multiple firm-level roles AND multiple
 * engagement-level roles on different engagements.
 *
 * The role catalog is hardcoded — it doesn't change per firm. New roles
 * land here, in the permission matrix, and in the schema migration's
 * audit log enum.
 *
 * Lifecycle stages extend the existing EngagementStatus enum. The
 * Phase 43.3 commit lands the migration to the Engagement table; this
 * module just types them so the matrix can reference the full set.
 */

// ─── Roles ───────────────────────────────────────────────────────────────────

export const FIRM_LEVEL_ROLES = [
  'APP_ADMIN',
  'CEO',
  'SALES_MANAGER',
  'SUPPORT_LEAD',
  'INTERNAL_ACCOUNTANT',
] as const;

/**
 * Phase 53.3 — Technical-consultant tracks. Each TC works one
 * discipline. EngagementRole.assignedModules carries the track id.
 */
export const TECHNICAL_TRACKS = [
  'integration',
  'data-migration',
  'customization',
  'reporting',
] as const;
export type TechnicalTrack = (typeof TECHNICAL_TRACKS)[number];

export const ENGAGEMENT_LEVEL_ROLES = [
  'SALES_REP',
  'PROJECT_MANAGER',
  'PROJECT_LEAD',
  'FUNCTIONAL_CONSULTANT',
  'TECHNICAL_CONSULTANT',
  'SUPPORT_ENGINEER',
  'ACCOUNT_MANAGER',
  'CLIENT_SPONSOR',
  'CLIENT_LEAD',
  'CLIENT_SME',
  'CLIENT_REVIEWER',
] as const;

export type FirmRole = (typeof FIRM_LEVEL_ROLES)[number];
export type EngagementRole = (typeof ENGAGEMENT_LEVEL_ROLES)[number];
export type Role = FirmRole | EngagementRole;

export const ALL_ROLES: ReadonlyArray<Role> = [
  ...FIRM_LEVEL_ROLES,
  ...ENGAGEMENT_LEVEL_ROLES,
];

export function isFirmLevelRole(role: string): role is FirmRole {
  return (FIRM_LEVEL_ROLES as readonly string[]).includes(role);
}

export function isEngagementLevelRole(role: string): role is EngagementRole {
  return (ENGAGEMENT_LEVEL_ROLES as readonly string[]).includes(role);
}

// Roles that operate on a per-module slice of the engagement (e.g.
// FUNCTIONAL_CONSULTANT only on R2R). The assignedModules JSON column
// on EngagementRole is meaningful for these and ignored for the others.
export const MODULE_SCOPED_ROLES: ReadonlyArray<EngagementRole> = [
  'FUNCTIONAL_CONSULTANT',
  'TECHNICAL_CONSULTANT',
  'CLIENT_SME',
];

export function isModuleScopedRole(role: string): role is EngagementRole {
  return (MODULE_SCOPED_ROLES as readonly string[]).includes(role);
}

// ─── Stages ──────────────────────────────────────────────────────────────────

export const LIFECYCLE_STAGES = [
  'PROSPECT',
  'PROPOSED',
  'CONTRACTED',
  'DISCOVERY',
  'SCOPING',
  'BUILD',
  'UAT',
  'GOLIVE',
  'CLOSEOUT',
  'SLA_ACTIVE',
  'ARCHIVED',
] as const;

/**
 * Phase 46.1 — terminal sales-side outcomes that branch off the
 * linear lifecycle rather than sitting on it. WON is set transiently
 * at SOW-signed time before Phase 46.6 auto-flips the engagement to
 * DISCOVERY; LOST is the permanent dead-end for prospects that never
 * close. These don't participate in nextStage/previousStage.
 */
export const SALES_OUTCOME_STAGES = ['WON', 'LOST'] as const;
export type SalesOutcomeStage = (typeof SALES_OUTCOME_STAGES)[number];

export type Stage = (typeof LIFECYCLE_STAGES)[number] | SalesOutcomeStage;

export function isLifecycleStage(s: string): s is Stage {
  return (
    (LIFECYCLE_STAGES as readonly string[]).includes(s) ||
    (SALES_OUTCOME_STAGES as readonly string[]).includes(s)
  );
}

/** True when the stage is a terminal sales outcome (WON or LOST). */
export function isSalesOutcomeStage(s: string): s is SalesOutcomeStage {
  return (SALES_OUTCOME_STAGES as readonly string[]).includes(s);
}

// Old stage names still in the DB. Map them to the new ones so the
// matrix lookup keeps working for engagements seeded pre-43.3.
export const LEGACY_STAGE_MAP: Record<string, Stage> = {
  // The existing enum uses GO_LIVE; new enum normalises to GOLIVE.
  GO_LIVE: 'GOLIVE',
};

export function normaliseStage(s: string): Stage {
  if (isLifecycleStage(s)) return s;
  const mapped = LEGACY_STAGE_MAP[s];
  if (mapped) return mapped;
  // Unknown stage falls back to DISCOVERY rather than crashing the
  // permission lookup — matches the most common engagement stage and
  // is conservative (most roles get their normal mid-cycle access).
  return 'DISCOVERY';
}

// ─── Resources ───────────────────────────────────────────────────────────────

export const RESOURCES = [
  'ENGAGEMENT_META',
  'WIZARD_ANSWERS',
  'DECISIONS',
  'RISKS',
  'ISSUES',
  'MEETINGS',
  'MEMBERS',
  'DATA_COLLECTION',
  'ACTION_ITEMS',
  'COMMENTS',
  'IMAGES',
  'GENERATORS',
  'BILLING',
  'ACTIVITY_LOG',
  'INTEGRATIONS',
  'ROLES',
] as const;

export type Resource = (typeof RESOURCES)[number];

// ─── Actions ─────────────────────────────────────────────────────────────────

export type Action = 'NONE' | 'READ' | 'WRITE';

const ACTION_RANK: Record<Action, number> = { NONE: 0, READ: 1, WRITE: 2 };

/** True when `actual` grants at least the level of access `required` asks for. */
export function actionAtLeast(actual: Action, required: Action): boolean {
  return ACTION_RANK[actual] >= ACTION_RANK[required];
}

/** Pick the strongest of two actions (used when stacking roles). */
export function maxAction(a: Action, b: Action): Action {
  return ACTION_RANK[a] >= ACTION_RANK[b] ? a : b;
}
