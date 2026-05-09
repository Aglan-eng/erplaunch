import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, Plus, Loader2, ArrowUpRight, X,
  Sparkles, Target, FileText, Handshake, Award, XCircle,
} from 'lucide-react';
import {
  salesApi,
  type PipelineColumn,
  type LeadSource,
  type SalesStage,
  type PipelineEntry,
} from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Phase 46.1 — Sales pipeline kanban dashboard.
 *
 * Seven columns (NEW → LOST). Each card surfaces clientName,
 * leadSource, estimated value, and days in stage. Drag-drop between
 * columns transitions the engagement.status (some columns share a
 * stage — drops between those are no-ops at the API layer).
 *
 * Filters (sales rep, lead source, value range) are intentionally
 * minimal in 46.1 — Phase 46.7 will replace this with a richer
 * pipeline view + reports surface. For now the operator filters by
 * lead source via a dropdown above the board.
 */

const COLUMN_ORDER: PipelineColumn[] = [
  'NEW',
  'QUALIFIED',
  'DISCOVERY_LITE',
  'PROPOSAL_SENT',
  'NEGOTIATION',
  'WON',
  'LOST',
];

const COLUMN_META: Record<
  PipelineColumn,
  { label: string; tint: string; Icon: typeof Sparkles }
> = {
  NEW: { label: 'New', tint: 'border-slate-200 bg-slate-50/60', Icon: Sparkles },
  QUALIFIED: { label: 'Qualified', tint: 'border-sky-200 bg-sky-50/60', Icon: Target },
  DISCOVERY_LITE: { label: 'Discovery Lite', tint: 'border-violet-200 bg-violet-50/60', Icon: Sparkles },
  PROPOSAL_SENT: { label: 'Proposal Sent', tint: 'border-indigo-200 bg-indigo-50/60', Icon: FileText },
  NEGOTIATION: { label: 'Negotiation', tint: 'border-amber-200 bg-amber-50/60', Icon: Handshake },
  WON: { label: 'Won', tint: 'border-emerald-200 bg-emerald-50/60', Icon: Award },
  LOST: { label: 'Lost', tint: 'border-red-200 bg-red-50/60', Icon: XCircle },
};

const COLUMN_TO_STAGE: Record<PipelineColumn, SalesStage> = {
  NEW: 'PROSPECT',
  QUALIFIED: 'PROSPECT',
  DISCOVERY_LITE: 'PROSPECT',
  PROPOSAL_SENT: 'PROPOSED',
  NEGOTIATION: 'CONTRACTED',
  WON: 'WON',
  LOST: 'LOST',
};

const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  OUTBOUND: 'Outbound',
  EVENT: 'Event',
  OTHER: 'Other',
};

export function SalesPipelinePage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<LeadSource | 'ALL'>('ALL');
  const [showAdd, setShowAdd] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['sales-pipeline'],
    queryFn: salesApi.listPipeline,
    refetchInterval: 60_000,
    staleTime: 15_000,
    retry: (count, err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) return false;
      return count < 3;
    },
  });

  const denied =
    (error as { response?: { status?: number } })?.response?.status === 403;

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SalesStage }) =>
      salesApi.setProspectStage(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-pipeline'] }),
  });

  const buckets = useMemo(() => {
    const byColumn: Record<PipelineColumn, PipelineEntry[]> = {
      NEW: [], QUALIFIED: [], DISCOVERY_LITE: [],
      PROPOSAL_SENT: [], NEGOTIATION: [], WON: [], LOST: [],
    };
    for (const e of data ?? []) {
      if (filter !== 'ALL' && e.leadSource !== filter) continue;
      byColumn[e.column].push(e);
    }
    return byColumn;
  }, [data, filter]);

  if (denied) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <TrendingUp className="h-7 w-7 text-slate-400" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900 mb-1">Sales pipeline</h1>
          <p className="text-sm text-slate-500">
            You don't have a sales role on this firm. Ask your firm admin for SALES_REP or
            SALES_MANAGER access if you need to see the pipeline.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-5 w-5 text-indigo-600" />
              <h1 className="text-2xl font-bold text-slate-900">Sales Pipeline</h1>
            </div>
            <p className="text-sm text-slate-500">
              Drag deals between columns to update their stage. Won deals auto-convert to active
              engagements once the SOW is signed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
            data-testid="sales-add-prospect"
          >
            <Plus className="h-4 w-4" />
            Add Prospect
          </button>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3 mb-4">
          <label className="text-xs uppercase tracking-wider font-bold text-slate-500">
            Lead source
          </label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as LeadSource | 'ALL')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          >
            <option value="ALL">All sources</option>
            {(Object.keys(LEAD_SOURCE_LABELS) as LeadSource[]).map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {/* Board */}
        {isLoading ? (
          <p className="text-center text-sm text-slate-400 py-16">Loading pipeline…</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
            {COLUMN_ORDER.map((col) => (
              <Column
                key={col}
                column={col}
                entries={buckets[col]}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={() => {
                  if (!draggedId) return;
                  const targetStage = COLUMN_TO_STAGE[col];
                  // Find source column to detect cross-stage moves;
                  // intra-stage drops (e.g. NEW→QUALIFIED) are visual
                  // only at the API layer in 46.1.
                  const card = (data ?? []).find((d) => d.id === draggedId);
                  if (card && card.status !== targetStage) {
                    moveMutation.mutate({ id: draggedId, status: targetStage });
                  }
                  setDraggedId(null);
                }}
                onDragStartCard={(id) => setDraggedId(id)}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddProspectModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            qc.invalidateQueries({ queryKey: ['sales-pipeline'] });
          }}
        />
      )}
    </div>
  );
}

