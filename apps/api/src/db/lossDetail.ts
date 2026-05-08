/**
 * Phase 46.7 — EngagementLossDetail DB layer.
 */
import { getDb } from './index.js';

export const LOSS_REASONS = [
  'PRICE',
  'TIMING',
  'NO_DECISION',
  'LOST_TO_COMPETITOR',
  'INTERNAL_BUILD',
  'OTHER',
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export function isLossReason(s: string): s is LossReason {
  return (LOSS_REASONS as readonly string[]).includes(s);
}

export interface EngagementLossDetail {
  engagementId: string;
  lossReason: LossReason;
  competitorName: string | null;
  notes: string | null;
  recordedByUserId: string | null;
  recordedAt: string;
}

type Row = Record<string, unknown>;

function toDetail(row: Row): EngagementLossDetail {
  return {
    engagementId: row.engagementId as string,
    lossReason: row.lossReason as LossReason,
    competitorName: (row.competitorName as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    recordedByUserId: (row.recordedByUserId as string | null) ?? null,
    recordedAt: row.recordedAt as string,
  };
}

export async function findLossDetail(engagementId: string): Promise<EngagementLossDetail | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM EngagementLossDetail WHERE engagementId = ?`,
    args: [engagementId],
  });
  return r.rows[0] ? toDetail(r.rows[0] as Row) : null;
}

export async function upsertLossDetail(input: {
  engagementId: string;
  lossReason: LossReason;
  competitorName?: string | null;
  notes?: string | null;
  recordedByUserId?: string | null;
}): Promise<EngagementLossDetail> {
  const db = getDb();
  const now = new Date().toISOString();
  // Upsert pattern compatible with SQLite without ON CONFLICT.
  await db.execute({
    sql: `INSERT OR IGNORE INTO EngagementLossDetail (engagementId, lossReason, recordedAt) VALUES (?, ?, ?)`,
    args: [input.engagementId, input.lossReason, now],
  });
  const sets: string[] = ['lossReason = ?', 'recordedAt = ?'];
  const args: (string | null)[] = [input.lossReason, now];
  if (input.competitorName !== undefined) {
    sets.push('competitorName = ?');
    args.push(input.competitorName);
  }
  if (input.notes !== undefined) {
    sets.push('notes = ?');
    args.push(input.notes);
  }
  if (input.recordedByUserId !== undefined) {
    sets.push('recordedByUserId = ?');
    args.push(input.recordedByUserId);
  }
  args.push(input.engagementId);
  await db.execute({
    sql: `UPDATE EngagementLossDetail SET ${sets.join(', ')} WHERE engagementId = ?`,
    args,
  });
  const r = await db.execute({
    sql: `SELECT * FROM EngagementLossDetail WHERE engagementId = ?`,
    args: [input.engagementId],
  });
  return toDetail(r.rows[0] as Row);
}

export async function listLossDetailsByFirm(firmId: string): Promise<
  Array<EngagementLossDetail & { clientName: string; estimatedValue: number | null; lostAt: string | null }>
> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT eld.*, e.clientName AS clientName, e.estimatedValue AS estimatedValue, e.lostAt AS lostAt
          FROM EngagementLossDetail eld
          JOIN Engagement e ON e.id = eld.engagementId
          WHERE e.firmId = ?
          ORDER BY eld.recordedAt DESC`,
    args: [firmId],
  });
  return (r.rows as Row[]).map((row) => ({
    ...toDetail(row),
    clientName: row.clientName as string,
    estimatedValue: row.estimatedValue === null || row.estimatedValue === undefined
      ? null
      : Number(row.estimatedValue),
    lostAt: (row.lostAt as string | null) ?? null,
  }));
}
