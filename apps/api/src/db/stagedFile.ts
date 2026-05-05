/**
 * StagedFile — DB layer (Phase 30).
 *
 * Holds file metadata for client portal uploads that are awaiting
 * consultant accept/reject via PendingSubmission.targetType=DATA_FILE.
 * On accept, the dataFileAcceptor moves the file to permanent storage,
 * creates a DataFile row, and deletes the StagedFile row. On reject,
 * the pendingSubmissions route handler deletes both the on-disk file
 * and the StagedFile row.
 *
 * Lifecycle: ~minutes (typical) to 24h (orphan GC threshold).
 *
 * The on-disk file lives at UPLOADS_DIR/staged/<filename>. The
 * `storagePath` field is informational — the staging directory is the
 * source of truth so callers don't need to read the column to find
 * the file.
 */

import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export interface StagedFile {
  id: string;
  engagementId: string;
  memberId: string;
  dataCollectionItemId: string | null;
  filename: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
}

type Row = Record<string, unknown>;

function toStagedFile(row: Row): StagedFile {
  return {
    id: row.id as string,
    engagementId: row.engagementId as string,
    memberId: row.memberId as string,
    dataCollectionItemId: (row.dataCollectionItemId as string | null) ?? null,
    filename: row.filename as string,
    originalName: row.originalName as string,
    mimeType: (row.mimeType as string | null) ?? null,
    sizeBytes: Number(row.sizeBytes ?? 0),
    storagePath: row.storagePath as string,
    createdAt: row.createdAt as string,
  };
}

export async function createStagedFile(input: {
  engagementId: string;
  memberId: string;
  dataCollectionItemId?: string | null;
  filename: string;
  originalName: string;
  mimeType?: string | null;
  sizeBytes: number;
  storagePath: string;
}): Promise<StagedFile> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO StagedFile
            (id, engagementId, memberId, dataCollectionItemId, filename,
             originalName, mimeType, sizeBytes, storagePath, createdAt)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.engagementId,
      input.memberId,
      input.dataCollectionItemId ?? null,
      input.filename,
      input.originalName,
      input.mimeType ?? null,
      input.sizeBytes,
      input.storagePath,
      now,
    ],
  });
  const r = await db.execute({ sql: `SELECT * FROM StagedFile WHERE id = ?`, args: [id] });
  return toStagedFile(r.rows[0] as Row);
}

export async function findStagedFileById(id: string): Promise<StagedFile | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM StagedFile WHERE id = ?`, args: [id] });
  return r.rows[0] ? toStagedFile(r.rows[0] as Row) : null;
}

export async function deleteStagedFileById(id: string): Promise<boolean> {
  const db = getDb();
  const r = await db.execute({ sql: `DELETE FROM StagedFile WHERE id = ?`, args: [id] });
  const affected = Number((r as { rowsAffected?: number | bigint }).rowsAffected ?? 0);
  return affected > 0;
}

/**
 * Returns staged files older than `cutoffIsoString`. Used by the orphan
 * GC sweep — anything in this list whose corresponding submission was
 * never created (or was rejected) is leaking disk + DB rows and should
 * be cleaned up.
 */
export async function findStagedFilesOlderThan(cutoffIsoString: string): Promise<StagedFile[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM StagedFile WHERE createdAt < ? ORDER BY createdAt ASC`,
    args: [cutoffIsoString],
  });
  return (r.rows as Row[]).map(toStagedFile);
}

/**
 * Phase 30 — find a DataFile that was promoted from a particular
 * submission. Used by the dataFileAcceptor's idempotency guard to
 * detect a successful prior promotion when the StagedFile row is
 * already gone.
 */
export async function findDataFileBySourceSubmissionId(
  submissionId: string,
): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM DataFile WHERE sourceSubmissionId = ?`,
    args: [submissionId],
  });
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}
