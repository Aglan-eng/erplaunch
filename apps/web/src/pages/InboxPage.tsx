/**
 * Phase 52.5 — role-based Inbox.
 *
 * Replaces the Phase 52.2 placeholder. Three stacked sections:
 *
 *   - For you      → items where you're the active-stage owner
 *   - Watching     → items where you own another (non-active) column
 *   - Firm-wide    → admin only, every item in the firm
 *
 * Top: 3-column counter row + a severity filter chip rail. Each
 * item row links to /customers/:id, shows a severity icon, the
 * one-line summary, an age badge, and a dismiss × button that
 * calls POST /api/v1/inbox/dismiss and optimistically yanks the
 * row out of the list. The dismissal is honoured server-side for 7
 * days.
 */
import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Briefcase,
  Clock,
  Inbox as InboxIcon,
  HelpCircle,
  RotateCcw,
  X,
  Eye,
  Crown,
} from 'lucide-react';

import { AppShell } from '../components/SideNav';
import {
  inboxApi,
  type InboxItem,
  type InboxItemType,
  type InboxResponse,
} from '@/lib/api';
type InboxSeverity = InboxItem['severity'];
import { formatRelativeTime } from '@/components/customers/stageMetadata';
import { cn } from '@/lib/utils';
import { HelpTip } from '@/components/guidance/HelpTip';

type SeverityFilter = 'all' | InboxSeverity;

function readFilter(params: URLSearchParams): SeverityFilter {
  const raw = params.get('filter');
  if (raw === 'critical' || raw === 'warning' || raw === 'info') return raw;
  return 'all';
}

const TYPE_META: Record<
  InboxItemType,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  STAGE_OVERDUE: { label: 'Overdue stage', icon: Clock },
  BLOCKER_OPEN: { label: 'Blocker', icon: AlertTriangle },
  DECISION_PENDING: { label: 'Decision pending', icon: HelpCircle },
  QUESTIONNAIRE_INCOMPLETE: { label: 'Questionnaire', icon: Briefcase },
  HANDOFF_INCOMING: { label: 'Handoff to you', icon: RotateCcw },
  RENEWAL_DUE_SOON: { label: 'Renewal soon', icon: RotateCcw },
};

const SEVERITY_META: Record<
  InboxSeverity,
  { dot: string; row: string; chip: string; chipActive: string }
> = {
  critical: {
    dot: 'bg-rose-500',
    row: 'border-l-rose-400',
    chip: 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
    chipActive: 'bg-rose-50 text-rose-700 border-transparent',
  },
  warning: {
    dot: 'bg-amber-500',
    row: 'border-l-amber-400',
    chip: 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
    chipActive: 'bg-amber-50 text-amber-700 border-transparent',
  },
  info: {
    dot: 'bg-blue-500',
    row: 'border-l-blue-400',
    chip: 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
    chipActive: 'bg-blue-50 text-blue-700 border-transparent',
  },
};

// ─── Page ─────────────────────────────────────────────────────────────────

