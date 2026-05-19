import React from 'react';
import type { StageWidget } from '@/lib/api';
import { ProgressBar, Stat } from './shared';

type GoLiveData = Extract<StageWidget, { kind: 'GOLIVE' }>;

export function GoLiveWidget({ data }: { data: GoLiveData }) {
  const pct =
    data.cutoverChecklistTotal > 0
      ? (data.cutoverChecklistComplete / data.cutoverChecklistTotal) * 100
      : 0;
  return (
    <div className="space-y-3" data-testid="widget-golive">
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label="Days until go-live"
          value={data.daysUntilGoLive == null ? '—' : `${data.daysUntilGoLive}d`}
          tone={
            data.daysUntilGoLive != null && data.daysUntilGoLive < 7 ? 'red' : 'brand'
          }
          testid="widget-golive-countdown"
        />
        <Stat
          label="Cutover checklist"
          value={`${data.cutoverChecklistComplete} / ${data.cutoverChecklistTotal}`}
          tone={pct === 100 ? 'green' : 'neutral'}
          testid="widget-golive-checklist"
        />
      </div>
      <ProgressBar
        pct={pct}
        tone={pct === 100 ? 'green' : 'brand'}
        testid="widget-golive-progress"
      />
    </div>
  );
}
