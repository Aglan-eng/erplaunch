import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, LogOut, Layers, LayoutGrid, BarChart2, Target, TrendingUp,
  TriangleAlert, Clock, Zap, Users, Search, ArrowUpDown,
  X, ChevronDown, Mail, CheckCircle2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { engagementsApi, authApi } from '@/lib/api';
import { EngagementCard } from '@/components/dashboard/EngagementCard';
import { NewEngagementModal } from '@/components/dashboard/NewEngagementModal';
import { Button } from '@/components/ui/Button';
import { ErplaunchLogo } from '@/components/ui/ErplaunchLogo';
import { firmDisplayName } from '@/lib/firmDisplayName';
import { PipelinePage } from './PipelinePage';
import { cn } from '@/lib/utils';

type Tab = 'cards' | 'pipeline';
type SortKey = 'newest' | 'oldest' | 'health' | 'stage' | 'name';

const STAGE_ORDER = ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GO_LIVE', 'CLOSED'];
const STAGE_LABELS: Record<string, string> = {
  DISCOVERY: 'Discovery', SCOPING: 'Scoping', BUILD: 'Build',
  UAT: 'UAT', GO_LIVE: 'Go-Live', CLOSED: 'Closed',
};
const STAGE_COLORS: Record<string, string> = {
  DISCOVERY: 'bg-sky-100 text-sky-700 border-sky-200',
  SCOPING:   'bg-violet-100 text-violet-700 border-violet-200',
  BUILD:     'bg-amber-100 text-amber-700 border-amber-200',
  UAT:       'bg-orange-100 text-orange-700 border-orange-200',
  GO_LIVE:   'bg-green-100 text-green-700 border-green-200',
  CLOSED:    'bg-gray-100 text-gray-500 border-gray-200',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface DashboardConflict { severity: string }
interface DashboardEngagement {
  id: string;
  clientName: string;
  status: string;
  updatedAt: string;
  contractEndDate?: string;
  adaptorId?: string;
  profile?: { completeness: Record<string, number>; updatedAt: string } | null;
  conflicts?: DashboardConflict[];
  jobs?: Array<{ status: string; createdAt: string }>;
  members?: unknown[];
}

function getDeadlineRisk(eng: DashboardEngagement): 'overdue' | 'at-risk' | 'on-track' | 'none' {
  if (!eng.contractEndDate || eng.status === 'GO_LIVE') return 'none';
  const days = Math.ceil((new Date(eng.contractEndDate).getTime() - Date.now()) / 86400000);
  if (days < 0) return 'overdue';
  if (days <= 14) return 'at-risk';
  return 'on-track';
}

function getHealthScore(eng: DashboardEngagement): number {
  const vals = Object.values(eng.profile?.completeness ?? {}).filter((v) => typeof v === 'number') as number[];
  const progress = vals.length ? Math.round(vals.reduce((a: number, b) => a + (b as number), 0) / vals.length) : 0;
  const blocks = eng.conflicts?.filter((c) => c.severity === 'BLOCK').length ?? 0;
  const warns  = eng.conflicts?.filter((c) => c.severity === 'WARN').length ?? 0;
  let score = 60 + Math.round(progress * 0.3) - blocks * 12 - warns * 4 + (STAGE_ORDER.indexOf(eng.status ?? '') * 3);
  const risk = getDeadlineRisk(eng);
  if (risk === 'overdue') score -= 20;
  else if (risk === 'at-risk') score -= 10;
  return Math.max(0, Math.min(100, score));
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ engagements }: { engagements: DashboardEngagement[] }) {
  const total       = engagements.length;
  const overdue     = engagements.filter((e) => getDeadlineRisk(e) === 'overdue').length;
  const atRisk      = engagements.filter((e) => getDeadlineRisk(e) === 'at-risk').length;
  const goLive      = engagements.filter((e) => e.status === 'GO_LIVE').length;
  const livePct     = total > 0 ? Math.round((goLive / total) * 100) : 0;
  const avgHealth   = total > 0 ? Math.round(engagements.reduce((s, e) => s + getHealthScore(e), 0) / total) : 0;
  const totalMembers = engagements.reduce((s, e) => s + (e.members?.length ?? 0), 0);

  const healthColor = avgHealth >= 70 ? 'text-green-600' : avgHealth >= 40 ? 'text-amber-600' : 'text-red-600';
  const healthBg    = avgHealth >= 70 ? 'bg-green-50' : avgHealth >= 40 ? 'bg-amber-50' : 'bg-red-50';

  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {/* Total */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3.5 flex items-center gap-3 hover:shadow-md transition-shadow">
        <div className="h-9 w-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
          <Target className="h-4 w-4 text-brand-600" />
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-tight">Total</p>
          <p className="text-xl font-black tabular-nums text-brand-700 leading-tight">{total}</p>
        </div>
      </div>

      {/* Live Rate */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3.5 flex items-center gap-3 hover:shadow-md transition-shadow">
        <div className="h-9 w-9 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
          <TrendingUp className="h-4 w-4 text-green-600" />
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-tight">Live Rate</p>
          <p className="text-xl font-black tabular-nums text-green-700 leading-tight">{livePct}%</p>
        </div>
      </div>

      {/* Overdue */}
      <div className={cn('bg-white rounded-xl border shadow-sm px-4 py-3.5 flex items-center gap-3 hover:shadow-md transition-shadow',
        overdue > 0 ? 'border-red-200' : 'border-gray-100')}>
        <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0', overdue > 0 ? 'bg-red-50' : 'bg-gray-50')}>
          <TriangleAlert className={cn('h-4 w-4', overdue > 0 ? 'text-red-500' : 'text-gray-300')} />
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-tight">Overdue</p>
          <p className={cn('text-xl font-black tabular-nums leading-tight', overdue > 0 ? 'text-red-600' : 'text-gray-300')}>{overdue}</p>
        </div>
      </div>

      {/* At Risk */}
      <div className={cn('bg-white rounded-xl border shadow-sm px-4 py-3.5 flex items-center gap-3 hover:shadow-md transition-shadow',
        atRisk > 0 ? 'border-amber-200' : 'border-gray-100')}>
        <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0', atRisk > 0 ? 'bg-amber-50' : 'bg-gray-50')}>
          <Clock className={cn('h-4 w-4', atRisk > 0 ? 'text-amber-500' : 'text-gray-300')} />
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-tight">At Risk</p>
          <p className={cn('text-xl font-black tabular-nums leading-tight', atRisk > 0 ? 'text-amber-600' : 'text-gray-300')}>{atRisk}</p>
        </div>
      </div>

      {/* Avg Health */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3.5 hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3 mb-1.5">
          <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0', healthBg)}>
            <Zap className={cn('h-4 w-4', healthColor)} />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-tight">Avg Health</p>
            <p className={cn('text-xl font-black tabular-nums leading-tight', healthColor)}>{avgHealth}</p>
          </div>
        </div>
        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-700', avgHealth >= 70 ? 'bg-green-400' : avgHealth >= 40 ? 'bg-amber-400' : 'bg-red-400')}
            style={{ width: `${avgHealth}%` }}
          />
        </div>
      </div>

      {/* Committee */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3.5 flex items-center gap-3 hover:shadow-md transition-shadow">
        <div className="h-9 w-9 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
          <Users className="h-4 w-4 text-slate-500" />
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-tight">Committee</p>
          <p className="text-xl font-black tabular-nums text-slate-700 leading-tight">{totalMembers}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Stats Skeleton ───────────────────────────────────────────────────────────

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {[1,2,3,4,5,6].map((i) => (
        <div key={i} className="h-[72px] rounded-xl bg-white border border-gray-100 animate-pulse overflow-hidden">
          <div className="h-full bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── Card Skeleton ────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden animate-pulse">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-100 rounded-lg w-3/4" />
            <div className="h-3 bg-gray-100 rounded-full w-1/3" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <div className="h-2.5 bg-gray-100 rounded w-20" />
            <div className="h-2.5 bg-gray-100 rounded w-8" />
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full" />
        </div>
        <div className="mt-3 flex justify-between">
          <div className="h-2.5 bg-gray-100 rounded w-24" />
        </div>
      </div>
      <div className="border-t border-gray-50 bg-gray-50/50 px-5 py-3">
        <div className="h-3 bg-gray-100 rounded w-32" />
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="text-center py-20">
      <div className="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 mb-5 shadow-sm">
        <Layers className="h-9 w-9 text-brand-500" />
      </div>
      <h3 className="text-lg font-bold text-gray-900">No engagements yet</h3>
      <p className="text-sm text-gray-500 mt-1.5 mb-6 max-w-xs mx-auto">Create your first client engagement to start the NetSuite implementation wizard.</p>
      <Button onClick={onNew}><Plus className="h-4 w-4" />Create Engagement</Button>
    </div>
  );
}

function FilteredEmptyState({ query, stage, onClear }: { query: string; stage: string; onClear: () => void }) {
  return (
    <div className="text-center py-16">
      <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gray-50 mb-4">
        <Search className="h-6 w-6 text-gray-300" />
      </div>
      <h3 className="text-sm font-semibold text-gray-700">No matches found</h3>
      <p className="text-xs text-gray-400 mt-1 mb-4">
        {query && `No engagements matching "${query}"`}
        {stage && ` in stage ${STAGE_LABELS[stage] ?? stage}`}
      </p>
      <button onClick={onClear} className="text-xs text-brand-600 hover:text-brand-800 font-semibold flex items-center gap-1 mx-auto">
        <X className="h-3.5 w-3.5" /> Clear filters
      </button>
    </div>
  );
}

// ─── Sort menu ─────────────────────────────────────────────────────────────────

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'health', label: 'Health score' },
  { key: 'stage',  label: 'Stage' },
  { key: 'name',   label: 'Name A→Z' },
];

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export function DashboardPage() {
  const { user, logout } = useAuth();
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('pipeline');
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [sortOpen, setSortOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['engagements'],
    queryFn: () => engagementsApi.list(),
  });

  const engagements = useMemo(() => (data ?? []) as DashboardEngagement[], [data]);

  const filtered = useMemo(() => {
    let list = [...engagements];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => e.clientName.toLowerCase().includes(q));
    }
    if (stageFilter) {
      list = list.filter((e) => e.status === stageFilter);
    }
    switch (sortKey) {
      case 'newest': list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()); break;
      case 'oldest': list.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()); break;
      case 'health': list.sort((a, b) => getHealthScore(b) - getHealthScore(a)); break;
      case 'stage':  list.sort((a, b) => STAGE_ORDER.indexOf(a.status) - STAGE_ORDER.indexOf(b.status)); break;
      case 'name':   list.sort((a, b) => a.clientName.localeCompare(b.clientName)); break;
    }
    return list;
  }, [engagements, search, stageFilter, sortKey]);

  const hasFilters = !!search || !!stageFilter;
  const clearFilters = () => { setSearch(''); setStageFilter(''); };

  // Unique stages present in data
  const presentStages = useMemo(() =>
    STAGE_ORDER.filter((s) => engagements.some((e) => e.status === s)),
    [engagements]
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
          {/* Phase 38.5 — proper ERPLaunch lockup + firm name inline. */}
          <div className="flex items-center gap-3">
            <ErplaunchLogo size="md" />
            {(() => {
              // Phase 39.1 — prefer the white-label displayName ("Xelerate")
              // over the registration `name` slug ("xelerate-llc"). Helper
              // falls back to `name` for firms that haven't set a brand
              // name in Settings yet.
              const display = firmDisplayName(user?.firm ?? null);
              if (!display) return null;
              return (
                <>
                  <span className="text-gray-300 text-base leading-none" aria-hidden>·</span>
                  <span className="text-sm font-semibold text-gray-700">{display}</span>
                </>
              );
            })()}
          </div>

          <div className="flex items-center gap-2.5">
            {/* Tab switcher */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => setTab('pipeline')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                  tab === 'pipeline' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                <BarChart2 className="h-3.5 w-3.5" />Pipeline
              </button>
              <button
                onClick={() => setTab('cards')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                  tab === 'cards' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />Cards
              </button>
            </div>

            <Button onClick={() => setNewModalOpen(true)} size="sm">
              <Plus className="h-4 w-4" />New
            </Button>

            <div className="h-6 w-px bg-gray-200" />

            <span className="text-sm text-gray-600 hidden sm:block font-medium">{user?.name}</span>
            <Link
              to="/custom-adaptors"
              className="text-sm text-gray-500 hover:text-gray-900 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              title="Custom platform adaptors"
            >
              Adaptors
            </Link>
            <Link
              to="/dashboard/archived"
              className="text-sm text-gray-500 hover:text-gray-900 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              title="View archived engagements"
            >
              Archived
            </Link>
            <Link
              to="/settings"
              className="text-sm text-gray-500 hover:text-gray-900 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              title="Firm settings"
            >
              Settings
            </Link>
            <Button variant="ghost" size="sm" onClick={logout} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-7">
        <VerifyEmailBanner />
        {isLoading ? (
          <>
            <StatsSkeleton />
            <div className="h-10 bg-white rounded-xl border border-gray-100 animate-pulse mb-6" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map((i) => <CardSkeleton key={i} />)}
            </div>
          </>
        ) : engagements.length === 0 ? (
          <EmptyState onNew={() => setNewModalOpen(true)} />
        ) : tab === 'pipeline' ? (
          <>
            <StatsBar engagements={engagements} />
            <PipelinePage />
          </>
        ) : (
          <>
            <StatsBar engagements={engagements} />

            {/* Search + filter + sort bar */}
            <div className="flex items-center gap-2.5 mb-5 flex-wrap">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search engagements..."
                  className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent shadow-sm placeholder:text-gray-400"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Stage filter pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setStageFilter('')}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                    !stageFilter ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  )}
                >
                  All
                </button>
                {presentStages.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStageFilter(stageFilter === s ? '' : s)}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                      stageFilter === s
                        ? cn(STAGE_COLORS[s], 'border-current')
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                    )}
                  >
                    {STAGE_LABELS[s]}
                  </button>
                ))}
              </div>

              {/* Sort dropdown */}
              <div className="relative ml-auto">
                <button
                  onClick={() => setSortOpen(!sortOpen)}
                  onBlur={() => setTimeout(() => setSortOpen(false), 150)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:border-gray-400 shadow-sm transition-all"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  {SORT_OPTIONS.find((o) => o.key === sortKey)?.label}
                  <ChevronDown className="h-3 w-3 text-gray-400" />
                </button>
                {sortOpen && (
                  <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-100 rounded-xl shadow-lg z-10 overflow-hidden">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => { setSortKey(opt.key); setSortOpen(false); }}
                        className={cn(
                          'w-full text-left px-3 py-2 text-xs transition-colors',
                          sortKey === opt.key ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-700 hover:bg-gray-50 font-medium'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Count + clear */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-gray-500">
                <span className="font-semibold text-gray-800">{filtered.length}</span> of {engagements.length} engagement{engagements.length !== 1 ? 's' : ''}
                {hasFilters && <span className="text-gray-400"> (filtered)</span>}
              </p>
              {hasFilters && (
                <button onClick={clearFilters} className="text-xs text-brand-600 hover:text-brand-800 font-semibold flex items-center gap-1">
                  <X className="h-3 w-3" /> Clear filters
                </button>
              )}
            </div>

            {/* Grid */}
            {filtered.length === 0 ? (
              <FilteredEmptyState query={search} stage={stageFilter} onClear={clearFilters} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((engagement) => (
                  <EngagementCard key={engagement.id} engagement={engagement} />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <NewEngagementModal open={newModalOpen} onClose={() => setNewModalOpen(false)} />
    </div>
  );
}

/**
 * Verify-email banner (Phase 19). Rendered above the dashboard content
 * when the signed-in user's email is still unverified. Offers a one-click
 * resend that posts to /auth/request-email-verification. Dismissible for
 * the current session only (state in-memory) — the banner re-appears on
 * the next page load until emailVerifiedAt is set.
 */
function VerifyEmailBanner() {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || user.emailVerifiedAt || dismissed) return null;

  async function handleResend() {
    setSending(true);
    setError(null);
    try {
      await authApi.requestEmailVerification();
      setSentAt(Date.now());
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message;
      setError(msg ?? 'Could not send. Try again in a moment.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mb-5 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
      <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
        <Mail className="h-4 w-4 text-amber-700" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-900">
          Verify your email to secure your account
        </p>
        <p className="text-xs text-amber-800 mt-0.5">
          We sent a verification link to <span className="font-mono font-semibold">{user.email}</span>. Click it to confirm you own this address.
        </p>
        {sentAt && !error && (
          <p className="text-xs text-green-700 mt-1.5 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Sent. Check your inbox (and spam folder).
          </p>
        )}
        {error && <p className="text-xs text-red-700 mt-1.5">{error}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleResend}
          disabled={sending}
          className="text-xs font-semibold text-amber-900 hover:text-amber-950 px-3 py-1.5 rounded-lg bg-white/60 hover:bg-white border border-amber-300 disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Resend email'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-700 hover:text-amber-900 p-1.5 rounded-lg hover:bg-white/50"
          aria-label="Dismiss"
          title="Dismiss until next page load"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
