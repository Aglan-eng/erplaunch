import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check, Circle, CircleDashed, MinusCircle,
  Flag, ChevronDown, ChevronRight, Lock,
} from 'lucide-react';
import { closeoutApi, type CloseoutChecklistItem, type CloseoutChecklistKey, type CloseoutChecklistStatus } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  PermissionDeniedState,
  extractPermissionDenied,
} from '@/components/rbac/PermissionDeniedState';
import { usePermissions } from '@/hooks/usePermissions';

/**
 * Phase 45.1 — Closeout step page.
 *
 * Renders when the engagement is in CLOSEOUT (or ARCHIVED, so the
 * consultant can revisit history). Shows the 9-item checklist with
 * status pills, notes, and "Mark done" / "Mark in-progress" controls.
 *
 * Per-item updates fire optimistically through useMutation and
 * invalidate the list query on success — keeps the activity log feed
 * in sync without a manual refetch.
 *
 * The matrix gates the underlying API on ENGAGEMENT_META; the page
 * re-uses the standard PermissionDeniedState for clean 403 fallback.
 */

const KEY_LABELS: Record<CloseoutChecklistKey, string> = {
  KNOWLEDGE_TRANSFER: 'Knowledge transfer to support team',
  SYSTEM_CATALOG_REVIEWED: 'System catalog reviewed',
  INTEGRATION_LIST_CONFIRMED: 'Integration list confirmed',
  SUPPORT_CONTACTS_ASSIGNED: 'Support contacts assigned',
  SLA_TERMS_AGREED: 'SLA terms agreed',
  FINAL_INVOICE_PAID: 'Final invoice paid',
  PRODUCTION_STABLE: 'Production stable for 7 days',
  CLIENT_SIGNOFF: 'Client closeout sign-off',
  SLA_TEAM_ACCEPT: 'SLA team accepts handover',
};

const STATUS_STYLES: Record<CloseoutChecklistStatus, { dot: string; chip: string; label: string }> = {
  NOT_STARTED: { dot: 'text-slate-300', chip: 'bg-slate-100 text-slate-600', label: 'Not started' },
  IN_PROGRESS: { dot: 'text-amber-500', chip: 'bg-amber-100 text-amber-700', label: 'In progress' },
  DONE: { dot: 'text-emerald-500', chip: 'bg-emerald-100 text-emerald-700', label: 'Done' },
  NA: { dot: 'text-slate-400', chip: 'bg-slate-50 text-slate-500', label: 'N/A' },
};

function StatusIcon({ status }: { status: CloseoutChecklistStatus }) {
  const className = cn('h-4 w-4 flex-shrink-0', STATUS_STYLES[status].dot);
  if (status === 'DONE') return <Check className={className} />;
  if (status === 'IN_PROGRESS') return <CircleDashed className={className} />;
  if (status === 'NA') return <MinusCircle className={className} />;
  return <Circle className={className} />;
}

