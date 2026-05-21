/**
 * Phase 55.1 — Business dashboard home.
 *
 * Replaces the Phase 53.3 role-aware home-redirect split: everyone
 * lands on `/dashboard` after login. Role-aware DATA scope (CEO /
 * APP_ADMIN / managers see firm-wide; operators see their slice)
 * but the layout is identical for everyone.
 *
 * Layout:
 *   - KPI row (6 metric cards)
 *   - Charts row (3 recharts cards)
 *   - Two-column lower section: "Needs your attention" + "Recent activity"
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  DollarSign,
  Briefcase,
  AlertTriangle,
  RefreshCcw,
  TrendingUp,
  Inbox as InboxIcon,
  ArrowRight,
  Activity as ActivityIcon,
} from 'lucide-react';

import { AppShell } from '../components/SideNav';
import { reportsApi, inboxApi } from '../lib/api';
import { cn } from '@/lib/utils';

function fmtCurrencyCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars.toFixed(0)}`;
}
function fmtArr(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

const CHART_COLORS = {
  brand: '#4f46e5',
  green: '#10b981',
  yellow: '#f59e0b',
  red: '#ef4444',
};

export function DashboardPage() {
  const pipeline = useQuery({ queryKey: ['report-pipeline'], queryFn: () => reportsApi.pipeline() });
  const delivery = useQuery({ queryKey: ['report-delivery'], queryFn: () => reportsApi.delivery() });
  const health = useQuery({ queryKey: ['report-health'], queryFn: () => reportsApi.health() });
  const renewals = useQuery({ queryKey: ['report-renewals'], queryFn: () => reportsApi.renewals() });
  const util = useQuery({ queryKey: ['report-utilization'], queryFn: () => reportsApi.utilization() });
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: () => inboxApi.get() });

  // Phase 55.2 hotfix — memoize all derived arrays so chart data
  // references are stable across renders. recharts re-animates when
  // its `data` prop changes by reference; without useMemo each
  // re-render produced a new `.map(...)` array, fed back into
  // ResizeObserver-driven ResponsiveContainer, which contributed to
  // the /dashboard render storm.
  const funnelData = useMemo(
    () => (pipeline.data?.funnel ?? []).map((s) => ({ stage: s.stage, count: s.count })),
    [pipeline.data?.funnel],
  );
  const deliveryByStage = useMemo(
    () =>
      (delivery.data?.byStage ?? []).map((s) => ({
        stage: s.stage,
        onTrack: s.onTrack,
        slipping: s.slipping,
      })),
    [delivery.data?.byStage],
  );
  const healthPieData = useMemo(
    () => [
      { name: 'Red', value: health.data?.distribution?.red ?? 0 },
      { name: 'Yellow', value: health.data?.distribution?.yellow ?? 0 },
      { name: 'Green', value: health.data?.distribution?.green ?? 0 },
    ],
    [
      health.data?.distribution?.red,
      health.data?.distribution?.yellow,
      health.data?.distribution?.green,
    ],
  );
  const attentionItems = useMemo(
    () => (inbox.data?.forYou ?? []).slice(0, 5),
    [inbox.data?.forYou],
  );
  const utilRows = useMemo(
    () => (util.data?.byUser ?? []).slice(0, 6),
    [util.data?.byUser],
  );

  const totalPipelineCents = (pipeline.data?.funnel ?? []).reduce((a, s) => a + (s.totalArr ?? 0), 0);
  const activeImpls = delivery.data?.activeProjects ?? 0;
  const atRisk = health.data?.distribution?.red ?? 0;
  const renewalExposure = renewals.data?.totalArrAtRisk ?? 0;
  const totalArr = (renewals.data?.next90Days ?? []).reduce((a, r) => a + (r.arr ?? 0), 0);
  const forYouCount = (inbox.data?.forYou ?? []).length;

  return (
    <AppShell>
      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-8" data-testid="dashboard-page">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Firm-wide health and the work that needs you today.
          </p>
        </header>

        {/* ── KPI row ─────────────────────────────────────────────── */}
        <section
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6"
          data-testid="dashboard-kpi-row"
        >
          <KpiCard
            testid="dash-kpi-pipeline"
            label="Pipeline Value"
            value={fmtCurrencyCents(totalPipelineCents)}
            icon={DollarSign}
            tone="brand"
          />
          <KpiCard
            testid="dash-kpi-active"
            label="Active Implementations"
            value={activeImpls}
            icon={Briefcase}
            tone="brand"
          />
          <KpiCard
            testid="dash-kpi-at-risk"
            label="Customers at Risk"
            value={atRisk}
            icon={AlertTriangle}
            tone={atRisk > 0 ? 'red' : 'green'}
          />
          <KpiCard
            testid="dash-kpi-renewal-exposure"
            label="90-Day Renewal Exposure"
            value={fmtArr(renewalExposure)}
            icon={RefreshCcw}
            tone={renewalExposure > 0 ? 'yellow' : 'green'}
          />
          <KpiCard
            testid="dash-kpi-total-arr"
            label="Total ARR (90d)"
            value={fmtArr(totalArr)}
            icon={TrendingUp}
            tone="brand"
          />
          <KpiCard
            testid="dash-kpi-for-you"
            label="Open Items for You"
            value={forYouCount}
            icon={InboxIcon}
            tone={forYouCount > 0 ? 'yellow' : 'green'}
          />
        </section>

        {/* ── Charts row ──────────────────────────────────────────── */}
        <section
          className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6"
          data-testid="dashboard-charts-row"
        >
          <DashboardCard title="Pipeline funnel" testid="dash-chart-pipeline" link="/reports?tab=pipeline">
            {pipeline.isLoading ? (
              <SkeletonChart />
            ) : (pipeline.data?.funnel ?? []).length === 0 ? (
              <EmptyChart label="No pre-Won customers yet." />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={funnelData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <XAxis dataKey="stage" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="count" fill={CHART_COLORS.brand} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </DashboardCard>

          <DashboardCard title="On-track vs slipping" testid="dash-chart-delivery" link="/reports?tab=delivery">
            {delivery.isLoading ? (
              <SkeletonChart />
            ) : !delivery.data?.byStage || delivery.data.byStage.every((s) => s.total === 0) ? (
              <EmptyChart label="No delivery-stage customers yet." />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={deliveryByStage}
                  margin={{ top: 5, right: 5, bottom: 0, left: 0 }}
                >
                  <XAxis dataKey="stage" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="onTrack" stackId="a" fill={CHART_COLORS.green} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="slipping" stackId="a" fill={CHART_COLORS.red} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </DashboardCard>

          <DashboardCard title="Health distribution" testid="dash-chart-health" link="/reports?tab=health">
            {health.isLoading ? (
              <SkeletonChart />
            ) : !health.data || health.data.totalManagedCustomers === 0 ? (
              <EmptyChart label="No managed customers yet." />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Tooltip />
                  <Pie
                    data={healthPieData}
                    dataKey="value"
                    innerRadius={42}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    <Cell fill={CHART_COLORS.red} />
                    <Cell fill={CHART_COLORS.yellow} />
                    <Cell fill={CHART_COLORS.green} />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
          </DashboardCard>
        </section>

        {/* ── Lower two-column section ────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="dashboard-lower-row">
          <DashboardCard title="Needs your attention" testid="dash-needs-attention" link="/inbox">
            {inbox.isLoading ? (
              <SkeletonRows />
            ) : forYouCount === 0 ? (
              <EmptyChart label="Nothing for you right now — 🎉" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {attentionItems.map((it) => (
                  <li
                    key={it.id}
                    className="py-2 flex items-start justify-between gap-2"
                    data-testid={`dash-attention-row-${it.id}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{it.customerName}</p>
                      <p className="text-[11px] text-gray-500 truncate">{it.summary}</p>
                    </div>
                    <Link
                      to={`/customers/${it.customerId}`}
                      className="text-xs text-brand-700 hover:underline flex-shrink-0"
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard title="Owner workload" testid="dash-utilization" link="/reports?tab=utilization">
            {util.isLoading ? (
              <SkeletonRows />
            ) : (util.data?.byUser ?? []).length === 0 ? (
              <EmptyChart label="No owners assigned yet." />
            ) : (
              <ul className="divide-y divide-gray-100">
                {utilRows.map((u) => (
                  <li
                    key={u.userId}
                    className="py-2 flex items-center justify-between gap-2"
                    data-testid={`dash-util-row-${u.userId}`}
                  >
                    <span className="text-sm text-gray-900 truncate">{u.userName}</span>
                    <span
                      className={cn(
                        'text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full',
                        u.isOverloaded
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-emerald-50 text-emerald-700',
                      )}
                    >
                      {u.totalActive} active
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        </section>
      </main>
    </AppShell>
  );
}

// ─── Reusable bits ─────────────────────────────────────────────────────────

interface DashboardCardProps {
  title: string;
  children: React.ReactNode;
  link?: string;
  testid: string;
}

function DashboardCard({ title, children, link, testid }: DashboardCardProps) {
  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm"
      data-testid={testid}
    >
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {link && (
          <Link
            to={link}
            className="text-[11px] text-brand-700 hover:underline inline-flex items-center gap-0.5"
          >
            View
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </header>
      {children}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'brand' | 'green' | 'yellow' | 'red';
  testid: string;
}

function KpiCard({ label, value, icon: Icon, tone, testid }: KpiCardProps) {
  const ring = {
    brand: 'border-gray-200',
    green: 'border-emerald-200',
    yellow: 'border-amber-200',
    red: 'border-rose-200',
  }[tone];
  const valTone = {
    brand: 'text-gray-900',
    green: 'text-emerald-700',
    yellow: 'text-amber-700',
    red: 'text-rose-700',
  }[tone];
  return (
    <div
      data-testid={testid}
      className={cn(
        'bg-white border rounded-xl p-4 shadow-sm transition-shadow hover:shadow',
        ring,
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5 text-gray-400" />
      </div>
      <div className={cn('text-2xl font-bold tabular-nums', valTone)}>{value}</div>
    </div>
  );
}

function SkeletonChart() {
  return (
    <div
      className="h-44 rounded-md bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 animate-pulse"
      data-testid="dash-skeleton-chart"
    />
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2" data-testid="dash-skeleton-rows">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-8 rounded-md bg-gray-100 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div
      className="h-44 flex items-center justify-center text-xs text-gray-500"
      data-testid="dash-empty-chart"
    >
      <ActivityIcon className="h-4 w-4 mr-1.5 text-gray-300" />
      {label}
    </div>
  );
}
