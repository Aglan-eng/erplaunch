/**
 * Phase 46.1 — Sales pipeline pure helpers.
 *
 * Maps engagement.status (the canonical enum) to the kanban column
 * the operator drags between. The PO spec lists 7 columns (New,
 * Qualified, Discovery Lite, Proposal Sent, Negotiation, Won, Lost)
 * but only 5 are distinct enum values today — PROSPECT shows up
 * three times because the kanban distinguishes pre-Discovery-Lite,
 * Discovery-Lite-in-progress, and Discovery-Lite-complete prospects
 * via the EngagementDiscoveryLite table that lands in Phase 46.2.
 *
 * This file owns the column → stage mapping. The drag-drop handler
 * uses `stageForColumn` to know which stage value to PATCH. Columns
 * sharing a stage (New / Qualified / Discovery Lite all = PROSPECT)
 * intentionally no-op the PATCH at the route layer — the visual
 * grouping is then a pure-frontend affordance until 46.2 ships.
 */

import type { SalesOutcomeStage } from '../types/roles.js';

export const PIPELINE_COLUMNS = [
  'NEW',
  'QUALIFIED',
  'DISCOVERY_LITE',
  'PROPOSAL_SENT',
  'NEGOTIATION',
  'WON',
  'LOST',
] as const;

export type PipelineColumn = (typeof PIPELINE_COLUMNS)[number];

export const PIPELINE_COLUMN_LABELS: Record<PipelineColumn, string> = {
  NEW: 'New',
  QUALIFIED: 'Qualified',
  DISCOVERY_LITE: 'Discovery Lite',
  PROPOSAL_SENT: 'Proposal Sent',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
};

/**
 * Given a column key, the stage to set on the engagement when an
 * operator drags a card into that column. Three of the columns share
 * PROSPECT — the route layer treats those drops as a no-op stage
 * change (they may still update prospectScore in a later phase). */
export type SalesStage = 'PROSPECT' | 'PROPOSED' | 'CONTRACTED' | SalesOutcomeStage;

const COLUMN_TO_STAGE: Record<PipelineColumn, SalesStage> = {
  NEW: 'PROSPECT',
  QUALIFIED: 'PROSPECT',
  DISCOVERY_LITE: 'PROSPECT',
  PROPOSAL_SENT: 'PROPOSED',
  NEGOTIATION: 'CONTRACTED',
  WON: 'WON',
  LOST: 'LOST',
};

export function stageForColumn(c: PipelineColumn): SalesStage {
  return COLUMN_TO_STAGE[c];
}

export function isPipelineColumn(s: string): s is PipelineColumn {
  return (PIPELINE_COLUMNS as readonly string[]).includes(s);
}

/**
 * The reverse mapping — given an engagement, which column to render it
 * in. PROSPECT engagements fall into NEW until Phase 46.2 wires
 * Discovery Lite presence/completion into the bucketing.
 */
export interface BucketingInput {
  status: string;
  hasDiscoveryLite?: boolean;
  discoveryLiteCompleted?: boolean;
}

export function columnForEngagement(e: BucketingInput): PipelineColumn {
  switch (e.status) {
    case 'PROSPECT':
      if (e.discoveryLiteCompleted) return 'DISCOVERY_LITE';
      if (e.hasDiscoveryLite) return 'QUALIFIED';
      return 'NEW';
    case 'PROPOSED':
      return 'PROPOSAL_SENT';
    case 'CONTRACTED':
      return 'NEGOTIATION';
    case 'WON':
      return 'WON';
    case 'LOST':
      return 'LOST';
    default:
      // Engagements that have advanced past the sales funnel
      // (DISCOVERY+) shouldn't be on the pipeline board. Caller is
      // expected to filter them out before calling this; the fallback
      // keeps a noisy edge case in NEW rather than throwing.
      return 'NEW';
  }
}

/** Stages the sales pipeline page renders. Implementation/closeout
 *  stages are filtered out at the query layer. */
export const SALES_PIPELINE_STAGES: ReadonlyArray<SalesStage> = [
  'PROSPECT',
  'PROPOSED',
  'CONTRACTED',
  'WON',
  'LOST',
];

export const LEAD_SOURCES = [
  'WEBSITE',
  'REFERRAL',
  'OUTBOUND',
  'EVENT',
  'OTHER',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export function isLeadSource(s: string): s is LeadSource {
  return (LEAD_SOURCES as readonly string[]).includes(s);
}

/**
 * Whole days an engagement has been sitting in its current stage. The
 * pipeline card surfaces this as "stale" pressure — a card that's been
 * in NEGOTIATION for 60 days deserves attention.
 */
export function daysInStage(updatedAt: string, now: Date = new Date()): number {
  const updated = new Date(updatedAt).getTime();
  if (Number.isNaN(updated)) return 0;
  const diff = now.getTime() - updated;
  return Math.max(0, Math.floor(diff / 86_400_000));
}