export function CloseoutStep({ engagementId }: { engagementId: string }) {
  const qc = useQueryClient();
  // Phase 45.4 — read firm-level role list so we can disable the
  // SLA_TEAM_ACCEPT and CLIENT_SIGNOFF "Mark done" buttons for users
  // without the appropriate role. APP_ADMIN bypasses both.
  const permissions = usePermissions(engagementId);
  const firmRoles = permissions.data?.firmRoles ?? [];
  const isAdmin = firmRoles.includes('APP_ADMIN');
  const isSupportLead = firmRoles.includes('SUPPORT_LEAD');
  const { data, isLoading, error } = useQuery({
    queryKey: ['closeout-checklist', engagementId],
    queryFn: () => closeoutApi.list(engagementId),
    retry: (count, err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) return false;
      return count < 3;
    },
  });

  const denied = extractPermissionDenied(error);
  if (denied) {
    return (
      <PermissionDeniedState
        requiredRole={denied.requiredRole}
        verb="view"
        resourceLabel="the closeout checklist"
      />
    );
  }

  const items = (data ?? []) as CloseoutChecklistItem[];
  const total = items.length;
  const done = items.filter((i) => i.status === 'DONE' || i.status === 'NA').length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Flag className="h-5 w-5 text-emerald-600" />
          <h1 className="text-xl font-bold text-slate-900">Closeout</h1>
        </div>
        <p className="text-sm text-slate-500">
          Tick off each item as the implementation team hands the engagement to the support team.
          The transition to <span className="font-mono">SLA_ACTIVE</span> is gated on Client Signoff and SLA Team Accept (Phase 45.4).
        </p>
      </div>

      {/* Progress bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-sm font-semibold text-slate-700">
            {done}/{total} complete
          </p>
          <p className="text-xs text-slate-400">{pct}%</p>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
            style={{ width: `${pct}%` }}
            data-testid="closeout-progress-bar"
          />
        </div>
      </div>

      {/* Items */}
      {isLoading ? (
        <p className="text-center text-sm text-slate-400 py-12">Loading checklist…</p>
      ) : (
        <ul className="space-y-2" data-testid="closeout-items">
          {items.map((item) => (
            <CloseoutItemRow
              key={item.key}
              item={item}
              gate={resolveGate(item.key, { isAdmin, isSupportLead })}
              onChange={async (status, notes) => {
                await closeoutApi.patch(engagementId, item.key, { status, notes });
                qc.invalidateQueries({ queryKey: ['closeout-checklist', engagementId] });
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Phase 45.4 — per-key role gating decision. Returns:
 *   - locked=false when the current user can flip the row.
 *   - locked=true with a tooltip when the row is reserved (CLIENT_SIGNOFF
 *     comes from the portal; SLA_TEAM_ACCEPT requires SUPPORT_LEAD).
 */
interface RoleGate {
  locked: boolean;
  tooltip?: string;
}

function resolveGate(
  key: CloseoutChecklistKey,
  ctx: { isAdmin: boolean; isSupportLead: boolean },
): RoleGate {
  if (ctx.isAdmin) return { locked: false };
  if (key === 'CLIENT_SIGNOFF') {
    return {
      locked: true,
      tooltip: 'Client sign-off must come from the client portal. Only an APP_ADMIN can override.',
    };
  }
  if (key === 'SLA_TEAM_ACCEPT' && !ctx.isSupportLead) {
    return {
      locked: true,
      tooltip: 'Only the SLA team lead (SUPPORT_LEAD) can accept the handover.',
    };
  }
  return { locked: false };
}

function CloseoutItemRow({
  item,
  onChange,
  gate,
}: {
  item: CloseoutChecklistItem;
  onChange: (status: CloseoutChecklistStatus, notes: string | null) => Promise<void>;
  gate?: RoleGate;
}) {
  const [open, setOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(item.notes ?? '');

  // Sync notesDraft when the upstream item refreshes (e.g. the
  // mutation just landed and the list invalidated).
  React.useEffect(() => {
    setNotesDraft(item.notes ?? '');
  }, [item.notes]);

  const mutation = useMutation({
    mutationFn: ({ status, notes }: { status?: CloseoutChecklistStatus; notes?: string | null }) =>
      onChange(status ?? item.status, notes ?? notesDraft),
  });

  const styles = STATUS_STYLES[item.status];

  return (
    <li className="bg-white rounded-2xl border border-slate-200 overflow-hidden" data-testid={`closeout-item-${item.key}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50/50 transition-colors text-left"
      >
        <StatusIcon status={item.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {KEY_LABELS[item.key]}
          </p>
          {item.completedBy && item.completedAt && (
            <p className="text-[11px] text-slate-400 mt-0.5">
              Completed by {item.completedBy} ·{' '}
              {new Date(item.completedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <span
          className={cn(
            'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider',
            styles.chip,
          )}
        >
          {styles.label}
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/30">
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="Optional notes — context, decisions, links to docs"
            rows={2}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            data-testid={`closeout-item-${item.key}-notes`}
            disabled={gate?.locked}
          />
          {gate?.locked && (
            <div
              className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50/80 border border-amber-200 px-3 py-2 text-xs text-amber-900"
              data-testid={`closeout-item-${item.key}-gated`}
            >
              <Lock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-amber-700" />
              <p>{gate.tooltip}</p>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              type="button"
              disabled={mutation.isPending || gate?.locked}
              onClick={() => mutation.mutate({ status: 'NA', notes: notesDraft })}
              title={gate?.locked ? gate.tooltip : undefined}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-40"
            >
              Mark N/A
            </button>
            <button
              type="button"
              disabled={mutation.isPending || item.status === 'IN_PROGRESS' || gate?.locked}
              onClick={() => mutation.mutate({ status: 'IN_PROGRESS', notes: notesDraft })}
              title={gate?.locked ? gate.tooltip : undefined}
              className="rounded-lg text-xs font-semibold px-3 py-1.5 bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-40"
            >
              In progress
            </button>
            <button
              type="button"
              disabled={mutation.isPending || item.status === 'DONE' || gate?.locked}
              onClick={() => mutation.mutate({ status: 'DONE', notes: notesDraft })}
              title={gate?.locked ? gate.tooltip : undefined}
              className="rounded-lg text-xs font-semibold px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
              data-testid={`closeout-item-${item.key}-done`}
            >
              Mark done
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
