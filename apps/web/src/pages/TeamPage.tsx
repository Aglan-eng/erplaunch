import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, ShieldCheck, X, Plus, ScrollText, AlertCircle,
} from 'lucide-react';
import { teamApi, engagementsApi, type TeamMember, type RoleAuditEntry } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

/**
 * Phase 43.4 — Settings → Team page (App Admin only).
 *
 * Three sections stacked vertically:
 *   1. Firm-level roles — table of users with APP_ADMIN /
 *      SALES_MANAGER / SUPPORT_LEAD / INTERNAL_ACCOUNTANT badges.
 *      Click a user row to add/remove firm roles via inline buttons.
 *   2. Engagement-level roles — list of engagements, expandable to
 *      show per-engagement assignments. "Assign role" opens a modal.
 *   3. Recent audit log — last 200 ROLE_GRANTED / ROLE_REVOKED
 *      entries with actor + target + role + scope.
 *
 * Permission guard: the page redirects non-APP_ADMIN users back to
 * /settings (the API would 403 anyway; the redirect avoids a
 * confusing error toast).
 */

const FIRM_LEVEL_ROLES = ['APP_ADMIN', 'SALES_MANAGER', 'SUPPORT_LEAD', 'INTERNAL_ACCOUNTANT'] as const;
const ENGAGEMENT_LEVEL_ROLES = [
  'SALES_REP', 'PROJECT_MANAGER', 'PROJECT_LEAD',
  'FUNCTIONAL_CONSULTANT', 'TECHNICAL_CONSULTANT',
  'SUPPORT_ENGINEER', 'ACCOUNT_MANAGER',
  'CLIENT_SPONSOR', 'CLIENT_LEAD', 'CLIENT_SME', 'CLIENT_REVIEWER',
] as const;
const MODULE_SCOPED_ROLES = new Set(['FUNCTIONAL_CONSULTANT', 'TECHNICAL_CONSULTANT', 'CLIENT_SME']);

const ROLE_BADGE_COLOR: Record<string, string> = {
  APP_ADMIN: 'bg-violet-100 text-violet-700',
  SALES_MANAGER: 'bg-cyan-100 text-cyan-700',
  SALES_REP: 'bg-cyan-50 text-cyan-700',
  PROJECT_MANAGER: 'bg-amber-100 text-amber-700',
  PROJECT_LEAD: 'bg-amber-200 text-amber-800',
  FUNCTIONAL_CONSULTANT: 'bg-blue-100 text-blue-700',
  TECHNICAL_CONSULTANT: 'bg-blue-100 text-blue-700',
  SUPPORT_LEAD: 'bg-teal-100 text-teal-700',
  SUPPORT_ENGINEER: 'bg-teal-50 text-teal-700',
  ACCOUNT_MANAGER: 'bg-emerald-100 text-emerald-700',
  INTERNAL_ACCOUNTANT: 'bg-slate-200 text-slate-700',
  CLIENT_SPONSOR: 'bg-orange-100 text-orange-700',
  CLIENT_LEAD: 'bg-orange-50 text-orange-700',
  CLIENT_SME: 'bg-orange-50 text-orange-700',
  CLIENT_REVIEWER: 'bg-gray-100 text-gray-600',
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide',
        ROLE_BADGE_COLOR[role] ?? 'bg-gray-100 text-gray-600',
      )}
    >
      {role}
    </span>
  );
}

