import React from 'react';
import type { StageWidget } from '@/lib/api';
import { Chip, formatArr } from './shared';

type LostData = Extract<StageWidget, { kind: 'LOST' }>;

export function LostWidget({ data }: { data: LostData }) {
  return (
    <div className="space-y-3" data-testid="widget-lost">
      <div className="grid grid-cols-2 gap-4 items-center">
        <div data-testid="widget-lost-reason">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            Reason
          </div>
          <p className="text-sm text-gray-900">{data.lostReason ?? 'Unspecified'}</p>
        </div>
        <div data-testid="widget-lost-value">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            Lost value
          </div>
          <Chip tone="red">{formatArr(data.lostValue)}</Chip>
        </div>
      </div>
    </div>
  );
}
