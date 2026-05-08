/**
 * Phase 45.8 — Renewal state DB layer. Single-row-per-engagement
 * upsert; the route layer reads and writes through this module so the
 * pure helpers (services/renewalTracker) stay free of SQL.
 */
import { getDb } from './index.js';
import type {
  RenewalStatus,
  ExpansionOpportunity,
} from '../services/renewalTracker.js';

export interface EngagementRenewalState {
  engagementId: string;
  contractStartAt: string | null;
  contractEndAt: string | null;
  renewalStatus: RenewalStatus;
  expansionOpportunities: ExpansionOpportunity[];
  notes: string | null;
  updatedAt: string;
}

type Row = Record<string, unknown>;

function parseExpansion(v: unknown): ExpansionOpportunity[] {
  if (typeof v !== 'string' || v.length === 0) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? (parsed as ExpansionOpportunity[]) : [];
  } catch {
    return [];
  }
}

function toState(row: Row): EngagementRenewalState {
  return {
    engagementId: row.engagementId as string,
    contractStartAt: (row.contractStartAt as string | null) ?? null,
    contractEndAt: (row.contractEndAt as string | null) ?? null,
    renewalStatus: ((row.renewalStatus as string | null) ?? 'NOT_STARTED') as RenewalStatus,
    expansionOpportunities: parseExpansion(row.expansionOpportunities),
    notes: (row.notes as string | null) ?? null,
    updatedAt: (row.updatedAt as string | null) ?? new Date().toISOString(),
  };
}

/** Returns null when no renewal row exists. The route layer maps this
 *  to a default-shaped response so the UI always has something to render. */
export async function findRenewalState(
  engagementId: string,
): Promise<EngagementRenewalState | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM EngagementRenewalState WHERE engagementId = ?`,
    args: [engagementId],
  });
  return r.rows[0] ? toState(r.rows[0] as Row) : null;
}

export interface UpsertRenewalStateArgs {
  engagementId: string;
  contractStartAt?: string | null;
  contractEndAt?: string | null;
  renewalStatus?: RenewalStatus;
  expansionOpportunities?: ExpansionOpportunity[];
  notes?: string | null;
}

/**
 * Upsert pattern — INSERT OR IGNORE then UPDATE so the SQL is portable
 * across libSQL versions. Only fields the caller explicitly passes are
 * touched; undefined leaves the column alone.
 */
export async function upsertRenewalState(
  args: UpsertRenewalStateArgs,
): Promise<EngagementRenewalState> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT OR IGNORE INTO EngagementRenewalState (engagementId, updatedAt) VALUES (?, ?)`,
    args: [args.engagementId, now],
  });

  const sets: string[] = ['updatedAt = ?'];
  const sqlArgs: (string | null)[] = [now];
  if (args.contractStartAt !== undefined) {
    sets.push('contractStartAt = ?');
    sqlArgs.push(args.contractStartAt);
  }
  if (args.contractEndAt !== undefined) {
    sets.push('contractEndAt = ?');
    sqlArgs.push(args.contractEndAt);
  }
  if (args.renewalStatus !== undefined) {
    sets.push('renewalStatus = ?');
    sqlArgs.push(args.renewalStatus);
  }
  if (args.expansionOpportunities !== undefined) {
    sets.push('expansionOpportunities = ?');
    sqlArgs.push(JSON.stringify(args.expansionOpportunities));
  }
  if (args.notes !== undefined) {
    sets.push('notes = ?');
    sqlArgs.push(args.notes);
  }
  sqlArgs.push(args.engagementId);
  await db.execute({
    sql: `UPDATE EngagementRenewalState SET ${sets.join(', ')} WHERE engagementId = ?`,
    args: sqlArgs,
  });

  const r = await db.execute({
    sql: `SELECT * FROM EngagementRenewalState WHERE engagementId = ?`,
    args: [args.engagementId],
  });
  return toState(r.rows[0] as Row);
}