export function TeamPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const teamQuery = useQuery({ queryKey: ['team'], queryFn: () => teamApi.listTeam() });
  const auditQuery = useQuery({ queryKey: ['role-audit-log'], queryFn: () => teamApi.listAuditLog() });
  const engagementsQuery = useQuery({ queryKey: ['engagements'], queryFn: () => engagementsApi.list() });

  // Permission guard. The API also enforces this via requirePermission,
  // but redirecting saves the user a 403 toast.
  const isAppAdmin = (teamQuery.data ?? []).some((m) => m.id === user?.id && m.firmRoles.includes('APP_ADMIN'));
  const guardLoading = teamQuery.isLoading;

  const grantFirmMut = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => teamApi.grantFirmRole(userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] });
      qc.invalidateQueries({ queryKey: ['role-audit-log'] });
    },
  });

  const revokeFirmMut = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => teamApi.revokeFirmRole(userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] });
      qc.invalidateQueries({ queryKey: ['role-audit-log'] });
    },
  });

  if (guardLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAppAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md text-center">
          <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-slate-900">Admins only</h1>
          <p className="text-sm text-slate-500 mt-2">
            Team management is restricted to App Admins. Talk to your firm admin if you need access.
          </p>
          <Link to="/settings" className="inline-block mt-5 text-sm font-semibold text-brand-600 hover:text-brand-700">
            ← Back to Settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <Link to="/settings" className="text-sm text-slate-500 hover:text-slate-700">← Settings</Link>
          <h1 className="text-xl font-semibold text-slate-900 mt-1 flex items-center gap-2">
            <Users className="h-5 w-5 text-brand-600" />
            Team
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Grant firm-level and per-engagement roles. Every change is auditable below.
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* ─── Firm-level roles ────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="h-4 w-4 text-violet-600" />
            <h2 className="text-base font-semibold text-slate-900">Firm-level roles</h2>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            APP_ADMIN, SALES_MANAGER, SUPPORT_LEAD, INTERNAL_ACCOUNTANT apply across every engagement in the firm.
          </p>
          <div className="overflow-hidden border border-slate-200 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">User</th>
                  <th className="text-left px-4 py-2 font-semibold">Roles</th>
                  <th className="text-right px-4 py-2 font-semibold">Add</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(teamQuery.data ?? []).map((member) => (
                  <FirmRoleRow
                    key={member.id}
                    member={member}
                    onGrant={(role) => grantFirmMut.mutate({ userId: member.id, role })}
                    onRevoke={(role) => revokeFirmMut.mutate({ userId: member.id, role })}
                    isPending={grantFirmMut.isPending || revokeFirmMut.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ─── Engagement-level roles ─────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-emerald-600" />
            <h2 className="text-base font-semibold text-slate-900">Engagement-level roles</h2>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Per-engagement assignments. Module-scoped roles (Functional/Technical Consultant, Client SME) get a
            modules picker that reads from the engagement's adaptor schema.
          </p>
          <div className="space-y-2">
            {((engagementsQuery.data ?? []) as Array<{ id: string; clientName: string; status: string }>).map((eng) => (
              <EngagementRoleSection
                key={eng.id}
                engagementId={eng.id}
                clientName={eng.clientName}
                status={eng.status}
                team={teamQuery.data ?? []}
              />
            ))}
            {(engagementsQuery.data ?? []).length === 0 && (
              <p className="text-sm text-slate-500 italic">
                No engagements yet — engagement-level roles assign once you create one from the dashboard.
              </p>
            )}
          </div>
        </section>

        {/* ─── Audit log ──────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <ScrollText className="h-4 w-4 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">Recent role changes</h2>
          </div>
          <ul className="space-y-1.5 text-xs">
            {((auditQuery.data ?? []) as RoleAuditEntry[]).slice(0, 50).map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-slate-600">
                <span
                  className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded',
                    e.action === 'ROLE_GRANTED' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700',
                  )}
                >
                  {e.action === 'ROLE_GRANTED' ? 'GRANTED' : 'REVOKED'}
                </span>
                <RoleBadge role={e.role} />
                <span className="text-slate-500">on {e.scope}</span>
                <span className="ml-auto text-[10px] text-slate-400">
                  {new Date(e.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </li>
            ))}
            {(auditQuery.data ?? []).length === 0 && (
              <li className="text-slate-400 italic">No role changes recorded yet.</li>
            )}
          </ul>
        </section>
      </main>
    </div>
  );
}

// ─── Firm-level row ──────────────────────────────────────────────────────────

function FirmRoleRow({
  member,
  onGrant,
  onRevoke,
  isPending,
}: {
  member: TeamMember;
  onGrant: (role: string) => void;
  onRevoke: (role: string) => void;
  isPending: boolean;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const available = FIRM_LEVEL_ROLES.filter((r) => !member.firmRoles.includes(r));
  return (
    <tr className="hover:bg-slate-50/50">
      <td className="px-4 py-3">
        <div className="text-sm font-semibold text-slate-900">{member.name}</div>
        <div className="text-xs text-slate-400">{member.email}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {member.firmRoles.length === 0 && (
            <span className="text-[11px] text-slate-400 italic">No firm roles</span>
          )}
          {member.firmRoles.map((r) => (
            <span key={r} className="inline-flex items-center gap-1">
              <RoleBadge role={r} />
              <button
                type="button"
                disabled={isPending}
                onClick={() => onRevoke(r)}
                className="text-slate-400 hover:text-rose-600 disabled:opacity-40"
                aria-label={`Revoke ${r}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        {available.length > 0 ? (
          adding === member.id ? (
            <select
              autoFocus
              onBlur={() => setAdding(null)}
              onChange={(e) => {
                const role = e.target.value;
                if (role) {
                  onGrant(role);
                  setAdding(null);
                }
              }}
              defaultValue=""
              className="text-xs border border-slate-300 rounded-md px-2 py-1"
            >
              <option value="" disabled>Pick a role</option>
              {available.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(member.id)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-800"
            >
              <Plus className="h-3 w-3" />
              Add role
            </button>
          )
        ) : (
          <span className="text-[11px] text-slate-400 italic">All assigned</span>
        )}
      </td>
    </tr>
  );
}

// ─── Engagement row + assignment modal ───────────────────────────────────────

function EngagementRoleSection({
  engagementId,
  clientName,
  status,
  team,
}: {
  engagementId: string;
  clientName: string;
  status: string;
  team: TeamMember[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const rolesQuery = useQuery({
    queryKey: ['engagement-roles', engagementId],
    queryFn: () => teamApi.listEngagementRoles(engagementId),
    enabled: open,
  });

  const adaptorQuery = useQuery({
    queryKey: ['engagement-adaptor', engagementId],
    queryFn: () => engagementsApi.getAdaptor(engagementId),
    enabled: assigning,
    retry: false,
  });

  const grantMut = useMutation({
    mutationFn: (body: { userId: string; role: string; assignedModules?: string[] | null }) =>
      teamApi.grantEngagementRole(engagementId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engagement-roles', engagementId] });
      qc.invalidateQueries({ queryKey: ['role-audit-log'] });
      setAssigning(false);
    },
  });

  const revokeMut = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      teamApi.revokeEngagementRole(engagementId, userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engagement-roles', engagementId] });
      qc.invalidateQueries({ queryKey: ['role-audit-log'] });
    },
  });

  const usersById = new Map(team.map((u) => [u.id, u]));

  return (
    <div className="border border-slate-200 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50/40"
      >
        <div className="text-left">
          <p className="text-sm font-semibold text-slate-900">{clientName}</p>
          <p className="text-[11px] text-slate-400">{status}</p>
        </div>
        <span className="text-xs text-slate-400">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-2">
          {(rolesQuery.data ?? []).length === 0 ? (
            <p className="text-xs text-slate-500 italic">No engagement-level roles assigned.</p>
          ) : (
            <ul className="space-y-1.5">
              {(rolesQuery.data ?? []).map((row, i) => {
                const u = usersById.get(row.userId);
                return (
                  <li key={`${row.userId}-${row.role}-${i}`} className="flex items-center gap-2 text-xs">
                    <RoleBadge role={row.role} />
                    <span className="text-slate-700">{u?.name ?? row.userId}</span>
                    {row.assignedModules && row.assignedModules.length > 0 && (
                      <span className="text-[10px] text-slate-500">modules: {row.assignedModules.join(', ')}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => revokeMut.mutate({ userId: row.userId, role: row.role })}
                      className="ml-auto text-slate-400 hover:text-rose-600"
                      aria-label={`Revoke ${row.role}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setAssigning(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-800 mt-2"
          >
            <Plus className="h-3 w-3" />
            Assign role
          </button>
        </div>
      )}
      {assigning && (
        <AssignRoleModal
          team={team}
          adaptorSchema={adaptorQuery.data?.schema}
          onCancel={() => setAssigning(false)}
          onSubmit={(body) => grantMut.mutate(body)}
          isPending={grantMut.isPending}
        />
      )}
    </div>
  );
}

function AssignRoleModal({
  team,
  adaptorSchema,
  onCancel,
  onSubmit,
  isPending,
}: {
  team: TeamMember[];
  adaptorSchema: unknown;
  onCancel: () => void;
  onSubmit: (body: { userId: string; role: string; assignedModules?: string[] | null }) => void;
  isPending: boolean;
}) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('');
  const [modules, setModules] = useState<string[]>([]);
  const moduleScoped = MODULE_SCOPED_ROLES.has(role);

  // Pull module ids from the adaptor schema's flow list. Falls back
  // to a fixed NetSuite-shaped list when the schema isn't loaded so
  // the modal still works on legacy adaptors that pre-date the SPI.
  const flows = (() => {
    const s = adaptorSchema as { flows?: Array<{ id?: string }> } | undefined;
    if (s?.flows && Array.isArray(s.flows)) {
      return s.flows.map((f) => String(f.id ?? '')).filter(Boolean);
    }
    return ['r2r', 'p2p', 'o2c', 'production', 'returns'];
  })();

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-900">Assign engagement role</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">User</span>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Pick a user</option>
              {team.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.email}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Pick a role</option>
              {ENGAGEMENT_LEVEL_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>

          {moduleScoped && (
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="text-xs font-semibold text-slate-600 px-1">
                Modules
                <span className="ml-1 text-slate-400 font-normal">(leave empty for all)</span>
              </legend>
              <div className="flex flex-wrap gap-2 mt-2">
                {flows.map((m) => {
                  const checked = modules.includes(m);
                  return (
                    <label key={m} className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setModules((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))
                        }
                        className="rounded border-slate-300"
                      />
                      <span>{m}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!userId || !role || isPending}
            onClick={() =>
              onSubmit({
                userId,
                role,
                assignedModules: moduleScoped && modules.length > 0 ? modules : null,
              })
            }
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}
