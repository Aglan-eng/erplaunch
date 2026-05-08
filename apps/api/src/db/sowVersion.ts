/**
 * Phase 46.4 — SOW version DB layer.
 *
 * Each regeneration creates a new EngagementSowVersion row pointing
 * at the GenerationJob that produced it. The version number
 * monotonically increases per engagement; old versions stay around
 * so the audit trail can reproduce what was sent for signature on
 * any given date.
 */
import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export interface EngagementSowVersion {
  id: string;
  engagementId: string;
  jobId: string;
  version: number;
  supersedesVersion: number | null;
  signedFileUrl: string | null;
  generatedAt: string;
}

type Row = Record<string, unknown>;

function toVersion(row: Row): EngagementSowVersion {
  return {
    id: row.id as string,
    engagementId: row.engagementId as string,
    jobId: row.jobId as string,
    version: Number(row.version),
    supersedesVersion: row.supersedesVersion === null || row.supersedesVersion === undefined
      ? null
      : Number(row.supersedesVersion),
    signedFileUrl: (row.signedFileUrl as string | null) ?? null,
    generatedAt: row.generatedAt as string,
  };
}

/**
 * Reserve the next version number for an engagement. The next call
 * gets N+1, even if the previous one's row hasn't been inserted yet
 * (we read the max + 1 inside the same transaction the route layer
 * controls, but for the test-friendly path we just pick the max).
 */
export async function nextSowVersion(engagementId: string): Promise<number> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT COALESCE(MAX(version), 0) AS maxv FROM EngagementSowVersion WHERE engagementId = ?`,
    args: [engagementId],
  });
  const maxv = Number((r.rows[0] as { maxv?: unknown })?.maxv ?? 0);
  return maxv + 1;
}

export async function recordSowVersion(input: {
  engagementId: string;
  jobId: string;
  version: number;
  supersedesVersion?: number | null;
}): Promise<EngagementSowVersion> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO EngagementSowVersion (id, engagementId, jobId, version, supersedesVersion, generatedAt)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, input.engagementId, input.jobId, input.version, input.supersedesVersion ?? null, now],
  });
  const r = await db.execute({
    sql: `SELECT * FROM EngagementSowVersion WHERE id = ?`,
    args: [id],
  });
  return toVersion(r.rows[0] as Row);
}

export async function listSowVersionsByEngagement(
  engagementId: string,
): Promise<EngagementSowVersion[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM EngagementSowVersion WHERE engagementId = ? ORDER BY version DESC`,
    args: [engagementId],
  });
  return (r.rows as Row[]).map(toVersion);
}

export async function findLatestSowVersion(
  engagementId: string,
): Promise<EngagementSowVersion | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM EngagementSowVersion WHERE engagementId = ? ORDER BY version DESC LIMIT 1`,
    args: [engagementId],
  });
  return r.rows[0] ? toVersion(r.rows[0] as Row) : null;
}

/** Phase 46.5 will call this once a signed PDF lands. */
export async function setSowSignedFileUrl(
  versionId: string,
  signedFileUrl: string | null,
): Promise<EngagementSowVersion | null> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE EngagementSowVersion SET signedFileUrl = ? WHERE id = ?`,
    args: [signedFileUrl, versionId],
  });
  const r = await db.execute({
    sql: `SELECT * FROM EngagementSowVersion WHERE id = ?`,
    args: [versionId],
  });
  return r.rows[0] ? toVersion(r.rows[0] as Row) : null;
}
