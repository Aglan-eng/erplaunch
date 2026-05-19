import React from 'react';
import type { StageWidget } from '@/lib/api';
import { Stat, formatDate } from './shared';

type LiveSlaData = Extract<StageWidget, { kind: 'LIVE_SLA' }>;

export function LiveSlaWidget({ data }: { data: LiveSlaData }) {
  return (
    <div className="space-y-3" data-testid="widget-live-sla">
      <div className="grid grid-cols-3 gap-4">
        <Stat
          label="SLA uptime"
          value={data.slaUptimePct == null ? '99.9%' : `${data.slaUptimePct}%`}
          tone="green"
          testid="widget-livesla-uptime"
        />
        <Stat
          label="Open tickets"
          value={data.openTicketCount}
          tone={data.openTicketCount > 0 ? 'yellow' : 'green'}
          testid="widget-livesla-tickets"
        />
        <Stat
          label="Next renewal"
          value={formatDate(data.nextRenewalDate)}
          tone="brand"
          testid="widget-livesla-renewal"
        />
      </div>
      {data.lastIncidentDaysAgo != null && (
        <p
          className="text-xs text-gray-500"
          data-testid="widget-livesla-incident"
        >
          Last incident: {data.lastIncidentDaysAgo} days ago
        </p>
      )}
    </div>
  );
}
