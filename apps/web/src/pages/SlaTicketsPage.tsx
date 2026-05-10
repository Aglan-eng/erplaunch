import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Inbox,
  AlertCircle,
  Clock,
  ChevronRight,
  Send,
  RefreshCw,
} from 'lucide-react';
import {
  ticketsApi,
  type FirmTicketRow,
  type TicketStatus,
  type TicketSeverity,
} from '@/lib/api';
import { sortTicketsByBreachProximity, filterBySeverity } from '@/lib/slaTicketSort';
import { cn } from '@/lib/utils';

/**
 * Phase 48.1 — SLA Engineer's ticket queue.
 *
 * Two-pane layout:
 *   Left  — list of every ticket in the firm. Filters: status,
 *           severity, assignee. Sorted by SLA breach proximity
 *           (worst first) so the operator's eye lands on the ticket
 *           that needs attention RIGHT NOW.
 *   Right — selected ticket detail: full message thread, SLA timer
 *           bar, status dropdown, assignee picker, "Add message" form.
 *
 * Data flow:
 *   - GET /sla/tickets         → list with computed SLA per row
 *   - GET /engagements/:eid/tickets/:tid → detail
 *   - POST .../messages        → append SUPPORT message
 *   - PATCH ...                → status / assignee
 *
 * Polling: 30s on the list (cheap) and 15s on the detail when a ticket
 * is selected. The user's browser tab will stay reasonably current
 * without a websocket layer.
 */

