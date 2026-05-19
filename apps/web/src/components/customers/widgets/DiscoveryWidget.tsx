import React from 'react';
import type { StageWidget } from '@/lib/api';
import { ProgressBar, Stat } from './shared';

type DiscoveryData = Extract<StageWidget, { kind: 'DISCOVERY' }>;

export function DiscoveryWidget({ data }: { data: DiscoveryData }) {
  const tone =
    data.questionnaireCompletionPct >= 70
      ? 'green'
      : data.questionnaireCompletionPct >= 30
        ? 'yellow'
        : 'red';
  return (
    <div className="space-y-3" data-testid="widget-discovery">
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label="Questionnaire"
          value={`${data.questionnaireCompletionPct}%`}
          tone={tone}
          testid="widget-discovery-pct"
        />
        <Stat
          label="Sections"
          value={`${data.questionnaireSectionsComplete} / ${data.questionnaireSectionsTotal}`}
          tone="neutral"
          testid="widget-discovery-sections"
        />
      </div>
      <ProgressBar
        pct={data.questionnaireCompletionPct}
        tone={tone}
        testid="widget-discovery-progress"
      />
      {data.nextSectionName ? (
        <p
          className="text-xs text-gray-700"
          data-testid="widget-discovery-next"
        >
          Next up: <span className="font-semibold">{data.nextSectionName}</span>
        </p>
      ) : (
        <p className="text-xs text-emerald-700" data-testid="widget-discovery-next">
          All sections complete — ready to scope.
        </p>
      )}
    </div>
  );
}
