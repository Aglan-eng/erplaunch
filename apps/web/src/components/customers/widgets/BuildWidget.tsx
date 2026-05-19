import React from 'react';
import { Link } from 'react-router-dom';
import type { StageWidget } from '@/lib/api';
import { Chip, ProgressBar, Stat } from './shared';

type BuildData = Extract<StageWidget, { kind: 'BUILD' }>;

export function BuildWidget({
  data,
  customerId,
}: {
  data: BuildData;
  customerId: string;
}) {
  const pct = data.targetDays > 0 ? (data.daysInStage / data.targetDays) * 100 : 0;
  const overdue = data.daysInStage > data.targetDays;
  return (
    <div className="space-y-3" data-testid="widget-build">
      <div className="grid grid-cols-3 gap-4">
        <div data-testid="widget-build-blockers">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            Blockers
          </div>
          <Chip tone={data.openBlockerCount > 0 ? 'red' : 'green'}>
            {data.openBlockerCount} open
          </Chip>
        </div>
        <div data-testid="widget-build-decisions">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            Decisions
          </div>
          <Chip tone={data.openDecisionCount > 0 ? 'yellow' : 'green'}>
            {data.openDecisionCount} open
          </Chip>
        </div>
        <Stat
          label="Days in build"
          value={`${data.daysInStage}d / ${data.targetDays}d`}
          tone={overdue ? 'red' : 'neutral'}
          testid="widget-build-days"
        />
      </div>
      <ProgressBar pct={pct} tone={overdue ? 'red' : 'brand'} testid="widget-build-progress" />
      <Link
        to={`/customers/${customerId}?tab=activity`}
        className="inline-flex items-center text-xs font-semibold text-brand-700 hover:underline"
        data-testid="widget-build-view-link"
      >
        View activity →
      </Link>
    </div>
  );
}
