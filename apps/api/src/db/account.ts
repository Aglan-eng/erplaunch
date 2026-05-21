/**
 * Phase 56.1 — Account → Project schema split.
 *
 * # FK topology (recon)
 *
 * The codebase has ~37 child tables. Of those, exactly **0** FK to
 * `Customer(id)` and **35** FK to `Engagement(id)` (ActivityLog,
 * IssueItem, DecisionItem, BusinessProfile, GeneratedDocument,
 * EngagementRole, Ticket, ProjectMember, RiskItem, MeetingNote,
 * MigrationItem, ClientPortalToken, LicenseProfile, Phase,
 * ConflictLog, TicketMessage, TicketStatusChange, and ~17 more).
 * The Phase 52.1 invariant `Customer.id === Engagement.id` makes
 * those rows reachable from a Customer id without rewriting anything.
 *
 * # Migration strategy (chosen)
 *
 * **Add a parent `Account` table; treat the existing `Customer` row
 * as the Project layer.** Rationale:
 *   - Renaming `Customer` → `Project` would require re-keying every
 *     consumer (35+ DB call sites, ~60 frontend files, every test).
 *     Phase 56 is supposed to ship in safe sub-phases — that rename
 *     is itself a phase, not a side effect of 56.1.
 *   - All child FKs key off `Engagement(id)`. Since `Customer.id ===
 *     Engagement.id === (now) Project.id`, child rows resolve through
 *     the new Project layer without any FK rewrites.
 *   - The lifecycle (stage, owners, health, transitions, renewals)
 *     stays on the existing row — that's the Project.
 *   - Add a NEW `Account` table above it. Backfill creates one
 *     Account per existing Customer row, copies the contact fields
 *     up to the Account, and sets `Customer.accountId`. After
 *     backfill: one Account ↔ one Project (matches today's reality).
 *     The multi-project capability is unlocked by 56.2's UI.
 *
 * **What this module adds:**
 *   - `Account` table + indexes.
 *   - New columns on `Customer`: `accountId`, `projectName`,
 *     `projectKind` (idempotent ALTERs).
 *   - `initAccountSchema()` — called from `initDb()` after Customer
 *     exists.
 *   - `backfillAccounts()` — idempotent; safe to run on every boot.
 *   - Helpers: `getAccount`, `listAccounts`, `listProjectsForAccount`,
 *     `createAccount`, `createProject`.
 *
 * The file header on `db/customer.ts` should note that a `Customer`
 * row is now semantically a Project; 56.2 / 56.3 surface that
 * distinction in the API + UI.
 */
import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export type ProjectKind =
  | 'INITIAL_IMPLEMENTATION'
  | 'PHASE_2'
  | 'MODULE_ROLLOUT'
  | 'OTHER';

export const PROJECT_KINDS: ReadonlyArray<ProjectKind> = [
  'INITIAL_IMPLEMENTATION',
  'PHASE_2',
  'MODULE_ROLLOUT',
  'OTHER',
];

export interface Account {
  id: string;
  firmId: string;
  name: string;
  address: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  accountId: string;
  projectName: string;
  projectKind: ProjectKind;
  currentStage: string;
  health: number | null;
  isArchived: boolean;
  createdAt: string;
}

// ─── Schema (idempotent) ──────────────────────────────────────────────────

let _initialised = false;
let _backfilled = false;

/**
 * Create the Account table + add the three new columns on Customer.
 * Idempotent — safe to call from every boot.
 */
