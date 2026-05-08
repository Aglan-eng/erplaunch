/**
 * Phase 46.2 — Discovery Lite DB layer.
 *
 * One row per engagement. Stored as a single JSON blob in the
 * `answers` column (matches the BusinessProfile pattern) so we can
 * evolve the question catalog without schema migrations.
 *
 * The share-token fields support the self-serve flow: a sales rep
 * generates an opaque token, the route layer mints `/discovery-lite/
 * :token` URLs the prospect's contact can fill out without auth.
 * Tokens are revocable (set to null) and expire after 14 days by
 * default. The route layer is the source of truth for TTL — the DB
 * layer just persists.
 */
import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export interface EngagementDiscoveryLite {
  engagementId: string;
  answers: Record<string, unknown>;
  completedAt: string | null;
  shareToken: string | null;
  shareTokenIssuedAt: string | null;
  shareTokenExpiresAt: string | null;
  lastEditedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;

function parseAnswers(v: unknown): Record<string, unknown> {
  if (typeof v !== 'string' || v.length === 0) return {};
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toRecord(row: Row): EngagementDiscoveryLite {
  return {
    engagementId: row.engagementId as string,
    answers: parseAnswers(row.answers),
    completedAt: (row.completedAt as string | null) ?? null,
    shareToken: (row.shareToken as string | null) ?? null,
    shareTokenIssuedAt: (row.shareTokenIssuedAt as string | null) ?? null,
    shareTokenExpiresAt: (row.shareTokenExpiresAt as string | null) ?? null,
    lastEditedBy: (row.lastEditedBy as string | null) ?? null,
    createdAt: (row.createdAt as string) ?? new Date().toISOString(),
    updatedAt: (row.updatedAt as string) ?? new Date().toISOString(),
  };
}

export async function findDiscoveryLite(
  engagementId: string,
): Promise<EngagementDiscoveryLite | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM EngagementDiscoveryLite WHERE engagementId = ?`,
    args: [engagementId],
  });
  return r.rows[0] ? toRecord(r.rows[0] as Row) : null;
}

export async function findDiscoveryLiteByShareToken(
  shareToken: string,
): Promise<EngagementDiscoveryLite | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM EngagementDiscoveryLite WHERE shareToken = ? LIMIT 1`,
    args: [shareToken],
  });
  return r.rows[0] ? toRecord(r.rows[0] as Row) : null;
}

/**
 * Upsert pattern — INSERT OR IGNORE to seed the row, then UPDATE the
 * fields the caller passed. Undefined fields are left untouched, so
 * partial saves don't clobber the share token (or vice versa).
 */
export async function upsertDiscoveryLite(args: {
  engagementId: string;
  answers?: Record<string, unknown>;
  completedAt?: string | null;
  shareToken?: string | null;
  shareTokenIssuedAt?: string | null;
  shareTokenExpiresAt?: string | null;
  lastEditedBy?: string | null;
}): Promise<EngagementDiscoveryLite> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT OR IGNORE INTO EngagementDiscoveryLite (engagementId, updatedAt, createdAt) VALUES (?, ?, ?)`,
    args: [args.engagementId, now, now],
  });

  const sets: string[] = ['updatedAt = ?'];
  const sqlArgs: (string | null)[] = [now];
  if (args.answers !== undefined) {
    sets.push('answers = ?');
    sqlArgs.push(JSON.stringify(args.answers));
  }
  if (args.completedAt !== undefined) {
    sets.push('completedAt = ?');
    sqlArgs.push(args.completedAt);
  }
  if (args.shareToken !== undefined) {
    sets.push('shareToken = ?');
    sqlArgs.push(args.shareToken);
  }
  if (args.shareTokenIssuedAt !== undefined) {
    sets.push('shareTokenIssuedAt = ?');
    sqlArgs.push(args.shareTokenIssuedAt);
  }
  if (args.shareTokenExpiresAt !== undefined) {
    sets.push('shareTokenExpiresAt = ?');
    sqlArgs.push(args.shareTokenExpiresAt);
  }
  if (args.lastEditedBy !== undefined) {
    sets.push('lastEditedBy = ?');
    sqlArgs.push(args.lastEditedBy);
  }
  sqlArgs.push(args.engagementId);
  await db.execute({
    sql: `UPDATE EngagementDiscoveryLite SET ${sets.join(', ')} WHERE engagementId = ?`,
    args: sqlArgs,
  });

  const r = await db.execute({
    sql: `SELECT * FROM EngagementDiscoveryLite WHERE engagementId = ?`,
    args: [args.engagementId],
  });
  return toRecord(r.rows[0] as Row);
}

/**
 * Generate a fresh share token. Uses createId for url-safety; the
 * token is opaque to the recipient.
 */
export function newShareToken(): string {
  return createId();
}

/**
 * Bulk fetch — used by the sales pipeline list to derive each
 * engagement's column without N round-trips. Returns a map keyed by
 * engagementId; engagements without a row simply aren't in the map.
 */
export async function listDiscoveryLiteByEngagementIds(
  ids: ReadonlyArray<string>,
): Promise<Map<string, { hasAnswers: boolean; completed: boolean }>> {
  const out = new Map<string, { hasAnswers: boolean; completed: boolean }>();
  if (ids.length === 0) return out;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const r = await db.execute({
    sql: `SELECT engagementId, answers, completedAt FROM EngagementDiscoveryLite WHERE engagementId IN (${placeholders})`,
    args: [...ids],
  });
  for (const row of r.rows) {
    const r2 = row as unknown as { engagementId: string; answers: string | null; completedAt: string | null };
    const answers = parseAnswers(r2.answers);
    out.set(r2.engagementId, {
      hasAnswers: Object.keys(answers).length > 0,
      completed: !!r2.completedAt,
    });
  }
  return out;
}
