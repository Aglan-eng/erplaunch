import React from 'react';
import type { StageWidget } from '@/lib/api';
import { Stat, formatDate } from './shared';

type RenewedData = Extract<StageWidget, { kind: 'RENEWED' }>;

export function RenewedWidget({ data }: { data: RenewedData }) {
  return (
    <div className="space-y-3" data-testid="widget-renewed">
      <div className="grid grid-cols-3 gap-4">
        <Stat
          label="Renewals"
          value={`↻ ${data.renewalCount}`}
          tone="green"
          testid="widget-renewed-count"
        />
        <Stat
          label="Last renewal"
          value={formatDate(data.lastRenewalDate)}
          tone="neutral"
          testid="widget-renewed-last"
        />
        <Stat
          label="Next renewal"
          value={formatDate(data.nextRenewalDate)}
          tone="brand"
          testid="widget-renewed-next"
        />
      </div>
    </div>
  );
}