export async function initAccountSchema(): Promise<void> {
  if (_initialised) return;
  _initialised = true;
  const db = getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS Account (
      id                    TEXT PRIMARY KEY,
      firmId                TEXT NOT NULL REFERENCES Firm(id) ON DELETE CASCADE,
      name                  TEXT NOT NULL,
      address               TEXT,
      primaryContactName    TEXT,
      primaryContactEmail   TEXT,
      primaryContactPhone   TEXT,
      archived              INTEGER NOT NULL DEFAULT 0,
      createdAt             TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt             TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_Account_firmId ON Account(firmId)`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_Account_firmId_archived ON Account(firmId, archived)`,
  );

  // Phase 56.1 — the three new columns on the existing lifecycle row.
  // Idempotent via try/catch; SQLite has no ALTER ... ADD IF NOT EXISTS.
  try {
    await db.execute(`ALTER TABLE Customer ADD COLUMN accountId TEXT REFERENCES Account(id)`);
  } catch {
    /* duplicate column on subsequent boots */
  }
  try {
    await db.execute(`ALTER TABLE Customer ADD COLUMN projectName TEXT`);
  } catch {
    /* duplicate */
  }
  try {
    await db.execute(
      `ALTER TABLE Customer ADD COLUMN projectKind TEXT DEFAULT 'INITIAL_IMPLEMENTATION'`,
    );
  } catch {
    /* duplicate */
  }
  try {
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_Customer_accountId ON Customer(accountId)`);
  } catch {
    /* duplicate */
  }
}

// ─── Backfill ────────────────────────────────────────────────────────────

interface BackfillRow {
  id: unknown;
  firmId: unknown;
  name: unknown;
  customerAddress: unknown;
  primaryContactName: unknown;
  primaryContactEmail: unknown;
  primaryContactPhone: unknown;
}

export interface BackfillResult {
  firms: Array<{
    firmId: string;
    accountsCreated: number;
    projectsLinked: number;
  }>;
  totalAccountsCreated: number;
  totalProjectsLinked: number;
}

/**
 * For every existing Customer row with no accountId, create exactly
 * one Account (copying the contact slice up), set Customer.accountId
 * + projectName + projectKind. Re-running creates nothing new.
 *
 * The function is grouped by firm so the log line lands per-firm.
 */
export async function backfillAccounts(): Promise<BackfillResult> {
  const db = getDb();

  // Phase 56.1 — the contact columns (customerAddress, primaryContact*)
  // are ALTER-added by `customerDetail.ts` on first read. We can't
  // count on them being present yet at backfill time, so detect and
  // tolerate missing columns by adding them here too.
  for (const col of [
    'customerAddress',
    'primaryContactName',
    'primaryContactEmail',
    'primaryContactPhone',
  ]) {
    try {
      await db.execute(`ALTER TABLE Customer ADD COLUMN ${col} TEXT`);
    } catch {
      /* idempotent */
    }
  }

  const unlinked = await db.execute({
    sql: `SELECT id, firmId, name,
                 customerAddress, primaryContactName, primaryContactEmail, primaryContactPhone
          FROM Customer
          WHERE accountId IS NULL`,
  });

  const byFirm = new Map<string, { accountsCreated: number; projectsLinked: number }>();
  let totalAccounts = 0;
  let totalLinked = 0;

  for (const raw of unlinked.rows) {
    const row = raw as unknown as BackfillRow;
    const firmId = String(row.firmId);
    const customerId = String(row.id);
    const customerName = String(row.name ?? 'Untitled customer');
    const address = row.customerAddress == null ? null : String(row.customerAddress);
    const contactName =
      row.primaryContactName == null ? null : String(row.primaryContactName);
    const contactEmail =
      row.primaryContactEmail == null ? null : String(row.primaryContactEmail);
    const contactPhone =
      row.primaryContactPhone == null ? null : String(row.primaryContactPhone);

    const accountId = createId();
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO Account
              (id, firmId, name, address, primaryContactName, primaryContactEmail,
               primaryContactPhone, archived, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      args: [accountId, firmId, customerName, address, contactName, contactEmail, contactPhone, now, now],
    });
    await db.execute({
      sql: `UPDATE Customer
            SET accountId = ?,
                projectName = COALESCE(projectName, ?),
                projectKind = COALESCE(projectKind, 'INITIAL_IMPLEMENTATION'),
                updatedAt = ?
            WHERE id = ?`,
      args: [
        accountId,
        `${customerName} — Initial Implementation`,
        now,
        customerId,
      ],
    });

    const entry = byFirm.get(firmId) ?? { accountsCreated: 0, projectsLinked: 0 };
    entry.accountsCreated += 1;
    entry.projectsLinked += 1;
    byFirm.set(firmId, entry);
    totalAccounts += 1;
    totalLinked += 1;
  }

  const firms = Array.from(byFirm.entries()).map(([firmId, v]) => ({ firmId, ...v }));
  return {
    firms,
    totalAccountsCreated: totalAccounts,
    totalProjectsLinked: totalLinked,
  };
}

/**
 * Public entrypoint — runs both initAccountSchema + backfillAccounts
 * exactly once per process. Called from initDb() after the Customer
 * table is in place.
 */
export async function runAccountMigrationOnce(): Promise<void> {
  await initAccountSchema();
  if (_backfilled) return;
  _backfilled = true;
  const result = await backfillAccounts();
  if (result.totalAccountsCreated > 0) {
    for (const f of result.firms) {
      // eslint-disable-next-line no-console
      console.log(
        `[56.1 backfill] firm=${f.firmId} accounts-created=${f.accountsCreated} projects-linked=${f.projectsLinked}`,
      );
    }
  }
}

/**
 * Test hook — reset the once-flags so a test that resets the DB
 * between cases can re-run the migration.
 */
export function _testOnlyResetAccountMigrationFlags(): void {
  _initialised = false;
  _backfilled = false;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

interface AccountRow {
  id: unknown;
  firmId: unknown;
  name: unknown;
  address: unknown;
  primaryContactName: unknown;
  primaryContactEmail: unknown;
  primaryContactPhone: unknown;
  archived: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

function parseAccount(raw: unknown): Account {
  const r = raw as AccountRow;
  return {
    id: String(r.id),
    firmId: String(r.firmId),
    name: String(r.name ?? ''),
    address: r.address == null ? null : String(r.address),
    primaryContactName: r.primaryContactName == null ? null : String(r.primaryContactName),
    primaryContactEmail: r.primaryContactEmail == null ? null : String(r.primaryContactEmail),
    primaryContactPhone: r.primaryContactPhone == null ? null : String(r.primaryContactPhone),
    archived: Number(r.archived ?? 0) === 1,
    createdAt: String(r.createdAt ?? ''),
    updatedAt: String(r.updatedAt ?? ''),
  };
}

export async function getAccount(id: string, firmId: string): Promise<Account | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, firmId, name, address, primaryContactName, primaryContactEmail,
                 primaryContactPhone, archived, createdAt, updatedAt
          FROM Account WHERE id = ? AND firmId = ? LIMIT 1`,
    args: [id, firmId],
  });
  if (r.rows.length === 0) return null;
  return parseAccount(r.rows[0]);
}

