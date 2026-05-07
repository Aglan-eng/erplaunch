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

export interface UsePermissionsResult {
  data: PermissionsResponse | undefined;
  isLoading: boolean;
  /** Returns false when permissions haven't loaded yet — fail-closed. */
  can: (action: PermissionAction, resource: PermissionResource) => boolean;
  /** True when the user has any of the named roles (firm OR engagement). */
  hasRole: (...roles: string[]) => boolean;
  /** True when the user has the role on a module (or has it without
   *  module restriction). Used by the wizard sidebar to filter
   *  modules for FUNCTIONAL_CONSULTANT etc. */
  hasModuleAccess: (role: string, moduleId: string) => boolean;
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
    hasRole,
    hasModuleAccess,
  };
}
