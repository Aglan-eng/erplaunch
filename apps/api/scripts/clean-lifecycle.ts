/**
 * Phase 52.9.1 — Lifecycle demo cleanup.
 *
 * Removes every `[DEMO]`-prefixed customer (and its dependent rows)
 * from a specific firm. Pairs with `seed-lifecycle.ts` so a firm
 * can be reset to a known good state without dragging the schema
 * around.
 *
 * Safety: this is destructive, so a firmId is REQUIRED. There is
 * NO default-to-first-firm behaviour (unlike the seed which is
 * additive and safe to default).
 *
 * Cascade strategy: Phase 52.1 preserved `Customer.id = Engagement.id`
 * for backfilled rows, so dependent rows keyed on `engagementId`
 * (IssueItem, DecisionItem, BusinessProfile, ActivityLog, …) match
 * via the same id. We delete from each child table explicitly here
 * rather than reusing `deleteEngagementCascade` because demo
 * customers may include native-create rows that have no Engagement
 * shadow once Phase 52.6 cutover landed.
 *
 * Run as:
 *   - CLI:      `SEED_FIRM_ID=<id> pnpm -F @ofoq/api clean:lifecycle`
 *   - Endpoint: `POST /api/v1/admin/clean-lifecycle` body { firmId }
 */
import { initDb, getDb } from '../src/db/index.js';

export interface CleanLifecycleResult {
  firmId: string;
  deleted: number;
  customerIds: string[];
}

/** Tables whose rows are keyed on customer/engagement id and need
 *  explicit cleanup. Listed in FK-safe delete order (children → parent). */
const CHILD_TABLES: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'ActivityLog', column: 'customerId' },
  { table: 'ActivityLog', column: 'engagementId' },
  { table: 'IssueItem', column: 'engagementId' },
  { table: 'DecisionItem', column: 'engagementId' },
  { table: 'BusinessProfile', column: 'engagementId' },
  { table: 'InboxDismissal', column: 'customerId' },
];

async function tableExists(name: string): Promise<boolean> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const db = getDb();
  try {
    const r = await db.execute({ sql: `PRAGMA table_info(${table})` });
    return r.rows.some(
      (row) => String((row as unknown as { name?: unknown }).name ?? '') === column,
    );
  } catch {
    return false;
  }
}

/**
 * Delete every Customer row in `firmId` whose name starts with `[DEMO]`
 * plus all dependent rows. Idempotent — running twice when there's no
 * demo data returns `{ deleted: 0 }`.
 */
export async function cleanLifecycleDemoCustomers(
  firmId: string,
): Promise<CleanLifecycleResult> {
  if (!firmId) {
    throw new Error('cleanLifecycleDemoCustomers: firmId is required');
  }
  const db = getDb();

  // 1. Collect the demo customer ids we'll be deleting.
  const targets = await db.execute({
    sql: `SELECT id FROM Customer WHERE firmId = ? AND name LIKE '[DEMO]%'`,
    args: [firmId],
  });
  const customerIds = targets.rows.map((row) =>
    String((row as unknown as { id: unknown }).id),
  );
  if (customerIds.length === 0) {
    return { firmId, deleted: 0, customerIds: [] };
  }

  // 2. Wipe child rows keyed on customerId/engagementId for each demo.
  for (const { table, column } of CHILD_TABLES) {
    if (!(await tableExists(table))) continue;
    if (!(await columnExists(table, column))) continue;
    const placeholders = customerIds.map(() => '?').join(',');
    await db.execute({
      sql: `DELETE FROM ${table} WHERE ${column} IN (${placeholders})`,
      args: customerIds,
    });
  }

  // 3. Delete the Customer rows themselves.
  const placeholders = customerIds.map(() => '?').join(',');
  await db.execute({
    sql: `DELETE FROM Customer WHERE id IN (${placeholders})`,
    args: customerIds,
  });

  // 4. Drop the backing Engagement shadow rows so the legacy
  //    surface can't resurrect a half-deleted ghost. Demo seeds
  //    always created an Engagement with the same id; non-demo
  //    customers in the firm are unaffected because their ids
  //    don't appear in `customerIds`.
  await db.execute({
    sql: `DELETE FROM Engagement WHERE id IN (${placeholders})`,
    args: customerIds,
  });

  return { firmId, deleted: customerIds.length, customerIds };
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function runCli(): Promise<void> {
  const firmId = process.env.SEED_FIRM_ID;
  if (!firmId) {
    // eslint-disable-next-line no-console
    console.error(
      '[clean:lifecycle] ERROR: SEED_FIRM_ID env var is required. ' +
        'Refusing to run a destructive delete without an explicit target.',
    );
    process.exit(1);
  }
  await initDb();
  const result = await cleanLifecycleDemoCustomers(firmId);
  // eslint-disable-next-line no-console
  console.log(
    `[clean:lifecycle] firm=${result.firmId} deleted=${result.deleted}`,
  );
}

const isDirectInvocation = (() => {
  try {
    const argv1 = process.argv[1] ?? '';
    return argv1.replace(/\\/g, '/').endsWith('scripts/clean-lifecycle.ts');
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  runCli().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[clean:lifecycle] failed:', e);
    process.exit(1);
  });
}
