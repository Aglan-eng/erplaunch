/**
 * Phase 52.7 — shared visual primitives for stage widgets.
 */
import React from 'react';
import { cn } from '@/lib/utils';

export function Stat({
  label,
  value,
  tone = 'neutral',
  testid,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'neutral' | 'brand' | 'green' | 'yellow' | 'red';
  testid?: string;
}) {
  const toneClass = {
    neutral: 'text-gray-900',
    brand: 'text-brand-700',
    green: 'text-emerald-700',
    yellow: 'text-amber-700',
    red: 'text-rose-700',
  }[tone];
  return (
    <div data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
        {label}
      </div>
      <div className={cn('text-xl font-bold tabular-nums mt-0.5', toneClass)}>{value}</div>
    </div>
  );
}

export function ProgressBar({
  pct,
  tone = 'brand',
  testid,
}: {
  pct: number;
  tone?: 'brand' | 'green' | 'yellow' | 'red';
  testid?: string;
}) {
  const safe = Math.max(0, Math.min(100, pct));
  const bg = {
    brand: 'bg-brand-500',
    green: 'bg-emerald-500',
    yellow: 'bg-amber-500',
    red: 'bg-rose-500',
  }[tone];
  return (
    <div
      className="h-2 w-full rounded-full bg-gray-100 overflow-hidden"
      data-testid={testid}
      role="progressbar"
      aria-valuenow={Math.round(safe)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn('h-full', bg)} style={{ width: `${safe}%` }} />
    </div>
  );
}

export function Chip({
  children,
  tone = 'neutral',
  testid,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'brand' | 'green' | 'yellow' | 'red';
  testid?: string;
}) {
  const cls = {
    neutral: 'bg-gray-100 text-gray-700',
    brand: 'bg-brand-50 text-brand-700',
    green: 'bg-emerald-50 text-emerald-700',
    yellow: 'bg-amber-50 text-amber-800',
    red: 'bg-rose-50 text-rose-700',
  }[tone];
  return (
    <span
      data-testid={testid}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        cls,
      )}
    >
      {children}
    </span>
  );
}

export function formatArr(value: number | null): string {
  if (value == null) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}
