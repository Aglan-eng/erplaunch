import React from 'react';
import type { StageWidget } from '@/lib/api';

type ChurnedData = Extract<StageWidget, { kind: 'CHURNED' }>;

export function ChurnedWidget({ data }: { data: ChurnedData }) {
  return (
    <div className="space-y-3" data-testid="widget-churned">
      <div className="grid grid-cols-2 gap-4">
        <div data-testid="widget-churned-reason">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            Churn reason
          </div>
          <p className="text-sm text-gray-900">{data.churnReason ?? 'Unspecified'}</p>
        </div>
        <div data-testid="widget-churned-date">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            Churned
          </div>
          <p className="text-sm text-gray-900">
            {data.churnedAt ? data.churnedAt.slice(0, 10) : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}