const SEVERITY_STYLES: Record<TicketSeverity, { chip: string; label: string; weight: number }> = {
  CRITICAL: { chip: 'bg-red-100 text-red-800 border-red-200', label: 'P1', weight: 0 },
  HIGH: { chip: 'bg-orange-100 text-orange-800 border-orange-200', label: 'P2', weight: 1 },
  MEDIUM: { chip: 'bg-amber-100 text-amber-800 border-amber-200', label: 'P3', weight: 2 },
  LOW: { chip: 'bg-slate-100 text-slate-700 border-slate-200', label: 'P4', weight: 3 },
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_CUSTOMER: 'Waiting on customer',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

const STATUS_OPTIONS: ReadonlyArray<TicketStatus | 'ALL'> = [
  'ALL',
  'OPEN',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
];

const SEVERITY_FILTER_OPTIONS: ReadonlyArray<TicketSeverity | 'ALL'> = [
  'ALL',
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
];

export function SlaTicketsPage() {
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'ALL'>('ALL');
  const [severityFilter, setSeverityFilter] = useState<TicketSeverity | 'ALL'>('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState<'ALL' | 'UNASSIGNED'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ticketsQuery = useQuery({
    queryKey: ['sla-tickets', statusFilter, assigneeFilter],
    queryFn: () =>
      ticketsApi.listFirmTickets({
        status: statusFilter,
        assignee: assigneeFilter,
      }),
    refetchInterval: 30_000,
  });

  const allTickets = ticketsQuery.data ?? [];
  const filteredTickets = useMemo(
    () => sortTicketsByBreachProximity(filterBySeverity(allTickets, severityFilter)),
    [allTickets, severityFilter],
  );

  const selectedRow = filteredTickets.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <header className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <Inbox className="h-5 w-5 text-emerald-600" />
            <h1 className="text-2xl font-bold text-slate-900">Ticket queue</h1>
          </div>
          <p className="text-sm text-slate-500">
            Every ticket across every engagement in your firm. Breached + closest-to-breach
            tickets appear first.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <FilterDropdown
            label="Status"
            value={statusFilter}
            options={STATUS_OPTIONS}
            renderOption={(o) => (o === 'ALL' ? 'All' : STATUS_LABELS[o as TicketStatus])}
            onChange={(v) => setStatusFilter(v as TicketStatus | 'ALL')}
          />
          <FilterDropdown
            label="Severity"
            value={severityFilter}
            options={SEVERITY_FILTER_OPTIONS}
            renderOption={(o) => (o === 'ALL' ? 'All' : SEVERITY_STYLES[o as TicketSeverity].label)}
            onChange={(v) => setSeverityFilter(v as TicketSeverity | 'ALL')}
          />
          <FilterDropdown
            label="Assignee"
            value={assigneeFilter}
            options={['ALL', 'UNASSIGNED']}
            renderOption={(o) => (o === 'ALL' ? 'All' : 'Unassigned')}
            onChange={(v) => setAssigneeFilter(v as 'ALL' | 'UNASSIGNED')}
          />
          <button
            onClick={() => ticketsQuery.refetch()}
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', ticketsQuery.isFetching && 'animate-spin')}
            />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <aside className="lg:col-span-5">
            <TicketList
              tickets={filteredTickets}
              selectedId={selectedId}
              onSelect={setSelectedId}
              isLoading={ticketsQuery.isLoading}
              isError={!!ticketsQuery.error}
            />
          </aside>
          <section className="lg:col-span-7">
            {selectedRow ? (
              <TicketDetailPane row={selectedRow} />
            ) : (
              <DetailEmpty />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function FilterDropdown<T extends string>({
  label,
  value,
  options,
  renderOption,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<T>;
  renderOption: (o: T) => React.ReactNode;
  onChange: (v: T) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
      <span>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {renderOption(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function TicketList({
  tickets,
  selectedId,
  onSelect,
  isLoading,
  isError,
}: {
  tickets: ReadonlyArray<FirmTicketRow>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        Loading tickets…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-600">
        Couldn't load the ticket queue.
      </div>
    );
  }
  if (tickets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
        <Inbox className="h-7 w-7 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-semibold text-slate-700">No tickets match the filters</p>
        <p className="text-xs text-slate-400 mt-1">
          Try widening status / severity / assignee.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-testid="ticket-list">
      {tickets.map((t) => (
        <li key={t.id}>
          <TicketCard ticket={t} selected={t.id === selectedId} onClick={() => onSelect(t.id)} />
        </li>
      ))}
    </ul>
  );
}

function TicketCard({
  ticket,
  selected,
  onClick,
}: {
  ticket: FirmTicketRow;
  selected: boolean;
  onClick: () => void;
}) {
  const sev = SEVERITY_STYLES[ticket.severity];
  const breached = ticket.sla.firstResponseBreached || ticket.sla.resolutionBreached;
  const minutesRemaining = Math.min(
    ticket.sla.firstResponseMinutesRemaining ?? Number.POSITIVE_INFINITY,
    ticket.sla.resolutionMinutesRemaining ?? Number.POSITIVE_INFINITY,
  );
  const approaching = !breached && minutesRemaining < 60;
  const daysOpen = Math.floor((Date.now() - new Date(ticket.createdAt).getTime()) / 86_400_000);
  return (
    <button
      onClick={onClick}
      data-testid={`ticket-card-${ticket.id}`}
      data-breach={breached ? 'true' : approaching ? 'approaching' : 'ok'}
      className={cn(
        'w-full text-left rounded-xl border bg-white p-4 transition-all',
        selected
          ? 'border-emerald-300 ring-2 ring-emerald-100 shadow-sm'
          : 'border-slate-200 hover:border-slate-300 hover:shadow-sm',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                sev.chip,
              )}
            >
              {sev.label}
            </span>
            <span className="text-[10px] font-semibold text-slate-400 uppercase">
              {STATUS_LABELS[ticket.status]}
            </span>
            {breached && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-red-100 text-red-800 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                <AlertCircle className="h-3 w-3" />
                BREACHED
              </span>
            )}
            {!breached && approaching && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                <Clock className="h-3 w-3" />
                {minutesRemaining}m left
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-slate-900 truncate">{ticket.title}</p>
          <p className="text-xs text-slate-500 mt-0.5">{ticket.clientName}</p>
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <ChevronRight className="h-4 w-4 text-slate-300" />
          <span className="text-[10px] text-slate-400 font-medium">{daysOpen}d</span>
        </div>
      </div>
    </button>
  );
}

function DetailEmpty() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-sm text-slate-400">
      Select a ticket on the left to view its thread, status, and SLA timer.
    </div>
  );
}

function TicketDetailPane({ row }: { row: FirmTicketRow }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const detailQuery = useQuery({
    queryKey: ['ticket-detail', row.engagementId, row.id],
    queryFn: () => ticketsApi.detail(row.engagementId, row.id),
    refetchInterval: 15_000,
  });

  const sendMessage = useMutation({
    mutationFn: (body: string) => ticketsApi.addMessage(row.engagementId, row.id, body),
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['ticket-detail', row.engagementId, row.id] });
      queryClient.invalidateQueries({ queryKey: ['sla-tickets'] });
    },
  });

  const updateStatus = useMutation({
    mutationFn: (status: TicketStatus) =>
      ticketsApi.patch(row.engagementId, row.id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-detail', row.engagementId, row.id] });
      queryClient.invalidateQueries({ queryKey: ['sla-tickets'] });
    },
  });

  const detail = detailQuery.data;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="ticket-detail">
      <div className="border-b border-slate-100 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider font-bold text-slate-400">
              {row.clientName}
            </p>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">{row.title}</h2>
            {row.description && (
              <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{row.description}</p>
            )}
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wider',
              SEVERITY_STYLES[row.severity].chip,
            )}
          >
            {SEVERITY_STYLES[row.severity].label}
          </span>
        </div>
        <SlaTimer row={row} />
      </div>

      <div className="border-b border-slate-100 p-4 flex items-center gap-3 flex-wrap">
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
          Status:
          <select
            value={row.status}
            onChange={(e) => updateStatus.mutate(e.target.value as TicketStatus)}
            disabled={updateStatus.isPending}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {(Object.keys(STATUS_LABELS) as TicketStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {updateStatus.isError && (
          <span className="text-xs text-red-600">Couldn't change status (transition not allowed?)</span>
        )}
      </div>

      <div className="p-5 max-h-[60vh] overflow-y-auto" data-testid="ticket-thread">
        {detailQuery.isLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading thread…</p>
        ) : detail && detail.messages.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No messages yet — be the first.</p>
        ) : (
          <ul className="space-y-3">
            {detail?.messages.map((m) => (
              <li
                key={m.id}
                className={cn(
                  'rounded-xl px-3 py-2 text-sm border',
                  m.senderType === 'SUPPORT'
                    ? 'bg-emerald-50 border-emerald-200 ml-8'
                    : 'bg-slate-50 border-slate-200 mr-8',
                )}
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                  {m.senderType === 'SUPPORT' ? 'Support' : 'Customer'} ·{' '}
                  {new Date(m.createdAt).toLocaleString()}
                </p>
                <p className="text-slate-800 whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim().length === 0) return;
          sendMessage.mutate(draft.trim());
        }}
        className="border-t border-slate-100 p-4"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply to the customer…"
            rows={3}
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
          />
          <button
            type="submit"
            disabled={draft.trim().length === 0 || sendMessage.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Send
          </button>
        </div>
        {sendMessage.isError && (
          <p className="text-xs text-red-600 mt-2">Couldn't send. Try again.</p>
        )}
      </form>
    </div>
  );
}

function SlaTimer({ row }: { row: FirmTicketRow }) {
  const breached = row.sla.firstResponseBreached || row.sla.resolutionBreached;
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-xs">
      <SlaSegment
        label="First response"
        targetHours={row.sla.firstResponseTargetHours}
        minutesRemaining={row.sla.firstResponseMinutesRemaining}
        breached={row.sla.firstResponseBreached}
      />
      <SlaSegment
        label="Resolution"
        targetHours={row.sla.resolutionTargetHours}
        minutesRemaining={row.sla.resolutionMinutesRemaining}
        breached={row.sla.resolutionBreached}
      />
      {breached && (
        <span className="inline-flex items-center gap-1 rounded-md bg-red-100 text-red-800 px-2 py-0.5 text-[10px] font-bold uppercase">
          <AlertCircle className="h-3 w-3" />
          SLA breached
        </span>
      )}
    </div>
  );
}

function SlaSegment({
  label,
  targetHours,
  minutesRemaining,
  breached,
}: {
  label: string;
  targetHours: number;
  minutesRemaining: number | null;
  breached: boolean;
}) {
  const stopped = minutesRemaining === null && !breached;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-semibold',
        breached
          ? 'border-red-200 bg-red-50 text-red-700'
          : stopped
            ? 'border-slate-200 bg-slate-50 text-slate-500'
            : minutesRemaining !== null && minutesRemaining < 60
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700',
      )}
    >
      <Clock className="h-3 w-3" />
      {label} · target {targetHours}h ·{' '}
      {stopped
        ? 'met'
        : breached
          ? 'BREACHED'
          : minutesRemaining !== null
            ? `${minutesRemaining}m left`
            : '—'}
    </span>
  );
}
