/**
 * Phase 52.6 — Reports tab with five dashboards.
 *
 * Replaces the Phase 52.2 stub. URL-state via `?tab=`:
 *   pipeline (default) · delivery · health · renewals · utilization
 *
 * Each dashboard is its own component under
 * `apps/web/src/components/reports/` and fetches via the matching
 * `reportsApi.<dashboard>` helper.
 */
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  Briefcase,
  Heart,
  RefreshCcw,
  Users,
} from 'lucide-react';

import { AppNav } from '../components/AppNav';
import { PipelineDashboard } from '@/components/reports/PipelineDashboard';
import { DeliveryDashboard } from '@/components/reports/DeliveryDashboard';
import { HealthDashboard } from '@/components/reports/HealthDashboard';
import { RenewalsDashboard } from '@/components/reports/RenewalsDashboard';
import { UtilizationDashboard } from '@/components/reports/UtilizationDashboard';
import { cn } from '@/lib/utils';

type Tab = 'pipeline' | 'delivery' | 'health' | 'renewals' | 'utilization';

const TABS: Array<{
  key: Tab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Phase 53.1 — plain-English "this answers" subtitle. */
  answers: string;
}> = [
  { key: 'pipeline', label: 'Pipeline', icon: BarChart3, answers: 'Are we filling the funnel?' },
  { key: 'delivery', label: 'Delivery', icon: Briefcase, answers: 'Who is slipping vs on-track?' },
  { key: 'health', label: 'Customer Health', icon: Heart, answers: 'Who is at risk of churning?' },
  { key: 'renewals', label: 'Renewals', icon: RefreshCcw, answers: "What's at risk in the next 90 days?" },
  { key: 'utilization', label: 'Utilization', icon: Users, answers: 'Who is overloaded?' },
];

function readTab(params: URLSearchParams): Tab {
  const raw = params.get('tab');
  if (
    raw === 'pipeline' ||
    raw === 'delivery' ||
    raw === 'health' ||
    raw === 'renewals' ||
    raw === 'utilization'
  ) {
    return raw;
  }
  return 'pipeline';
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = readTab(searchParams);

  const setTab = (next: Tab): void => {
    const np = new URLSearchParams(searchParams);
    if (next === 'pipeline') np.delete('tab');
    else np.set('tab', next);
    setSearchParams(np, { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50" data-testid="reports-page">
      <AppNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <header className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">Reports</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Roll-ups across your firm's customers — pipeline, delivery, health, renewals,
            utilization.
          </p>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-gray-200 mb-4 overflow-x-auto"
          aria-label="Reports tabs"
          data-testid="reports-tabs"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                data-testid={`reports-tab-${t.key}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  active
                    ? 'text-brand-700 border-brand-500'
                    : 'text-gray-500 border-transparent hover:text-gray-900',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </nav>

        <p
          className="text-xs text-gray-500 mb-4 -mt-2"
          data-testid="reports-tab-answers"
        >
          This dashboard answers:{' '}
          <span className="font-semibold text-gray-700">
            {TABS.find((t) => t.key === tab)?.answers}
          </span>
        </p>

        {tab === 'pipeline' && <PipelineDashboard />}
        {tab === 'delivery' && <DeliveryDashboard />}
        {tab === 'health' && <HealthDashboard />}
        {tab === 'renewals' && <RenewalsDashboard />}
        {tab === 'utilization' && <UtilizationDashboard />}
      </main>
    </div>
  );
}
