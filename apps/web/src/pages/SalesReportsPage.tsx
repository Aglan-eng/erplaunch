import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, ChevronLeft, Download, Loader2, Trophy, AlertTriangle,
  Clock, TrendingDown,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import {
  salesReportsApi,
  type FunnelReport,
  type LeaderboardEntry,
  type LossReasonsReport,
  type TimeToCloseReport,
} from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Phase 46.8.5 — Sales reports dashboard.
 *
 * Visible to APP_ADMIN + SALES_MANAGER (the GET endpoints 403 anyone
 * else; the page renders the 403 fallback when that happens).
 *
 * Four cards reading from the four /sales/reports/* endpoints:
 *   - Funnel: stage counts + total estimated value + cross-stage
 *     conversion rate annotations
 *   - Leaderboard: per-rep deals won, revenue, win rate, sortable
 *   - Loss Reasons: pie-style breakdown + recent-losses table
 *   - Time to Close: histogram with median + p90 callouts
 *
 * "Export PDF" button at the top triggers the SALES_PERFORMANCE_REPORT
 * generator (Phase 46.8.7); until that ships, the button stays
 * disabled with a tooltip.
 */

const STAGE_LABELS: Record<string, string> = {
  PROSPECT: 'Prospect',
  PROPOSED: 'Proposal',
  CONTRACTED: 'Contracted',
  WON: 'Won',
  LOST: 'Lost',
};

const LOSS_REASON_LABELS: Record<string, string> = {
  PRICE: 'Price',
  TIMING: 'Timing',
  NO_DECISION: 'No decision',
  LOST_TO_COMPETITOR: 'Lost to competitor',
  INTERNAL_BUILD: 'Built in-house',
  OTHER: 'Other',
};

const LOSS_REASON_COLORS: Record<string, string> = {
  PRICE: 'bg-rose-400',
  TIMING: 'bg-amber-400',
  NO_DECISION: 'bg-slate-400',
  LOST_TO_COMPETITOR: 'bg-red-500',
  INTERNAL_BUILD: 'bg-violet-400',
  OTHER: 'bg-slate-300',
};

export function SalesReportsPage() {
  const funnelQuery = useQuery({
    queryKey: ['sales-funnel'],
    queryFn: salesReportsApi.funnel,
    staleTime: 60_000,
  });
  const leaderboardQuery = useQuery({
    queryKey: ['sales-leaderboard'],
    queryFn: salesReportsApi.leaderboard,
    staleTime: 60_000,
  });
  const lossReasonsQuery = useQuery({
    queryKey: ['sales-loss-reasons'],
    queryFn: salesReportsApi.lossReasons,
    staleTime: 60_000,
  });
  const ttcQuery = useQuery({
    queryKey: ['sales-time-to-close'],
    queryFn: salesReportsApi.timeToClose,
    staleTime: 60_000,
  });

  const denied = [funnelQuery, leaderboardQuery, lossReasonsQuery, ttcQuery].some(
    (q) => (q.error as { response?: { status?: number } })?.response?.status === 403,
  );

  if (denied) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <BarChart3 className="h-7 w-7 text-slate-400" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900 mb-1">Sales reports</h1>
          <p className="text-sm text-slate-500">
            Reports are restricted to APP_ADMIN and SALES_MANAGER. Ask your firm admin for the
            role if you need access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <Link
            to="/sales/pipeline"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-3"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to pipeline
          </Link>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="h-5 w-5 text-indigo-600" />
                <h1 className="text-2xl font-bold text-slate-900">Sales Reports</h1>
              </div>
              <p className="text-sm text-slate-500">
                Pipeline performance, sales-rep leaderboard, loss reasons, time-to-close.
              </p>
            </div>
            <ExportPdfButton />
          </div>
        </div>

        {/* Cards */}
        <div className="space-y-4">
          <FunnelCard query={funnelQuery} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LeaderboardCard query={leaderboardQuery} />
            <LossReasonsCard query={lossReasonsQuery} />
          </div>
          <TimeToCloseCard query={ttcQuery} />
        </div>
      </div>
    </div>
  );
}

// ─── Funnel ─────────────────────────────────────────────────────────────────

