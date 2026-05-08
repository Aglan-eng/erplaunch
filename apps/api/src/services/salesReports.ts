/**
 * Phase 46.7 — Sales report pure helpers.
 *
 * Each function takes the raw rows the route layer pulls from the DB
 * and returns a structured report payload. Pure — no SQL — so the
 * math can be exhaustively unit tested without seeding fixtures.
 */

export interface PipelineRow {
  status: string;
  estimatedValue: number | null;
  createdAt: string;
  wonAt: string | null;
  lostAt: string | null;
  salesCycleDays: number | null;
  salesRepUserId: string | null;
}

// ─── Pipeline funnel ────────────────────────────────────────────────────────

const FUNNEL_STAGES: ReadonlyArray<string> = [
  'PROSPECT',
  'PROPOSED',
  'CONTRACTED',
  'WON',
  'LOST',
];

export interface PipelineFunnelStage {
  stage: string;
  count: number;
  totalEstimatedValue: number;
}

export interface PipelineFunnel {
  stages: ReadonlyArray<PipelineFunnelStage>;
  /** Number of deals that ever passed through "won" (wonAt set) — */
  totalWon: number;
  totalLost: number;
  /** Win rate over closed deals (won / (won + lost)). 0 when neither. */
  winRate: number;
}

export function pipelineFunnel(rows: ReadonlyArray<PipelineRow>): PipelineFunnel {
  const buckets = new Map<string, { count: number; total: number }>();
  for (const s of FUNNEL_STAGES) buckets.set(s, { count: 0, total: 0 });

  let won = 0;
  let lost = 0;
  for (const r of rows) {
    if (r.wonAt) {
      won++;
      // wonAt counts under WON for funnel display; engagement may
      // currently be at DISCOVERY/BUILD/etc but the funnel cares
      // about closed-won.
      const wonBucket = buckets.get('WON')!;
      wonBucket.count++;
      wonBucket.total += r.estimatedValue ?? 0;
      continue;
    }
    if (r.lostAt || r.status === 'LOST') {
      lost++;
      const lostBucket = buckets.get('LOST')!;
      lostBucket.count++;
      lostBucket.total += r.estimatedValue ?? 0;
      continue;
    }
    if (FUNNEL_STAGES.includes(r.status)) {
      const b = buckets.get(r.status)!;
      b.count++;
      b.total += r.estimatedValue ?? 0;
    }
  }
  const total = won + lost;
  const winRate = total === 0 ? 0 : won / total;
  return {
    stages: FUNNEL_STAGES.map((s) => ({
      stage: s,
      count: buckets.get(s)!.count,
      totalEstimatedValue: buckets.get(s)!.total,
    })),
    totalWon: won,
    totalLost: lost,
    winRate,
  };
}

// ─── Sales rep leaderboard ──────────────────────────────────────────────────

export interface LeaderboardEntry {
  salesRepUserId: string;
  dealsWon: number;
  dealsLost: number;
  revenueClosed: number;
  avgDealSize: number;
  /** Win rate over closed deals (won / (won + lost)). */
  winRate: number;
  /** Median sales cycle in whole days, or null when no won deals. */
  medianSalesCycleDays: number | null;
}

