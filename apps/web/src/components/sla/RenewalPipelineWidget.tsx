import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CircleCheck,
  CircleX,
  TriangleAlert,
  ChevronRight,
  Activity,
  X,
  Plus,
  Trash2,
  FileText,
} from 'lucide-react';
import {
  renewalApi,
  engagementsApi,
  type RenewalRow,
  type RenewalStatus,
  type RenewalUrgency,
  type ExpansionOpportunity,
} from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Phase 48.2 — Renewal pipeline widget for the SLA dashboard.
 *
 * Lists every SLA_ACTIVE engagement with its renewal urgency,
 * contract end date, and renewal status. Click a row to open the
 * detail drawer where you can update status, add expansion notes,
 * and trigger a Quarterly Health Check generation.
 */

const URGENCY_STYLES: Record<RenewalUrgency, { dot: string; label: string }> = {
  RED: { dot: 'bg-red-500', label: 'At risk' },
  AMBER: { dot: 'bg-amber-500', label: 'Watch' },
  GREEN: { dot: 'bg-emerald-500', label: 'Healthy' },
};

const STATUS_STYLES: Record<RenewalStatus, { chip: string; label: string }> = {
  NOT_STARTED: { chip: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Not started' },
  DISCUSSING: { chip: 'bg-amber-100 text-amber-800 border-amber-200', label: 'In progress' },
  PROPOSAL_OUT: { chip: 'bg-blue-100 text-blue-800 border-blue-200', label: 'Proposal out' },
  SIGNED: { chip: 'bg-emerald-100 text-emerald-800 border-emerald-200', label: 'Renewed' },
  LOST: { chip: 'bg-slate-900 text-white border-slate-900', label: 'Churned' },
  NA: { chip: 'bg-slate-50 text-slate-500 border-slate-200', label: 'N/A' },
};

const STATUS_OPTIONS: ReadonlyArray<RenewalStatus> = [
  'NOT_STARTED',
  'DISCUSSING',
  'PROPOSAL_OUT',
  'SIGNED',
  'LOST',
  'NA',
];

export function RenewalPipelineWidget() {
  const [openRow, setOpenRow] = useState<RenewalRow | null>(null);

  const renewalsQuery = useQuery({
    queryKey: ['sla-renewals'],
    queryFn: () => renewalApi.listFirm(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const rows = renewalsQuery.data ?? [];

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="h-5 w-5 text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">Renewal pipeline</h2>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Every active customer's contract end date and renewal status. At-risk first.
      </p>

      {renewalsQuery.isLoading ? (
        <p className="text-center text-sm text-slate-400 py-12">Loading renewal pipeline…</p>
      ) : renewalsQuery.error ? (
        <p className="text-center text-sm text-red-500 py-12">Couldn't load renewals.</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <CalendarClock className="h-7 w-7 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700">No renewals to track yet</p>
          <p className="text-xs text-slate-400 mt-1">
            Engagements appear here once they're under SLA support.
          </p>
        </div>
      ) : (
        <RenewalsTable rows={rows} onOpen={(r) => setOpenRow(r)} />
      )}

      {openRow && (
        <RenewalDetailDrawer
          row={openRow}
          onClose={() => setOpenRow(null)}
        />
      )}
    </div>
  );
}

function RenewalsTable({
  rows,
  onOpen,
}: {
  rows: ReadonlyArray<RenewalRow>;
  onOpen: (r: RenewalRow) => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden" data-testid="renewal-pipeline-table">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left px-4 py-2.5 font-semibold">Status</th>
            <th className="text-left px-4 py-2.5 font-semibold">Client</th>
            <th className="text-left px-4 py-2.5 font-semibold hidden md:table-cell">Days to expiry</th>
            <th className="text-left px-4 py-2.5 font-semibold hidden md:table-cell">Renewal stage</th>
            <th className="text-left px-4 py-2.5 font-semibold hidden lg:table-cell">Expansions</th>
            <th className="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <RenewalRowView key={r.engagementId} row={r} onOpen={() => onOpen(r)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RenewalRowView({ row, onOpen }: { row: RenewalRow; onOpen: () => void }) {
  const urgency = URGENCY_STYLES[row.urgency];
  const status = STATUS_STYLES[row.renewalStatus];
  return (
    <tr
      className="hover:bg-slate-50/60 cursor-pointer"
      onClick={onOpen}
      data-testid={`renewal-row-${row.engagementId}`}
      data-urgency={row.urgency}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={cn('inline-block h-2.5 w-2.5 rounded-full', urgency.dot)} />
          <span className="text-xs font-semibold text-slate-700">{urgency.label}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <p className="font-semibold text-slate-900">{row.clientName}</p>
        {row.expired && (
          <p className="text-[10px] text-red-700 font-bold uppercase tracking-wider mt-0.5">
            Expired
          </p>
        )}
      </td>
      <td className="px-4 py-3 hidden md:table-cell tabular-nums text-slate-600">
        {row.daysToExpiry === null
          ? '—'
          : row.daysToExpiry < 0
            ? `${Math.abs(row.daysToExpiry)}d ago`
            : `${row.daysToExpiry}d`}
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <span
          className={cn(
            'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            status.chip,
          )}
        >
          {status.label}
        </span>
      </td>
      <td className="px-4 py-3 hidden lg:table-cell text-slate-500 text-xs">
        {row.expansionOpportunities.length === 0 ? (
          <span className="text-slate-400">—</span>
        ) : (
          `${row.expansionOpportunities.length} tracked`
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <ChevronRight className="h-4 w-4 text-slate-300 ml-auto" />
      </td>
    </tr>
  );
}

function RenewalDetailDrawer({
  row,
  onClose,
}: {
  row: RenewalRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [contractEndAt, setContractEndAt] = useState(row.contractEndAt ?? '');
  const [renewalStatus, setRenewalStatus] = useState<RenewalStatus>(row.renewalStatus);
  const [notes, setNotes] = useState(row.notes ?? '');
  const [opportunities, setOpportunities] = useState<ExpansionOpportunity[]>(
    row.expansionOpportunities,
  );

  const patchMutation = useMutation({
    mutationFn: () =>
      renewalApi.patch(row.engagementId, {
        contractEndAt: contractEndAt.trim().length > 0 ? contractEndAt : null,
        renewalStatus,
        expansionOpportunities: opportunities.filter((o) => o.title.trim().length > 0),
        notes: notes.trim().length > 0 ? notes : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sla-renewals'] });
      onClose();
    },
  });

  const qhcMutation = useMutation({
    mutationFn: () => engagementsApi.createJob(row.engagementId, 'QUARTERLY_HEALTH_CHECK'),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      data-testid="renewal-detail-drawer"
    >
      <div
        className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-lg bg-white shadow-2xl overflow-y-auto">
        <header className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
              Renewal details
            </p>
            <h3 className="text-lg font-bold text-slate-900 truncate">{row.clientName}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-slate-100 text-slate-500"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-5 space-y-5">
          <Field label="Contract end date">
            <input
              type="date"
              value={contractEndAt ? contractEndAt.slice(0, 10) : ''}
              onChange={(e) =>
                setContractEndAt(e.target.value ? `${e.target.value}T00:00:00Z` : '')
              }
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {row.daysToExpiry !== null && (
              <p className="text-xs text-slate-500 mt-1">
                {row.daysToExpiry < 0
                  ? `Expired ${Math.abs(row.daysToExpiry)} days ago`
                  : `${row.daysToExpiry} days remaining`}
              </p>
            )}
          </Field>

          <Field label="Renewal stage">
            <select
              value={renewalStatus}
              onChange={(e) => setRenewalStatus(e.target.value as RenewalStatus)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_STYLES[s].label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Free-form notes — call summaries, blockers, next steps…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </Field>

          <ExpansionEditor
            opportunities={opportunities}
            onChange={setOpportunities}
          />

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={onClose}
              className="text-sm font-semibold text-slate-500 hover:text-slate-700 px-3 py-2"
            >
              Cancel
            </button>
            <button
              onClick={() => patchMutation.mutate()}
              disabled={patchMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <CircleCheck className="h-4 w-4" />
              {patchMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>

          <QuarterlyHealthCheckSection
            engagementId={row.engagementId}
            onTrigger={() => qhcMutation.mutate()}
            jobId={qhcMutation.data?.id ?? null}
            isPending={qhcMutation.isPending}
            isError={qhcMutation.isError}
          />
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function ExpansionEditor({
  opportunities,
  onChange,
}: {
  opportunities: ExpansionOpportunity[];
  onChange: (next: ExpansionOpportunity[]) => void;
}) {
  function update(idx: number, patch: Partial<ExpansionOpportunity>) {
    onChange(opportunities.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }
  function remove(idx: number) {
    onChange(opportunities.filter((_, i) => i !== idx));
  }
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
        Expansion opportunities
      </p>
      <div className="space-y-2" data-testid="expansion-editor">
        {opportunities.map((o, i) => (
          <div
            key={i}
            className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2"
            data-testid={`expansion-row-${i}`}
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={o.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="Opportunity title (e.g. Add Manufacturing module)"
                className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="rounded-md p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600"
                aria-label="Remove opportunity"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <input
              type="text"
              value={o.size ?? ''}
              onChange={(e) => update(i, { size: e.target.value })}
              placeholder="Size estimate (e.g. +$25k ARR)"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              value={o.notes ?? ''}
              onChange={(e) => update(i, { notes: e.target.value })}
              rows={2}
              placeholder="Notes (status, blockers, next step)"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...opportunities, { title: '' }])}
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
      >
        <Plus className="h-3 w-3" />
        Add opportunity
      </button>
    </div>
  );
}

function QuarterlyHealthCheckSection({
  engagementId,
  onTrigger,
  jobId,
  isPending,
  isError,
}: {
  engagementId: string;
  onTrigger: () => void;
  jobId: string | null;
  isPending: boolean;
  isError: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
          <Activity className="h-4 w-4 text-emerald-700" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-slate-900">Quarterly Health Check</h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Generates a 5-document health-check bundle: ticket performance, open issues, recommended
            next actions. Use it as the agenda for the QBR.
          </p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onTrigger}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              data-testid="trigger-qhc"
            >
              <FileText className="h-3.5 w-3.5" />
              {isPending ? 'Generating…' : 'Generate report'}
            </button>
            {jobId && !isPending && (
              <a
                href={`/engagements/${engagementId}/jobs/${jobId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
                data-testid="qhc-open-link"
              >
                Open deliverable browser
                <ChevronRight className="h-3 w-3" />
              </a>
            )}
            {isError && (
              <span className="inline-flex items-center gap-1 text-xs text-red-600">
                <CircleX className="h-3 w-3" />
                Couldn't kick off the job. Try again.
              </span>
            )}
          </div>
          {jobId && !isPending && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-semibold text-slate-600 hover:text-slate-800 inline-flex items-center gap-1">
                <TriangleAlert className="h-3 w-3 text-amber-500" />
                Email draft (copy-paste)
              </summary>
              <pre className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-700 whitespace-pre-wrap">
                {`Hi <Customer>,

Hope you're well. I've put together our Quarterly Health Check for the past three months. The report is in the link below — it covers ticket performance, any open issues, and our recommended next actions for the next quarter.

I'd love to walk you through it on a 30-minute call. What works on your end?

[Link to deliverable]

Best,
<Your name>`}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