export function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = readFilter(searchParams);
  const queryClient = useQueryClient();

  const setFilter = (next: SeverityFilter): void => {
    const np = new URLSearchParams(searchParams);
    if (next === 'all') np.delete('filter');
    else np.set('filter', next);
    setSearchParams(np, { replace: true });
  };

  const inboxQuery = useQuery({
    queryKey: ['inbox'],
    queryFn: () => inboxApi.get(),
  });

  const dismiss = useMutation({
    mutationFn: (itemId: string) => inboxApi.dismiss(itemId),
    onMutate: async (itemId) => {
      await queryClient.cancelQueries({ queryKey: ['inbox'] });
      const previous = queryClient.getQueryData<InboxResponse>(['inbox']);
      if (previous) {
        queryClient.setQueryData<InboxResponse>(['inbox'], {
          forYou: previous.forYou.filter((i) => i.id !== itemId),
          watching: previous.watching.filter((i) => i.id !== itemId),
          firmWide: previous.firmWide
            ? previous.firmWide.filter((i) => i.id !== itemId)
            : null,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['inbox'], ctx.previous);
    },
  });

  const data = inboxQuery.data;
  const forYou = useMemo(
    () =>
      filter === 'all'
        ? (data?.forYou ?? [])
        : (data?.forYou ?? []).filter((i) => i.severity === filter),
    [data, filter],
  );
  const watching = useMemo(
    () =>
      filter === 'all'
        ? (data?.watching ?? [])
        : (data?.watching ?? []).filter((i) => i.severity === filter),
    [data, filter],
  );
  const firmWide = useMemo(
    () =>
      data?.firmWide
        ? filter === 'all'
          ? data.firmWide
          : data.firmWide.filter((i) => i.severity === filter)
        : null,
    [data, filter],
  );

  return (
    <AppShell>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6" data-testid="inbox-page">
        <header className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">Inbox</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            What needs your attention across all your customers.
          </p>
        </header>

        {/* Counters + filters */}
        {data ? (
          <div className="mb-4 flex flex-wrap items-center gap-3" data-testid="inbox-summary">
            <CounterCard
              label="For you"
              count={data.forYou.length}
              icon={InboxIcon}
              accent="bg-brand-50 text-brand-700"
              testid="inbox-counter-foryou"
            />
            <CounterCard
              label="Watching"
              count={data.watching.length}
              icon={Eye}
              accent="bg-gray-100 text-gray-700"
              testid="inbox-counter-watching"
            />
            {data.firmWide !== null && (
              <CounterCard
                label="Firm-wide"
                count={data.firmWide.length}
                icon={Crown}
                accent="bg-purple-50 text-purple-700"
                testid="inbox-counter-firmwide"
              />
            )}
            <span className="mx-1 h-4 w-px bg-gray-200" />
            <FilterChips active={filter} onChange={setFilter} />
          </div>
        ) : null}

        {/* Body */}
        {inboxQuery.isLoading ? (
          <div
            className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center"
            data-testid="inbox-loading"
          >
            <p className="text-sm text-gray-500">Loading inbox…</p>
          </div>
        ) : inboxQuery.isError ? (
          <div
            className="bg-white border border-rose-200 rounded-xl px-4 py-8 text-center"
            data-testid="inbox-error"
          >
            <p className="text-sm text-rose-700">
              Failed to load inbox:{' '}
              {inboxQuery.error instanceof Error ? inboxQuery.error.message : 'Unknown error'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <InboxBucket
              testid="inbox-bucket-foryou"
              title="For you"
              subtitle="Items where you're the active owner."
              icon={InboxIcon}
              items={forYou}
              onDismiss={(id) => dismiss.mutate(id)}
              helpLabel="Why is this in For You?"
              helpBody="Alerts on customers where the current lifecycle stage matches a role you own (Sales / Project Lead / CSM / AR). These need your action today."
            />
            <InboxBucket
              testid="inbox-bucket-watching"
              title="Watching"
              subtitle="Items on customers where you're not the active owner but you own another column."
              icon={Eye}
              items={watching}
              onDismiss={(id) => dismiss.mutate(id)}
              helpLabel="Why is this in Watching?"
              helpBody="You own a different role on this customer (for example, Sales sees a customer they once owned now in Build). Keep an eye, but it's not your action — it belongs to whoever owns the current stage."
            />
            {firmWide !== null && (
              <InboxBucket
                testid="inbox-bucket-firmwide"
                title="Firm-wide"
                subtitle="Everything across the firm (admin view)."
                icon={Crown}
                items={firmWide}
                onDismiss={(id) => dismiss.mutate(id)}
                helpLabel="Why am I seeing Firm-wide?"
                helpBody="Admins see every alert in the firm regardless of ownership. Use it to spot patterns or step in when nobody else has."
              />
            )}
          </div>
        )}
      </main>
    </AppShell>
  );
}

// ─── Bits ─────────────────────────────────────────────────────────────────

interface CounterCardProps {
  label: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  testid: string;
}

function CounterCard({ label, count, icon: Icon, accent, testid }: CounterCardProps) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5"
      data-testid={testid}
    >
      <span
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-md text-xs',
          accent,
        )}
      >
        <Icon className="h-3 w-3" />
      </span>
      <span className="text-xs uppercase tracking-wider font-semibold text-gray-500">
        {label}
      </span>
      <span className="text-sm font-bold tabular-nums text-gray-900">{count}</span>
    </div>
  );
}

