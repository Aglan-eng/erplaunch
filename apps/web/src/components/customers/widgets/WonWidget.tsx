import React from 'react';
import type { StageWidget } from '@/lib/api';
import { Chip } from './shared';

type WonData = Extract<StageWidget, { kind: 'WON' }>;

export function WonWidget({ data }: { data: WonData }) {
  return (
    <div className="space-y-3" data-testid="widget-won">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            SOW
          </div>
          {data.sowGeneratedAt ? (
            <Chip tone="green" testid="widget-won-sow">
              Signed
            </Chip>
          ) : (
            <Chip tone="yellow" testid="widget-won-sow">
              Not generated
            </Chip>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            Kickoff
          </div>
          {data.kickoffScheduled ? (
            <Chip tone="green" testid="widget-won-kickoff">
              Scheduled
            </Chip>
          ) : (
            <Chip tone="yellow" testid="widget-won-kickoff">
              Not scheduled
            </Chip>
          )}
        </div>
      </div>
      <p className="text-[11px] text-gray-500">
        Tip: lock in a kickoff meeting to move into Discovery.
      </p>
    </div>
  );
}
