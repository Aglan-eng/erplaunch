import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '@/lib/api';

/**
 * Phase 43.5 — frontend permission lookup.
 *
 * Reads /me/permissions for the current user (optionally scoped to
 * an engagement) and exposes a tiny `can()` helper plus the raw role
 * lists for sidebar / button gating.
 *
 * The backend matrix is the source of truth — this hook just reflects
 * the server's verdict so the UI can hide forbidden surfaces before
 * a 403 round-trip. Failed checks fail-closed (treat as NONE) so a
 * network blip doesn't accidentally surface admin features to a
 * non-admin user.
 */

export type PermissionAction = 'NONE' | 'READ' | 'WRITE';

export type PermissionResource =
  | 'ENGAGEMENT_META' | 'WIZARD_ANSWERS' | 'DECISIONS' | 'RISKS'
  | 'ISSUES' | 'MEETINGS' | 'MEMBERS' | 'DATA_COLLECTION'
  | 'ACTION_ITEMS' | 'COMMENTS' | 'IMAGES' | 'GENERATORS'
  | 'BILLING' | 'ACTIVITY_LOG' | 'INTEGRATIONS' | 'ROLES';

export interface PermissionsResponse {
  userId: string;
  firmId: string;
  engagementId: string | null;
  stage: string;
  firmRoles: string[];
  engagementRoles: string[];
  assignedModulesByRole: Record<string, string[] | null>;
  effective: Record<PermissionResource, PermissionAction>;
}

const RANK: Record<PermissionAction, number> = { NONE: 0, READ: 1, WRITE: 2 };

/**
 * Single source of truth for "is this action allowed?" — `can('WRITE',
 * 'DECISIONS')` is true when effective[DECISIONS] is WRITE; `can('READ',
 * 'DECISIONS')` is true when effective[DECISIONS] is READ or WRITE.
 */
export function actionAtLeast(actual: PermissionAction, required: PermissionAction): boolean {
  return RANK[actual] >= RANK[required];
}

export interface PermissionVerdict {
  allowed: boolean;
  /** Tooltip copy for buttons disabled by permission — populated when
   *  allowed is false. Phrased "Requires <ROLE> to <verb> <resource>". */
  tooltip?: string;
}

export interface UsePermissionsResult {
  data: PermissionsResponse | undefined;
  isLoading: boolean;
  /** Returns false when permissions haven't loaded yet — fail-closed. */
  can: (action: PermissionAction, resource: PermissionResource) => boolean;
  /** Phase 44.4 — verdict + tooltip for button gating. */
  canOrTooltip: (action: PermissionAction, resource: PermissionResource) => PermissionVerdict;
  /** True when the user has any of the named roles (firm OR engagement). */
  hasRole: (...roles: string[]) => boolean;
  /** True when the user has the role on a module (or has it without
   *  module restriction). Used by the wizard sidebar to filter
   *  modules for FUNCTIONAL_CONSULTANT etc. */
  hasModuleAccess: (role: string, moduleId: string) => boolean;
}

// ─── Phase 44.4 — tooltip helpers ────────────────────────────────────────────
//
// Mapping from resource → the role that most cleanly grants WRITE on
// it. The tooltip is informational; the API still re-checks the matrix.

const REQUIRED_ROLE_FOR_WRITE: Record<PermissionResource, string> = {
  ENGAGEMENT_META: 'PROJECT_MANAGER',
  WIZARD_ANSWERS: 'FUNCTIONAL_CONSULTANT',
  DECISIONS: 'PROJECT_LEAD',
  RISKS: 'PROJECT_MANAGER',
  ISSUES: 'PROJECT_MANAGER',
  MEETINGS: 'PROJECT_MANAGER',
  MEMBERS: 'PROJECT_MANAGER',
  DATA_COLLECTION: 'PROJECT_MANAGER',
  ACTION_ITEMS: 'PROJECT_MANAGER',
  COMMENTS: 'CLIENT_LEAD',
  IMAGES: 'PROJECT_MANAGER',
  GENERATORS: 'PROJECT_MANAGER',
  BILLING: 'INTERNAL_ACCOUNTANT',
  ACTIVITY_LOG: 'PROJECT_MANAGER',
  INTEGRATIONS: 'APP_ADMIN',
  ROLES: 'APP_ADMIN',
};

const RESOURCE_LABEL: Record<PermissionResource, string> = {
  ENGAGEMENT_META: 'engagement details',
  WIZARD_ANSWERS: 'wizard answers',
  DECISIONS: 'decisions',
  RISKS: 'risks',
  ISSUES: 'issues',
  MEETINGS: 'meetings',
  MEMBERS: 'team members',
  DATA_COLLECTION: 'data collection',
  ACTION_ITEMS: 'action items',
  COMMENTS: 'comments',
  IMAGES: 'attachments',
  GENERATORS: 'deliverables',
  BILLING: 'billing',
  ACTIVITY_LOG: 'the activity log',
  INTEGRATIONS: 'integrations',
  ROLES: 'roles',
};

function tooltipFor(action: PermissionAction, resource: PermissionResource): string {
  const verb = action === 'WRITE' ? 'edit' : action === 'READ' ? 'view' : 'access';
  const role = REQUIRED_ROLE_FOR_WRITE[resource];
  const noun = RESOURCE_LABEL[resource];
  return `Requires ${role} to ${verb} ${noun}.`;
}

export function usePermissions(engagementId?: string | null): UsePermissionsResult {
  const query = useQuery<PermissionsResponse>({
    queryKey: ['me-permissions', engagementId ?? null],
    queryFn: async () => {
      const url = engagementId
        ? `/me/permissions?engagementId=${encodeURIComponent(engagementId)}`
        : '/me/permissions';
      const r = await api.get(url);
      return r.data.data as PermissionsResponse;
    },
    staleTime: 30_000,
  });

  const can = useMemo(() => {
    return (action: PermissionAction, resource: PermissionResource): boolean => {
      const e = query.data?.effective?.[resource];
      if (!e) return false;
      return actionAtLeast(e, action);
    };
  }, [query.data]);

  const canOrTooltip = useMemo(() => {
    return (action: PermissionAction, resource: PermissionResource): PermissionVerdict => {
      const e = query.data?.effective?.[resource];
      if (!e) {
        // Permissions haven't loaded yet — fail closed but skip the
        // tooltip so we don't flash a noisy hint during the initial
        // page render.
        return { allowed: false };
      }
      const allowed = actionAtLeast(e, action);
      if (allowed) return { allowed: true };
      return { allowed: false, tooltip: tooltipFor(action, resource) };
    };
  }, [query.data]);

  const hasRole = useMemo(() => {
    return (...roles: string[]): boolean => {
      const all = new Set([
        ...(query.data?.firmRoles ?? []),
        ...(query.data?.engagementRoles ?? []),
      ]);
      return roles.some((r) => all.has(r));
    };
  }, [query.data]);

  const hasModuleAccess = useMemo(() => {
    return (role: string, moduleId: string): boolean => {
      const modules = query.data?.assignedModulesByRole?.[role];
      // No assignment row at all → no access. NULL modules → unrestricted.
      if (modules === undefined) return false;
      if (modules === null) return true;
      return modules.includes(moduleId);
    };
  }, [query.data]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    can,
    canOrTooltip,
    hasRole,
    hasModuleAccess,
  };
}
