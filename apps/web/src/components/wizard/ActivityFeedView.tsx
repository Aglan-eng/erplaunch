import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity as ActivityIcon,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Users,
  Database,
  PenLine,
  Settings,
  ArrowRightLeft,
  Search,
  ChevronRight,
} from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { useWizardStore } from '@/stores/wizardStore';
import { cn } from '@/lib/utils';
import {
  ACTION_CATEGORIES,
  filterAndSearch,
  getActionMeta,
  groupByDay,
  paginate,
  type ActionCategory,
  type ActivityRow,
} from './activityFeedHelpers';

/**
 * Phase 40.3 — Activity Feed view rebuilt around the real activity columns
 * (`details`, `createdAt`) plus polish:
 *   - day-bucket grouping (Today / Yesterday / date)
 *   - category filter pills with counts
 *   - case-insensitive search
 *   - paginated rows (20/page)
 *   - color-coded action icons
 *   - row click navigates to the related register/log section
 *
 * The pure logic lives in activityFeedHelpers.ts so it's unit-tested
 * without React, and this component stays focused on layout + state.
 */

const PAGE_SIZE = 20;

const ICON_BY_CATEGORY: Record<ActionCategory, React.ComponentType<{ className?: string }>> = {
  risks: AlertTriangle,
  issues: AlertCircle,
  decisions: CheckCircle2,
  meetings: Calendar,
  members: Users,
  migration: ArrowRightLeft,
  data: Database,
  notes: PenLine,
  system: Settings,
};

// Tailwind-safe color palette lookup. Inline class names so PurgeCSS keeps
// them; building strings dynamically would risk getting tree-shaken.
const COLOR_CLASSES: Record<string, { bg: string; fg: string; ring: string; pillBg: string; pillFg: string }> = {
  red:     { bg: 'bg-red-50',     fg: 'text-red-600',     ring: 'ring-red-100',     pillBg: 'bg-red-100',     pillFg: 'text-red-700' },
  orange:  { bg: 'bg-orange-50',  fg: 'text-orange-600',  ring: 'ring-orange-100',  pillBg: 'bg-orange-100',  pillFg: 'text-orange-700' },
  amber:   { bg: 'bg-amber-50',   fg: 'text-amber-600',   ring: 'ring-amber-100',   pillBg: 'bg-amber-100',   pillFg: 'text-amber-700' },
  violet:  { bg: 'bg-violet-50',  fg: 'text-violet-600',  ring: 'ring-violet-100',  pillBg: 'bg-violet-100',  pillFg: 'text-violet-700' },
  blue:    { bg: 'bg-blue-50',    fg: 'text-blue-600',    ring: 'ring-blue-100',    pillBg: 'bg-blue-100',    pillFg: 'text-blue-700' },
  emerald: { bg: 'bg-emerald-50', fg: 'text-emerald-600', ring: 'ring-emerald-100', pillBg: 'bg-emerald-100', pillFg: 'text-emerald-700' },
  indigo:  { bg: 'bg-indigo-50',  fg: 'text-indigo-600',  ring: 'ring-indigo-100',  pillBg: 'bg-indigo-100',  pillFg: 'text-indigo-700' },
  teal:    { bg: 'bg-teal-50',    fg: 'text-teal-600',    ring: 'ring-teal-100',    pillBg: 'bg-teal-100',    pillFg: 'text-teal-700' },
  slate:   { bg: 'bg-slate-50',   fg: 'text-slate-600',   ring: 'ring-slate-100',   pillBg: 'bg-slate-100',   pillFg: 'text-slate-700' },
};

