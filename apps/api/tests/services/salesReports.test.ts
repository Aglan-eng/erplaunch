/**
 * Phase 46.7 — pure tests for the sales-report math.
 */
import { describe, it, expect } from 'vitest';
import {
  pipelineFunnel,
  salesRepLeaderboard,
  lossReasonBreakdown,
  timeToCloseDistribution,
  type PipelineRow,
} from '../../src/services/salesReports.js';

function row(over: Partial<PipelineRow>): PipelineRow {
  return {
    status: 'PROSPECT',
    estimatedValue: null,
    createdAt: '2026-01-01T00:00:00Z',
    wonAt: null,
    lostAt: null,
    salesCycleDays: null,
    salesRepUserId: null,
    ...over,
  };
}

describe('pipelineFunnel', () => {
  it('counts deals into the 5 funnel buckets', () => {
    const rows: PipelineRow[] = [
      row({ status: 'PROSPECT' }),
      row({ status: 'PROSPECT' }),
      row({ status: 'PROPOSED' }),
      row({ status: 'CONTRACTED' }),
      row({ status: 'DISCOVERY', wonAt: '2026-04-01' }),
      row({ status: 'LOST' }),
    ];
    const f = pipelineFunnel(rows);
    expect(f.stages.find((s) => s.stage === 'PROSPECT')?.count).toBe(2);
    expect(f.stages.find((s) => s.stage === 'PROPOSED')?.count).toBe(1);
    expect(f.stages.find((s) => s.stage === 'WON')?.count).toBe(1);
    expect(f.stages.find((s) => s.stage === 'LOST')?.count).toBe(1);
  });

  it('sums estimatedValue per bucket', () => {
    const rows: PipelineRow[] = [
      row({ status: 'PROPOSED', estimatedValue: 50_000 }),
      row({ status: 'PROPOSED', estimatedValue: 30_000 }),
      row({ status: 'WON', wonAt: '2026-03-01', estimatedValue: 100_000 }),
    ];
    const f = pipelineFunnel(rows);
    expect(f.stages.find((s) => s.stage === 'PROPOSED')?.totalEstimatedValue).toBe(80_000);
    expect(f.stages.find((s) => s.stage === 'WON')?.totalEstimatedValue).toBe(100_000);
  });

  it('computes win rate over closed deals', () => {
    const rows: PipelineRow[] = [
      row({ status: 'DISCOVERY', wonAt: '2026-03-01' }),
      row({ status: 'BUILD', wonAt: '2026-03-15' }),
      row({ status: 'BUILD', wonAt: '2026-03-15' }),
      row({ status: 'LOST', lostAt: '2026-03-30' }),
    ];
    const f = pipelineFunnel(rows);
    expect(f.totalWon).toBe(3);
    expect(f.totalLost).toBe(1);
    expect(f.winRate).toBeCloseTo(0.75);
  });

  it('returns 0 winRate when no closed deals', () => {
    const f = pipelineFunnel([row({ status: 'PROSPECT' })]);
    expect(f.winRate).toBe(0);
  });

  it('places wonAt rows in the WON column even when status moved past DISCOVERY', () => {
    const rows: PipelineRow[] = [row({ status: 'BUILD', wonAt: '2026-03-01', estimatedValue: 50_000 })];
    const f = pipelineFunnel(rows);
    expect(f.stages.find((s) => s.stage === 'WON')?.count).toBe(1);
    expect(f.stages.find((s) => s.stage === 'WON')?.totalEstimatedValue).toBe(50_000);
  });
});