function Column({
  column, entries, onDragOver, onDrop, onDragStartCard,
}: {
  column: PipelineColumn;
  entries: PipelineEntry[];
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragStartCard: (id: string) => void;
}) {
  const meta = COLUMN_META[column];
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'rounded-2xl border p-3 min-h-[200px]',
        meta.tint,
      )}
      data-testid={`pipeline-column-${column}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <meta.Icon className="h-3.5 w-3.5 text-slate-500" />
          <p className="text-xs uppercase tracking-wider font-bold text-slate-700">
            {meta.label}
          </p>
        </div>
        <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
          {entries.length}
        </span>
      </div>
      <div className="space-y-2">
        {entries.map((e) => (
          <Card key={e.id} entry={e} onDragStart={onDragStartCard} />
        ))}
        {entries.length === 0 && (
          <p className="text-[11px] text-slate-400 italic px-1">No deals here.</p>
        )}
      </div>
    </div>
  );
}

function Card({
  entry, onDragStart,
}: {
  entry: PipelineEntry;
  onDragStart: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(entry.id)}
      className="rounded-xl bg-white border border-slate-200 p-3 cursor-grab hover:border-indigo-300 hover:shadow-sm transition-all"
      data-testid={`pipeline-card-${entry.id}`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="font-semibold text-sm text-slate-900 truncate">{entry.clientName}</p>
        <Link
          to={`/engagements/${entry.id}`}
          className="text-slate-400 hover:text-indigo-600 flex-shrink-0"
          title="Open engagement"
          onClick={(e) => e.stopPropagation()}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-2">
        {entry.leadSource && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold">
            {LEAD_SOURCE_LABELS[entry.leadSource]}
          </span>
        )}
        <span className="text-slate-400">·</span>
        <span className="tabular-nums">{entry.daysInStage}d in stage</span>
      </div>
      {entry.estimatedValue !== null && (
        <p className="text-xs font-bold text-slate-700 tabular-nums">
          ${entry.estimatedValue.toLocaleString()}
        </p>
      )}
      {/* Phase 46.8.1 — Discovery Lite quick-link on PROSPECT cards. */}
      {entry.status === 'PROSPECT' && (
        <Link
          to={`/sales/prospects/${entry.id}/discovery-lite`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'mt-2 block text-[11px] font-semibold rounded-md px-2 py-1 transition-colors text-center',
            entry.column === 'DISCOVERY_LITE'
              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              : entry.column === 'QUALIFIED'
                ? 'bg-violet-100 text-violet-700 hover:bg-violet-200'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
          )}
          data-testid={`pipeline-card-${entry.id}-discovery-lite`}
        >
          {entry.column === 'DISCOVERY_LITE'
            ? 'Discovery Lite ✓'
            : entry.column === 'QUALIFIED'
              ? 'Continue Discovery Lite'
              : 'Start Discovery Lite'}
        </Link>
      )}
    </div>
  );
}

function AddProspectModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [clientName, setClientName] = useState('');
  const [leadSource, setLeadSource] = useState<LeadSource | ''>('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [estimatedCloseDate, setEstimatedCloseDate] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      salesApi.createProspect({
        clientName: clientName.trim(),
        leadSource: leadSource ? (leadSource as LeadSource) : null,
        estimatedValue: estimatedValue ? Number(estimatedValue) : null,
        estimatedCloseDate: estimatedCloseDate || null,
      }),
    onSuccess: () => onCreated(),
  });

  const canSubmit = clientName.trim().length > 0 && !mutation.isPending;

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">New prospect</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Client name *</label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Acme Industries"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Lead source</label>
            <select
              value={leadSource}
              onChange={(e) => setLeadSource(e.target.value as LeadSource | '')}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              <option value="">— Choose —</option>
              {(Object.keys(LEAD_SOURCE_LABELS) as LeadSource[]).map((s) => (
                <option key={s} value={s}>
                  {LEAD_SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Est. value</label>
              <input
                type="number"
                value={estimatedValue}
                onChange={(e) => setEstimatedValue(e.target.value)}
                placeholder="50000"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Est. close</label>
              <input
                type="date"
                value={estimatedCloseDate}
                onChange={(e) => setEstimatedCloseDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
            data-testid="sales-add-submit"
          >
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Add to pipeline
          </button>
        </div>
      </div>
    </div>
  );
}
