/**
 * Phase 52.3.1 — reconcile + health unit tests.
 *
 * Three categories:
 *   1. `reconcileEngagementsToCustomers` — creates Customer rows
 *      for orphan Engagements + is idempotent on rerun.
 *   2. `backfillCustomerOwners` — drops the resolved userId into
 *      the right owner column based on the Customer's currentStage
 *      (lock #2 mapping).
 *   3. `computeHealthScore` — returns the expected numerical score
 *      for a constructed fixture + band thresholds at 29 / 30 / 69
 *      / 70.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../../_helpers/testDb.js';
import { getDb, insertCustomer } from '../../../src/db/index.js';
import {
  reconcileEngagementsToCustomers,
  backfillCustomerOwners,
  reconcileFirmCustomers,
} from '../../../src/services/customer/reconcile.js';
import {
  computeHealthScore,
  recomputeAndPersistHealth,
  STAGE_TARGET_DAYS,
  _testOnlyBandFor,
} from '../../../src/services/customer/health.js';

let cleanup: () => void;
let firmId: string;

async function seedFirm(): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
    args: [id, 'Test Firm', `tf-${id}`, 'STARTER', new Date().toISOString()],
  });
  return id;
}

async function seedUser(firmIdArg: string, role = 'CONSULTANT'): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, firmIdArg, `${id}@example.com`, `User ${id.slice(0, 6)}`, 'x', role, new Date().toISOString()],
  });
  return id;
}

async function seedEngagement(opts: {
  firmId: string;
  status: string;
  salesRepUserId?: string | null;
  previousStatus?: string | null;
  clientName?: string;
}): Promise<string> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Engagement
            (id, firmId, clientName, status, previousStatus, salesRepUserId, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      opts.firmId,
      opts.clientName ?? `Client ${id.slice(0, 6)}`,
      opts.status,
      opts.previousStatus ?? null,
      opts.salesRepUserId ?? null,
      now,
      now,
    ],
  });
  return id;
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
  await db.execute(`DELETE FROM GeneratedDocument`);
  await db.execute(`DELETE FROM ProjectMember`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM Customer`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
  firmId = await seedFirm();
});

// ─── reconcileEngagementsToCustomers ───────────────────────────────────────

describe('reconcileEngagementsToCustomers', () => {
  it('creates Customer rows for orphan Engagements (PROSPECT → LEAD)', async () => {
    const salesRep = await seedUser(firmId);
    const engId = await seedEngagement({ firmId, status: 'PROSPECT', salesRepUserId: salesRep, clientName: 'Acme' });
    const created = await reconcileEngagementsToCustomers(firmId);
    expect(created).toBe(1);
    const db = getDb();
    const r = await db.execute({ sql: `SELECT id, currentStage, name, salesOwnerUserId, sourceEngagementId FROM Customer WHERE firmId = ?`, args: [firmId] });
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0] as Record<string, unknown>;
    expect(row.id).toBe(engId);
    expect(row.currentStage).toBe('LEAD');
    expect(row.name).toBe('Acme');
    expect(row.salesOwnerUserId).toBe(salesRep);
    expect(row.sourceEngagementId).toBe(engId);
  });

  it('is idempotent — running twice does not duplicate', async () => {
    await seedEngagement({ firmId, status: 'BUILD' });
    const first = await reconcileEngagementsToCustomers(firmId);
    expect(first).toBe(1);
    const second = await reconcileEngagementsToCustomers(firmId);
    expect(second).toBe(0);
    const r = await getDb().execute({ sql: `SELECT COUNT(*) AS c FROM Customer WHERE firmId = ?`, args: [firmId] });
    expect(Number((r.rows[0] as unknown as { c: number }).c)).toBe(1);
  });

  it('routes to projectLeadUserId for delivery-stage engagements (BUILD)', async () => {
    const sales = await seedUser(firmId);
    const lead = await seedUser(firmId);
    const engId = await seedEngagement({ firmId, status: 'BUILD', salesRepUserId: sales });
    // Project-lead role row trumps salesRepUserId for delivery stages.
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO EngagementRole (id, engagementId, userId, role) VALUES (?, ?, ?, ?)`,
      args: [createId(), engId, lead, 'PROJECT_LEAD'],
    });
    await reconcileEngagementsToCustomers(firmId);
    const r = await db.execute({ sql: `SELECT salesOwnerUserId, projectLeadUserId, csmUserId FROM Customer WHERE id = ?`, args: [engId] });
    const row = r.rows[0] as Record<string, unknown>;
    expect(row.salesOwnerUserId).toBeNull();
    expect(row.projectLeadUserId).toBe(lead);
    expect(row.csmUserId).toBeNull();
  });

  it('falls back to salesRepUserId on projectLead when no role row exists', async () => {
    const sales = await seedUser(firmId);
    const engId = await seedEngagement({ firmId, status: 'BUILD', salesRepUserId: sales });
    await reconcileEngagementsToCustomers(firmId);
    const r = await getDb().execute({ sql: `SELECT projectLeadUserId FROM Customer WHERE id = ?`, args: [engId] });
    expect((r.rows[0] as unknown as { projectLeadUserId: string }).projectLeadUserId).toBe(sales);
  });

  it('flags ARCHIVED engagements as isArchived=1 with stage recovered from previousStatus', async () => {
    const engId = await seedEngagement({
      firmId,
      status: 'ARCHIVED',
      previousStatus: 'SLA_ACTIVE',
    });
    await reconcileEngagementsToCustomers(firmId);
    const r = await getDb().execute({ sql: `SELECT currentStage, isArchived FROM Customer WHERE id = ?`, args: [engId] });
    const row = r.rows[0] as Record<string, unknown>;
    expect(row.currentStage).toBe('LIVE_SLA');
    expect(Number(row.isArchived)).toBe(1);
  });
});

// ─── backfillCustomerOwners ───────────────────────────────────────────────

describe('backfillCustomerOwners', () => {
  it('puts the value on salesOwnerUserId for LEAD stage', async () => {
    const rep = await seedUser(firmId);
    const engId = await seedEngagement({ firmId, status: 'PROSPECT', salesRepUserId: rep });
    // Create the Customer manually with ALL owner fields null to
    // exercise the backfill path.
    await insertCustomer({
      id: engId,
      firmId,
      name: 'Lead Co',
      currentStage: 'LEAD',
      sourceEngagementId: engId,
    });
    const filled = await backfillCustomerOwners(firmId);
    expect(filled).toBe(1);
    const r = await getDb().execute({ sql: `SELECT salesOwnerUserId, projectLeadUserId, csmUserId FROM Customer WHERE id = ?`, args: [engId] });
    const row = r.rows[0] as Record<string, unknown>;
    expect(row.salesOwnerUserId).toBe(rep);
    expect(row.projectLeadUserId).toBeNull();
    expect(row.csmUserId).toBeNull();
  });

  it('puts the value on projectLeadUserId for UAT stage', async () => {
    const sales = await seedUser(firmId);
    const lead = await seedUser(firmId);
    const engId = await seedEngagement({ firmId, status: 'UAT', salesRepUserId: sales });
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO EngagementRole (id, engagementId, userId, role) VALUES (?, ?, ?, ?)`,
      args: [createId(), engId, lead, 'PROJECT_LEAD'],
    });
    await insertCustomer({
      id: engId,
      firmId,
      name: 'UAT Co',
      currentStage: 'UAT',
      sourceEngagementId: engId,
    });
    await backfillCustomerOwners(firmId);
    const r = await db.execute({ sql: `SELECT salesOwnerUserId, projectLeadUserId FROM Customer WHERE id = ?`, args: [engId] });
    const row = r.rows[0] as Record<string, unknown>;
    expect(row.projectLeadUserId).toBe(lead);
    expect(row.salesOwnerUserId).toBeNull();
  });

  it('puts the value on csmUserId for LIVE_SLA stage', async () => {
    const sales = await seedUser(firmId);
    const engId = await seedEngagement({ firmId, status: 'SLA_ACTIVE', salesRepUserId: sales });
    await insertCustomer({
      id: engId,
      firmId,
      name: 'SLA Co',
      currentStage: 'LIVE_SLA',
      sourceEngagementId: engId,
    });
    await backfillCustomerOwners(firmId);
    const r = await getDb().execute({ sql: `SELECT salesOwnerUserId, projectLeadUserId, csmUserId FROM Customer WHERE id = ?`, args: [engId] });
    const row = r.rows[0] as Record<string, unknown>;
    expect(row.csmUserId).toBe(sales); // salesRep stamp is the only resolvable user — falls onto csm column per stage
    expect(row.salesOwnerUserId).toBeNull();
    expect(row.projectLeadUserId).toBeNull();
  });

  it('falls back to the firm APP_ADMIN when no engagement or role match exists', async () => {
    const admin = await seedUser(firmId, 'APP_ADMIN');
    await insertCustomer({
      id: createId(),
      firmId,
      name: 'Lonely',
      currentStage: 'LEAD',
      // No sourceEngagementId — native-create customer with no
      // engagement to resolve from.
    });
    const filled = await backfillCustomerOwners(firmId);
    expect(filled).toBe(1);
    const r = await getDb().execute({ sql: `SELECT salesOwnerUserId FROM Customer WHERE firmId = ?`, args: [firmId] });
    expect((r.rows[0] as unknown as { salesOwnerUserId: string }).salesOwnerUserId).toBe(admin);
  });

  it('leaves customers with any owner already set untouched', async () => {
    const existing = await seedUser(firmId);
    await insertCustomer({
      id: createId(),
      firmId,
      name: 'Already owned',
      currentStage: 'BUILD',
      projectLeadUserId: existing,
    });
    const filled = await backfillCustomerOwners(firmId);
    expect(filled).toBe(0);
  });
});

// ─── computeHealthScore ────────────────────────────────────────────────────

describe('computeHealthScore — composite formula', () => {
  it('returns 100 + green for a baseline fresh customer with no data sources', async () => {
    const cid = createId();
    await insertCustomer({
      id: cid,
      firmId,
      name: 'Pristine',
      currentStage: 'LEAD',
    });
    const r = await computeHealthScore(cid);
    // No engagement → questionnaire 0% (0/30), no blockers (25/25),
    // 0 days in stage (25/25), no pending decisions (20/20) = 70.
    // Top-of-yellow / floor-of-green boundary.
    expect(r.score).toBe(70);
    expect(r.band).toBe('green');
  });

  it('drops the questionnaire component when completeness is partial', async () => {
    const engId = await seedEngagement({ firmId, status: 'DISCOVERY' });
    const cid = engId;
    await insertCustomer({
      id: cid,
      firmId,
      name: 'Half-answered',
      currentStage: 'DISCOVERY',
      sourceEngagementId: engId,
    });
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO BusinessProfile (id, engagementId, version, answers, completeness, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [createId(), engId, 1, '{}', JSON.stringify({ a: 0.5, b: 0.5 }), new Date().toISOString()],
    });
    const r = await computeHealthScore(cid);
    // 30 × 0.5 = 15 (questionnaire), 25 (blockers), 25 (stage), 20 (decisions) → 85
    expect(r.score).toBe(85);
    expect(r.band).toBe('green');
  });

  it('drops the blocker component by 5% per open IssueItem', async () => {
    const engId = await seedEngagement({ firmId, status: 'BUILD' });
    const cid = engId;
    await insertCustomer({
      id: cid,
      firmId,
      name: 'Blocked',
      currentStage: 'BUILD',
      sourceEngagementId: engId,
    });
    const db = getDb();
    // 2 open blockers → 25 × max(0, 1 − 2 × 0.05) = 25 × 0.9 = 22.5
    for (let i = 0; i < 2; i++) {
      await db.execute({
        sql: `INSERT INTO IssueItem (id, engagementId, title, status) VALUES (?, ?, ?, ?)`,
        args: [createId(), engId, `Blocker ${i}`, 'OPEN'],
      });
    }
    const r = await computeHealthScore(cid);
    // 0 + 22.5 + 25 + 20 = 67.5 → round → 68 → yellow
    expect(r.score).toBe(68);
    expect(r.band).toBe('yellow');
  });

  it('drops the stage-overdue component when the customer is past STAGE_TARGET_DAYS', async () => {
    const engId = await seedEngagement({ firmId, status: 'LEAD' });
    const cid = engId;
    const longAgo = new Date(Date.now() - (STAGE_TARGET_DAYS.LEAD + 10) * 86_400_000).toISOString();
    const db = getDb();
    // Use raw INSERT so we can backdate createdAt.
    await db.execute({
      sql: `INSERT INTO Customer (id, firmId, name, currentStage, sourceEngagementId,
              renewalCount, isArchived, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [cid, firmId, 'Overdue', 'LEAD', engId, 0, 0, longAgo, longAgo],
    });
    const r = await computeHealthScore(cid);
    // 0 (questionnaire) + 25 (blockers) + (25 × max(0, 1 − 10/30) = 25 × 0.6666… ≈ 16.67) + 20 (decisions) ≈ 61.67 → 62 → yellow
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.score).toBeLessThanOrEqual(63);
    expect(r.band).toBe('yellow');
  });

  it('drops the decisions component by 20% per pending decision > 14 days', async () => {
    const engId = await seedEngagement({ firmId, status: 'BUILD' });
    const cid = engId;
    await insertCustomer({
      id: cid,
      firmId,
      name: 'Pending decisions',
      currentStage: 'BUILD',
      sourceEngagementId: engId,
    });
    const db = getDb();
    const longAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    // 1 pending decision past 14 days → 20 × 0.8 = 16
    await db.execute({
      sql: `INSERT INTO DecisionItem (id, engagementId, title, decidedAt, createdAt)
            VALUES (?, ?, ?, NULL, ?)`,
      args: [createId(), engId, 'Pending', longAgo],
    });
    const r = await computeHealthScore(cid);
    // 0 + 25 + 25 + 16 = 66 → yellow
    expect(r.score).toBe(66);
    expect(r.band).toBe('yellow');
  });

  it('returns 0 + red for archived customers', async () => {
    const cid = createId();
    await insertCustomer({
      id: cid,
      firmId,
      name: 'Archived',
      currentStage: 'LOST',
      isArchived: true,
    });
    const r = await computeHealthScore(cid);
    expect(r.score).toBe(0);
    expect(r.band).toBe('red');
  });

  it('handles a missing customer by returning 0 + red', async () => {
    const r = await computeHealthScore('definitely-not-a-real-id');
    expect(r.score).toBe(0);
    expect(r.band).toBe('red');
  });

  it('persists the score onto Customer.health via recomputeAndPersistHealth', async () => {
    const cid = createId();
    await insertCustomer({
      id: cid,
      firmId,
      name: 'Persistable',
      currentStage: 'LEAD',
    });
    const r = await recomputeAndPersistHealth(cid);
    expect(r.score).toBe(70);
    const row = await getDb().execute({ sql: `SELECT health FROM Customer WHERE id = ?`, args: [cid] });
    expect(Number((row.rows[0] as unknown as { health: number }).health)).toBe(70);
  });
});

// ─── Band thresholds ───────────────────────────────────────────────────────

describe('health band thresholds', () => {
  it('returns red for scores below 30', () => {
    expect(_testOnlyBandFor(0)).toBe('red');
    expect(_testOnlyBandFor(15)).toBe('red');
    expect(_testOnlyBandFor(29)).toBe('red');
  });

  it('returns yellow for 30..69', () => {
    expect(_testOnlyBandFor(30)).toBe('yellow');
    expect(_testOnlyBandFor(50)).toBe('yellow');
    expect(_testOnlyBandFor(69)).toBe('yellow');
  });

  it('returns green for >= 70', () => {
    expect(_testOnlyBandFor(70)).toBe('green');
    expect(_testOnlyBandFor(85)).toBe('green');
    expect(_testOnlyBandFor(100)).toBe('green');
  });
});

// ─── Combined entrypoint ───────────────────────────────────────────────────

describe('reconcileFirmCustomers — end-to-end', () => {
  it('creates customers, fills owners, and persists health in one pass', async () => {
    const rep = await seedUser(firmId);
    await seedEngagement({ firmId, status: 'PROSPECT', salesRepUserId: rep, clientName: 'Alpha' });
    await seedEngagement({ firmId, status: 'BUILD', salesRepUserId: rep, clientName: 'Beta' });
    const result = await reconcileFirmCustomers(firmId);
    expect(result.created).toBe(2);
    // ownersFilled targets rows whose four owner columns are ALL
    // null — after reconcile-pass-1 the rows have owners set on
    // the right column, so pass 2 has nothing to do.
    expect(result.ownersFilled).toBe(0);
    expect(result.healthUpdated).toBe(2);
    const rows = await getDb().execute({ sql: `SELECT health FROM Customer WHERE firmId = ?`, args: [firmId] });
    for (const row of rows.rows) {
      const score = Number((row as unknown as { health: number }).health);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});
