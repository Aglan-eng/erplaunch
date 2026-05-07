/**
 * Phase 43.1 — RBAC permission matrix + can() helper.
 *
 * Given the 15 roles × 11 lifecycle stages × 16 resources, the full
 * matrix would be 2640 entries — unmaintainable. Instead each role
 * declares a sparse policy with a `default` (the fallback action when
 * no specific override applies) and per-stage / per-resource
 * overrides. Resolution order, most specific wins:
 *
 *   1. policy.stages?.[stage]?.[resource]    (most specific)
 *   2. policy.stages?.[stage]?.['*']         (stage-wide override)
 *   3. policy.resources?.[resource]          (resource-wide override)
 *   4. policy.default                         (fallback)
 *
 * `can(userId, action, resource, engagementId?)` is the runtime entry
 * point: it looks up the user's roles (firm-level + per-engagement),
 * normalises the engagement's stage, and returns true when ANY role
 * grants at least the requested action.
 */

import type {
  Role,
  Stage,
  Resource,
  Action,
} from '../types/roles.js';
import {
  LIFECYCLE_STAGES,
  RESOURCES,
  actionAtLeast,
  maxAction,
  normaliseStage,
} from '../types/roles.js';

// ─── Policy shape ────────────────────────────────────────────────────────────

interface RolePolicy {
  default: Action;
  /** Resource-wide override regardless of stage. */
  resources?: Partial<Record<Resource, Action>>;
  /**
   * Per-stage overrides. The special key '*' inside a stage block means
   * "every resource for this stage" — useful for SALES_MANAGER going
   * fully READ-only after CONTRACTED.
   */
  stages?: Partial<Record<Stage, Partial<Record<Resource | '*', Action>>>>;
}

const SALES_STAGES: ReadonlyArray<Stage> = ['PROSPECT', 'PROPOSED', 'CONTRACTED'];
const IMPLEMENTATION_STAGES: ReadonlyArray<Stage> = ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GOLIVE'];
// POST_GOLIVE_STAGES was removed — no current policy iterates it (the
// roles that care about post-golive stages list them inline). Re-add
// here if a new role needs the trio.

// ─── Per-role policies ───────────────────────────────────────────────────────
//
// Comments on each policy explain the intent so future tweaks don't
// silently break the contract — the unit tests pin the user-visible
// outcomes but the prose here pins the rationale.

const APP_ADMIN_POLICY: RolePolicy = {
  // Full access everywhere. Used for the firm-creator and any
  // explicitly-promoted "App Admin" — equivalent to root.
  default: 'WRITE',
};

// Sales: write during sales stages, read afterwards. Cannot touch
// billing (accountant) or generators (consultants).
function salesPolicy(): RolePolicy {
  const writeStage: Partial<Record<Resource | '*', Action>> = {
    ENGAGEMENT_META: 'WRITE',
    MEMBERS: 'WRITE',
    ACTIVITY_LOG: 'WRITE',
    DECISIONS: 'WRITE',
    COMMENTS: 'WRITE',
  };
  return {
    default: 'READ',
    resources: {
      // Sales has no business writing billing or deliverables.
      BILLING: 'READ',
      GENERATORS: 'READ',
      ROLES: 'READ',
      INTEGRATIONS: 'READ',
    },
    stages: Object.fromEntries(SALES_STAGES.map((s) => [s, writeStage])) as RolePolicy['stages'],
  };
}

const SALES_MANAGER_POLICY: RolePolicy = salesPolicy();

const SALES_REP_POLICY: RolePolicy = {
  // Identical to SALES_MANAGER on stage timing, but tighter on what
  // they can write — reps don't manage decisions for their accounts;
  // that's the manager's call. They can edit the deal metadata + add
  // members + comment.
  default: 'READ',
  resources: {
    GENERATORS: 'NONE',
    ROLES: 'NONE',
    INTEGRATIONS: 'NONE',
    BILLING: 'READ',
  },
  stages: Object.fromEntries(
    SALES_STAGES.map((s) => [s, {
      ENGAGEMENT_META: 'WRITE',
      MEMBERS: 'WRITE',
      ACTIVITY_LOG: 'WRITE',
      COMMENTS: 'WRITE',
    } as Partial<Record<Resource | '*', Action>>]),
  ) as RolePolicy['stages'],
};

// Implementation: read pre-CONTRACTED, full implementation rights
// during DISCOVERY..GOLIVE, read-only afterwards.
function implementationPolicy(extra?: Partial<Record<Resource, Action>>): RolePolicy {
  const writeStage: Partial<Record<Resource | '*', Action>> = {
    WIZARD_ANSWERS: 'WRITE',
    DECISIONS: 'WRITE',
    RISKS: 'WRITE',
    ISSUES: 'WRITE',
    MEETINGS: 'WRITE',
    MEMBERS: 'WRITE',
    DATA_COLLECTION: 'WRITE',
    ACTION_ITEMS: 'WRITE',
    COMMENTS: 'WRITE',
    IMAGES: 'WRITE',
    GENERATORS: 'WRITE',
    ACTIVITY_LOG: 'WRITE',
    INTEGRATIONS: 'WRITE',
    ENGAGEMENT_META: 'WRITE',
    // BILLING + ROLES stay at the resource-level cap below.
    ...(extra ?? {}),
  };
  return {
    default: 'READ',
    resources: {
      BILLING: 'READ',
      ROLES: 'READ',
    },
    stages: Object.fromEntries(IMPLEMENTATION_STAGES.map((s) => [s, writeStage])) as RolePolicy['stages'],
  };
}

