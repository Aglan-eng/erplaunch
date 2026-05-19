import React from 'react';
import { Link } from 'react-router-dom';
import type { StageWidget } from '@/lib/api';
import { Chip, ProgressBar, Stat, formatArr } from './shared';

type ProposalData = Extract<StageWidget, { kind: 'PROPOSAL' | 'NEGOTIATION' }>;

export function ProposalWidget({
  data,
  customerId,
}: {
  data: ProposalData;
  customerId: string;
}) {
  const pct = data.targetDays > 0 ? (data.daysInStage / data.targetDays) * 100 : 0;
  const overdue = data.daysInStage > data.targetDays;
  const hasProposal = data.proposalGeneratedAt != null;
  return (
    <div className="space-y-3" data-testid={`widget-${data.kind.toLowerCase()}`}>
      <div className="grid grid-cols-3 gap-4">
        <Stat
          label="Days in stage"
          value={`${data.daysInStage}d / ${data.targetDays}d`}
          tone={overdue ? 'red' : 'neutral'}
          testid="widget-proposal-days"
        />
        <Stat
          label="Deal value"
          value={formatArr(data.arr)}
          tone="brand"
          testid="widget-proposal-arr"
        />
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            Proposal
          </div>
          {hasProposal ? (
            <Chip tone="green" testid="widget-proposal-status">
              Generated
            </Chip>
          ) : (
            <Chip tone="yellow" testid="widget-proposal-status">
              Not generated
            </Chip>
          )}
        </div>
      </div>
      <ProgressBar pct={pct} tone={overdue ? 'red' : 'brand'} testid="widget-proposal-progress" />
      {!hasProposal && (
        <Link
          to={`/customers/${customerId}?tab=documents`}
          className="inline-flex items-center text-xs font-semibold text-brand-700 hover:underline"
          data-testid="widget-proposal-generate-link"
        >
          Generate Proposal PDF →
        </Link>
      )}
    </div>
  );
}
