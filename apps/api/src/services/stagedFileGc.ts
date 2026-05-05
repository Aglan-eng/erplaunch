/**
 * Staged-file orphan garbage collector (Phase 30).
 *
 * Sweeps StagedFile rows older than 24h (default) by deleting the
 * on-disk file and the DB row. Orphans accumulate when:
 *   - Client uploads a staged file but never submits.
 *   - Submission lifecycle hits an edge case the route handler doesn't
 *     cover (e.g. server crashed mid-accept, leaving StagedFile + tx
 *     rolled back).
 *
 * Runs hourly on a setInterval scheduled at server startup. Disabled
 * in test environments via the NODE_ENV guard. The sweep is fully
 * tolerant — FS unlink failures are logged but do not stop the loop.
 *
 * Per the sprint spec: "if Redis unavailable just log a warning". This
 * GC doesn't depend on Redis at all (it's a setInterval inside the API
 * process), so the warning case doesn't apply. Keeping a comment here
 * for posterity in case the future BullMQ-scheduled variant is wired
 * back in: that path WOULD need a Redis-down branch.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  findStagedFilesOlderThan,
  deleteStagedFileById,
} from '../db/stagedFile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGING_DIR = path.join(__dirname, '../../uploads/staged');

export interface PurgeResult {
  scanned: number;
  deletedRows: number;
  fsErrors: number;
}

/**
 * Sweep staged-file orphans older than `maxAgeHours` (default 24).
 * Returns a summary; logs are emitted via console (no fastify logger
 * dependency so this can be called from anywhere).
 */
export async function purgeOrphanStagedFiles(
  maxAgeHours = 24,
): Promise<PurgeResult> {
  const cutoffMs = Date.now() - maxAgeHours * 3600_000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const rows = await findStagedFilesOlderThan(cutoffIso);
  let fsErrors = 0;
  let deleted = 0;

  for (const row of rows) {
    const filePath = path.join(STAGING_DIR, row.filename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      fsErrors++;
      // eslint-disable-next-line no-console
      console.warn(
        `[stagedFileGc] failed to unlink ${filePath}: ${(err as Error).message}`,
      );
      // Continue regardless — the DB row delete still happens so we
      // don't accumulate a row referencing a missing file.
    }
    try {
      await deleteStagedFileById(row.id);
      deleted++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[stagedFileGc] failed to delete StagedFile row ${row.id}: ${(err as Error).message}`,
      );
    }
  }

  return { scanned: rows.length, deletedRows: deleted, fsErrors };
}

/**
 * Wire the GC into a setInterval. Caller should invoke once at server
 * startup. Returns the interval handle so callers can clearInterval()
 * during shutdown / hot-reload. No-op (returns null) when NODE_ENV is
 * 'test' so vitest doesn't accumulate background timers across files.
 */
// `setInterval` returns a Timeout-like value in Node and `number` in DOM.
// Returning `unknown` keeps the lint config from needing a globals/NodeJS
// override; callers cast/use it via `clearInterval` which accepts both.
export function scheduleStagedFileGc(intervalMs = 3600_000): ReturnType<typeof setInterval> | null {
  if (process.env.NODE_ENV === 'test') return null;
  // Run once shortly after startup so a fresh server promptly cleans up
  // any orphans left from a prior run.
  setTimeout(() => {
    purgeOrphanStagedFiles().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[stagedFileGc] initial sweep failed:', err);
    });
  }, 60_000);

  return setInterval(() => {
    purgeOrphanStagedFiles().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[stagedFileGc] sweep failed:', err);
    });
  }, intervalMs);
}
