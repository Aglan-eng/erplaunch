import React from 'react';
import type { StageWidget } from '@/lib/api';
import { Chip, ProgressBar, Stat } from './shared';

type UatData = Extract<StageWidget, { kind: 'UAT' }>;

export function UatWidget({ data, customerId }: { data: UatData; customerId: string }) {
  void customerId;
  const pct = data.targetDays > 0 ? (data.daysInStage / data.targetDays) * 100 : 0;
  const overdue = data.daysInStage > data.targetDays;
  return (
    <div className="space-y-3" data-testid="widget-uat">
      <div className="grid grid-cols-3 gap-4">
        <div data-testid="widget-uat-blockers">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            Blockers
          </div>
          <Chip tone={data.openBlockerCount > 0 ? 'red' : 'green'}>
            {data.openBlockerCount} open
          </Chip>
        </div>
        <Stat
          label="Tests passed"
          value={data.testsPassedPct == null ? '—' : `${data.testsPassedPct}%`}
          tone={data.testsPassedPct != null && data.testsPassedPct >= 80 ? 'green' : 'neutral'}
          testid="widget-uat-tests"
        />
        <Stat
          label="Days in UAT"
          value={`${data.daysInStage}d / ${data.targetDays}d`}
          tone={overdue ? 'red' : 'neutral'}
          testid="widget-uat-days"
        />
      </div>
      <ProgressBar pct={pct} tone={overdue ? 'red' : 'brand'} testid="widget-uat-progress" />
    </div>
  );
}
