/**
 * Phase 52.6 — Renewals dashboard.
 *
 * 90-day strip + total-ARR-at-risk callout + by-month bar chart +
 * at-risk vs healthy donut + renewals table.
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
import {
  CHART_COLORS,
  Callout,
  EmptyState,
  ReportSection,
  formatArr,
  SEVERITY_BG,
  SEVERITY_TEXT,
} from './reportsShared';
import { cn } from '@/lib/utils';

export function RenewalsDashboard() {
  const q = useQuery({ queryKey: ['report-renewals'], queryFn: () => reportsApi.renewals() });
  if (q.isLoading) return <EmptyState message="Loading renewals…" testid="renewals-loading" />;
  if (q.isError || !q.data) {
    return <EmptyState message="Failed to load renewals." testid="renewals-error" />;
  }
  const data = q.data;
  const noUpcoming = data.next90Days.length === 0;

  return (
    <div className="space-y-4" data-testid="renewals-dashboard">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Callout
          label="Total ARR at risk (90d)"
          value={formatArr(data.totalArrAtRisk)}
          tone={data.totalArrAtRisk > 0 ? 'red' : 'green'}
          testid="renewals-callout-arr"
        />
        <Callout
          label="Renewals next 90d"
          value={data.next90Days.length}
          tone="brand"
          testid="renewals-callout-count"
        />
        <Callout
          label="At-risk renewals"
          value={data.riskBreakdown.atRiskRenewals}
          tone={data.riskBreakdown.atRiskRenewals > 0 ? 'red' : 'green'}
          testid="renewals-callout-atrisk"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ReportSection title="By month" testid="renewals-bymonth-section">
          {data.byMonth.length === 0 ? (
            <EmptyState message="No upcoming renewals." />
          ) : (
            <div data-testid="renewals-bymonth-chart" style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={data.byMonth.map((m) => ({
                    month: m.monthLabel,
                    Count: m.count,
                  }))}
                  margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
                >
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="Count" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ReportSection>

        <ReportSection title="At-risk vs healthy" testid="renewals-risk-section">
          {noUpcoming ? (
            <EmptyState message="No upcoming renewals." />
          ) : (
            <div data-testid="renewals-risk-chart" style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Tooltip />
                  <Legend verticalAlign="bottom" iconType="circle" />
                  <Pie
                    data={[
                      { name: 'At risk', value: data.riskBreakdown.atRiskRenewals },
                      { name: 'Healthy', value: data.riskBreakdown.healthyRenewals },
                    ]}
                    dataKey="value"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    <Cell fill={CHART_COLORS.red} />
                    <Cell fill={CHART_COLORS.green} />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ReportSection>
      </div>

      <ReportSection
        title="Renewals coming due"
        subtitle="Customers with a renewal date within the next 90 days, ordered by date."
        testid="renewals-list-section"
      >
        {noUpcoming ? (
          <EmptyState message="No upcoming renewals." testid="renewals-list-empty" />
        ) : (
          <table className="w-full text-sm" data-testid="renewals-list-table">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left py-1.5 font-semibold">Customer</th>
                <th className="text-left py-1.5 font-semibold">CSM</th>
                <th className="text-left py-1.5 font-semibold">Health</th>
                <th className="text-right py-1.5 font-semibold">Renewal date</th>
                <th className="text-right py-1.5 font-semibold">Days</th>
                <th className="text-right py-1.5 font-semibold">ARR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.next90Days.map((row) => (
                <tr
                  key={row.customerId}
                  className="hover:bg-gray-50"
                  data-testid={`renewals-list-row-${row.customerId}`}
                >
                  <td className="py-1.5">
                    <Link to={`/customers/${row.customerId}`} className="text-brand-700 hover:underline">
                      {row.customerName}
                    </Link>
                  </td>
                  <td className="py-1.5 text-gray-700">{row.csmName ?? '—'}</td>
                  <td className="py-1.5">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize',
                        SEVERITY_BG[row.healthBand],
                        SEVERITY_TEXT[row.healthBand],
                      )}
                    >
                      {row.healthBand}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{row.renewalDueDate}</td>
                  <td className="py-1.5 text-right text-gray-700 tabular-nums">{row.daysUntilDue}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">
                    {formatArr(row.arr)}
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
