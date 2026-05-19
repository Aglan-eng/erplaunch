/**
 * Phase 52.9.1 — clean-lifecycle tests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { getDb, insertCustomer } from '../../src/db/index.js';
import { seedLifecycleForFirm } from '../../scripts/seed-lifecycle.js';
import { cleanLifecycleDemoCustomers } from '../../scripts/clean-lifecycle.js';

let cleanupDb: () => void;
let firmId: string;

async function seedFirmWithUsers(): Promise<string> {
  const db = getDb();
  const fid = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
    args: [fid, 'Clean Test', `ct-${fid}`, 'STARTER', new Date().toISOString()],
  });
  for (let i = 0; i < 2; i++) {
    const uid = createId();
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
            VALUES (?, ?, ?, ?, 'x', 'CONSULTANT', ?)`,
      args: [uid, fid, `${uid}@x.io`, `U${i + 1}`, new Date().toISOString()],
    });
  }
  return fid;
}

async function seedNonDemoCustomer(firmIdArg: string, name: string): Promise<string> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
          VALUES (?, ?, ?, 'DISCOVERY', ?, ?)`,
    args: [id, firmIdArg, name, now, now],
  });
  await insertCustomer({
    id,
    firmId: firmIdArg,
    name,
    currentStage: 'BUILD',
    sourceEngagementId: id,
  });
  return id;
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanupDb = setup.cleanup;
});

afterAll(() => cleanupDb());

beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM IssueItem`);
  await db.execute(`DELETE FROM DecisionItem`);
  await db.execute(`DELETE FROM BusinessProfile`);
  await db.execute(`DELETE FROM Customer`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
  firmId = await seedFirmWithUsers();
});

describe('cleanLifecycleDemoCustomers', () => {
  it('deletes every [DEMO]-prefixed customer in the firm', async () => {
    await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    const result = await cleanLifecycleDemoCustomers(firmId);
    expect(result.deleted).toBe(16);
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM Customer WHERE firmId = ? AND name LIKE '[DEMO]%'`,
      args: [firmId],
    });
    expect(Number((r.rows[0] as unknown as { c: number }).c)).toBe(0);
  });

  it('leaves non-demo customers in the same firm untouched', async () => {
    await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    const realId = await seedNonDemoCustomer(firmId, 'Real Customer LLC');
    await cleanLifecycleDemoCustomers(firmId);
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT id, name FROM Customer WHERE firmId = ?`,
      args: [firmId],
    });
    expect(r.rows.length).toBe(1);
    const row = r.rows[0] as unknown as { id: string; name: string };
    expect(row.id).toBe(realId);
    expect(row.name).toBe('Real Customer LLC');
  });

  it('cascades child rows (ActivityLog / IssueItem / DecisionItem / BusinessProfile)', async () => {
    await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    const db = getDb();
    // Pre-flight: confirm the seed actually produced child rows.
    const beforeIssues = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM IssueItem`,
    });
    expect(Number((beforeIssues.rows[0] as unknown as { c: number }).c)).toBeGreaterThan(0);

    await cleanLifecycleDemoCustomers(firmId);

    // Every IssueItem / DecisionItem / BusinessProfile in this firm
    // belongs to a demo customer (we seeded nothing else), so all
    // should be gone.
    for (const table of ['IssueItem', 'DecisionItem', 'BusinessProfile']) {
      const r = await db.execute({ sql: `SELECT COUNT(*) AS c FROM ${table}` });
      expect(
        Number((r.rows[0] as unknown as { c: number }).c),
        `${table} should have no rows after cleanup`,
      ).toBe(0);
    }
    // ActivityLog transitions for demo customers should be gone too.
    const al = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM ActivityLog WHERE firmId = ?`,
      args: [firmId],
    });
    expect(Number((al.rows[0] as unknown as { c: number }).c)).toBe(0);
  });

  it('is idempotent — running twice with nothing to delete returns 0', async () => {
    await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    const first = await cleanLifecycleDemoCustomers(firmId);
    expect(first.deleted).toBe(16);
    const second = await cleanLifecycleDemoCustomers(firmId);
    expect(second.deleted).toBe(0);
  });

  it('refuses to run when firmId is missing / empty', async () => {
    await expect(cleanLifecycleDemoCustomers('')).rejects.toThrow(/firmId is required/);
  });

  it('does not touch a different firm\'s demo customers', async () => {
    await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    const otherFirmId = await seedFirmWithUsers();
    await seedLifecycleForFirm(otherFirmId, { includeDeadEnds: true });

    await cleanLifecycleDemoCustomers(firmId);

    const db = getDb();
    const other = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM Customer WHERE firmId = ? AND name LIKE '[DEMO]%'`,
      args: [otherFirmId],
    });
    expect(Number((other.rows[0] as unknown as { c: number }).c)).toBe(16);
    const target = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM Customer WHERE firmId = ? AND name LIKE '[DEMO]%'`,
      args: [firmId],
    });
    expect(Number((target.rows[0] as unknown as { c: number }).c)).toBe(0);
  });
});