const PROJECT_MANAGER_POLICY: RolePolicy = implementationPolicy();
// PROJECT_LEAD is the same shape today — the signoff distinction is
// expressed at the route layer (specific signoff endpoints check role
// directly). Both have WRITE on DECISIONS so the matrix doesn't need
// to differ; the Phase 43.4 "PL only" buttons inspect the role list.
const PROJECT_LEAD_POLICY: RolePolicy = implementationPolicy();

// Consultants: WRITE on the user-content resources; module-scoping
// is enforced separately at the route layer (the matrix can't know
// what module a wizard answer belongs to). They can't touch deal
// economics or roles.
const CONSULTANT_POLICY: RolePolicy = {
  default: 'READ',
  resources: {
    BILLING: 'NONE',
    ROLES: 'NONE',
    GENERATORS: 'READ',
  },
  stages: Object.fromEntries(IMPLEMENTATION_STAGES.map((s) => [s, {
    WIZARD_ANSWERS: 'WRITE',
    RISKS: 'WRITE',
    ISSUES: 'WRITE',
    MEETINGS: 'WRITE',
    DATA_COLLECTION: 'WRITE',
    COMMENTS: 'WRITE',
    IMAGES: 'WRITE',
    ACTIVITY_LOG: 'WRITE',
  } as Partial<Record<Resource | '*', Action>>])) as RolePolicy['stages'],
};

const FUNCTIONAL_CONSULTANT_POLICY: RolePolicy = CONSULTANT_POLICY;
const TECHNICAL_CONSULTANT_POLICY: RolePolicy = CONSULTANT_POLICY;

// Support roles (firm-level SUPPORT_LEAD, engagement-scoped
// SUPPORT_ENGINEER): full operational rights during SLA_ACTIVE,
// read-only earlier (visibility for handoff context).
const SUPPORT_LEAD_POLICY: RolePolicy = {
  default: 'READ',
  resources: {
    BILLING: 'READ',
    ROLES: 'READ',
  },
  stages: {
    SLA_ACTIVE: {
      ISSUES: 'WRITE',
      ACTION_ITEMS: 'WRITE',
      ACTIVITY_LOG: 'WRITE',
      DECISIONS: 'WRITE',
      MEETINGS: 'WRITE',
      COMMENTS: 'WRITE',
      MEMBERS: 'WRITE',
    },
  },
};

const SUPPORT_ENGINEER_POLICY: RolePolicy = SUPPORT_LEAD_POLICY;

// Account manager: lives in SLA_ACTIVE, owns the renewal/expansion
// fields (BILLING + ENGAGEMENT_META).
const ACCOUNT_MANAGER_POLICY: RolePolicy = {
  default: 'READ',
  resources: {
    BILLING: 'READ',
    ROLES: 'READ',
    GENERATORS: 'NONE',
  },
  stages: {
    SLA_ACTIVE: {
      ENGAGEMENT_META: 'WRITE',
      BILLING: 'WRITE',
      ACTIVITY_LOG: 'WRITE',
      COMMENTS: 'WRITE',
    },
    CLOSEOUT: {
      ENGAGEMENT_META: 'WRITE',
      BILLING: 'WRITE',
    },
  },
};

// Internal accountant: BILLING-only WRITE, ENGAGEMENT_META READ for
// dashboard listing. Everything else is NONE — the route layer
// applies a field-level filter on top so they only see billing
// fields on the Engagement payload.
const INTERNAL_ACCOUNTANT_POLICY: RolePolicy = {
  default: 'NONE',
  resources: {
    BILLING: 'WRITE',
    ENGAGEMENT_META: 'READ',
    ACTIVITY_LOG: 'READ',
  },
};

// Client roles. CLIENT_SPONSOR has signoff WRITE on DECISIONS;
// CLIENT_LEAD does not.
function clientPolicyShared(): RolePolicy {
  return {
    default: 'READ',
    resources: {
      BILLING: 'NONE',
      ROLES: 'NONE',
      GENERATORS: 'NONE',
      INTEGRATIONS: 'NONE',
    },
    stages: Object.fromEntries(
      [...IMPLEMENTATION_STAGES, ...SALES_STAGES].map((s) => [s, {
        WIZARD_ANSWERS: 'WRITE',
        COMMENTS: 'WRITE',
        DATA_COLLECTION: 'WRITE',
        IMAGES: 'WRITE',
        MEETINGS: 'WRITE',
      } as Partial<Record<Resource | '*', Action>>]),
    ) as RolePolicy['stages'],
  };
}