function FunnelCard({ query }: { query: { data?: FunnelReport; isLoading: boolean } }) {
  const data = query.data;
  // Memoise the stages reference so the maxCount useMemo dep is
  // stable across renders (otherwise the empty-array fallback
  // creates a fresh `[]` every render).
  const stages = useMemo(() => data?.stages ?? [], [data?.stages]);
  const maxCount = useMemo(() => Math.max(1, ...stages.map((s) => s.count)), [stages]);
  return (
    <Card title="Pipeline funnel" Icon={TrendingDown} loading={query.isLoading}>
      {data && (
        <>
          <div className="flex items-baseline gap-4 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wider font-bold text-slate-500">Win rate</p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">
                {Math.round(data.winRate * 100)}%
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider font-bold text-slate-500">Won</p>
              <p className="text-lg font-semibold text-emerald-600 tabular-nums">{data.totalWon}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider font-bold text-slate-500">Lost</p>
              <p className="text-lg font-semibold text-red-500 tabular-nums">{data.totalLost}</p>
            </div>
          </div>
          <div className="space-y-2" data-testid="funnel-stages">
            {stages.map((s, idx) => {
              const widthPct = (s.count / maxCount) * 100;
              const prev = idx > 0 ? stages[idx - 1] : null;
              const conversionPct =
                prev && prev.count > 0 ? Math.round((s.count / prev.count) * 100) : null;
              return (
                <div key={s.stage}>
                  {conversionPct !== null && (
                    <p className="text-[10px] text-slate-400 italic ml-2">
                      {prev?.stage} → {STAGE_LABELS[s.stage] ?? s.stage}: {conversionPct}%
                      conversion
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="w-24 text-xs font-semibold text-slate-700 truncate">
                      {STAGE_LABELS[s.stage] ?? s.stage}
                    </span>
                    <div className="flex-1 h-7 rounded-md bg-slate-100 overflow-hidden relative">
                      <div
                        className={cn(
                          'h-full transition-all',
                          s.stage === 'WON'
                            ? 'bg-emerald-400'
                            : s.stage === 'LOST'
                              ? 'bg-red-300'
                              : 'bg-indigo-400',
                        )}
                        style={{ width: `${Math.max(2, widthPct)}%` }}
                      />
                      <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-slate-800 tabular-nums">
                        {s.count}
                      </div>
                    </div>
                    <span className="w-24 text-right text-xs text-slate-500 tabular-nums">
                      ${s.totalEstimatedValue.toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

function LeaderboardCard({
  query,
}: {
  query: { data?: LeaderboardEntry[]; isLoading: boolean };
}) {
  const [sortKey, setSortKey] = useState<keyof LeaderboardEntry>('revenueClosed');
  // Move the empty-array fallback inside the useMemo so the dep
  // (query.data) is the stable source — otherwise `[]` would be a
  // fresh reference every render, defeating the memo.
  const sorted = useMemo(() => {
    const out = [...(query.data ?? [])];
    out.sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number;
      const bv = (b[sortKey] ?? 0) as number;
      return bv - av;
    });
    return out;
  }, [query.data, sortKey]);
  return (
    <Card title="Sales rep leaderboard" Icon={Trophy} loading={query.isLoading}>
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No closed deals yet.</p>
      ) : (
        <div className="overflow-x-auto" data-testid="leaderboard-table">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left py-2 font-semibold">Rep</th>
                <SortableTh
                  active={sortKey === 'dealsWon'}
                  onClick={() => setSortKey('dealsWon')}
                >
                  Won
                </SortableTh>
                <SortableTh
                  active={sortKey === 'revenueClosed'}
                  onClick={() => setSortKey('revenueClosed')}
                >
                  Revenue
                </SortableTh>
                <SortableTh
                  active={sortKey === 'avgDealSize'}
                  onClick={() => setSortKey('avgDealSize')}
                >
                  Avg deal
                </SortableTh>
                <SortableTh
                  active={sortKey === 'winRate'}
                  onClick={() => setSortKey('winRate')}
                >
                  Win rate
                </SortableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => (
                <tr key={r.salesRepUserId} className="hover:bg-slate-50/60">
                  <td className="py-2 font-mono text-xs text-slate-700 truncate max-w-[100px]">
                    {r.salesRepUserId.slice(0, 8)}…
                  </td>
                  <td className="py-2 tabular-nums text-emerald-700 font-semibold">{r.dealsWon}</td>
                  <td className="py-2 tabular-nums">${r.revenueClosed.toLocaleString()}</td>
                  <td className="py-2 tabular-nums">
                    {r.dealsWon === 0 ? '—' : `$${Math.round(r.avgDealSize).toLocaleString()}`}
                  </td>
                  <td className="py-2 tabular-nums">{Math.round(r.winRate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SortableTh({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <th
      onClick={onClick}
      className={cn(
        'text-left py-2 font-semibold cursor-pointer select-none',
        active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700',
      )}
    >
      {children} {active ? '↓' : ''}
    </th>
  );
}

// ─── Loss reasons ───────────────────────────────────────────────────────────

function LossReasonsCard({
  query,
}: {
  query: { data?: LossReasonsReport; isLoading: boolean };
}) {
  const data = query.data;
  return (
    <Card title="Loss reasons" Icon={AlertTriangle} loading={query.isLoading}>
      {data && data.breakdown.total === 0 ? (
        <p className="text-sm text-slate-400 italic">No losses recorded yet.</p>
      ) : data ? (
        <>
          {/* Stacked horizontal pie/bar substitute */}
          <div
            className="flex h-3 w-full rounded-full overflow-hidden bg-slate-100 mb-3"
            data-testid="loss-reasons-bar"
          >
            {Object.entries(data.breakdown.byReason).map(([reason, b]) => (
              <div
                key={reason}
                className={cn('h-full', LOSS_REASON_COLORS[reason] ?? 'bg-slate-300')}
                style={{ width: `${b.pct * 100}%` }}
                title={`${LOSS_REASON_LABELS[reason] ?? reason}: ${b.count} (${Math.round(b.pct * 100)}%)`}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            {Object.entries(data.breakdown.byReason).map(([reason, b]) => (
              <div key={reason} className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    'h-2.5 w-2.5 rounded-full flex-shrink-0',
                    LOSS_REASON_COLORS[reason] ?? 'bg-slate-300',
                  )}
                />
                <span className="text-slate-700 truncate">
                  {LOSS_REASON_LABELS[reason] ?? reason}
                </span>
                <span className="ml-auto tabular-nums text-slate-500">
                  {b.count} · {Math.round(b.pct * 100)}%
                </span>
              </div>
            ))}
          </div>
          {data.recentLosses.length > 0 && (
            <>
              <p className="text-xs uppercase tracking-wider font-bold text-slate-500 mb-1.5">
                Recent losses
              </p>
              <ul className="space-y-1" data-testid="recent-losses-list">
                {data.recentLosses.slice(0, 5).map((l) => (
                  <li key={l.engagementId} className="text-xs">
                    <Link
                      to={`/engagements/${l.engagementId}`}
                      className="block px-2 py-1 rounded hover:bg-slate-100 transition-colors"
                    >
                      <span className="font-semibold text-slate-700">{l.clientName}</span>
                      <span className="text-slate-500">
                        {' '}
                        — {LOSS_REASON_LABELS[l.lossReason] ?? l.lossReason}
                        {l.competitorName && ` (${l.competitorName})`}
                      </span>
                      {l.estimatedValue !== null && (
                        <span className="text-slate-400 ml-1 tabular-nums">
                          · ${l.estimatedValue.toLocaleString()}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : null}
    </Card>
  );
}

// ─── Time to close ──────────────────────────────────────────────────────────

function TimeToCloseCard({
  query,
}: {
  query: { data?: TimeToCloseReport; isLoading: boolean };
}) {
  const data = query.data;
  const max = useMemo(
    () => Math.max(1, ...(data?.histogram ?? []).map((h) => h.count)),
    [data?.histogram],
  );
  return (
    <Card title="Time to close" Icon={Clock} loading={query.isLoading}>
      {data && data.median === null ? (
        <p className="text-sm text-slate-400 italic">No closed deals yet.</p>
      ) : data ? (
        <>
          <div className="flex items-baseline gap-4 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wider font-bold text-slate-500">Median</p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">
                {data.median}d
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider font-bold text-slate-500">p90</p>
              <p className="text-lg font-semibold text-slate-700 tabular-nums">{data.p90}d</p>
            </div>
          </div>
          <div className="space-y-1.5" data-testid="time-to-close-histogram">
            {data.histogram.map((h) => {
              const widthPct = (h.count / max) * 100;
              return (
                <div key={h.bucket} className="flex items-center gap-2">
                  <span className="w-20 text-xs font-semibold text-slate-700">{h.bucket}</span>
                  <div className="flex-1 h-5 rounded bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-indigo-400"
                      style={{ width: `${Math.max(2, widthPct)}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs text-slate-500 tabular-nums">
                    {h.count}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </Card>
  );
}

// ─── Shared shells ──────────────────────────────────────────────────────────

interface CardProps {
  title: string;
  Icon: typeof BarChart3;
  loading: boolean;
  children: React.ReactNode;
}

function Card({ title, Icon, loading, children }: CardProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      </div>
      {loading ? (
        <div className="text-slate-400 text-sm py-6 inline-flex items-center gap-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function ExportPdfButton() {
  // Phase 46.8.7 — POSTs to /sales/reports/export-pdf, receives the
  // PDF as a Blob, and triggers a browser download via a temporary
  // anchor. The route streams the PDF synchronously (no background
  // job) so the user gets the download immediately.
  const [error, setError] = useState<string | null>(null);
  const exportMutation = useMutation({
    mutationFn: () => salesReportsApi.exportPdf(),
    onSuccess: ({ blob, filename }) => {
      setError(null);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revoke so Safari has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(
        status === 403
          ? 'Restricted to APP_ADMIN + SALES_MANAGER.'
          : 'PDF export failed — try again.',
      );
    },
  });
  return (
    <div className="text-right">
      <button
        type="button"
        onClick={() => exportMutation.mutate()}
        disabled={exportMutation.isPending}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-40"
        data-testid="export-pdf-button"
      >
        {exportMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        Export PDF
      </button>
      {error && <p className="text-[11px] text-rose-600 mt-1">{error}</p>}
    </div>
  );
}
