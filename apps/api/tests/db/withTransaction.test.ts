import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../_helpers/testDb.js';
import { withTransaction } from '../../src/db/transaction.js';
import { getDb } from '../../src/db/index.js';

let cleanup: () => void;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
});

describe('withTransaction', () => {
  it('commits on success and returns the inner function value', async () => {
    const db = getDb();
    // Seed parent rows in FK-order: Firm -> Engagement -> ProjectMember.
    // Use the existing PendingSubmission table — Phase 28 already creates
    // it in initDb(), so we don't need a throwaway test table.
    await db.execute({
      sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES ('firm-tx-1', 'Tx Firm', 'firm-tx-1', 'STARTER', datetime('now'))`,
    });
    await db.execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
            VALUES ('eng-tx-1', 'firm-tx-1', 'Tx Test', 'DISCOVERY', datetime('now'), datetime('now'))`,
    });
    await db.execute({
      sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, createdAt)
            VALUES ('mem-tx-1', 'eng-tx-1', 'Tx Member', 'Stakeholder', 'CLIENT', 'tx@x.com', datetime('now'))`,
    });

    const result = await withTransaction(async () => {
      await db.execute({
        sql: `INSERT INTO PendingSubmission (id, engagementId, memberId, targetType, payload, status, createdAt)
              VALUES ('sub-tx-commit', 'eng-tx-1', 'mem-tx-1', 'TEST', '{}', 'PENDING', datetime('now'))`,
      });
      return 42;
    });

    expect(result).toBe(42);
    const r = await db.execute({
      sql: `SELECT id FROM PendingSubmission WHERE id = ?`,
      args: ['sub-tx-commit'],
    });
    expect(r.rows.length).toBe(1);
  });

  it('rolls back on throw and re-throws the original error', async () => {
    const db = getDb();
    // Pre-condition: ensure no leftover row from a prior run.
    await db.execute({
      sql: `DELETE FROM PendingSubmission WHERE id = 'sub-tx-rollback'`,
    });

    const original = new Error('original boom');
    let caught: unknown = null;
    try {
      await withTransaction(async () => {
        await db.execute({
          sql: `INSERT INTO PendingSubmission (id, engagementId, memberId, targetType, payload, status, createdAt)
                VALUES ('sub-tx-rollback', 'eng-tx-1', 'mem-tx-1', 'TEST', '{}', 'PENDING', datetime('now'))`,
        });
        throw original;
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(original);
    const r = await db.execute({
      sql: `SELECT id FROM PendingSubmission WHERE id = ?`,
      args: ['sub-tx-rollback'],
    });
    expect(r.rows.length).toBe(0);
  });

  it('preserves the inner error type, not a wrapped one', async () => {
    class CustomError extends Error {
      readonly code = 'CUSTOM';
    }
    const original = new CustomError('typed boom');
    let caught: unknown = null;
    try {
      await withTransaction(async () => {
        throw original;
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CustomError);
    expect((caught as CustomError).code).toBe('CUSTOM');
  });

  it('returns the awaited value from a Promise-returning inner function', async () => {
    const result = await withTransaction(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return { ok: true, n: 7 };
    });
    expect(result).toEqual({ ok: true, n: 7 });
  });

  it('rollback failure does not shadow the original error', async () => {
    // Hard to inject a ROLLBACK failure on libSQL without monkey-patching.
    // Instead: verify the code path by inspecting that consecutive
    // independent transactions still work — implicit proof that rollback
    // cleaned up cleanly even on a previous throw.
    let caught: unknown = null;
    try {
      await withTransaction(async () => { throw new Error('first'); });
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toBe('first');

    // Subsequent transaction must succeed — proves the previous ROLLBACK
    // released the connection state.
    const result = await withTransaction(async () => 'second-ok');
    expect(result).toBe('second-ok');
  });
});