const CLIENT_SPONSOR_POLICY: RolePolicy = (() => {
  const base = clientPolicyShared();
  // Sponsor signs off — WRITE on DECISIONS during impl stages.
  for (const stage of IMPLEMENTATION_STAGES) {
    (base.stages![stage] as Partial<Record<Resource | '*', Action>>).DECISIONS = 'WRITE';
  }
  return base;
})();

const CLIENT_LEAD_POLICY: RolePolicy = clientPolicyShared();

const CLIENT_SME_POLICY: RolePolicy = {
  // Same shape as CLIENT_LEAD but the route layer enforces module
  // scoping on every resource access.
  ...clientPolicyShared(),
};

const CLIENT_REVIEWER_POLICY: RolePolicy = {
  default: 'READ',
  resources: {
    BILLING: 'NONE',
    ROLES: 'NONE',
    GENERATORS: 'NONE',
    INTEGRATIONS: 'NONE',
  },
};

// ─── Master matrix ───────────────────────────────────────────────────────────

const MATRIX: Record<Role, RolePolicy> = {
  APP_ADMIN: APP_ADMIN_POLICY,
  SALES_MANAGER: SALES_MANAGER_POLICY,
  SUPPORT_LEAD: SUPPORT_LEAD_POLICY,
  INTERNAL_ACCOUNTANT: INTERNAL_ACCOUNTANT_POLICY,
  SALES_REP: SALES_REP_POLICY,
  PROJECT_MANAGER: PROJECT_MANAGER_POLICY,
  PROJECT_LEAD: PROJECT_LEAD_POLICY,
  FUNCTIONAL_CONSULTANT: FUNCTIONAL_CONSULTANT_POLICY,
  TECHNICAL_CONSULTANT: TECHNICAL_CONSULTANT_POLICY,
  SUPPORT_ENGINEER: SUPPORT_ENGINEER_POLICY,
  ACCOUNT_MANAGER: ACCOUNT_MANAGER_POLICY,
  CLIENT_SPONSOR: CLIENT_SPONSOR_POLICY,
  CLIENT_LEAD: CLIENT_LEAD_POLICY,
  CLIENT_SME: CLIENT_SME_POLICY,
  CLIENT_REVIEWER: CLIENT_REVIEWER_POLICY,
};

// ─── Lookup ──────────────────────────────────────────────────────────────────

/**
 * Pure matrix lookup — given a single role + stage + resource,
 * resolve to the granted Action via the four-tier specificity rule.
 */
export function getActionForRole(role: Role, stage: Stage, resource: Resource): Action {
  const policy = MATRIX[role];
  if (!policy) return 'NONE';
  const stageBlock = policy.stages?.[stage];
  if (stageBlock) {
    if (stageBlock[resource] !== undefined) return stageBlock[resource]!;
    if (stageBlock['*'] !== undefined) return stageBlock['*']!;
  }
  if (policy.resources?.[resource] !== undefined) return policy.resources[resource]!;
  return policy.default;
}

/**
 * Stack a list of roles and return the strongest action across all of
 * them. Used by `can()` after fetching all of a user's roles for the
 * given engagement.
 */
export function evaluateEffectiveAction(
  roles: ReadonlyArray<Role>,
  stage: Stage,
  resource: Resource,
): Action {
  let best: Action = 'NONE';
  for (const role of roles) {
    best = maxAction(best, getActionForRole(role, stage, resource));
  }
  return best;
}

// ─── can() runtime entry point ───────────────────────────────────────────────

/**
 * Inputs to `can()`. The caller hands us the rows we'd otherwise look
 * up — keeping `can()` pure makes it trivially testable and lets the
 * DB-backed wrapper (Phase 43.2 middleware) cache lookups per request.
 */
export interface PermissionCheckInputs {
  /** Firm-level roles for this user (rows from FirmRole). */
  firmRoles: ReadonlyArray<Role>;
  /** Engagement-level roles for this user on the specific engagement
   *  (rows from EngagementRole). Empty when no engagementId was given. */
  engagementRoles: ReadonlyArray<Role>;
  /** The current stage of the engagement. Falls back to DISCOVERY for
   *  firm-wide checks (no engagement context). */
  stage: Stage;
}

export function can(
  inputs: PermissionCheckInputs,
  required: Action,
  resource: Resource,
): boolean {
  if (required === 'NONE') return true;
  const allRoles: Role[] = [...inputs.firmRoles, ...inputs.engagementRoles];
  const effective = evaluateEffectiveAction(allRoles, inputs.stage, resource);
  return actionAtLeast(effective, required);
}

// Re-export type primitives so consumers can `import { Role, Stage,
// Resource, Action } from '../services/permissions.js'` if they
// prefer one path.
export type { Role, Stage, Resource, Action };
export { LIFECYCLE_STAGES, RESOURCES, normaliseStage };
