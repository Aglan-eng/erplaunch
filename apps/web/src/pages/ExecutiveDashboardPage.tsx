/**
 * Phase 53.3 — Executive Dashboard.
 *
 * Read-only firm-wide home for CEO-role users (and APP_ADMIN).
 * Five KPI tiles + compact roll-ups of the five Reports dashboards
 * (re-using `reportsApi` so the numbers match what /reports shows).
 *
 * CEO permissions in the matrix: firm-wide READ, no operational
 * writes — so this page is informational only. Every roll-up
 * deep-links to the corresponding /reports tab for detail.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Briefcase,
  Heart,
  RefreshCcw,
  Users,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Activity as ActivityIcon,
  Crown,
} from 'lucide-react';

import { AppNav } from '../components/AppNav';
import { reportsApi } from '../lib/api';
import { cn } from '@/lib/utils';

function fmtCurrency(cents: number | null | undefined): string {
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

export function ExecutiveDashboardPage() {
  const pipelineQ = useQuery({ queryKey: ['report-pipeline'], queryFn: () => reportsApi.pipeline() });
  const deliveryQ = useQuery({ queryKey: ['report-delivery'], queryFn: () => reportsApi.delivery() });
  const healthQ = useQuery({ queryKey: ['report-health'], queryFn: () => reportsApi.health() });
  const renewalsQ = useQuery({ queryKey: ['report-renewals'], queryFn: () => reportsApi.renewals() });
  const utilQ = useQuery({ queryKey: ['report-utilization'], queryFn: () => reportsApi.utilization() });

  // KPI strip math — all derived from the existing report payloads.
  const totalPipelineValueCents = (pipelineQ.data?.funnel ?? []).reduce(
    (acc, s) => acc + (s.totalArr ?? 0),
    0,
  );
  const activeImplementations = deliveryQ.data?.activeProjects ?? 0;
  const customersAtRisk = healthQ.data?.distribution?.red ?? 0;
  const renewalExposureArr = renewalsQ.data?.totalArrAtRisk ?? 0;
  const totalArr = (healthQ.data?.totalManagedCustomers ?? 0) * 0; // placeholder — see report shape
  void totalArr;
  const ownersOverloaded = utilQ.data?.overloadedUsers ?? 0;

  return (
    <div className="min-h-screen bg-gray-50" data-testid="executive-dashboard-page">
      <AppNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <header className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Crown className="h-5 w-5 text-amber-600" />
            <h1 className="text-xl font-bold text-gray-900">Executive Dashboard</h1>
          </div>
          <p className="text-xs text-gray-500">
            Firm-wide view, read-only. The full breakdowns live on the{' '}
            <Link to="/reports" className="text-brand-700 hover:underline">
              Reports
            </Link>{' '}
            page.
          </p>
        </header>

        {/* ─── KPI strip ────────────────────────────────────────────── */}
        <section
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6"
          data-testid="executive-kpi-strip"
        >
          <KpiTile
            testid="exec-kpi-pipeline-value"
            label="Total Pipeline Value"
            value={fmtCurrency(totalPipelineValueCents)}
            icon={DollarSign}
            tone="brand"
          />
          <KpiTile
            testid="exec-kpi-active-impl"
            label="Active Implementations"
            value={activeImplementations}
            icon={Briefcase}
            tone="brand"
          />
          <KpiTile
            testid="exec-kpi-at-risk"
            label="Customers at Risk"
            value={customersAtRisk}
            icon={AlertTriangle}
            tone={customersAtRisk > 0 ? 'red' : 'green'}
          />
          <KpiTile
            testid="exec-kpi-renewal-exposure"
            label="90-Day Renewal Exposure"
            value={fmtArr(renewalExposureArr)}
            icon={RefreshCcw}
            tone={renewalExposureArr > 0 ? 'yellow' : 'green'}
          />
          <KpiTile
            testid="exec-kpi-overloaded"
            label="Owners Overloaded"
            value={ownersOverloaded}
            icon={TrendingUp}
            tone={ownersOverloaded > 0 ? 'yellow' : 'green'}
          />
        </section>

        {/* ─── Five report roll-ups ────────────────────────────────── */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="executive-rollups">
          <RollupCard
            testid="exec-rollup-pipeline"
            title="Pipeline"
            answers="Are we filling the funnel?"
            icon={BarChart3}
            link="/reports?tab=pipeline"
            stats={[
              { label: 'Stalled', value: pipelineQ.data?.stalledCount ?? '—' },
              {
                label: 'Active pre-Won',
                value: (pipelineQ.data?.funnel ?? []).reduce((a, s) => a + s.count, 0),
              },
              { label: 'Total ARR', value: fmtCurrency(totalPipelineValueCents) },
            ]}
          />
          <RollupCard
            testid="exec-rollup-delivery"
            title="Delivery"
            answers="Who is slipping vs on-track?"
            icon={Briefcase}
            link="/reports?tab=delivery"
            stats={[
              { label: 'Active', value: activeImplementations },
              { label: 'Slipping', value: (deliveryQ.data?.slippingList ?? []).length },
              { label: 'Forecast', value: (deliveryQ.data?.forecastedGoLives ?? []).length },
            ]}
          />
          <RollupCard
            testid="exec-rollup-health"
            title="Customer Health"
            answers="Who is at risk of churning?"
            icon={Heart}
            link="/reports?tab=health"
            stats={[
              { label: 'Managed', value: healthQ.data?.totalManagedCustomers ?? '—' },
              { label: 'Red', value: healthQ.data?.distribution?.red ?? 0 },
              { label: 'Yellow', value: healthQ.data?.distribution?.yellow ?? 0 },
            ]}
          />
          <RollupCard
            testid="exec-rollup-renewals"
            title="Renewals"
            answers="What's at risk in the next 90 days?"
            icon={RefreshCcw}
            link="/reports?tab=renewals"
            stats={[
              { label: 'Due 90d', value: (renewalsQ.data?.next90Days ?? []).length },
              {
                label: 'At-risk',
                value: renewalsQ.data?.riskBreakdown?.atRiskRenewals ?? 0,
              },
              { label: 'ARR at risk', value: fmtArr(renewalExposureArr) },
            ]}
          />
          <RollupCard
            testid="exec-rollup-utilization"
            title="Utilization"
            answers="Who is overloaded?"
            icon={Users}
            link="/reports?tab=utilization"
            stats={[
              { label: 'Owners', value: (utilQ.data?.byUser ?? []).length },
              { label: 'Overloaded', value: ownersOverloaded },
              {
                label: 'Skewed role',
                value: utilQ.data?.unbalancedRoles
                  ? `${utilQ.data.unbalancedRoles.role}`
                  : '—',
              },
            ]}
          />
          <ActivityCard />
        </section>
      </main>
    </div>
  );
}

