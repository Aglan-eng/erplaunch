/**
 * Phase 52.6 — shared helpers for the five Reports dashboards.
 *
 * Chart colour palette lifted from the Xelerate brand vars set in
 * Phase 49 (--brand-primary / --brand-accent) with neutral support
 * tones. Used everywhere the recharts components need a discrete
 * series colour.
 */
import React from 'react';
import { cn } from '@/lib/utils';

export const CHART_COLORS = {
  primary: '#0EA5E9', // brand-sky 500 — primary fills
  accent: '#10B981', // brand-emerald 500 — success accent
  warning: '#F59E0B', // amber 500 — slipping / warning band
  danger: '#EF4444', // rose 500 — critical / red band
  neutral: '#94A3B8', // slate 400 — empty / inactive series
  green: '#10B981',
  yellow: '#F59E0B',
  red: '#EF4444',
};

export const SEVERITY_TEXT: Record<'red' | 'yellow' | 'green', string> = {
  red: 'text-rose-700',
  yellow: 'text-amber-700',
  green: 'text-emerald-700',
};

export const SEVERITY_BG: Record<'red' | 'yellow' | 'green', string> = {
  red: 'bg-rose-50',
  yellow: 'bg-amber-50',
  green: 'bg-emerald-50',
};

interface SectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  testid?: string;
  className?: string;
}

export function ReportSection({ title, subtitle, children, testid, className }: SectionProps) {
  return (
    <section
      className={cn('bg-white border border-gray-200 rounded-xl p-5', className)}
      data-testid={testid}
    >
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

interface CalloutProps {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'red' | 'yellow' | 'green' | 'brand';
  testid?: string;
}

export function Callout({ label, value, tone = 'neutral', testid }: CalloutProps) {
  const toneClasses =
    tone === 'red'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : tone === 'yellow'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : tone === 'green'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : tone === 'brand'
            ? 'bg-brand-50 text-brand-700 border-brand-200'
            : 'bg-gray-50 text-gray-700 border-gray-200';
  return (
    <div
      className={cn('rounded-lg border px-4 py-3', toneClasses)}
      data-testid={testid}
    >
      <p className="text-[10px] uppercase tracking-wider font-semibold opacity-70">{label}</p>
      <p className="text-2xl font-bold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

export function EmptyState({ message, testid }: { message: string; testid?: string }) {
  return (
    <div
      className="text-sm text-gray-500 italic py-8 text-center"
      data-testid={testid}
    >
      {message}
    </div>
  );
}

export function formatArr(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  return `$${value.toFixed(0)}`;
}

export function stageLabel(stage: string): string {
  return stage.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()).replace('Sla', 'SLA').replace('Uat', 'UAT');
}