describe('salesRepLeaderboard', () => {
  it('aggregates won + lost deals per rep', () => {
    const rows: PipelineRow[] = [
      row({ salesRepUserId: 'rep-1', wonAt: '2026-02-01', estimatedValue: 100_000, salesCycleDays: 60 }),
      row({ salesRepUserId: 'rep-1', wonAt: '2026-03-01', estimatedValue: 50_000, salesCycleDays: 90 }),
      row({ salesRepUserId: 'rep-1', status: 'LOST', lostAt: '2026-03-15' }),
      row({ salesRepUserId: 'rep-2', wonAt: '2026-02-15', estimatedValue: 200_000, salesCycleDays: 30 }),
    ];
    const board = salesRepLeaderboard(rows);
    expect(board[0].salesRepUserId).toBe('rep-2'); // higher revenue first
    expect(board[0].dealsWon).toBe(1);
    expect(board[0].revenueClosed).toBe(200_000);
    expect(board[0].avgDealSize).toBe(200_000);
    expect(board[0].winRate).toBe(1);
    expect(board[0].medianSalesCycleDays).toBe(30);

    expect(board[1].salesRepUserId).toBe('rep-1');
    expect(board[1].dealsWon).toBe(2);
    expect(board[1].dealsLost).toBe(1);
    expect(board[1].revenueClosed).toBe(150_000);
    expect(board[1].avgDealSize).toBe(75_000);
    expect(board[1].winRate).toBeCloseTo(2 / 3);
    expect(board[1].medianSalesCycleDays).toBe(75); // (60+90)/2 floored
  });

  it('skips deals with no salesRepUserId', () => {
    const rows: PipelineRow[] = [row({ wonAt: '2026-03-01', estimatedValue: 100_000 })];
    expect(salesRepLeaderboard(rows)).toEqual([]);
  });

  it('skips reps whose deals are all open', () => {
    const rows: PipelineRow[] = [row({ salesRepUserId: 'rep-1', status: 'PROSPECT' })];
    expect(salesRepLeaderboard(rows)).toEqual([]);
  });
});

describe('lossReasonBreakdown', () => {
  it('counts + percentages by reason, plus dollar totals', () => {
    const losses = [
      { lossReason: 'PRICE', estimatedValue: 50_000 },
      { lossReason: 'PRICE', estimatedValue: 75_000 },
      { lossReason: 'TIMING', estimatedValue: 100_000 },
      { lossReason: 'NO_DECISION', estimatedValue: null },
    ];
    const b = lossReasonBreakdown(losses);
    expect(b.total).toBe(4);
    expect(b.byReason['PRICE'].count).toBe(2);
    expect(b.byReason['PRICE'].pct).toBe(0.5);
    expect(b.byReason['PRICE'].totalEstimatedValue).toBe(125_000);
    expect(b.byReason['TIMING'].count).toBe(1);
    expect(b.byReason['TIMING'].totalEstimatedValue).toBe(100_000);
    expect(b.byReason['NO_DECISION'].totalEstimatedValue).toBe(0);
  });

  it('returns total=0 + empty buckets on no losses', () => {
    expect(lossReasonBreakdown([])).toEqual({ total: 0, byReason: {} });
  });

  it('falls back to OTHER when reason is empty', () => {
    const b = lossReasonBreakdown([{ lossReason: '', estimatedValue: 1 }]);
    expect(b.byReason['OTHER'].count).toBe(1);
  });
});

describe('timeToCloseDistribution', () => {
  it('returns null medians when no won deals', () => {
    const t = timeToCloseDistribution([]);
    expect(t.median).toBeNull();
    expect(t.p90).toBeNull();
    for (const b of t.histogram) expect(b.count).toBe(0);
  });

  it('computes median + p90 across won deals', () => {
    const rows = [10, 20, 30, 60, 90, 120].map((d) => ({
      salesCycleDays: d,
      wonAt: '2026-03-01',
    }));
    const t = timeToCloseDistribution(rows);
    expect(t.median).toBe(45); // avg of 30 and 60
    // p90 of 6 sorted values [10,20,30,60,90,120], idx = floor(0.9*5) = 4 -> 90
    expect(t.p90).toBe(90);
  });

  it('buckets durations into the histogram tiers', () => {
    const rows = [5, 25, 45, 75, 100, 200].map((d) => ({
      salesCycleDays: d,
      wonAt: '2026-03-01',
    }));
    const t = timeToCloseDistribution(rows);
    const counts = Object.fromEntries(t.histogram.map((b) => [b.bucket, b.count]));
    expect(counts['0-30d']).toBe(2);
    expect(counts['31-60d']).toBe(1);
    expect(counts['61-90d']).toBe(1);
    expect(counts['91-180d']).toBe(1);
    expect(counts['181d+']).toBe(1);
  });

  it('ignores rows that aren\'t won', () => {
    const t = timeToCloseDistribution([
      { salesCycleDays: 10, wonAt: null },
      { salesCycleDays: null, wonAt: '2026-03-01' },
    ]);
    expect(t.median).toBeNull();
  });
});
