/**
 * Phase 52.6 — Customer Health dashboard.
 *
 * Red/yellow/green donut + churn-risk gauge + red-customers table
 * + per-stage stacked bar.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { reportsApi } from '@/lib/api';
import { CHART_COLORS, Callout, EmptyState, ReportSection, stageLabel } from './reportsShared';
import { cn } from '@/lib/utils';

export function HealthDashboard() {
  const q = useQuery({ queryKey: ['report-health'], queryFn: () => reportsApi.health() });
  if (q.isLoading) return <EmptyState message="Loading health…" testid="health-loading" />;
  if (q.isError || !q.data) return <EmptyState message="Failed to load health." testid="health-error" />;
  const data = q.data;
  const noData = data.totalManagedCustomers === 0;

  return (
    <div className="space-y-4" data-testid="health-dashboard">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Callout
          label="Managed customers"
          value={data.totalManagedCustomers}
          tone="brand"
          testid="health-callout-total"
        />
        <Callout
          label="Churn risk"
          value={`${data.churnRiskScore}%`}
          tone={
            data.churnRiskScore >= 30
              ? 'red'
              : data.churnRiskScore >= 10
                ? 'yellow'
                : 'green'
          }
          testid="health-callout-churn"
        />
        <Callout
          label="Red customers"
          value={data.distribution.red}
          tone={data.distribution.red > 0 ? 'red' : 'green'}
          testid="health-callout-red"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ReportSection title="Health distribution" testid="health-distribution-section">
          {noData ? (
            <EmptyState message="No managed customers yet." />
          ) : (
            <div data-testid="health-distribution-chart" style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Tooltip />
                  <Legend verticalAlign="bottom" iconType="circle" />
                  <Pie
                    data={[
                      { name: 'Red', value: data.distribution.red },
                      { name: 'Yellow', value: data.distribution.yellow },
                      { name: 'Green', value: data.distribution.green },
                    ]}
                    dataKey="value"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    <Cell fill={CHART_COLORS.red} />
                    <Cell fill={CHART_COLORS.yellow} />
                    <Cell fill={CHART_COLORS.green} />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ReportSection>

        <ReportSection title="By stage" testid="health-bystage-section">
          {noData ? (
            <EmptyState message="No managed customers yet." />
          ) : (
            <div data-testid="health-bystage-chart" style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={data.byStage.map((s) => ({
                    stage: stageLabel(s.stage),
                    Red: s.red,
                    Yellow: s.yellow,
                    Green: s.green,
                  }))}
                  margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
                >
                  <XAxis dataKey="stage" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="Red" stackId="a" fill={CHART_COLORS.red} />
                  <Bar dataKey="Yellow" stackId="a" fill={CHART_COLORS.yellow} />
                  <Bar dataKey="Green" stackId="a" fill={CHART_COLORS.green} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ReportSection>
      </div>

      <ReportSection title="Red customers — at risk" testid="health-redlist-section">
        {data.redCustomers.length === 0 ? (
          <EmptyState message="No red customers — your portfolio is healthy." testid="health-redlist-empty" />
        ) : (
          <table className="w-full text-sm" data-testid="health-redlist-table">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left py-1.5 font-semibold">Customer</th>
                <th className="text-left py-1.5 font-semibold">CSM</th>
                <th className="text-right py-1.5 font-semibold">Score</th>
                <th className="text-right py-1.5 font-semibold">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.redCustomers.map((row) => (
                <tr
                  key={row.customerId}
                  className="hover:bg-gray-50"
                  data-testid={`health-redlist-row-${row.customerId}`}
                >
                  <td className="py-1.5">
                    <Link to={`/customers/${row.customerId}`} className="text-brand-700 hover:underline">
                      {row.customerName}
                    </Link>
                  </td>
                  <td className="py-1.5 text-gray-700">{row.csmName ?? '—'}</td>
                  <td
                    className={cn(
                      'py-1.5 text-right font-semibold tabular-nums',
                      row.healthScore < 15 ? 'text-rose-700' : 'text-amber-700',
                    )}
                  >
                    {row.healthScore}
                  </td>
                  <td className="py-1.5 text-right text-gray-600 tabular-nums">
                    {row.lastActivityDaysAgo}d ago
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportSection>
    </div>
  );
}
