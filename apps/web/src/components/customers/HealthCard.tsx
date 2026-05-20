/**
 * Phase 52.4 — Customer Detail "Health" card.
 *
 * Headline score with band-coloured background + four mini-bars
 * showing the per-component contribution to the total. Hover-titles
 * carry the raw counts so a user can see "3 blockers · 12 days
 * overdue" without leaving the page.
 */
import React from 'react';
import type { CustomerHealthBreakdown } from '@/lib/api';
import { cn } from '@/lib/utils';
import { HelpTip } from '@/components/guidance/HelpTip';

interface HealthCardProps {
  breakdown: CustomerHealthBreakdown;
}

const BAND_BG: Record<'red' | 'yellow' | 'green', string> = {
  red: 'bg-rose-50 border-rose-200',
  yellow: 'bg-amber-50 border-amber-200',
  green: 'bg-emerald-50 border-emerald-200',
};

const BAND_TEXT: Record<'red' | 'yellow' | 'green', string> = {
  red: 'text-rose-700',
  yellow: 'text-amber-700',
  green: 'text-emerald-700',
};

const BAND_BAR: Record<'red' | 'yellow' | 'green', string> = {
  red: 'bg-rose-400',
  yellow: 'bg-amber-400',
  green: 'bg-emerald-400',
};

interface MiniBarProps {
  label: string;
  value: number;
  max: number;
  band: 'red' | 'yellow' | 'green';
  hoverLabel: string;
  testid: string;
}

function MiniBar({ label, value, max, band, hoverLabel, testid }: MiniBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div data-testid={testid} title={hoverLabel}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          {label}
        </span>
        <span className="text-[11px] font-medium text-gray-700 tabular-nums">
          {Math.round(value)} / {max}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', BAND_BAR[band])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function HealthCard({ breakdown }: HealthCardProps) {
  const { score, band, rawCounts } = breakdown;
  return (
    <div
      className={cn('rounded-xl border p-5', BAND_BG[band])}
      data-testid="customer-health-card"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 flex items-center gap-1">
            Health score
            <HelpTip
              testid="helptip-health"
              label="What the health score means"
              body="0–100 score combining questionnaire completion, open blockers, time stuck in stage, and pending decisions. Red under 30 (act now), yellow 30–69 (watch), green 70+ (healthy)."
            />
          </p>
          <p
            className={cn('text-4xl font-bold tabular-nums mt-1', BAND_TEXT[band])}
            data-testid="customer-health-score"
          >
            {score}
            <span className="text-base font-semibold text-gray-400 ml-1">/ 100</span>
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold uppercase',
            BAND_TEXT[band],
            band === 'red' ? 'bg-rose-100' : band === 'yellow' ? 'bg-amber-100' : 'bg-emerald-100',
          )}
          data-testid="customer-health-band"
        >
          {band}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <MiniBar
          label="Questionnaire"
          value={breakdown.questionnaireCompletion}
          max={30}
          band={band}
          hoverLabel={`${Math.round(rawCounts.questionnairePct * 100)}% complete`}
          testid="health-bar-questionnaire"
        />
        <MiniBar
          label="Blockers"
          value={breakdown.blockersComponent}
          max={25}
          band={band}
          hoverLabel={`${rawCounts.blockers} open issue${rawCounts.blockers === 1 ? '' : 's'}`}
          testid="health-bar-blockers"
        />
        <MiniBar
          label="Stage progress"
          value={breakdown.overdueComponent}
          max={25}
          band={band}
          hoverLabel={`${rawCounts.daysOverdue} day${rawCounts.daysOverdue === 1 ? '' : 's'} overdue`}
          testid="health-bar-overdue"
        />
        <MiniBar
          label="Decisions"
          value={breakdown.pendingDecisionsComponent}
          max={20}
          band={band}
          hoverLabel={`${rawCounts.pendingDecisions} pending >14d`}
          testid="health-bar-decisions"
        />
      </div>
    </div>
  );
}
