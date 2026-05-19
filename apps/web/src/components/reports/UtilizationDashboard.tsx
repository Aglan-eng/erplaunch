/**
 * Phase 52.6 — Utilization dashboard.
 *
 * Per-user horizontal stacked bar (Sales/PM/CSM/AR) + overload
 * count callout + unbalanced-role flag chip.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { reportsApi } from '@/lib/api';
import { CHART_COLORS, Callout, EmptyState, ReportSection } from './reportsShared';
import { cn } from '@/lib/utils';

export function UtilizationDashboard() {
  const q = useQuery({ queryKey: ['report-utilization'], queryFn: () => reportsApi.utilization() });
  if (q.isLoading) return <EmptyState message="Loading utilization…" testid="utilization-loading" />;
  if (q.isError || !q.data) {
    return <EmptyState message="Failed to load utilization." testid="utilization-error" />;
  }
  const data = q.data;
  const noUsers = data.byUser.length === 0;

  const chartData = data.byUser.slice(0, 20).map((u) => ({
    user: u.userName,
    Sales: u.salesCount,
    'Project Lead': u.projectLeadCount,
    CSM: u.csmCount,
    AR: u.arCount,
  }));

  return (
    <div className="space-y-4" data-testid="utilization-dashboard">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Callout
          label="Owners tracked"
          value={data.byUser.length}
          tone="brand"
          testid="utilization-callout-owners"
        />
        <Callout
          label="Overloaded (> 15 active)"
          value={data.overloadedUsers}
          tone={data.overloadedUsers > 0 ? 'red' : 'green'}
          testid="utilization-callout-overloaded"
        />
        <Callout
          label="Most-skewed role"
          value={
            data.unbalancedRoles
              ? `${data.unbalancedRoles.role} (${data.unbalancedRoles.ratio}×)`
              : '—'
          }
          tone={
            data.unbalancedRoles && data.unbalancedRoles.ratio >= 3
              ? 'yellow'
              : 'neutral'
          }
          testid="utilization-callout-skew"
        />
      </div>

      <ReportSection
        title="Per-user workload"
        subtitle="Active assignments split by role. Each row is one owner; bar segments stack."
        testid="utilization-byuser-section"
      >
        {noUsers ? (
          <EmptyState message="No owners assigned across the firm yet." testid="utilization-byuser-empty" />
        ) : (
          <div
            data-testid="utilization-byuser-chart"
            style={{ width: '100%', height: Math.max(200, 30 * chartData.length + 50) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={chartData}
                margin={{ top: 5, right: 20, left: 80, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis
                  type="category"
                  dataKey="user"
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                  width={100}
                />
                <Tooltip />
                <Legend />
                <Bar dataKey="Sales" stackId="a" fill={CHART_COLORS.primary} />
                <Bar dataKey="Project Lead" stackId="a" fill={CHART_COLORS.accent} />
                <Bar dataKey="CSM" stackId="a" fill={CHART_COLORS.warning} />
                <Bar dataKey="AR" stackId="a" fill={CHART_COLORS.neutral} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportSection>

      <ReportSection
        title="Owner detail"
        subtitle="Total active customers across all four columns per owner."
        testid="utilization-detail-section"
      >
        {noUsers ? (
          <EmptyState message="No owners assigned." />
        ) : (
          <table className="w-full text-sm" data-testid="utilization-detail-table">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left py-1.5 font-semibold">Owner</th>
                <th className="text-right py-1.5 font-semibold">Sales</th>
                <th className="text-right py-1.5 font-semibold">Project Lead</th>
                <th className="text-right py-1.5 font-semibold">CSM</th>
                <th className="text-right py-1.5 font-semibold">AR</th>
                <th className="text-right py-1.5 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.byUser.map((u) => (
                <tr
                  key={u.userId}
                  className={cn('hover:bg-gray-50', u.isOverloaded ? 'bg-rose-50/30' : '')}
                  data-testid={`utilization-detail-row-${u.userId}`}
                  data-overloaded={u.isOverloaded}
                >
                  <td className="py-1.5 text-gray-900 font-medium">{u.userName}</td>
                  <td className="py-1.5 text-right text-gray-700 tabular-nums">{u.salesCount}</td>
                  <td className="py-1.5 text-right text-gray-700 tabular-nums">
                    {u.projectLeadCount}
                  </td>
                  <td className="py-1.5 text-right text-gray-700 tabular-nums">{u.csmCount}</td>
                  <td className="py-1.5 text-right text-gray-700 tabular-nums">{u.arCount}</td>
                  <td
                    className={cn(
                      'py-1.5 text-right font-bold tabular-nums',
                      u.isOverloaded ? 'text-rose-700' : 'text-gray-900',
                    )}
                  >
                    {u.totalActive}
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
