/**
 * Phase 52.1 — DB-backed Customer CRUD + backfill integration test.
 *
 * Exercises the real libSQL `Customer` table via setupTestDb (which
 * runs initDb() against an ephemeral file). The backfill itself fires
 * inside initDb(), so by the time the test body runs, the table
 * already exists; we further assert the backfill is a no-op on the
 * empty fixture and behaves correctly when we seed Engagements
 * before re-running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  getDb,
  getCustomer,
  insertCustomer,
  listCustomersByFirm,
  listCustomersByFirmAndStage,
  advanceStage,
  archiveCustomer,
  computeHealth,
  backfillCustomersFromEngagements,
} from '../../src/db/index.js';

let cleanup: () => void;
let firmId: string;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
});

beforeEach(async () => {
  const db = getDb();
  // Order matters: clear child rows before parent rows. The Phase
  // 52.1 customerId FK on GeneratedDocument (and the legacy
  // engagementId FK already present) means we must purge both
  // before touching Customer/Engagement.
  await db.execute(`DELETE FROM GeneratedDocument`);
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM Customer`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM Firm`);

  firmId = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
    args: [firmId, 'Test Firm', `test-firm-${createId()}`, 'STARTER', new Date().toISOString()],
  });
});

describe('insertCustomer + getCustomer roundtrip', () => {
  it('persists every column and reads it back', async () => {
    const id = createId();
    const created = await insertCustomer({
      id,
      firmId,
      name: 'Acme Industries',
      slug: 'acme-industries',
      currentStage: 'BUILD',
      salesOwnerUserId: 'u-sales',
      projectLeadUserId: 'u-pm',
      csmUserId: null,
      arOwnerUserId: 'u-ar',
      leadSource: 'Referral',
      industry: 'Manufacturing',
      dealValue: 2_500_000, // $25,000 in cents
      modules: 'Financials,Inventory',
      startDate: '2026-01-15',
      targetGoLive: '2026-08-01',
      contractEndDate: '2027-08-01',
      cutoverStrategy: 'PHASED',
      renewalCount: 0,
      isArchived: false,
      sourceEngagementId: null,
    });
    expect(created.id).toBe(id);
    expect(created.currentStage).toBe('BUILD');
    expect(created.dealValue).toBe(2_500_000);
    expect(created.cutoverStrategy).toBe('PHASED');

    const fetched = await getCustomer(id, firmId);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe('Acme Industries');
    expect(fetched?.industry).toBe('Manufacturing');
    expect(fetched?.modules).toBe('Financials,Inventory');
    expect(fetched?.isArchived).toBe(false);
  });

  it('returns null for cross-firm reads (tenant safety)', async () => {
    const id = createId();
    await insertCustomer({ id, firmId, name: 'Isolated Co' });
    const otherFirmId = createId();
    expect(await getCustomer(id, otherFirmId)).toBeNull();
  });
});

describe('listCustomersByFirm filters', () => {
  beforeEach(async () => {
    // Seed 5 customers across stages
    await insertCustomer({ id: createId(), firmId, name: 'Lead Co', currentStage: 'LEAD' });
    await insertCustomer({ id: createId(), firmId, name: 'Proposal Co', currentStage: 'PROPOSAL' });
    await insertCustomer({ id: createId(), firmId, name: 'Build Co', currentStage: 'BUILD' });
    await insertCustomer({ id: createId(), firmId, name: 'Live Co', currentStage: 'LIVE_SLA', salesOwnerUserId: 'u-1' });
    await insertCustomer({
      id: createId(),
      firmId,
      name: 'Lost Co',
      currentStage: 'LOST',
      isArchived: true,
    });
  });

  it('excludes archived by default', async () => {
    const rows = await listCustomersByFirm(firmId);
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.name === 'Lost Co')).toBeUndefined();
  });

  it('includes archived when requested', async () => {
    const rows = await listCustomersByFirm(firmId, { includeArchived: true });
    expect(rows).toHaveLength(5);
  });

  it('filters by stage list', async () => {
    const rows = await listCustomersByFirm(firmId, { stages: ['LEAD', 'PROPOSAL'] });
    expect(rows.map((r) => r.name).sort()).toEqual(['Lead Co', 'Proposal Co']);
  });

  it('filters by stage group (kanban swimlane)', async () => {
    const preSales = await listCustomersByFirm(firmId, { group: 'pre-sales' });
    expect(preSales.map((r) => r.name).sort()).toEqual(['Lead Co', 'Proposal Co']);

    const delivery = await listCustomersByFirm(firmId, { group: 'delivery' });
    expect(delivery.map((r) => r.name)).toEqual(['Build Co']);
  });

  it('filters by owner across any owner column', async () => {
    const rows = await listCustomersByFirm(firmId, { ownerUserId: 'u-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Live Co');
  });

  it('search is case-insensitive substring match', async () => {
    const rows = await listCustomersByFirm(firmId, { search: 'build' });
    expect(rows.map((r) => r.name)).toEqual(['Build Co']);
    const rows2 = await listCustomersByFirm(firmId, { search: 'CO' });
    expect(rows2).toHaveLength(4); // all unarchived end with "Co"
  });
});

describe('listCustomersByFirmAndStage', () => {
  it('returns only the requested stage', async () => {
    await insertCustomer({ id: createId(), firmId, name: 'A', currentStage: 'LEAD' });
    await insertCustomer({ id: createId(), firmId, name: 'B', currentStage: 'LEAD' });
    await insertCustomer({ id: createId(), firmId, name: 'C', currentStage: 'WON' });
    const leads = await listCustomersByFirmAndStage(firmId, 'LEAD');
    expect(leads).toHaveLength(2);
    expect(leads.every((c) => c.currentStage === 'LEAD')).toBe(true);
  });
});

describe('advanceStage', () => {
  it('updates currentStage and bumps updatedAt', async () => {
    const id = createId();
    await insertCustomer({ id, firmId, name: 'Acme', currentStage: 'PROPOSAL' });
    const before = await getCustomer(id, firmId);
    // Force a small delay so updatedAt differs.
    await new Promise((r) => setTimeout(r, 5));
    const after = await advanceStage(id, firmId, 'NEGOTIATION', {
      actorUserId: 'u-1',
      reason: 'Verbal yes',
    });
    expect(after.currentStage).toBe('NEGOTIATION');
    expect(after.updatedAt).not.toBe(before?.updatedAt);
  });

  it('increments renewalCount when RENEWAL_DUE → LIVE_SLA (per locked decision)', async () => {
    const id = createId();
    await insertCustomer({ id, firmId, name: 'Renewing Co', currentStage: 'RENEWAL_DUE', renewalCount: 2 });
    const next = await advanceStage(id, firmId, 'LIVE_SLA', { actorUserId: 'u-1' });
    expect(next.currentStage).toBe('LIVE_SLA');
    expect(next.renewalCount).toBe(3);
  });

  it('does NOT bump renewalCount for other LIVE_SLA transitions', async () => {
    const id = createId();
    await insertCustomer({ id, firmId, name: 'Hyper Co', currentStage: 'HYPERCARE', renewalCount: 0 });
    const next = await advanceStage(id, firmId, 'LIVE_SLA', { actorUserId: 'u-1' });
    expect(next.renewalCount).toBe(0);
  });

  it('throws when customer not found', async () => {
    await expect(
      advanceStage('nonexistent', firmId, 'WON', { actorUserId: 'u-1' }),
    ).rejects.toThrow(/not found/);
  });
});

describe('archiveCustomer', () => {
  it('flips isArchived to true and records lostReason', async () => {
    const id = createId();
    await insertCustomer({ id, firmId, name: 'Acme', currentStage: 'PROPOSAL' });
    const archived = await archiveCustomer(id, firmId, 'Went with incumbent vendor');
    expect(archived.isArchived).toBe(true);
    expect(archived.lostReason).toBe('Went with incumbent vendor');
  });

  it('accepts null lostReason', async () => {
    const id = createId();
    await insertCustomer({ id, firmId, name: 'Acme' });
    const archived = await archiveCustomer(id, firmId, null);
    expect(archived.isArchived).toBe(true);
    expect(archived.lostReason).toBeNull();
  });
});

describe('computeHealth', () => {
  it('returns 0 for archived customers', async () => {
    const id = createId();
    await insertCustomer({ id, firmId, name: 'A', isArchived: true });
    expect(await computeHealth(id, firmId)).toBe(0);
  });

  it('returns 100 for healthy customers (stub formula — Phase 52.4 fills in real data sources)', async () => {
    const id = createId();
    await insertCustomer({ id, firmId, name: 'A' });
    expect(await computeHealth(id, firmId)).toBe(100);
  });

  it('returns 0 for unknown customer', async () => {
    expect(await computeHealth('nope', firmId)).toBe(0);
  });
});

describe('backfillCustomersFromEngagements', () => {
  it('SKIPPED_NO_ENGAGEMENTS when Engagement table is empty', async () => {
    const r = await backfillCustomersFromEngagements();
    expect(r.status).toBe('SKIPPED_NO_ENGAGEMENTS');
    expect(r.migratedCount).toBe(0);
  });

  it('SKIPPED_ALREADY_POPULATED when Customer already has rows', async () => {
    await insertCustomer({ id: createId(), firmId, name: 'Pre-existing' });
    const r = await backfillCustomersFromEngagements();
    expect(r.status).toBe('SKIPPED_ALREADY_POPULATED');
  });

  it('migrates Engagements with the right stage mapping', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const seed = async (id: string, status: string, prev: string | null = null): Promise<void> => {
      await db.execute({
        sql: `INSERT INTO Engagement (id, firmId, clientName, status, previousStatus, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [id, firmId, `Client ${id}`, status, prev, now, now],
      });
    };
    await seed('e-1', 'PROSPECT');
    await seed('e-2', 'PROPOSED');
    await seed('e-3', 'CONTRACTED');
    await seed('e-4', 'BUILD');
    await seed('e-5', 'SLA_ACTIVE');
    await seed('e-6', 'ARCHIVED', 'CLOSEOUT');
    await seed('e-7', 'ARCHIVED', null);

    const r = await backfillCustomersFromEngagements();
    expect(r.status).toBe('BACKFILLED');
    expect(r.migratedCount).toBe(7);

    const expectations: Array<[string, string, boolean]> = [
      ['e-1', 'LEAD', false],
      ['e-2', 'PROPOSAL', false],
      ['e-3', 'WON', false],
      ['e-4', 'BUILD', false],
      ['e-5', 'LIVE_SLA', false],
      ['e-6', 'HYPERCARE', true], // archived but stage recovered from previousStatus
      ['e-7', 'DISCOVERY', true], // archived with no previousStatus → default
    ];
    for (const [id, expectedStage, expectedArchived] of expectations) {
      const c = await getCustomer(id, firmId);
      expect(c, `id=${id}`).not.toBeNull();
      expect(c?.currentStage, `id=${id} stage`).toBe(expectedStage);
      expect(c?.isArchived, `id=${id} archived`).toBe(expectedArchived);
      // Critical: id preserved (the FK-stability promise of the
      // backfill).
      expect(c?.id, `id=${id} preserved`).toBe(id);
      expect(c?.sourceEngagementId, `id=${id} sourceEngagementId`).toBe(id);
    }
  });

  it('converts Engagement.estimatedValue (dollars) to Customer.dealValue (cents)', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, estimatedValue, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['e-money', firmId, 'Money Co', 'PROPOSED', 25_000.5, now, now],
    });
    await backfillCustomersFromEngagements();
    const c = await getCustomer('e-money', firmId);
    expect(c?.dealValue).toBe(2_500_050); // 25,000.50 → 2,500,050 cents
  });

  it('carries salesRepUserId into salesOwnerUserId', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, salesRepUserId, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['e-owner', firmId, 'Owned Co', 'PROSPECT', 'u-bdr', now, now],
    });
    await backfillCustomersFromEngagements();
    const c = await getCustomer('e-owner', firmId);
    expect(c?.salesOwnerUserId).toBe('u-bdr');
    expect(c?.projectLeadUserId).toBeNull();
    expect(c?.csmUserId).toBeNull();
  });

  it('populates customerId on child tables (GeneratedDocument example)', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['e-with-doc', firmId, 'Doc Co', 'BUILD', now, now],
    });
    await db.execute({
      sql: `INSERT INTO GeneratedDocument (id, firmId, engagementId, name, body, generatedBy, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['doc-1', firmId, 'e-with-doc', 'My Doc', '# body', 'u-1', now, now],
    });

    await backfillCustomersFromEngagements();

    const r = await db.execute(`SELECT engagementId, customerId FROM GeneratedDocument WHERE id = 'doc-1'`);
    const row = r.rows[0] as unknown as { engagementId: string; customerId: string };
    expect(row.engagementId).toBe('e-with-doc');
    expect(row.customerId).toBe('e-with-doc'); // id-preserving backfill means engagementId == customerId
  });

  it('a second run is a no-op (steady-state path)', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['e-once', firmId, 'Once Co', 'DISCOVERY', now, now],
    });
    const first = await backfillCustomersFromEngagements();
    expect(first.status).toBe('BACKFILLED');
    expect(first.migratedCount).toBe(1);
    const second = await backfillCustomersFromEngagements();
    expect(second.status).toBe('SKIPPED_ALREADY_POPULATED');
    expect(second.migratedCount).toBe(0);
  });
});
