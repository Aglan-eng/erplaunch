/**
 * Phase 52.6 — Delivery dashboard.
 *
 * Stacked on-track-vs-slipping bar + slipping-list table + blocker
 * heat-row + forecasted go-lives list.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { reportsApi } from '@/lib/api';
import { CHART_COLORS, Callout, EmptyState, ReportSection, formatDate, stageLabel } from './reportsShared';
import { cn } from '@/lib/utils';

export function DeliveryDashboard() {
  const q = useQuery({ queryKey: ['report-delivery'], queryFn: () => reportsApi.delivery() });
  if (q.isLoading) return <EmptyState message="Loading delivery…" testid="delivery-loading" />;
  if (q.isError || !q.data) return <EmptyState message="Failed to load delivery." testid="delivery-error" />;
  const data = q.data;
  const slippingTotal = data.byStage.reduce((acc, s) => acc + s.slipping, 0);

  return (
    <div className="space-y-4" data-testid="delivery-dashboard">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Callout
          label="Active projects"
          value={data.activeProjects}
          tone="brand"
          testid="delivery-callout-active"
        />
        <Callout
          label="Slipping"
          value={slippingTotal}
          tone={slippingTotal > 0 ? 'red' : 'green'}
          testid="delivery-callout-slipping"
        />
        <Callout
          label="Forecasted go-lives"
          value={data.forecastedGoLives.length}
          tone="neutral"
          testid="delivery-callout-forecast"
        />
      </div>

      <ReportSection
        title="By stage: on-track vs slipping"
        testid="delivery-bystage-section"
      >
        {data.activeProjects === 0 ? (
          <EmptyState message="No active implementations." />
        ) : (
          <div data-testid="delivery-bystage-chart" style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={data.byStage.map((s) => ({
                  stage: stageLabel(s.stage),
                  'On track': s.onTrack,
                  Slipping: s.slipping,
                }))}
                margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="stage" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="On track" stackId="a" fill={CHART_COLORS.accent} />
                <Bar dataKey="Slipping" stackId="a" fill={CHART_COLORS.danger} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportSection>

      <ReportSection
        title="Slipping customers"
        subtitle={`${data.slippingList.length} project${data.slippingList.length === 1 ? '' : 's'} past target.`}
        testid="delivery-slipping-section"
      >
        {data.slippingList.length === 0 ? (
          <EmptyState message="No projects are slipping right now — 🎉" testid="delivery-slipping-empty" />
        ) : (
          <table className="w-full text-sm" data-testid="delivery-slipping-table">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left py-1.5 font-semibold">Customer</th>
                <th className="text-left py-1.5 font-semibold">Stage</th>
                <th className="text-left py-1.5 font-semibold">Project lead</th>
                <th className="text-right py-1.5 font-semibold">Days overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.slippingList.map((row) => (
                <tr
                  key={row.customerId}
                  className="hover:bg-gray-50"
                  data-testid={`delivery-slipping-row-${row.customerId}`}
                >
                  <td className="py-1.5">
                    <Link to={`/customers/${row.customerId}`} className="text-brand-700 hover:underline">
                      {row.customerName}
                    </Link>
                  </td>
                  <td className="py-1.5 text-gray-700">{stageLabel(row.stage)}</td>
                  <td className="py-1.5 text-gray-700">{row.projectLeadName ?? '—'}</td>
                  <td
                    className={cn(
                      'py-1.5 text-right font-semibold tabular-nums',
                      row.daysOverdue >= 30 ? 'text-rose-700' : 'text-amber-700',
                    )}
                  >
                    {row.daysOverdue}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportSection>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ReportSection title="Blockers by stage" testid="delivery-blockers-section">
          <ul className="space-y-1.5" data-testid="delivery-blockers-list">
            {data.blockersByStage.map((b) => (
              <li
                key={b.stage}
                className="flex items-center justify-between text-sm"
                data-testid={`delivery-blockers-row-${b.stage}`}
              >
                <span className="text-gray-700">{stageLabel(b.stage)}</span>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                    b.openBlockers === 0
                      ? 'bg-emerald-50 text-emerald-700'
                      : b.openBlockers >= 3
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-amber-50 text-amber-700',
                  )}
                >
                  {b.openBlockers}
                </span>
              </li>
            ))}
          </ul>
        </ReportSection>

        <ReportSection title="Forecasted go-lives" testid="delivery-forecast-section">
          {data.forecastedGoLives.length === 0 ? (
            <EmptyState message="No projects en route." />
          ) : (
            <ul className="space-y-1.5" data-testid="delivery-forecast-list">
              {data.forecastedGoLives.slice(0, 10).map((row) => {
                const daysOut = Math.max(
                  0,
                  Math.floor(
                    (new Date(row.estimatedGoLiveDate).getTime() - Date.now()) / 86_400_000,
                  ),
                );
                const weeks = Math.round(daysOut / 7);
                return (
                  <li
                    key={row.customerId}
                    className="flex items-center justify-between text-sm"
                    data-testid={`delivery-forecast-row-${row.customerId}`}
                  >
                    <Link
                      to={`/customers/${row.customerId}`}
                      className="text-brand-700 hover:underline truncate"
                    >
                      {row.customerName}
                    </Link>
                    <span className="text-xs text-gray-500 tabular-nums">
                      {formatDate(row.estimatedGoLiveDate)} · {weeks} wk
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </ReportSection>
      </div>
    </div>
  );
}
