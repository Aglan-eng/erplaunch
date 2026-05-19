/**
 * Phase 52.4 — chronological stage history strip.
 *
 * Renders every STAGE_TRANSITION event as a chip with hover-tooltip
 * (when + by whom + reason). Rollbacks render with a red border + ↩
 * icon per the spec.
 */
import React from 'react';
import { Undo2 } from 'lucide-react';
import type { StageHistoryEntry } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatRelativeTime, stageDetail } from './stageMetadata';

interface StageHistoryStripProps {
  history: StageHistoryEntry[];
}

export function StageHistoryStrip({ history }: StageHistoryStripProps) {
  if (history.length === 0) {
    return (
      <div
        className="text-sm text-gray-400 italic py-3"
        data-testid="customer-stage-history-empty"
      >
        No stage transitions yet.
      </div>
    );
  }
  return (
    <div
      className="overflow-x-auto pb-1"
      data-testid="customer-stage-history-strip"
    >
      <ol className="flex items-center gap-2 min-w-max">
        {history.map((entry) => {
          const toDetail = stageDetail(entry.toStage);
          const tooltip = [
            `${entry.fromStage} → ${entry.toStage}`,
            entry.isRollback ? 'Rolled back' : 'Advanced',
            `by ${entry.actorName}`,
            formatRelativeTime(entry.createdAt),
            entry.reason ? `Reason: ${entry.reason}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li
              key={entry.id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border whitespace-nowrap',
                entry.isRollback
                  ? 'bg-rose-50 text-rose-700 border-rose-300'
                  : cn(toDetail.badgeClass, 'border-transparent'),
              )}
              title={tooltip}
              data-testid={`stage-history-entry-${entry.id}`}
              data-rollback={entry.isRollback}
            >
              {entry.isRollback && <Undo2 className="h-3 w-3" />}
              <span>{toDetail.label}</span>
              <span className="text-[10px] text-gray-500 ml-1">
                {formatRelativeTime(entry.createdAt)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
