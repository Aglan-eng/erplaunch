/**
 * Phase 52.3 — display metadata for the 14 (+ 2 terminal) Customer
 * lifecycle stages.
 *
 * The 6 group columns at the top of the kanban view come from these
 * `STAGE_GROUPS_ORDERED` definitions; the 14-stage horizontal scroll
 * inside the kanban uses `STAGE_DETAILS_ORDERED`.
 *
 * Colour choices are intentionally desaturated (50/100 Tailwind tones)
 * so the firm's brand accent on hover/active states still reads as
 * the primary signal.
 */
import type { CustomerStage, StageGroup } from '@/lib/api';

export interface StageDetail {
  key: CustomerStage;
  label: string;
  /** Tailwind classes for the badge background + text colour. */
  badgeClass: string;
  group: StageGroup;
}

export const STAGE_DETAILS_ORDERED: ReadonlyArray<StageDetail> = [
  { key: 'LEAD',         label: 'Lead',         group: 'pre-sales', badgeClass: 'bg-slate-100 text-slate-700' },
  { key: 'QUALIFIED',    label: 'Qualified',    group: 'pre-sales', badgeClass: 'bg-slate-100 text-slate-700' },
  { key: 'PROPOSAL',     label: 'Proposal',     group: 'pre-sales', badgeClass: 'bg-blue-50 text-blue-700' },
  { key: 'NEGOTIATION',  label: 'Negotiation',  group: 'pre-sales', badgeClass: 'bg-blue-50 text-blue-700' },
  { key: 'WON',          label: 'Won',          group: 'closing',   badgeClass: 'bg-emerald-50 text-emerald-700' },
  { key: 'DISCOVERY',    label: 'Discovery',    group: 'delivery',  badgeClass: 'bg-violet-50 text-violet-700' },
  { key: 'SCOPING',      label: 'Scoping',      group: 'delivery',  badgeClass: 'bg-violet-50 text-violet-700' },
  { key: 'BUILD',        label: 'Build',        group: 'delivery',  badgeClass: 'bg-violet-50 text-violet-700' },
  { key: 'UAT',          label: 'UAT',          group: 'delivery',  badgeClass: 'bg-violet-50 text-violet-700' },
  { key: 'GOLIVE',       label: 'Go-live',      group: 'launch',    badgeClass: 'bg-amber-50 text-amber-700' },
  { key: 'HYPERCARE',    label: 'Hypercare',    group: 'launch',    badgeClass: 'bg-amber-50 text-amber-700' },
  { key: 'LIVE_SLA',     label: 'Live SLA',     group: 'live',      badgeClass: 'bg-teal-50 text-teal-700' },
  { key: 'RENEWAL_DUE',  label: 'Renewal due',  group: 'live',      badgeClass: 'bg-teal-50 text-teal-700' },
  { key: 'RENEWED',      label: 'Renewed',      group: 'terminal',  badgeClass: 'bg-emerald-100 text-emerald-800' },
  { key: 'LOST',         label: 'Lost',         group: 'terminal',  badgeClass: 'bg-rose-50 text-rose-700' },
  { key: 'CHURNED',      label: 'Churned',      group: 'terminal',  badgeClass: 'bg-rose-50 text-rose-700' },
];

const STAGE_DETAIL_BY_KEY: Record<CustomerStage, StageDetail> = STAGE_DETAILS_ORDERED.reduce(
  (acc, detail) => {
    acc[detail.key] = detail;
    return acc;
  },
  {} as Record<CustomerStage, StageDetail>,
);

export function stageDetail(stage: CustomerStage): StageDetail {
  return STAGE_DETAIL_BY_KEY[stage];
}

export interface StageGroupHeader {
  id: StageGroup;
  label: string;
  badgeClass: string;
}

export const STAGE_GROUPS_ORDERED: ReadonlyArray<StageGroupHeader> = [
  { id: 'pre-sales', label: 'Sales',          badgeClass: 'bg-blue-100 text-blue-700' },
  { id: 'closing',   label: 'Closing',        badgeClass: 'bg-emerald-100 text-emerald-700' },
  { id: 'delivery',  label: 'Implementation', badgeClass: 'bg-violet-100 text-violet-700' },
  { id: 'launch',    label: 'Go-live',        badgeClass: 'bg-amber-100 text-amber-700' },
  { id: 'live',      label: 'Live',           badgeClass: 'bg-teal-100 text-teal-700' },
  { id: 'terminal',  label: 'Closed',         badgeClass: 'bg-slate-200 text-slate-700' },
];

export function healthDotClass(band: 'red' | 'yellow' | 'green'): string {
  switch (band) {
    case 'green':  return 'bg-emerald-500';
    case 'yellow': return 'bg-amber-500';
    case 'red':    return 'bg-rose-500';
  }
}

export function ownerInitials(name: string): string {
  const trimmed = (name || '').trim();
  if (trimmed.length === 0) return '·';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return `${parts[0]!.charAt(0)}${parts[parts.length - 1]!.charAt(0)}`.toUpperCase();
}

export function formatArr(arr: number | null): string {
  if (arr == null) return '—';
  if (arr >= 1_000_000) return `$${(arr / 1_000_000).toFixed(arr % 1_000_000 === 0 ? 0 : 1)}M`;
  if (arr >= 1_000) return `$${(arr / 1_000).toFixed(arr % 1_000 === 0 ? 0 : 1)}K`;
  return `$${arr.toFixed(0)}`;
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}
