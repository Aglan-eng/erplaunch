/**
 * Phase 46.8.7 — pure tests for the SALES_PERFORMANCE_REPORT generator.
 */
import { describe, it, expect } from 'vitest';
import {
  computeSalesPerformanceKpis,
  generateSalesPerformanceReportPdf,
  type SalesPerformanceReportInput,
} from '../../../src/services/generators/salesPerformanceReportGenerator.js';

function baseInput(over: Partial<SalesPerformanceReportInput> = {}): SalesPerformanceReportInput {
  return {
    firmName: 'ERPLaunch Partners',
    periodEndDate: '2026-06-30',
    periodLabel: 'Q2 2026',
    funnel: {
      stages: [
        { stage: 'PROSPECT', count: 12, totalEstimatedValue: 600_000 },
        { stage: 'PROPOSED', count: 5, totalEstimatedValue: 350_000 },
        { stage: 'CONTRACTED', count: 2, totalEstimatedValue: 180_000 },
        { stage: 'WON', count: 4, totalEstimatedValue: 420_000 },
        { stage: 'LOST', count: 3, totalEstimatedValue: 180_000 },
      ],
      totalWon: 4,
      totalLost: 3,
      winRate: 4 / 7,
    },
    leaderboard: [
      {
        salesRepUserId: 'rep-1',
        salesRepName: 'Alice Andersson',
        dealsWon: 3,
        dealsLost: 1,
        revenueClosed: 320_000,
        avgDealSize: 320_000 / 3,
        winRate: 3 / 4,
        medianSalesCycleDays: 60,
      },
      {
        salesRepUserId: 'rep-2',
        salesRepName: 'Bob Bryant',
        dealsWon: 1,
        dealsLost: 2,
        revenueClosed: 100_000,
        avgDealSize: 100_000,
        winRate: 1 / 3,
        medianSalesCycleDays: 90,
      },
    ],
    lossReasons: {
      total: 3,
      byReason: {
        PRICE: { count: 2, pct: 2 / 3, totalEstimatedValue: 100_000 },
        TIMING: { count: 1, pct: 1 / 3, totalEstimatedValue: 80_000 },
      },
      recentLosses: [
        {
          clientName: 'Acme Co',
          lossReason: 'PRICE',
          competitorName: null,
          estimatedValue: 50_000,
          lostAt: '2026-05-15',
        },
      ],
    },
    timeToClose: {
      median: 60,
      p90: 120,
      histogram: [
        { bucket: '0-30d', count: 1 },
        { bucket: '31-60d', count: 2 },
        { bucket: '61-90d', count: 1 },
        { bucket: '91-180d', count: 1 },
        { bucket: '181d+', count: 0 },
      ],
    },
    ...over,
  };
}

describe('computeSalesPerformanceKpis', () => {
  it('rounds win-rate to whole percent', () => {
    const k = computeSalesPerformanceKpis(baseInput());
    // 4/7 = 0.5714 → 57%
    expect(k.winRatePct).toBe(57);
  });

  it('sums revenueClosed across the leaderboard', () => {
    const k = computeSalesPerformanceKpis(baseInput());
    expect(k.totalRevenueClosed).toBe(320_000 + 100_000);
  });

  it('dealsClosed = totalWon + totalLost', () => {
    const k = computeSalesPerformanceKpis(baseInput());
    expect(k.dealsClosed).toBe(7);
  });

  it('returns zero KPIs cleanly when nothing closed', () => {
    const k = computeSalesPerformanceKpis(
      baseInput({
        funnel: {
          stages: [
            { stage: 'PROSPECT', count: 5, totalEstimatedValue: 0 },
            { stage: 'PROPOSED', count: 0, totalEstimatedValue: 0 },
            { stage: 'CONTRACTED', count: 0, totalEstimatedValue: 0 },
            { stage: 'WON', count: 0, totalEstimatedValue: 0 },
            { stage: 'LOST', count: 0, totalEstimatedValue: 0 },
          ],
          totalWon: 0,
          totalLost: 0,
          winRate: 0,
        },
        leaderboard: [],
      }),
    );
    expect(k.winRatePct).toBe(0);
    expect(k.totalRevenueClosed).toBe(0);
    expect(k.dealsClosed).toBe(0);
  });
});

describe('generateSalesPerformanceReportPdf', () => {
  it('renders a non-empty PDF starting with the magic bytes', async () => {
    const buf = await generateSalesPerformanceReportPdf(baseInput());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(2000);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders even when the leaderboard is empty', async () => {
    const buf = await generateSalesPerformanceReportPdf(baseInput({ leaderboard: [] }));
    expect(buf.length).toBeGreaterThan(2000);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders even when no losses are recorded', async () => {
    const buf = await generateSalesPerformanceReportPdf(
      baseInput({
        lossReasons: { total: 0, byReason: {}, recentLosses: [] },
      }),
    );
    expect(buf.length).toBeGreaterThan(2000);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders cleanly when the histogram is all zeros', async () => {
    const buf = await generateSalesPerformanceReportPdf(
      baseInput({
        timeToClose: {
          median: null,
          p90: null,
          histogram: [
            { bucket: '0-30d', count: 0 },
            { bucket: '31-60d', count: 0 },
            { bucket: '61-90d', count: 0 },
            { bucket: '91-180d', count: 0 },
            { bucket: '181d+', count: 0 },
          ],
        },
      }),
    );
    expect(buf.length).toBeGreaterThan(2000);
  });
});