interface KpiTileProps {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'brand' | 'green' | 'yellow' | 'red';
  testid: string;
}

function KpiTile({ label, value, icon: Icon, tone, testid }: KpiTileProps) {
  const toneCls = {
    brand: 'bg-white border-gray-200',
    green: 'bg-emerald-50 border-emerald-200',
    yellow: 'bg-amber-50 border-amber-200',
    red: 'bg-rose-50 border-rose-200',
  }[tone];
  const valueCls = {
    brand: 'text-brand-700',
    green: 'text-emerald-700',
    yellow: 'text-amber-700',
    red: 'text-rose-700',
  }[tone];
  return (
    <div
      data-testid={testid}
      className={cn('rounded-xl border p-4', toneCls)}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5 text-gray-400" />
      </div>
      <div className={cn('text-2xl font-bold tabular-nums', valueCls)}>{value}</div>
    </div>
  );
}

interface RollupCardProps {
  title: string;
  answers: string;
  icon: React.ComponentType<{ className?: string }>;
  link: string;
  stats: Array<{ label: string; value: React.ReactNode }>;
  testid: string;
}

function RollupCard({ title, answers, icon: Icon, link, stats, testid }: RollupCardProps) {
  return (
    <Link
      to={link}
      data-testid={testid}
      className="group bg-white border border-gray-200 rounded-xl p-5 hover:border-brand-300 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        </div>
      </div>
      <p className="text-[11px] text-gray-500 mb-4">{answers}</p>
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
              {s.label}
            </div>
            <div className="text-base font-bold text-gray-900 tabular-nums mt-0.5">
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </Link>
  );
}

function ActivityCard() {
  return (
    <div
      data-testid="exec-rollup-activity"
      className="bg-white border border-gray-200 rounded-xl p-5"
    >
      <div className="flex items-center gap-2 mb-2">
        <ActivityIcon className="h-4 w-4 text-brand-600" />
        <h2 className="text-sm font-semibold text-gray-900">Firm-wide activity</h2>
      </div>
      <p className="text-[11px] text-gray-500 mb-3">
        Recent stage transitions, handoffs, and document generation across every customer.
      </p>
      <p className="text-xs text-gray-500">
        Open the{' '}
        <Link
          to="/inbox"
          className="text-brand-700 hover:underline font-semibold"
        >
          Firm-wide Inbox
        </Link>{' '}
        for the full feed (admin view).
      </p>
    </div>
  );
}
