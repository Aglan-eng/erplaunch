import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle, AlertCircle, ArrowUpRight, Activity } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Phase 45.5 — SLA portfolio dashboard.
 *
 * Firm-wide cockpit listing every SLA_ACTIVE engagement with a
 * traffic-light health indicator. Aggregates server-side; the client
 * just renders. Sort order is worst-first (RED → AMBER → GREEN) so
 * the operator's eye lands on the engagements that need attention.
 *
 * Roadmap: Phase 45.6 will swap "open issues" for the real ticket
 * queue once it ships, and Phase 45.8 will surface the upcoming
 * renewal date in a dedicated column.
 */

interface PortfolioEntry {
  engagementId: string;
  clientName: string;
  enteredSlaAt: string | null;
  lastActivityAt: string | null;
  health: 'GREEN' | 'AMBER' | 'RED';
  inGracePeriod: boolean;
  daysOnSla: number | null;
  daysSinceActivity: number | null;
  rationale: string;
  openIssueCounts: { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number };
}

const HEALTH_STYLES: Record<PortfolioEntry['health'], { dot: string; chip: string; label: string; Icon: typeof ShieldCheck }> = {
  GREEN: { dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Healthy', Icon: ShieldCheck },
  AMBER: { dot: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800 border-amber-200', label: 'Watch', Icon: AlertTriangle },
  RED: { dot: 'bg-red-500', chip: 'bg-red-100 text-red-700 border-red-200', label: 'Action needed', Icon: AlertCircle },
};

export function SlaPortfolioPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sla-portfolio'],
    queryFn: () => api.get('/sla/portfolio').then((r) => r.data.data as PortfolioEntry[]),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const entries = data ?? [];
  const counts = countByHealth(entries);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Header counts={counts} total={entries.length} />

        {isLoading ? (
          <p className="text-center text-sm text-slate-400 py-16">Loading portfolio…</p>
        ) : error ? (
          <p className="text-center text-sm text-red-500 py-16">Couldn't load portfolio. Try again shortly.</p>
        ) : entries.length === 0 ? (
          <EmptyState />
        ) : (
          <PortfolioTable entries={entries} />
        )}
      </div>
    </div>
  );
}

function Header({ counts, total }: { counts: Record<PortfolioEntry['health'], number>; total: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="h-5 w-5 text-emerald-600" />
        <h1 className="text-2xl font-bold text-slate-900">SLA Portfolio</h1>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Every engagement currently under support. Health is rolled up from open issue
        priorities and recent activity.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total" value={total} tone="slate" />
        <SummaryCard label="Healthy" value={counts.GREEN} tone="emerald" />
        <SummaryCard label="Watch" value={counts.AMBER} tone="amber" />
        <SummaryCard label="Action needed" value={counts.RED} tone="red" />
      </div>
    </div>
  );
}

function SummaryCard({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'emerald' | 'amber' | 'red';
}) {
  const tones = {
    slate: 'border-slate-200 bg-white',
    emerald: 'border-emerald-200 bg-emerald-50/40',
    amber: 'border-amber-200 bg-amber-50/40',
    red: 'border-red-200 bg-red-50/40',
  } as const;
  return (
    <div className={cn('rounded-2xl border p-4', tones[tone])}>
      <p className="text-xs uppercase tracking-wider font-bold text-slate-500 mb-1">{label}</p>
      <p className="text-2xl font-extrabold text-slate-900 tabular-nums">{value}</p>
    </div>
  );
}

function PortfolioTable({ entries }: { entries: PortfolioEntry[] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm" data-testid="sla-portfolio-table">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left px-4 py-2.5 font-semibold">Health</th>
            <th className="text-left px-4 py-2.5 font-semibold">Client</th>
            <th className="text-left px-4 py-2.5 font-semibold hidden sm:table-cell">Days on SLA</th>
            <th className="text-left px-4 py-2.5 font-semibold hidden md:table-cell">Open issues</th>
            <th className="text-left px-4 py-2.5 font-semibold hidden lg:table-cell">Last activity</th>
            <th className="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {entries.map((e) => (
            <Row key={e.engagementId} entry={e} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ entry }: { entry: PortfolioEntry }) {
  const styles = HEALTH_STYLES[entry.health];
  const totalIssues =
    entry.openIssueCounts.CRITICAL +
    entry.openIssueCounts.HIGH +
    entry.openIssueCounts.MEDIUM +
    entry.openIssueCounts.LOW;
  return (
    <tr
      className="hover:bg-slate-50/60 transition-colors"
      data-testid={`sla-row-${entry.engagementId}`}
      data-health={entry.health}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={cn('inline-block h-2.5 w-2.5 rounded-full', styles.dot)} />
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
              styles.chip,
            )}
          >
            <styles.Icon className="h-3 w-3" />
            {styles.label}
          </span>
        </div>
        <p className="text-[11px] text-slate-400 mt-1 max-w-xs">{entry.rationale}</p>
      </td>
      <td className="px-4 py-3">
        <p className="font-semibold text-slate-900">{entry.clientName}</p>
        {entry.inGracePeriod && (
          <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-wider mt-0.5">
            Post-handover grace
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-slate-600 tabular-nums hidden sm:table-cell">
        {entry.daysOnSla === null ? '—' : `${entry.daysOnSla}d`}
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        {totalIssues === 0 ? (
          <span className="text-slate-400">None</span>
        ) : (
          <div className="flex items-center gap-1.5 text-xs">
            {entry.openIssueCounts.CRITICAL > 0 && (
              <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 font-bold">
                {entry.openIssueCounts.CRITICAL} crit
              </span>
            )}
            {entry.openIssueCounts.HIGH > 0 && (
              <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 font-bold">
                {entry.openIssueCounts.HIGH} high
              </span>
            )}
            {entry.openIssueCounts.MEDIUM + entry.openIssueCounts.LOW > 0 && (
              <span className="text-slate-500">
                +{entry.openIssueCounts.MEDIUM + entry.openIssueCounts.LOW} other
              </span>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-slate-500 hidden lg:table-cell">
        {entry.daysSinceActivity === null
          ? '—'
          : entry.daysSinceActivity === 0
            ? 'Today'
            : `${entry.daysSinceActivity}d ago`}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          to={`/engagements/${entry.engagementId}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-900"
        >
          Open
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </td>
    </tr>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-16 text-center">
      <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
        <ShieldCheck className="h-7 w-7 text-emerald-600" />
      </div>
      <p className="text-base font-semibold text-slate-700 mb-2">No engagements under SLA yet</p>
      <p className="text-sm text-slate-500 max-w-md mx-auto">
        Once an engagement completes Closeout and the dual sign-off, it'll appear here for ongoing
        support tracking.
      </p>
    </div>
  );
}

function countByHealth(
  entries: ReadonlyArray<PortfolioEntry>,
): Record<PortfolioEntry['health'], number> {
  const counts = { GREEN: 0, AMBER: 0, RED: 0 } as Record<PortfolioEntry['health'], number>;
  for (const e of entries) counts[e.health]++;
  return counts;
}
