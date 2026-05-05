/**
 * DATA_FILE acceptor + payload schema (Phase 30).
 *
 * §5.1 lifecycle for client uploads:
 *   1. Client POSTs to /portal/data-files/staged → file written to
 *      UPLOADS_DIR/staged/<filename>; StagedFile DB row inserted.
 *   2. Client POSTs to /portal/submissions with targetType='DATA_FILE'
 *      and payload referencing the stagedFileId + dataCollectionItemId.
 *   3. PendingSubmission.PENDING row exists; consultant sees a
 *      DataFileCard in the Pending Review tab.
 *   4a. Consultant accepts → THIS acceptor runs:
 *       - Move file from staging to permanent UPLOADS_DIR
 *       - Create DataFile row with sourceSubmissionId
 *       - Update DataCollectionItem.status to 'RECEIVED'
 *       - Delete StagedFile row
 *   4b. Consultant rejects → routes/pendingSubmissions.ts reject handler
 *       (NOT this acceptor — §5.1 invariant) deletes the staged file
 *       + StagedFile row.
 *
 * IDEMPOTENCY: idempotent. The acceptor handles three states:
 *   (i)   StagedFile present, DataFile not yet created — perform full
 *         promotion path.
 *   (ii)  StagedFile gone, DataFile with sourceSubmissionId == this
 *         submission.id present — prior accept already succeeded;
 *         no-op return.
 *   (iii) StagedFile gone, no DataFile with that sourceSubmissionId —
 *         genuine error (manual mutation, GC raced, etc.); throw.
 *
 * FILE OPERATION ORDERING: rename runs BEFORE the DB writes inside the
 * parent withTransaction block. A failed rename throws BEFORE any DB
 * state changes — transaction rolls back to no-op. If DB writes fail
 * AFTER a successful rename, the transaction rolls back but the file
 * is now in the permanent location with no DB row referencing it
 * (orphan). Permanent-orphan recovery is out of scope; the staging GC
 * doesn't touch permanent-dir orphans. Documented tradeoff vs the
 * 2-phase commit alternative (which has its own failure modes).
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import {
  registerAcceptor,
  type PendingSubmissionAcceptor,
} from './pendingSubmissionAcceptors.js';
import { registerSubmissionPayloadSchema } from './pendingSubmissionPayloadSchemas.js';
import * as db from '../db/index.js';
import {
  findStagedFileById,
  deleteStagedFileById,
  findDataFileBySourceSubmissionId,
} from '../db/stagedFile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Mirror the constant in routes/dataCollection.ts. Inlined here rather
// than imported to avoid creating a cyclic-import dependency between
// routes and services.
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const STAGING_DIR = path.join(UPLOADS_DIR, 'staged');

// ─── Payload schema ──────────────────────────────────────────────────────────

export const DataFilePayloadSchema = z.object({
  stagedFileId: z.string().min(1).max(64),
  dataCollectionItemId: z.string().min(1).max(64),
  // Echoed metadata for audit display in the consultant card. The
  // server re-checks against the StagedFile row at accept time so a
  // tampered echo can't change actual behavior.
  originalFilename: z.string().min(1).max(500),
  sizeBytes: z.number().int().nonnegative(),
});

registerSubmissionPayloadSchema('DATA_FILE', DataFilePayloadSchema);

// ─── Acceptor ────────────────────────────────────────────────────────────────

export const dataFileAcceptor: PendingSubmissionAcceptor = {
  targetType: 'DATA_FILE',
  async accept(submission, ctx) {
    const payload = submission.payload as {
      stagedFileId?: unknown;
      dataCollectionItemId?: unknown;
    };
    if (typeof payload.stagedFileId !== 'string' || payload.stagedFileId.length === 0) {
      throw new Error('DATA_FILE acceptor: payload.stagedFileId required');
    }
    if (
      typeof payload.dataCollectionItemId !== 'string' ||
      payload.dataCollectionItemId.length === 0
    ) {
      throw new Error('DATA_FILE acceptor: payload.dataCollectionItemId required');
    }

    const staged = await findStagedFileById(payload.stagedFileId);
    if (!staged) {
      // Idempotency check (state ii): if a prior accept already promoted
      // this submission, the DataFile row still has sourceSubmissionId
      // matching this submission. Treat as no-op success.
      const promoted = await findDataFileBySourceSubmissionId(submission.id);
      if (promoted) return;
      // State (iii) — genuine error.
      throw new Error(
        `DATA_FILE acceptor: staged file ${payload.stagedFileId} not found and no prior promotion`,
      );
    }

    // Defense — ensure the staged file belongs to this engagement.
    if (staged.engagementId !== ctx.engagementId) {
      throw new Error(
        `DATA_FILE acceptor: staged file ${payload.stagedFileId} does not belong to engagement ${ctx.engagementId}`,
      );
    }

    // Perform the promotion. File ops first (rename or copy+delete), then
    // DB writes inside the parent withTransaction. A failed rename throws
    // BEFORE any DB state changes; tx rolls back to no-op.
    const newName = `${ctx.engagementId}_${payload.dataCollectionItemId}_client_${Date.now()}_${path.basename(staged.originalName)}`;
    const oldPath = path.join(STAGING_DIR, staged.filename);
    const newPath = path.join(UPLOADS_DIR, newName);

    try {
      fs.renameSync(oldPath, newPath);
    } catch {
      // Cross-device rename can fail with EXDEV; fall back to copy + delete.
      // Surface the COPY failure (more useful diagnostic than the rename
      // EXDEV which is benign).
      fs.copyFileSync(oldPath, newPath);
      try { fs.unlinkSync(oldPath); } catch { /* leave staging copy; GC sweeps */ }
    }

    // DB writes inside the parent transaction.
    await db.createDataFile({
      engagementId: ctx.engagementId,
      dataCollectionItemId: payload.dataCollectionItemId,
      filename: newName,
      originalName: staged.originalName,
      mimeType: staged.mimeType ?? 'application/octet-stream',
      sizeBytes: staged.sizeBytes,
      uploadedBy: 'Client (portal)',
      sourceSubmissionId: submission.id,
    });

    await db.updateDataCollectionItem(payload.dataCollectionItemId, {
      status: 'RECEIVED',
      receivedAt: new Date().toISOString(),
    });

    // Delete StagedFile row (file already moved). If this fails the
    // transaction rolls back and the rename has to be re-done on retry —
    // acceptable since promotion is idempotent.
    await deleteStagedFileById(staged.id);

    // Phase 38.3 — emit DATA_REQUEST_FULFILLED so the activity feed
    // reflects the lifecycle event ("client uploaded the file we asked
    // for"). Out-of-transaction is intentional: the audit log is
    // best-effort and shouldn't block the acceptor's atomic state flip.
    try {
      const item = await db.findDataCollectionItemById(payload.dataCollectionItemId);
      const itemName = item ? ((item as Record<string, unknown>).name as string | undefined) ?? 'data request' : 'data request';
      await db.logActivity(
        ctx.engagementId,
        ctx.firmId,
        'DATA_REQUEST_FULFILLED',
        `Client uploaded file for: ${itemName}`,
      );
    } catch {
      // Activity write failure shouldn't undo a successful acceptor.
    }
  },
};

registerAcceptor(dataFileAcceptor);

// ─── Public helpers used by the route layer ──────────────────────────────────

/**
 * Phase 30 — used by routes/pendingSubmissions.ts reject handler to
 * delete the staged file when a DATA_FILE submission is rejected.
 * Logged + tolerant: a missing file or a missing row is not an error
 * (e.g. orphan GC may have raced ahead).
 */
export async function deleteStagedFileForRejectedSubmission(
  stagedFileId: string,
): Promise<void> {
  const staged = await findStagedFileById(stagedFileId);
  if (!staged) return;
  try {
    fs.unlinkSync(path.join(STAGING_DIR, staged.filename));
  } catch {
    // File may already be gone (GC race / manual delete). Continue —
    // we still want to remove the DB row.
  }
  await deleteStagedFileById(staged.id);
}

export const STAGING_DIR_PATH = STAGING_DIR;
export const UPLOADS_DIR_PATH = UPLOADS_DIR;