const CATEGORY_LABELS: Record<ActionCategory, string> = {
  risks: 'Risks',
  issues: 'Issues',
  decisions: 'Decisions',
  meetings: 'Meetings',
  members: 'Members',
  migration: 'Migration',
  data: 'Data',
  notes: 'Notes',
  system: 'System',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function ActivityFeedView({ engagementId }: { engagementId: string }) {
  const setCurrentSection = useWizardStore((s) => s.setCurrentSection);

  const { data: rawActivities = [], isLoading } = useQuery({
    queryKey: ['activity', engagementId],
    queryFn: () => engagementsApi.listActivity(engagementId),
    enabled: !!engagementId,
  });

  const activities = rawActivities as ActivityRow[];

  // ── filter / search / pagination state ─────────────────────────────────
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ActionCategory | 'all'>('all');
  const [page, setPage] = useState(1);

  // Counts per category — computed from the unfiltered set so pills always
  // show "what's possible", not "what's left after the filter applies".
  const counts = useMemo(() => {
    const c: Record<ActionCategory | 'all', number> = {
      all: activities.length,
      risks: 0, issues: 0, decisions: 0, meetings: 0,
      members: 0, migration: 0, data: 0, notes: 0, system: 0,
    };
    for (const a of activities) {
      c[getActionMeta(a.action).category]++;
    }
    return c;
  }, [activities]);

  const filtered = useMemo(
    () => filterAndSearch(activities, { query: search, category }),
    [activities, search, category]
  );

  const pageResult = paginate(filtered, page, PAGE_SIZE);
  const groups = useMemo(() => groupByDay(pageResult.items), [pageResult.items]);

  // Reset to page 1 whenever filters change so a stale page index doesn't
  // strand the user on an empty page.
  React.useEffect(() => {
    setPage(1);
  }, [search, category]);

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto py-8 text-center">
        <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full mx-auto" />
        <p className="mt-3 text-sm text-gray-500">Loading activity…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black text-gray-900">Activity Feed</h2>
        <p className="text-sm text-gray-500 mt-1">
          Everything that's happened on this engagement, newest first.
        </p>
      </div>

      {/* Search + filter bar */}
      <div className="bg-white rounded-2xl border border-gray-100 p-3 shadow-sm space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-300"
            data-testid="activity-search-input"
          />
        </div>

        <div className="flex flex-wrap gap-1.5" data-testid="activity-category-filters">
          <FilterPill
            active={category === 'all'}
            label="All"
            count={counts.all}
            onClick={() => setCategory('all')}
            color="slate"
          />
          {ACTION_CATEGORIES.map((cat) => {
            // Skip empty categories so the bar doesn't show a wall of zeros.
            if (counts[cat] === 0) return null;
            // Use the canonical color from any meta in that category — the
            // first action lookup is enough since palette is per-category.
            const sample = activities.find((a) => getActionMeta(a.action).category === cat);
            const color = sample ? getActionMeta(sample.action).color : 'slate';
            return (
              <FilterPill
                key={cat}
                active={category === cat}
                label={CATEGORY_LABELS[cat]}
                count={counts[cat]}
                onClick={() => setCategory(cat)}
                color={color}
              />
            );
          })}
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 shadow-sm text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-slate-50 flex items-center justify-center mb-3">
            <ActivityIcon className="h-5 w-5 text-slate-400" />
          </div>
          <p className="text-sm font-semibold text-gray-700">
            {activities.length === 0 ? 'No activity recorded yet.' : 'No activity matches your filters.'}
          </p>
          {activities.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Try clearing the search or switching to "All".
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Day-bucket groups */}
          <div className="space-y-6" data-testid="activity-groups">
            {groups.map((group) => (
              <div key={group.dateKey} className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-1">
                  {group.dateLabel}
                </h3>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50 overflow-hidden">
                  {group.items.map((activity) => (
                    <ActivityRowCard
                      key={activity.id}
                      activity={activity}
                      onClickSection={(section) => setCurrentSection(section)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pageResult.totalPages > 1 && (
            <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 px-4 py-3 shadow-sm">
              <p className="text-xs text-gray-500">
                Page {pageResult.page} of {pageResult.totalPages}
                <span className="ml-2 text-gray-400">({filtered.length} entries)</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageResult.page === 1}
                  className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!pageResult.hasMore}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FilterPill({
  active, label, count, onClick, color,
}: {
  active: boolean; label: string; count: number; onClick: () => void; color: string;
}) {
  const palette = COLOR_CLASSES[color] ?? COLOR_CLASSES.slate;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all',
        active
          ? `${palette.pillBg} ${palette.pillFg} ring-2 ring-offset-1 ring-offset-white ${palette.ring}`
          : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
      )}
    >
      {label}
      <span className={cn('text-[10px] font-bold opacity-70')}>{count}</span>
    </button>
  );
}

function ActivityRowCard({
  activity, onClickSection,
}: {
  activity: ActivityRow;
  onClickSection: (section: string) => void;
}) {
  const meta = getActionMeta(activity.action);
  const palette = COLOR_CLASSES[meta.color] ?? COLOR_CLASSES.slate;
  const Icon = ICON_BY_CATEGORY[meta.category];
  const clickable = !!meta.section;

  const inner = (
    <div className="flex items-start gap-3 p-4 group">
      <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0', palette.bg)}>
        <Icon className={cn('h-4 w-4', palette.fg)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={cn('text-[10px] font-bold uppercase tracking-wider', palette.fg)}>
            {meta.label}
          </span>
          <span className="text-[11px] text-gray-400">{formatTime(activity.createdAt)}</span>
        </div>
        <p className="text-sm font-medium text-gray-800 mt-0.5 break-words">
          {activity.details ?? meta.label}
        </p>
      </div>
      {clickable && (
        <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 mt-2 flex-shrink-0" />
      )}
    </div>
  );

  if (clickable && meta.section) {
    return (
      <button
        type="button"
        onClick={() => onClickSection(meta.section!)}
        className="w-full text-left hover:bg-slate-50/50 transition-colors"
      >
        {inner}
      </button>
    );
  }
  return <div className="w-full">{inner}</div>;
}
