import React from 'react';
import type { StageWidget } from '@/lib/api';
import { Chip, Stat } from './shared';

type ScopingData = Extract<StageWidget, { kind: 'SCOPING' }>;

export function ScopingWidget({ data }: { data: ScopingData }) {
  return (
    <div className="space-y-3" data-testid="widget-scoping">
      <div className="grid grid-cols-2 gap-4 items-center">
        <Stat
          label="Open decisions"
          value={data.openDecisionsCount}
          tone={data.openDecisionsCount > 0 ? 'yellow' : 'green'}
          testid="widget-scoping-decisions"
        />
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            Scope sign-off
          </div>
          {data.pendingScopeSignoff ? (
            <Chip tone="yellow" testid="widget-scoping-signoff">
              Pending
            </Chip>
          ) : (
            <Chip tone="green" testid="widget-scoping-signoff">
              Signed
            </Chip>
          )}
        </div>
      </div>
    </div>
  );
}
