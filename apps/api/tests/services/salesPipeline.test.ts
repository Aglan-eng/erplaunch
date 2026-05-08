/**
 * Phase 46.1 — pure tests for the sales pipeline column mapping.
 */
import { describe, it, expect } from 'vitest';
import {
  PIPELINE_COLUMNS,
  PIPELINE_COLUMN_LABELS,
  SALES_PIPELINE_STAGES,
  columnForEngagement,
  daysInStage,
  isLeadSource,
  isPipelineColumn,
  stageForColumn,
} from '../../src/services/salesPipeline.js';

describe('PIPELINE_COLUMNS catalog', () => {
  it('lists the 7 canonical kanban columns', () => {
    expect([...PIPELINE_COLUMNS]).toEqual([
      'NEW',
      'QUALIFIED',
      'DISCOVERY_LITE',
      'PROPOSAL_SENT',
      'NEGOTIATION',
      'WON',
      'LOST',
    ]);
  });

  it('every column has a human label', () => {
    for (const c of PIPELINE_COLUMNS) {
      expect(PIPELINE_COLUMN_LABELS[c]).toBeTruthy();
    }
  });

  it('SALES_PIPELINE_STAGES are the 5 deal-status values rendered', () => {
    expect([...SALES_PIPELINE_STAGES]).toEqual([
      'PROSPECT',
      'PROPOSED',
      'CONTRACTED',
      'WON',
      'LOST',
    ]);
  });
});

describe('stageForColumn', () => {
  it('maps the three pre-Discovery columns to PROSPECT', () => {
    expect(stageForColumn('NEW')).toBe('PROSPECT');
    expect(stageForColumn('QUALIFIED')).toBe('PROSPECT');
    expect(stageForColumn('DISCOVERY_LITE')).toBe('PROSPECT');
  });
  it('PROPOSAL_SENT → PROPOSED', () => {
    expect(stageForColumn('PROPOSAL_SENT')).toBe('PROPOSED');
  });
  it('NEGOTIATION → CONTRACTED', () => {
    expect(stageForColumn('NEGOTIATION')).toBe('CONTRACTED');
  });
  it('WON → WON, LOST → LOST', () => {
    expect(stageForColumn('WON')).toBe('WON');
    expect(stageForColumn('LOST')).toBe('LOST');
  });
});

describe('columnForEngagement', () => {
  it('PROSPECT with no DiscoveryLite → NEW', () => {
    expect(columnForEngagement({ status: 'PROSPECT' })).toBe('NEW');
  });
  it('PROSPECT with DiscoveryLite started → QUALIFIED', () => {
    expect(columnForEngagement({ status: 'PROSPECT', hasDiscoveryLite: true })).toBe('QUALIFIED');
  });
  it('PROSPECT with DiscoveryLite completed → DISCOVERY_LITE', () => {
    expect(
      columnForEngagement({ status: 'PROSPECT', hasDiscoveryLite: true, discoveryLiteCompleted: true }),
    ).toBe('DISCOVERY_LITE');
  });
  it('PROPOSED → PROPOSAL_SENT', () => {
    expect(columnForEngagement({ status: 'PROPOSED' })).toBe('PROPOSAL_SENT');
  });
  it('WON / LOST land in their own column', () => {
    expect(columnForEngagement({ status: 'WON' })).toBe('WON');
    expect(columnForEngagement({ status: 'LOST' })).toBe('LOST');
  });
  it('post-funnel stages defensively bucket to NEW', () => {
    expect(columnForEngagement({ status: 'BUILD' })).toBe('NEW');
  });
});

describe('isPipelineColumn', () => {
  it('recognises canonical values', () => {
    expect(isPipelineColumn('NEW')).toBe(true);
    expect(isPipelineColumn('WON')).toBe(true);
  });
  it('rejects unknowns', () => {
    expect(isPipelineColumn('LATER')).toBe(false);
  });
});

describe('isLeadSource', () => {
  it('recognises canonical lead sources', () => {
    for (const s of ['WEBSITE', 'REFERRAL', 'OUTBOUND', 'EVENT', 'OTHER']) {
      expect(isLeadSource(s)).toBe(true);
    }
  });
  it('rejects unknowns', () => {
    expect(isLeadSource('LINKEDIN')).toBe(false);
  });
});

describe('daysInStage', () => {
  const NOW = new Date('2026-05-08T12:00:00Z');
  it('returns whole days since updatedAt', () => {
    const fiveDaysAgo = new Date(NOW.getTime() - 5 * 86_400_000).toISOString();
    expect(daysInStage(fiveDaysAgo, NOW)).toBe(5);
  });
  it('clamps at 0 for future timestamps (clock skew)', () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    expect(daysInStage(future, NOW)).toBe(0);
  });
  it('returns 0 on a malformed timestamp', () => {
    expect(daysInStage('not-an-iso', NOW)).toBe(0);
  });
});
