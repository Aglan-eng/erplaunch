/**
 * Phase 56.1 — Account → Project schema split tests.
 *
 * Pins:
 *   - The Account table exists + carries the contact slice.
 *   - The new Customer columns (accountId, projectName, projectKind)
 *     are present and populated by the backfill.
 *   - Every existing Customer row links to exactly one Account.
 *   - The backfill is idempotent: re-running creates nothing new.
 *   - Child rows (ActivityLog, IssueItem, etc.) still resolve
 *     against the project id unchanged — no FK rewrite was needed.
 *   - The helpers (listAccounts, listProjectsForAccount) return
 *     the expected linkage.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { getDb, insertCustomer } from '../../src/db/index.js';
import {
  backfillAccounts,
  createAccount,
  createProject,
  getAccount,
  listAccounts,
  listProjectsForAccount,
  _testOnlyResetAccountMigrationFlags,
} from '../../src/db/account.js';

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

async function seedCustomerRow(opts: { firmId: string; name?: string }): Promise<string> {
  const id = createId();
  await insertCustomer({
    id,
    firmId: opts.firmId,
    name: opts.name ?? 'Untitled',
    currentStage: 'LEAD',
    sourceEngagementId: id,
  });
  // Engagement row mirrors Customer.id per Phase 52.1.
  await getDb().execute({
    sql: `INSERT OR IGNORE INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
          VALUES (?, ?, ?, 'PROSPECT', ?, ?)`,
    args: [id, opts.firmId, opts.name ?? 'Untitled', new Date().toISOString(), new Date().toISOString()],
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
  await db.execute(`DELETE FROM Customer`);
  try {
    await db.execute(`DELETE FROM Account`);
  } catch {
    /* Account table may not exist on the first beforeEach if initDb
       skipped it for some reason — tolerate so the rest of the test
       file still runs. */
  }
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM Firm`);
  firmId = await seedFirm();
  _testOnlyResetAccountMigrationFlags();
});

describe('Phase 56.1 — Account schema + columns', () => {
  it('Customer table carries the new accountId / projectName / projectKind columns', async () => {
    const db = getDb();
    const cols = await db.execute({ sql: `PRAGMA table_info(Customer)` });
    const names = cols.rows.map((r) => String((r as unknown as { name: unknown }).name));
    expect(names).toContain('accountId');
    expect(names).toContain('projectName');
    expect(names).toContain('projectKind');
  });

  it('Account table exists with the firm-level contact slice', async () => {
    const db = getDb();
    const cols = await db.execute({ sql: `PRAGMA table_info(Account)` });
    const names = cols.rows.map((r) => String((r as unknown as { name: unknown }).name));
    for (const expected of [
      'id',
      'firmId',
      'name',
      'address',
      'primaryContactName',
      'primaryContactEmail',
      'primaryContactPhone',
      'archived',
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe('backfillAccounts', () => {
  it('creates exactly one Account per unlinked Customer row and links them', async () => {
    await seedCustomerRow({ firmId, name: 'Acme Industries' });
    await seedCustomerRow({ firmId, name: 'Beta Co' });

    const result = await backfillAccounts();
    expect(result.totalAccountsCreated).toBe(2);
    expect(result.totalProjectsLinked).toBe(2);

    const accounts = await listAccounts(firmId);
    expect(accounts).toHaveLength(2);
    const names = accounts.map((a) => a.name).sort();
    expect(names).toEqual(['Acme Industries', 'Beta Co']);

    // Every Customer row now has an accountId.
    const r = await getDb().execute({
      sql: `SELECT COUNT(*) AS c FROM Customer WHERE accountId IS NULL`,
    });
    expect(Number((r.rows[0] as unknown as { c: number }).c)).toBe(0);
  });

  it('is idempotent — a second run creates nothing new', async () => {
    await seedCustomerRow({ firmId });
    const first = await backfillAccounts();
    expect(first.totalAccountsCreated).toBe(1);

    const second = await backfillAccounts();
    expect(second.totalAccountsCreated).toBe(0);
    expect(second.totalProjectsLinked).toBe(0);

    // Still exactly one account.
    expect((await listAccounts(firmId)).length).toBe(1);
  });

  it('populates projectName with "{name} — Initial Implementation" and projectKind = INITIAL_IMPLEMENTATION', async () => {
    const cid = await seedCustomerRow({ firmId, name: 'Gamma Co' });
    await backfillAccounts();
    const r = await getDb().execute({
      sql: `SELECT projectName, projectKind FROM Customer WHERE id = ?`,
      args: [cid],
    });
    const row = r.rows[0] as unknown as { projectName: unknown; projectKind: unknown };
    expect(String(row.projectName)).toBe('Gamma Co — Initial Implementation');
    expect(String(row.projectKind)).toBe('INITIAL_IMPLEMENTATION');
  });

  it('copies the contact slice (address + primary contact*) onto the Account', async () => {
    const cid = await seedCustomerRow({ firmId, name: 'Contact Co' });
    // Set the contact fields the way Phase 52.4 does (via ALTER-added cols).
    const db = getDb();
    await db.execute({
      sql: `UPDATE Customer
            SET customerAddress = ?, primaryContactName = ?, primaryContactEmail = ?, primaryContactPhone = ?
            WHERE id = ?`,
      args: [
        '12 Main St, Dubai',
        'Lina Said',
        'lina@contact.example',
        '+971-50-1234567',
        cid,
      ],
    });
    await backfillAccounts();
    const acct = (await listAccounts(firmId))[0];
    expect(acct.address).toBe('12 Main St, Dubai');
    expect(acct.primaryContactName).toBe('Lina Said');
    expect(acct.primaryContactEmail).toBe('lina@contact.example');
    expect(acct.primaryContactPhone).toBe('+971-50-1234567');
  });

  it('leaves child rows (ActivityLog) untouched — no FK rewrite needed', async () => {
    const cid = await seedCustomerRow({ firmId, name: 'Child Co' });
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO ActivityLog
              (id, engagementId, customerId, firmId, action, createdAt)
            VALUES (?, ?, ?, ?, 'STAGE_TRANSITION', ?)`,
      args: [createId(), cid, cid, firmId, new Date().toISOString()],
    });

    await backfillAccounts();

    const r = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM ActivityLog WHERE customerId = ? OR engagementId = ?`,
      args: [cid, cid],
    });
    expect(Number((r.rows[0] as unknown as { c: number }).c)).toBe(1);
  });
});

describe('helpers', () => {
  it('listProjectsForAccount returns the linked Project after backfill', async () => {
    const cid = await seedCustomerRow({ firmId, name: 'Lookup Co' });
    await backfillAccounts();
    const accountId = (await listAccounts(firmId))[0].id;
    const projects = await listProjectsForAccount(accountId);
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(cid);
    expect(projects[0].projectName).toBe('Lookup Co — Initial Implementation');
    expect(projects[0].projectKind).toBe('INITIAL_IMPLEMENTATION');
    expect(projects[0].currentStage).toBe('LEAD');
  });

  it('createAccount + createProject — the Account→Project multi-project capability is unlocked', async () => {
    const account = await createAccount({
      firmId,
      name: 'Multi-Project Co',
      address: 'HQ',
      primaryContactName: 'Hesham',
    });
    expect(account.id).toBeTruthy();
    expect(account.name).toBe('Multi-Project Co');

    const p1 = await createProject({
      accountId: account.id,
      firmId,
      projectName: 'Initial NetSuite rollout',
      projectKind: 'INITIAL_IMPLEMENTATION',
    });
    const p2 = await createProject({
      accountId: account.id,
      firmId,
      projectName: 'Phase 2: Subsidiary onboarding',
      projectKind: 'PHASE_2',
    });

    const projects = await listProjectsForAccount(account.id);
    expect(projects.map((p) => p.id).sort()).toEqual([p1.projectId, p2.projectId].sort());
    expect(projects.map((p) => p.projectKind).sort()).toEqual(
      ['INITIAL_IMPLEMENTATION', 'PHASE_2'].sort(),
    );
  });

  it('getAccount is firm-scoped — cross-firm reads return null', async () => {
    const account = await createAccount({ firmId, name: 'Tenant Co' });
    expect(await getAccount(account.id, firmId)).not.toBeNull();
    const otherFirm = await seedFirm();
    expect(await getAccount(account.id, otherFirm)).toBeNull();
  });
});
