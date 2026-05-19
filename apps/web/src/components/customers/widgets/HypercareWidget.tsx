import React from 'react';
import type { StageWidget } from '@/lib/api';
import { Chip, Stat } from './shared';

type HypercareData = Extract<StageWidget, { kind: 'HYPERCARE' }>;

export function HypercareWidget({ data }: { data: HypercareData }) {
  return (
    <div className="space-y-3" data-testid="widget-hypercare">
      <div className="grid grid-cols-3 gap-4">
        <Stat
          label="Open incidents"
          value={data.openIncidentCount}
          tone={data.openIncidentCount > 0 ? 'yellow' : 'green'}
          testid="widget-hypercare-incidents"
        />
        <div data-testid="widget-hypercare-p1">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            P1 count
          </div>
          <Chip tone={data.p1Count > 0 ? 'red' : 'green'}>
            {data.p1Count} P1
          </Chip>
        </div>
        <Stat
          label="Days remaining"
          value={`${data.daysRemainingInHypercare}d`}
          tone="brand"
          testid="widget-hypercare-remaining"
        />
      </div>
    </div>
  );
}