export function salesRepLeaderboard(rows: ReadonlyArray<PipelineRow>): LeaderboardEntry[] {
  const byRep = new Map<string, { won: PipelineRow[]; lost: PipelineRow[] }>();
  for (const r of rows) {
    if (!r.salesRepUserId) continue;
    if (!r.wonAt && !r.lostAt && r.status !== 'LOST') continue;
    let entry = byRep.get(r.salesRepUserId);
    if (!entry) {
      entry = { won: [], lost: [] };
      byRep.set(r.salesRepUserId, entry);
    }
    if (r.wonAt) entry.won.push(r);
    else entry.lost.push(r);
  }
  const out: LeaderboardEntry[] = [];
  for (const [userId, e] of byRep.entries()) {
    const dealsWon = e.won.length;
    const dealsLost = e.lost.length;
    const revenueClosed = e.won.reduce((sum, r) => sum + (r.estimatedValue ?? 0), 0);
    const avgDealSize = dealsWon === 0 ? 0 : revenueClosed / dealsWon;
    const winRate = dealsWon + dealsLost === 0 ? 0 : dealsWon / (dealsWon + dealsLost);
    const cycles = e.won
      .map((r) => r.salesCycleDays)
      .filter((v): v is number => typeof v === 'number');
    const medianSalesCycleDays = cycles.length === 0 ? null : median(cycles);
    out.push({
      salesRepUserId: userId,
      dealsWon,
      dealsLost,
      revenueClosed,
      avgDealSize,
      winRate,
      medianSalesCycleDays,
    });
  }
  // Stable sort: revenue closed desc, then dealsWon desc, then userId asc.
  out.sort((a, b) => {
    if (a.revenueClosed !== b.revenueClosed) return b.revenueClosed - a.revenueClosed;
    if (a.dealsWon !== b.dealsWon) return b.dealsWon - a.dealsWon;
    return a.salesRepUserId.localeCompare(b.salesRepUserId);
  });
  return out;
}

// ─── Loss reason breakdown ──────────────────────────────────────────────────

export interface LossReasonBreakdown {
  total: number;
  byReason: Record<string, { count: number; pct: number; totalEstimatedValue: number }>;
}

export function lossReasonBreakdown(
  losses: ReadonlyArray<{ lossReason: string; estimatedValue: number | null }>,
): LossReasonBreakdown {
  const byReason: Record<string, { count: number; pct: number; totalEstimatedValue: number }> = {};
  for (const l of losses) {
    const key = l.lossReason || 'OTHER';
    const bucket = byReason[key] ?? { count: 0, pct: 0, totalEstimatedValue: 0 };
    bucket.count++;
    bucket.totalEstimatedValue += l.estimatedValue ?? 0;
    byReason[key] = bucket;
  }
  const total = losses.length;
  for (const k of Object.keys(byReason)) {
    byReason[k].pct = total === 0 ? 0 : byReason[k].count / total;
  }
  return { total, byReason };
}

// ─── Time to close distribution ─────────────────────────────────────────────

export interface TimeToCloseDistribution {
  /** Whole days. */
  median: number | null;
  /** 90th percentile in whole days. */
  p90: number | null;
  /** Histogram buckets — count of deals in each duration tier. */
  histogram: ReadonlyArray<{ bucket: string; count: number }>;
}

const HIST_BUCKETS: ReadonlyArray<{ key: string; max: number }> = [
  { key: '0-30d', max: 30 },
  { key: '31-60d', max: 60 },
  { key: '61-90d', max: 90 },
  { key: '91-180d', max: 180 },
  { key: '181d+', max: Infinity },
];

export function timeToCloseDistribution(
  rows: ReadonlyArray<{ salesCycleDays: number | null; wonAt: string | null }>,
): TimeToCloseDistribution {
  const closed = rows
    .filter((r) => r.wonAt && typeof r.salesCycleDays === 'number')
    .map((r) => r.salesCycleDays as number);
  if (closed.length === 0) {
    return {
      median: null,
      p90: null,
      histogram: HIST_BUCKETS.map((b) => ({ bucket: b.key, count: 0 })),
    };
  }
  const median0 = median(closed);
  const p90 = percentile(closed, 0.9);

  const counts = new Map<string, number>(HIST_BUCKETS.map((b) => [b.key, 0]));
  for (const d of closed) {
    for (const b of HIST_BUCKETS) {
      if (d <= b.max) {
        counts.set(b.key, (counts.get(b.key) ?? 0) + 1);
        break;
      }
    }
  }
  return {
    median: median0,
    p90,
    histogram: HIST_BUCKETS.map((b) => ({ bucket: b.key, count: counts.get(b.key) ?? 0 })),
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function median(nums: ReadonlyArray<number>): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
  return sorted[mid];
}

function percentile(nums: ReadonlyArray<number>, p: number): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[idx];
}