interface FilterChipsProps {
  active: SeverityFilter;
  onChange: (next: SeverityFilter) => void;
}

function FilterChips({ active, onChange }: FilterChipsProps) {
  const options: Array<{ key: SeverityFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'critical', label: 'Critical' },
    { key: 'warning', label: 'Warning' },
    { key: 'info', label: 'Info' },
  ];
  return (
    <div className="flex items-center gap-1.5" data-testid="inbox-filter-row">
      {options.map((opt) => {
        const isActive = active === opt.key;
        const classes =
          opt.key === 'all'
            ? isActive
              ? 'bg-gray-900 text-white border-transparent'
              : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            : isActive
              ? SEVERITY_META[opt.key].chipActive
              : SEVERITY_META[opt.key].chip;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            data-testid={`inbox-filter-${opt.key}`}
            aria-pressed={isActive}
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors',
              classes,
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface InboxBucketProps {
  testid: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  items: InboxItem[];
  onDismiss: (id: string) => void;
  helpLabel?: string;
  helpBody?: string;
}

function InboxBucket({
  testid,
  title,
  subtitle,
  icon: Icon,
  items,
  onDismiss,
  helpLabel,
  helpBody,
}: InboxBucketProps) {
  return (
    <section data-testid={testid}>
      <header className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {helpLabel && helpBody && (
          <HelpTip
            testid={`${testid}-help`}
            label={helpLabel}
            body={helpBody}
          />
        )}
        <span className="text-xs text-gray-400 tabular-nums">{items.length}</span>
      </header>
      <p className="text-xs text-gray-500 mb-2">{subtitle}</p>
      {items.length === 0 ? (
        <div
          className="bg-white border border-gray-200 rounded-xl py-10 px-6 text-center"
          data-testid={`${testid}-empty`}
        >
          <p className="text-sm font-medium text-gray-900">
            Nothing here right now — 🎉
          </p>
          <p className="mt-1 text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
            Items appear when a customer needs your attention — an overdue
            stage, an open blocker, a pending decision, an incoming handoff,
            or a renewal coming due in the next 90 days.
          </p>
        </div>
      ) : (
        <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {items.map((item) => (
            <InboxRow key={item.id} item={item} onDismiss={onDismiss} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface InboxRowProps {
  item: InboxItem;
  onDismiss: (id: string) => void;
}

function InboxRow({ item, onDismiss }: InboxRowProps) {
  const typeMeta = TYPE_META[item.itemType];
  const Icon = typeMeta.icon;
  const sevMeta = SEVERITY_META[item.severity];
  return (
    <li
      className={cn(
        'flex items-start gap-3 px-4 py-3 border-l-4',
        sevMeta.row,
      )}
      data-testid={`inbox-row-${item.id}`}
      data-severity={item.severity}
      data-item-type={item.itemType}
    >
      <span
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full flex-shrink-0',
          item.severity === 'critical'
            ? 'bg-rose-100 text-rose-700'
            : item.severity === 'warning'
              ? 'bg-amber-100 text-amber-700'
              : 'bg-blue-100 text-blue-700',
        )}
        aria-hidden="true"
        title={typeMeta.label}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          to={`/customers/${item.customerId}`}
          className="text-sm font-medium text-gray-900 hover:text-brand-700 truncate block"
          data-testid={`inbox-row-link-${item.id}`}
        >
          {item.customerName}
        </Link>
        <p className="text-xs text-gray-600 mt-0.5">{item.summary}</p>
        <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-2">
          <span className="uppercase tracking-wider font-semibold">{typeMeta.label}</span>
          <span>·</span>
          <span>{formatRelativeTime(item.createdAt)}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className="text-gray-300 hover:text-gray-700 p-1 rounded hover:bg-gray-100 flex-shrink-0"
        title="Dismiss for 7 days"
        data-testid={`inbox-row-dismiss-${item.id}`}
        aria-label={`Dismiss ${typeMeta.label} for ${item.customerName}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

