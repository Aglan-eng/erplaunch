import React from 'react';
import type { StageWidget } from '@/lib/api';
import { ProgressBar, Stat } from './shared';

type LeadData = Extract<StageWidget, { kind: 'LEAD' | 'QUALIFIED' }>;

export function LeadWidget({ data }: { data: LeadData }) {
  const pct = data.targetDays > 0 ? (data.daysInStage / data.targetDays) * 100 : 0;
  const overdue = data.daysInStage > data.targetDays;
  return (
    <div className="space-y-3" data-testid={`widget-${data.kind.toLowerCase()}`}>
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label="Days in stage"
          value={`${data.daysInStage}d / ${data.targetDays}d`}
          tone={overdue ? 'red' : 'neutral'}
          testid="widget-lead-days"
        />
        <Stat
          label="Source"
          value={data.leadSource ?? '—'}
          tone="brand"
          testid="widget-lead-source"
        />
      </div>
      <ProgressBar pct={pct} tone={overdue ? 'red' : 'brand'} testid="widget-lead-progress" />
      <p className="text-[11px] text-gray-500">
        Tip: qualify or disqualify so this customer doesn't stall in the pipeline.
      </p>
    </div>
  );
}
