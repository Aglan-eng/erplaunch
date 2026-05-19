/**
 * Phase 52.6 — Pipeline dashboard.
 *
 * Funnel bar chart + conversion-rate table + avg-days-in-stage
 * horizontal bars + stalled-customers callout.
 */
import React from 'react';
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
import {
  CHART_COLORS,
  Callout,
  EmptyState,
  ReportSection,
  formatArr,
  stageLabel,
} from './reportsShared';

export function PipelineDashboard() {
  const q = useQuery({ queryKey: ['report-pipeline'], queryFn: () => reportsApi.pipeline() });

  if (q.isLoading) return <EmptyState message="Loading pipeline…" testid="pipeline-loading" />;
  if (q.isError || !q.data) {
    return <EmptyState message="Failed to load pipeline." testid="pipeline-error" />;
  }
  const data = q.data;
  const hasFunnelData = data.funnel.some((s) => s.count > 0);

  return (
    <div className="space-y-4" data-testid="pipeline-dashboard">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Callout
          label="Stalled customers"
          value={data.stalledCount}
          tone={data.stalledCount > 0 ? 'red' : 'neutral'}
          testid="pipeline-callout-stalled"
        />
        <Callout
          label="Active pre-Won"
          value={data.funnel.reduce((acc, s) => acc + s.count, 0)}
          tone="brand"
          testid="pipeline-callout-active"
        />
        <Callout
          label="Pipeline value"
          value={formatArr(data.funnel.reduce((acc, s) => acc + s.totalArr, 0))}
          tone="brand"
          testid="pipeline-callout-arr"
        />
      </div>

      <ReportSection
        title="Funnel by stage"
        subtitle="Pre-Won customers grouped by stage; bar width = count."
        testid="pipeline-funnel-section"
      >
        {hasFunnelData ? (
          <div data-testid="pipeline-funnel-chart" style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={data.funnel.map((s) => ({ stage: stageLabel(s.stage), count: s.count }))}
                margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="stage" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="count" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState message="No pre-Won customers." testid="pipeline-funnel-empty" />
        )}
      </ReportSection>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ReportSection
          title="Conversion rates"
          subtitle="180-day rolling window."
          testid="pipeline-conversion-section"
        >
          {data.conversionRates.length === 0 ? (
            <EmptyState message="No transitions in the last 180 days." />
          ) : (
            <table className="w-full text-sm" data-testid="pipeline-conversion-table">
              <thead className="text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left py-1 font-semibold">From → To</th>
                  <th className="text-right py-1 font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.conversionRates.map((c) => (
                  <tr key={`${c.from}-${c.to}`} data-testid={`pipeline-conversion-row-${c.from}-${c.to}`}>
                    <td className="py-1.5 text-gray-700">
                      {stageLabel(c.from)} → {stageLabel(c.to)}
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{c.ratePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ReportSection>

        <ReportSection
          title="Average days in stage"
          subtitle="Computed from completed transition pairs."
          testid="pipeline-avgdays-section"
        >
          {data.avgDaysInStage.every((d) => d.days === 0) ? (
            <EmptyState message="No completed stage exits yet." />
          ) : (
            <div data-testid="pipeline-avgdays-chart" style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  layout="vertical"
                  data={data.avgDaysInStage.map((d) => ({ stage: stageLabel(d.stage), days: d.days }))}
                  margin={{ top: 5, right: 20, left: 60, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis type="category" dataKey="stage" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="days" fill={CHART_COLORS.accent} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ReportSection>
      </div>
    </div>
  );
}

