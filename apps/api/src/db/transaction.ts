/**
 * Transaction helper (Phase 29 — sprint rule §5).
 *
 * "Accept-side-effect must run inside the same DB transaction as the
 * status flip. ActivityLog is outside the transaction."
 *
 * libSQL/SQLite does not expose a fluent `db.transaction(fn)` API like
 * better-sqlite3 — it requires manual BEGIN / COMMIT / ROLLBACK. This
 * helper wraps that pattern with rollback-on-throw + value-passthrough
 * semantics.
 *
 * SINGLE-LEVEL ONLY. Nesting BEGIN inside another transaction throws
 * `cannot start a transaction within a transaction` on SQLite. Callers
 * MUST NOT call withTransaction from within an acceptor or a sub-helper
 * that's itself running under a parent transaction. The accept-handler
 * in routes/pendingSubmissions.ts is the sole call site for now.
 *
 * Phase 30+ acceptors that need their own multi-statement atomicity must
 * either keep all writes inside the parent transaction (preferred) or
 * use savepoints (out of scope for now).
 */

import { getDb } from './index.js';

/**
 * Run `fn` inside a BEGIN/COMMIT block. Rolls back on throw and
 * re-throws the original error. Returns whatever `fn` returns.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const db = getDb();
  await db.execute('BEGIN');
  try {
    const result = await fn();
    await db.execute('COMMIT');
    return result;
  } catch (err) {
    // ROLLBACK can itself fail (rare — e.g. connection died between
    // BEGIN and the rollback). We swallow that secondary error so the
    // ORIGINAL error reaches the caller; otherwise debugging gets a
    // misleading "rollback failed" trace and the real cause is hidden.
    try {
      await db.execute('ROLLBACK');
    } catch {
      /* ignore — surfaces nothing useful and shadows the real error */
    }
    throw err;
  }
}