export async function listAccounts(
  firmId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Account[]> {
  const db = getDb();
  const args: Array<string | number> = [firmId];
  let where = 'firmId = ?';
  if (!options.includeArchived) {
    where += ' AND archived = 0';
  }
  const r = await db.execute({
    sql: `SELECT id, firmId, name, address, primaryContactName, primaryContactEmail,
                 primaryContactPhone, archived, createdAt, updatedAt
          FROM Account WHERE ${where}
          ORDER BY name ASC`,
    args,
  });
  return r.rows.map(parseAccount);
}

interface ProjectSummaryRow {
  id: unknown;
  accountId: unknown;
  projectName: unknown;
  projectKind: unknown;
  currentStage: unknown;
  health: unknown;
  isArchived: unknown;
  createdAt: unknown;
}

export async function listProjectsForAccount(accountId: string): Promise<ProjectSummary[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, accountId, projectName, projectKind, currentStage, health, isArchived, createdAt
          FROM Customer WHERE accountId = ?
          ORDER BY createdAt ASC`,
    args: [accountId],
  });
  return r.rows.map((raw) => {
    const p = raw as unknown as ProjectSummaryRow;
    return {
      id: String(p.id),
      accountId: String(p.accountId),
      projectName: String(p.projectName ?? ''),
      projectKind: (PROJECT_KINDS.includes(String(p.projectKind) as ProjectKind)
        ? (p.projectKind as ProjectKind)
        : 'INITIAL_IMPLEMENTATION') as ProjectKind,
      currentStage: String(p.currentStage ?? 'LEAD'),
      health: p.health == null ? null : Number(p.health),
      isArchived: Number(p.isArchived ?? 0) === 1,
      createdAt: String(p.createdAt ?? ''),
    };
  });
}

export interface CreateAccountArgs {
  firmId: string;
  name: string;
  address?: string | null;
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
  primaryContactPhone?: string | null;
}

export async function createAccount(args: CreateAccountArgs): Promise<Account> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Account
            (id, firmId, name, address, primaryContactName, primaryContactEmail,
             primaryContactPhone, archived, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    args: [
      id,
      args.firmId,
      args.name,
      args.address ?? null,
      args.primaryContactName ?? null,
      args.primaryContactEmail ?? null,
      args.primaryContactPhone ?? null,
      now,
      now,
    ],
  });
  const created = await getAccount(id, args.firmId);
  if (!created) throw new Error('createAccount: row not retrievable after insert');
  return created;
}

export interface CreateProjectArgs {
  accountId: string;
  firmId: string;
  projectName: string;
  projectKind?: ProjectKind;
  initialStage?: string;
  salesOwnerUserId?: string | null;
  projectLeadUserId?: string | null;
  csmUserId?: string | null;
  arOwnerUserId?: string | null;
}

/**
 * Creates a new Project (Customer row) under an existing Account.
 * Used by 56.2's "New Project" + "New Lead under existing account"
 * surfaces.
 */
export async function createProject(args: CreateProjectArgs): Promise<{ projectId: string }> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  // Resolve the project's display name from the linked Account when
  // the caller doesn't supply one — same shape the backfill uses.
  const acct = await getAccount(args.accountId, args.firmId);
  if (!acct) throw new Error(`createProject: account ${args.accountId} not found in firm`);
  await db.execute({
    sql: `INSERT INTO Customer
            (id, firmId, name, currentStage, salesOwnerUserId, projectLeadUserId,
             csmUserId, arOwnerUserId, renewalCount, isArchived, createdAt, updatedAt,
             accountId, projectName, projectKind)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
    args: [
      id,
      args.firmId,
      acct.name, // legacy `name` column still required NOT NULL
      args.initialStage ?? 'LEAD',
      args.salesOwnerUserId ?? null,
      args.projectLeadUserId ?? null,
      args.csmUserId ?? null,
      args.arOwnerUserId ?? null,
      now,
      now,
      args.accountId,
      args.projectName,
      args.projectKind ?? 'INITIAL_IMPLEMENTATION',
    ],
  });
  return { projectId: id };
}
