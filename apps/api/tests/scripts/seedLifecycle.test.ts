/**
 * Phase 52.9 — seed-lifecycle script tests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { getDb } from '../../src/db/index.js';
import { seedLifecycleForFirm } from '../../scripts/seed-lifecycle.js';

let cleanup: () => void;
let firmId: string;

async function seedFirmWithUsers(userCount = 2): Promise<string> {
  const db = getDb();
  const fid = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
    args: [fid, 'Test', `t-${fid}`, 'STARTER', new Date().toISOString()],
  });
  for (let i = 0; i < userCount; i++) {
    const uid = createId();
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
            VALUES (?, ?, ?, ?, 'x', 'CONSULTANT', ?)`,
      args: [uid, fid, `${uid}@x.io`, `User ${i + 1}`, new Date().toISOString()],
    });
  }
  return fid;
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => cleanup());

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
  firmId = await seedFirmWithUsers(3);
});

describe('seedLifecycleForFirm', () => {
  it('creates exactly 16 [DEMO] customers including dead-ends', async () => {
    const result = await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    expect(result.created).toBe(16);
    expect(result.upserted).toBe(0);
    expect(result.customerIds).toHaveLength(16);
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM Customer WHERE firmId = ? AND name LIKE '[DEMO]%'`,
      args: [firmId],
    });
    expect(Number((r.rows[0] as unknown as { c: number }).c)).toBe(16);
  });

  it('omits dead-ends when includeDeadEnds=false (14 customers)', async () => {
    const result = await seedLifecycleForFirm(firmId, { includeDeadEnds: false });
    expect(result.created).toBe(14);
    expect(result.skippedDeadEnds).toBe(2);
  });

  it('is idempotent — re-running upserts instead of duplicating', async () => {
    await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    const second = await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    expect(second.created).toBe(0);
    expect(second.upserted).toBe(16);
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM Customer WHERE firmId = ? AND name LIKE '[DEMO]%'`,
      args: [firmId],
    });
    expect(Number((r.rows[0] as unknown as { c: number }).c)).toBe(16);
  });

  it('every customer has the right currentStage matching its name', async () => {
    await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    const db = getDb();
    const expectations: Array<[string, string]> = [
      ['Acme Sales Lead', 'LEAD'],
      ['Beta Qualified', 'QUALIFIED'],
      ['Gamma Proposal', 'PROPOSAL'],
      ['Delta Negotiation', 'NEGOTIATION'],
      ['Echo Won', 'WON'],
      ['Foxtrot Discovery', 'DISCOVERY'],
      ['Golf Scoping', 'SCOPING'],
      ['Hotel Build', 'BUILD'],
      ['India UAT', 'UAT'],
      ['Juliet GoLive', 'GOLIVE'],
      ['Kilo Hypercare', 'HYPERCARE'],
      ['Lima Live SLA', 'LIVE_SLA'],
      ['Mike Renewal Due', 'RENEWAL_DUE'],
      ['Oscar Lost', 'LOST'],
      ['Papa Churned', 'CHURNED'],
    ];
    for (const [nameFragment, stage] of expectations) {
      const r = await db.execute({
        sql: `SELECT currentStage FROM Customer WHERE firmId = ? AND name LIKE ? LIMIT 1`,
        args: [firmId, `%${nameFragment}%`],
      });
      const row = r.rows[0] as { currentStage?: string } | undefined;
      expect(row?.currentStage, `expected ${nameFragment} to be ${stage}`).toBe(stage);
    }
  });

  it('writes ActivityLog rows for stage transitions', async () => {
    await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM ActivityLog
            WHERE firmId = ? AND action = 'STAGE_TRANSITION'`,
      args: [firmId],
    });
    // 16 customers each have ≥ 1 transition; November has 2 → expect ≥ 16.
    expect(Number((r.rows[0] as unknown as { c: number }).c)).toBeGreaterThanOrEqual(16);
  });

  it('seeds BusinessProfile / IssueItem / DecisionItem fixtures', async () => {
    await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    const db = getDb();
    const issues = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM IssueItem WHERE status = 'OPEN'`,
    });
    expect(Number((issues.rows[0] as unknown as { c: number }).c)).toBeGreaterThan(0);
    const decisions = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM DecisionItem WHERE decidedAt IS NULL`,
    });
    expect(Number((decisions.rows[0] as unknown as { c: number }).c)).toBeGreaterThan(0);
    const profiles = await db.execute({ sql: `SELECT COUNT(*) AS c FROM BusinessProfile` });
    expect(Number((profiles.rows[0] as unknown as { c: number }).c)).toBeGreaterThan(0);
  });

  it('computes non-trivial health scores for non-archived customers', async () => {
    await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT name, health FROM Customer
            WHERE firmId = ? AND isArchived = 0 AND name LIKE '[DEMO]%'`,
      args: [firmId],
    });
    const withScore = r.rows.filter((row) => {
      const h = (row as { health?: number | null }).health;
      return h != null && h > 0;
    });
    // At least half the active demos should compute a positive score.
    expect(withScore.length).toBeGreaterThanOrEqual(7);
  });

  it('distributes owners across multiple users for utilization variation', async () => {
    await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT DISTINCT salesOwnerUserId FROM Customer
            WHERE firmId = ? AND name LIKE '[DEMO]%' AND salesOwnerUserId IS NOT NULL`,
      args: [firmId],
    });
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
  });
});
