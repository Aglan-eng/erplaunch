/**
 * Database layer — uses @libsql/client (SQLite, no binary downloads).
 * Replaces Prisma for the local/dev run.
 */
import { createClient, type Client } from '@libsql/client';
import { createId } from '@paralleldrive/cuid2';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function generateSecureToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _client: Client | null = null;

export function getDb(): Client {
  if (!_client) throw new Error('DB not initialised — call initDb() first');
  return _client;
}

export async function initDb() {
  const dbFile = process.env.DATABASE_URL?.replace('file:', '') ?? path.join(__dirname, '../../dev.db');

  // Ensure the parent directory exists — when Render mounts a persistent disk
  // at /data, any directories baked into the image are overlaid, so we must
  // create them at runtime before libSQL tries to open the file.
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });

  _client = createClient({ url: `file:${dbFile}` });

  // WAL mode is faster but fails on cloud-synced folders (OneDrive/Dropbox).
  // Silently fall back to the default journal mode if WAL is unavailable.
  try {
    await _client.execute('PRAGMA journal_mode=WAL');
  } catch {
    // fall back to default (DELETE) journal mode — safe on all file systems
  }
  await _client.execute('PRAGMA foreign_keys=ON');

  await createTables(_client);
  return _client;
}

async function createTables(db: Client) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS Firm (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      plan      TEXT NOT NULL DEFAULT 'STARTER',
      slug      TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Firm branding (minimal slice for Phase 5.A; full settings UI in §6.8)
  try { await db.execute(`ALTER TABLE Firm ADD COLUMN displayName TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE Firm ADD COLUMN logoUrl TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE Firm ADD COLUMN primaryColor TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE Firm ADD COLUMN secondaryColor TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE Firm ADD COLUMN supportEmail TEXT`); } catch {}

  await db.execute(`
    CREATE TABLE IF NOT EXISTS User (
      id           TEXT PRIMARY KEY,
      firmId       TEXT NOT NULL REFERENCES Firm(id),
      email        TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'CONSULTANT',
      createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS Engagement (
      id              TEXT PRIMARY KEY,
      firmId          TEXT NOT NULL REFERENCES Firm(id),
      clientName      TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'DISCOVERY',
      startDate       TEXT,
      contractEndDate TEXT,
      createdAt       TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migrate existing Engagement rows — add columns if missing
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN startDate TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN contractEndDate TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN portalSettings TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN verticalType TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN parentEngagementId TEXT REFERENCES Engagement(id)`); } catch {}
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN verticalSettings TEXT`); } catch {}

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ProjectMember (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id),
      name         TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'Stakeholder',
      team         TEXT NOT NULL DEFAULT 'CLIENT',
      email        TEXT,
      phone        TEXT,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Migrate existing rows — add team column if missing
  try { await db.execute(`ALTER TABLE ProjectMember ADD COLUMN team TEXT NOT NULL DEFAULT 'CLIENT'`); } catch {}
  // Add inviteToken for per-member portal auth
  try { await db.execute(`ALTER TABLE ProjectMember ADD COLUMN inviteToken TEXT`); } catch {}
  // Fix legacy 'OFOQ' team value → 'CONSULTANT'
  await db.execute(`UPDATE ProjectMember SET team = 'CONSULTANT' WHERE team = 'OFOQ'`);

  // ─── Portal Todos ──────────────────────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS PortalTodo (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      description  TEXT,
      dueDate      TEXT,
      assignedTo   TEXT,
      priority     TEXT NOT NULL DEFAULT 'MEDIUM',
      completedAt  TEXT,
      completedBy  TEXT,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS RiskItem (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      description  TEXT,
      probability  TEXT NOT NULL DEFAULT 'MEDIUM',
      impact       TEXT NOT NULL DEFAULT 'MEDIUM',
      status       TEXT NOT NULL DEFAULT 'OPEN',
      owner        TEXT,
      mitigation   TEXT,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS IssueItem (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      description  TEXT,
      priority     TEXT NOT NULL DEFAULT 'MEDIUM',
      status       TEXT NOT NULL DEFAULT 'OPEN',
      owner        TEXT,
      resolution   TEXT,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS DecisionItem (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      description  TEXT,
      decidedBy    TEXT,
      decidedAt    TEXT,
      rationale    TEXT,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS MeetingNote (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      meetingDate  TEXT NOT NULL,
      attendees    TEXT NOT NULL DEFAULT '[]',
      notes        TEXT,
      actionItems  TEXT NOT NULL DEFAULT '[]',
      createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS MigrationItem (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      objectName   TEXT NOT NULL,
      source       TEXT,
      recordCount  INTEGER,
      owner        TEXT,
      status       TEXT NOT NULL DEFAULT 'NOT_STARTED',
      notes        TEXT,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ActivityLog (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      firmId       TEXT NOT NULL,
      action       TEXT NOT NULL,
      details      TEXT,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ClientPortalToken (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      token        TEXT NOT NULL UNIQUE,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS BusinessProfile (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL UNIQUE REFERENCES Engagement(id),
      version      INTEGER NOT NULL DEFAULT 1,
      answers      TEXT NOT NULL DEFAULT '{}',
      completeness TEXT NOT NULL DEFAULT '{}',
      updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS LicenseProfile (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL UNIQUE REFERENCES Engagement(id),
      edition      TEXT NOT NULL DEFAULT 'MID_MARKET',
      modules      TEXT NOT NULL DEFAULT '[]',
      updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS Phase (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id),
      name         TEXT NOT NULL,
      "order"      INTEGER NOT NULL,
      flows        TEXT NOT NULL DEFAULT '[]',
      trigger      TEXT NOT NULL DEFAULT 'REQUIREMENT',
      targetDate   TEXT,
      status       TEXT NOT NULL DEFAULT 'PLANNED'
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ConflictLog (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id),
      ruleId       TEXT NOT NULL,
      type         TEXT NOT NULL,
      severity     TEXT NOT NULL,
      questionIds  TEXT NOT NULL DEFAULT '[]',
      message      TEXT NOT NULL,
      resolution   TEXT NOT NULL,
      resolvedAt   TEXT,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS GenerationJob (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id),
      type         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'QUEUED',
      outputUrl    TEXT,
      error        TEXT,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt  TEXT
    )
  `);

  // ── New tables for comments, images, AI advice ───────────────────────────

  await db.execute(`
    CREATE TABLE IF NOT EXISTS SectionComment (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id),
      sectionKey   TEXT NOT NULL,
      text         TEXT NOT NULL DEFAULT '',
      updatedAt    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(engagementId, sectionKey)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS SectionImage (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id),
      sectionKey   TEXT NOT NULL,
      filename     TEXT NOT NULL,
      originalName TEXT NOT NULL,
      mimeType     TEXT NOT NULL,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS AIAdvice (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id),
      sectionKey   TEXT NOT NULL,
      advice       TEXT NOT NULL DEFAULT '{}',
      answersHash  TEXT NOT NULL DEFAULT '',
      createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(engagementId, sectionKey)
    )
  `);

  // ── Data Collection ─────────────────────────────────────────────────────────

  // AI-generated template schemas scoped to an engagement
  await db.execute(`
    CREATE TABLE IF NOT EXISTS DataTemplateSchema (
      id              TEXT PRIMARY KEY,
      engagementId    TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      templateId      TEXT NOT NULL,
      name            TEXT NOT NULL,
      category        TEXT NOT NULL,
      description     TEXT,
      sheetName       TEXT NOT NULL,
      fields          TEXT NOT NULL DEFAULT '[]',
      validationRules TEXT NOT NULL DEFAULT '[]',
      generatedBy     TEXT NOT NULL DEFAULT 'AI',
      createdAt       TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Per-engagement data collection checklist items
  await db.execute(`
    CREATE TABLE IF NOT EXISTS DataCollectionItem (
      id              TEXT PRIMARY KEY,
      engagementId    TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      templateSchemaId TEXT REFERENCES DataTemplateSchema(id) ON DELETE SET NULL,
      templateId      TEXT NOT NULL,
      name            TEXT NOT NULL,
      category        TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'NOT_STARTED',
      assignedTo      TEXT,
      dueDate         TEXT,
      sentAt          TEXT,
      receivedAt      TEXT,
      validatedAt     TEXT,
      uploadedAt      TEXT,
      notes           TEXT,
      createdAt       TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Files uploaded against a data collection item
  await db.execute(`
    CREATE TABLE IF NOT EXISTS DataFile (
      id                   TEXT PRIMARY KEY,
      engagementId         TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      dataCollectionItemId TEXT NOT NULL REFERENCES DataCollectionItem(id) ON DELETE CASCADE,
      filename             TEXT NOT NULL,
      originalName         TEXT NOT NULL,
      mimeType             TEXT NOT NULL,
      sizeBytes            INTEGER NOT NULL DEFAULT 0,
      uploadedBy           TEXT,
      validationStatus     TEXT NOT NULL DEFAULT 'PENDING',
      validationResult     TEXT,
      rowCount             INTEGER,
      errorCount           INTEGER,
      warningCount         INTEGER,
      createdAt            TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // ── Indexes ──────────────────────────────────────────────────────────────────
  // Using IF NOT EXISTS so safe to run on every startup.

  // User lookups by firm
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_user_firmId ON User(firmId)`);

  // Engagement lookups by firm + ordering
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_engagement_firmId ON Engagement(firmId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_engagement_createdAt ON Engagement(createdAt)`);

  // ProjectMember by engagement
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_projectmember_engagementId ON ProjectMember(engagementId)`);

  // PortalTodo by engagement
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_portaltodo_engagementId ON PortalTodo(engagementId)`);

  // RAID items by engagement
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_riskitem_engagementId ON RiskItem(engagementId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_issueitem_engagementId ON IssueItem(engagementId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_decisionitem_engagementId ON DecisionItem(engagementId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_meetingnote_engagementId ON MeetingNote(engagementId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_migrationitem_engagementId ON MigrationItem(engagementId)`);

  // Activity log by engagement + chronological ordering
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_activitylog_engagementId ON ActivityLog(engagementId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_activitylog_createdAt ON ActivityLog(createdAt)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_activitylog_firmId ON ActivityLog(firmId)`);

  // Portal token lookup
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_clientportaltoken_engagementId ON ClientPortalToken(engagementId)`);

  // Phases by engagement + ordering
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_phase_engagementId ON Phase(engagementId)`);

  // Conflicts by engagement (frequently queried)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_conflictlog_engagementId ON ConflictLog(engagementId)`);

  // Generation jobs by engagement + status
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_generationjob_engagementId ON GenerationJob(engagementId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_generationjob_status ON GenerationJob(status)`);

  // Section comments & images by engagement + section
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sectioncomment_engagementId ON SectionComment(engagementId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sectionimage_engagementId ON SectionImage(engagementId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sectionimage_sectionKey ON SectionImage(engagementId, sectionKey)`);

  // AI Advice by engagement
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_aiadvice_engagementId ON AIAdvice(engagementId)`);

  // Data collection
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_datatemplateschema_engagementId ON DataTemplateSchema(engagementId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_datacollectionitem_engagementId ON DataCollectionItem(engagementId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_datafile_engagementId ON DataFile(engagementId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_datafile_collectionItemId ON DataFile(dataCollectionItemId)`);

  // ─── Portal Sessions (Phase 5.A magic-link auth) ───────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS PortalSession (
      id           TEXT PRIMARY KEY,
      engagementId TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      memberId     TEXT NOT NULL REFERENCES ProjectMember(id) ON DELETE CASCADE,
      jtiHash      TEXT NOT NULL UNIQUE,
      issuedAt     TEXT NOT NULL DEFAULT (datetime('now')),
      lastUsedAt   TEXT NOT NULL DEFAULT (datetime('now')),
      expiresAt    TEXT NOT NULL,
      revokedAt    TEXT,
      userAgent    TEXT,
      ipHash       TEXT,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_portalsession_engagement ON PortalSession(engagementId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_portalsession_member     ON PortalSession(memberId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_portalsession_jti        ON PortalSession(jtiHash)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_portalsession_expires    ON PortalSession(expiresAt)`);

  // ─── Firm Email Settings (Phase 5.A-2 per-firm SMTP/IMAP/POP3) ─────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS FirmEmailSettings (
      firmId                TEXT PRIMARY KEY REFERENCES Firm(id) ON DELETE CASCADE,
      fromEmail             TEXT NOT NULL,
      fromName              TEXT,
      smtpHost              TEXT NOT NULL,
      smtpPort              INTEGER NOT NULL,
      smtpSecure            INTEGER NOT NULL DEFAULT 1,
      smtpUsername          TEXT NOT NULL,
      smtpPasswordCipher    TEXT NOT NULL,
      inboundProtocol       TEXT NOT NULL DEFAULT 'IMAP',
      inboundHost           TEXT,
      inboundPort           INTEGER,
      inboundSecure         INTEGER,
      inboundUsername       TEXT,
      inboundPasswordCipher TEXT,
      inboundFolder         TEXT,
      testedAt              TEXT,
      lastTestResult        TEXT,
      createdAt             TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt             TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ─── Portal Magic Link (Phase 5.A-2 OTP lifecycle) ─────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS PortalMagicLink (
      id            TEXT PRIMARY KEY,
      engagementId  TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      memberId      TEXT NOT NULL REFERENCES ProjectMember(id) ON DELETE CASCADE,
      codeHash      TEXT NOT NULL,
      expiresAt     TEXT NOT NULL,
      attemptCount  INTEGER NOT NULL DEFAULT 0,
      maxAttempts   INTEGER NOT NULL DEFAULT 5,
      consumedAt    TEXT,
      ipHash        TEXT,
      createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_portalmagiclink_member  ON PortalMagicLink(memberId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_portalmagiclink_expires ON PortalMagicLink(expiresAt)`);
}

// ─── Helper types ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function parseRow<T>(row: Row): T {
  const result: Row = {};
  for (const [k, v] of Object.entries(row)) {
    // Parse JSON fields
    if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
      try { result[k] = JSON.parse(v); continue; } catch { /**/ }
    }
    result[k] = v;
  }
  return result as T;
}

// ─── Firm ─────────────────────────────────────────────────────────────────────

export async function createFirm(data: { name: string; slug: string; plan?: string }) {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan) VALUES (?, ?, ?, ?)`,
    args: [id, data.name, data.slug, data.plan ?? 'STARTER'],
  });
  return findFirmById(id);
}

export async function findFirmById(id: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM Firm WHERE id = ?`, args: [id] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

export async function findFirmBySlug(slug: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM Firm WHERE slug = ?`, args: [slug] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export async function createUser(data: {
  firmId: string; email: string; name: string; passwordHash: string; role?: string;
}) {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
    args: [id, data.firmId, data.email, data.name, data.passwordHash, data.role ?? 'CONSULTANT'],
  });
  return findUserById(id);
}

export async function resetUserPassword(email: string, passwordHash: string) {
  const db = getDb();
  await db.execute({ sql: `UPDATE User SET passwordHash = ? WHERE email = ?`, args: [passwordHash, email] });
}

export async function findUserByEmail(email: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM User WHERE email = ?`, args: [email] });
  if (!r.rows[0]) return null;
  const user = parseRow<Row>(r.rows[0] as Row);
  const firm = await findFirmById(user.firmId as string);
  return { ...user, firm };
}

export async function findUserById(id: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM User WHERE id = ?`, args: [id] });
  if (!r.rows[0]) return null;
  const user = parseRow<Row>(r.rows[0] as Row);
  const firm = await findFirmById(user.firmId as string);
  return { ...user, firm };
}

// ─── Engagement ───────────────────────────────────────────────────────────────

export async function createEngagement(data: { firmId: string; clientName: string }) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, updatedAt) VALUES (?,?,?,?)`,
    args: [id, data.firmId, data.clientName, now],
  });
  // Create empty profile and license
  await db.execute({
    sql: `INSERT INTO BusinessProfile (id, engagementId, answers, completeness, updatedAt) VALUES (?,?,?,?,?)`,
    args: [createId(), id, '{}', '{}', now],
  });
  await db.execute({
    sql: `INSERT INTO LicenseProfile (id, engagementId, updatedAt) VALUES (?,?,?)`,
    args: [createId(), id, now],
  });
  return findEngagementById(id);
}

export async function listEngagements(firmId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM Engagement WHERE firmId = ? ORDER BY updatedAt DESC`, args: [firmId] });
  return Promise.all((r.rows as Row[]).map(async (row) => {
    const eng = parseRow<Row>(row);
    return enrichEngagement(eng, { includeProfile: true, includeLicense: true, includeConflicts: true, includeJobs: true, includeMembers: true });
  }));
}

export async function findEngagementById(id: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM Engagement WHERE id = ?`, args: [id] });
  if (!r.rows[0]) return null;
  const eng = parseRow<Row>(r.rows[0] as Row);
  return enrichEngagement(eng, { includeProfile: true, includeLicense: true, includeConflicts: true, includeJobs: true, includeMembers: true });
}

export async function findEngagementByIdAndFirmId(id: string, firmId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM Engagement WHERE id = ? AND firmId = ?`, args: [id, firmId] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

// db-reload
export async function deleteEngagement(id: string) {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM Engagement WHERE id = ?`, args: [id] });
}

export async function updateEngagement(id: string, data: Partial<{ clientName: string; status: string; startDate: string | null; contractEndDate: string | null }>) {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (data.clientName !== undefined) { sets.push('clientName = ?'); args.push(data.clientName); }
  if (data.status !== undefined) { sets.push('status = ?'); args.push(data.status); }
  if (data.startDate !== undefined) { sets.push('startDate = ?'); args.push(data.startDate); }
  if (data.contractEndDate !== undefined) { sets.push('contractEndDate = ?'); args.push(data.contractEndDate); }
  sets.push("updatedAt = ?"); args.push(new Date().toISOString());
  args.push(id);
  await db.execute({ sql: `UPDATE Engagement SET ${sets.join(', ')} WHERE id = ?`, args: args as (string | number | boolean | null)[] });
  return findEngagementById(id);
}

// ─── ProjectMembers ───────────────────────────────────────────────────────────

export async function getMembers(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM ProjectMember WHERE engagementId = ? ORDER BY createdAt ASC`, args: [engagementId] });
  return (r.rows as Row[]).map((row) => parseRow<Row>(row));
}

export async function addMember(engagementId: string, data: { name: string; role: string; team?: string; email?: string; phone?: string }) {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, phone) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, engagementId, data.name, data.role, data.team ?? 'CLIENT', data.email ?? null, data.phone ?? null],
  });
  const r = await db.execute({ sql: `SELECT * FROM ProjectMember WHERE id = ?`, args: [id] });
  return parseRow<Row>(r.rows[0] as Row);
}

export async function updateMember(id: string, engagementId: string, data: {
  name?: string; role?: string; team?: string; email?: string | null; phone?: string | null;
}) {
  const db = getDb();
  const fields: string[] = [];
  const args: unknown[] = [];
  if (data.name  !== undefined) { fields.push('name = ?');  args.push(data.name); }
  if (data.role  !== undefined) { fields.push('role = ?');  args.push(data.role); }
  if (data.team  !== undefined) { fields.push('team = ?');  args.push(data.team); }
  if (data.email !== undefined) { fields.push('email = ?'); args.push(data.email); }
  if (data.phone !== undefined) { fields.push('phone = ?'); args.push(data.phone); }
  if (fields.length === 0) return;
  args.push(id, engagementId);
  await db.execute({
    sql: `UPDATE ProjectMember SET ${fields.join(', ')} WHERE id = ? AND engagementId = ?`,
    args,
  });
  const r = await db.execute({ sql: `SELECT * FROM ProjectMember WHERE id = ?`, args: [id] });
  return parseRow<Row>(r.rows[0] as Row);
}

export async function deleteMember(id: string, engagementId: string) {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM ProjectMember WHERE id = ? AND engagementId = ?`, args: [id, engagementId] });
}

async function enrichEngagement(
  eng: Row,
  opts: { includeProfile?: boolean; includeLicense?: boolean; includeConflicts?: boolean; includeJobs?: boolean; includeMembers?: boolean }
) {
  const db = getDb();
  const result: Row = { ...eng };

  if (opts.includeProfile) {
    const r = await db.execute({ sql: `SELECT * FROM BusinessProfile WHERE engagementId = ?`, args: [eng.id as string] });
    result.profile = r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
  }
  if (opts.includeLicense) {
    const r = await db.execute({ sql: `SELECT * FROM LicenseProfile WHERE engagementId = ?`, args: [eng.id as string] });
    if (r.rows[0]) {
      const lic = parseRow<Row>(r.rows[0] as Row);
      if (typeof lic.modules === 'string') lic.modules = JSON.parse(lic.modules as string);
      result.license = lic;
    } else result.license = null;
  }
  if (opts.includeConflicts) {
    const r = await db.execute({ sql: `SELECT * FROM ConflictLog WHERE engagementId = ?`, args: [eng.id as string] });
    result.conflicts = (r.rows as Row[]).map((row) => {
      const c = parseRow<Row>(row);
      if (typeof c.questionIds === 'string') c.questionIds = JSON.parse(c.questionIds as string);
      return c;
    });
  }
  if (opts.includeJobs) {
    const r = await db.execute({ sql: `SELECT * FROM GenerationJob WHERE engagementId = ? ORDER BY createdAt DESC LIMIT 1`, args: [eng.id as string] });
    result.jobs = r.rows.length > 0 ? [(parseRow<Row>(r.rows[0] as Row))] : [];
  }
  if (opts.includeMembers) {
    const r = await db.execute({ sql: `SELECT * FROM ProjectMember WHERE engagementId = ? ORDER BY createdAt ASC`, args: [eng.id as string] });
    result.members = (r.rows as Row[]).map((row) => parseRow<Row>(row));
  }

  return result;
}

// ─── BusinessProfile ──────────────────────────────────────────────────────────

export async function getProfile(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM BusinessProfile WHERE engagementId = ?`, args: [engagementId] });
  if (!r.rows[0]) return null;
  const profile = parseRow<Row>(r.rows[0] as Row);
  if (typeof profile.answers === 'string') profile.answers = JSON.parse(profile.answers as string);
  if (typeof profile.completeness === 'string') profile.completeness = JSON.parse(profile.completeness as string);
  return profile;
}

export async function upsertProfile(engagementId: string, mergedAnswers: Record<string, unknown>) {
  const db = getDb();
  const now = new Date().toISOString();
  const r = await db.execute({ sql: `SELECT id FROM BusinessProfile WHERE engagementId = ?`, args: [engagementId] });

  if (r.rows[0]) {
    await db.execute({
      sql: `UPDATE BusinessProfile SET answers = ?, version = version + 1, updatedAt = ? WHERE engagementId = ?`,
      args: [JSON.stringify(mergedAnswers), now, engagementId],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO BusinessProfile (id, engagementId, answers, completeness, updatedAt) VALUES (?,?,?,?,?)`,
      args: [createId(), engagementId, JSON.stringify(mergedAnswers), '{}', now],
    });
  }
  // Update engagement updatedAt
  await db.execute({ sql: `UPDATE Engagement SET updatedAt = ? WHERE id = ?`, args: [now, engagementId] });
  return getProfile(engagementId);
}

// ─── LicenseProfile ───────────────────────────────────────────────────────────

export async function getLicense(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM LicenseProfile WHERE engagementId = ?`, args: [engagementId] });
  if (!r.rows[0]) return null;
  const lic = parseRow<Row>(r.rows[0] as Row);
  if (typeof lic.modules === 'string') lic.modules = JSON.parse(lic.modules as string);
  return lic;
}

export async function upsertLicense(engagementId: string, data: { edition: string; modules: string[] }) {
  const db = getDb();
  const now = new Date().toISOString();
  const r = await db.execute({ sql: `SELECT id FROM LicenseProfile WHERE engagementId = ?`, args: [engagementId] });
  const modulesJson = JSON.stringify(data.modules);

  if (r.rows[0]) {
    await db.execute({
      sql: `UPDATE LicenseProfile SET edition = ?, modules = ?, updatedAt = ? WHERE engagementId = ?`,
      args: [data.edition, modulesJson, now, engagementId],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO LicenseProfile (id, engagementId, edition, modules, updatedAt) VALUES (?,?,?,?,?)`,
      args: [createId(), engagementId, data.edition, modulesJson, now],
    });
  }
  return getLicense(engagementId);
}

// ─── ConflictLog ──────────────────────────────────────────────────────────────

export async function replaceConflicts(
  engagementId: string,
  conflicts: Array<{ ruleId: string; type: string; severity: string; questionIds: string[]; message: string; resolution: string }>
) {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM ConflictLog WHERE engagementId = ?`, args: [engagementId] });
  for (const c of conflicts) {
    await db.execute({
      sql: `INSERT INTO ConflictLog (id, engagementId, ruleId, type, severity, questionIds, message, resolution) VALUES (?,?,?,?,?,?,?,?)`,
      args: [createId(), engagementId, c.ruleId, c.type, c.severity, JSON.stringify(c.questionIds), c.message, c.resolution],
    });
  }
}

export async function getConflicts(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM ConflictLog WHERE engagementId = ?`, args: [engagementId] });
  return (r.rows as Row[]).map((row) => {
    const c = parseRow<Row>(row);
    if (typeof c.questionIds === 'string') c.questionIds = JSON.parse(c.questionIds as string);
    return c;
  });
}

// ─── Phase ────────────────────────────────────────────────────────────────────

export async function getPhases(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM Phase WHERE engagementId = ? ORDER BY "order" ASC`, args: [engagementId] });
  return (r.rows as Row[]).map((row) => {
    const p = parseRow<Row>(row);
    if (typeof p.flows === 'string') p.flows = JSON.parse(p.flows as string);
    return p;
  });
}

export async function replacePhases(
  engagementId: string,
  phases: Array<{ name: string; order: number; flows: string[]; trigger?: string; status?: string; targetDate?: string }>
) {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM Phase WHERE engagementId = ?`, args: [engagementId] });
  for (const p of phases) {
    await db.execute({
      sql: `INSERT INTO Phase (id, engagementId, name, "order", flows, trigger, status, targetDate) VALUES (?,?,?,?,?,?,?,?)`,
      args: [createId(), engagementId, p.name, p.order, JSON.stringify(p.flows), p.trigger ?? 'REQUIREMENT', p.status ?? 'PLANNED', p.targetDate ?? null],
    });
  }
  return getPhases(engagementId);
}

// ─── GenerationJob ────────────────────────────────────────────────────────────

export async function createJob(engagementId: string, type: string) {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO GenerationJob (id, engagementId, type) VALUES (?,?,?)`,
    args: [id, engagementId, type],
  });
  return findJobById(id);
}

export async function findJobById(id: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM GenerationJob WHERE id = ?`, args: [id] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

export async function findJobByIdAndEngagementId(id: string, engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM GenerationJob WHERE id = ? AND engagementId = ?`, args: [id, engagementId] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

export async function listJobs(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM GenerationJob WHERE engagementId = ? ORDER BY createdAt DESC`, args: [engagementId] });
  return (r.rows as Row[]).map((row) => parseRow<Row>(row));
}

export async function updateJob(id: string, data: Partial<{ status: string; outputUrl: string; error: string; completedAt: string }>) {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (data.status !== undefined) { sets.push('status = ?'); args.push(data.status); }
  if (data.outputUrl !== undefined) { sets.push('outputUrl = ?'); args.push(data.outputUrl); }
  if (data.error !== undefined) { sets.push('error = ?'); args.push(data.error); }
  if (data.completedAt !== undefined) { sets.push('completedAt = ?'); args.push(data.completedAt); }
  args.push(id);
  await db.execute({ sql: `UPDATE GenerationJob SET ${sets.join(', ')} WHERE id = ?`, args: args as (string | number | boolean | null)[] });
  return findJobById(id);
}

// ─── SectionComment ───────────────────────────────────────────────────────────

export async function getSectionComments(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM SectionComment WHERE engagementId = ? ORDER BY sectionKey`, args: [engagementId] });
  return (r.rows as Row[]).map((row) => parseRow<Row>(row));
}

export async function getSectionComment(engagementId: string, sectionKey: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM SectionComment WHERE engagementId = ? AND sectionKey = ?`, args: [engagementId, sectionKey] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

export async function upsertSectionComment(engagementId: string, sectionKey: string, text: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = await db.execute({ sql: `SELECT id FROM SectionComment WHERE engagementId = ? AND sectionKey = ?`, args: [engagementId, sectionKey] });
  if (existing.rows[0]) {
    await db.execute({
      sql: `UPDATE SectionComment SET text = ?, updatedAt = ? WHERE engagementId = ? AND sectionKey = ?`,
      args: [text, now, engagementId, sectionKey],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO SectionComment (id, engagementId, sectionKey, text, updatedAt) VALUES (?,?,?,?,?)`,
      args: [createId(), engagementId, sectionKey, text, now],
    });
  }
  return getSectionComment(engagementId, sectionKey);
}

// ─── SectionImage ─────────────────────────────────────────────────────────────

export async function getSectionImages(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM SectionImage WHERE engagementId = ? ORDER BY createdAt`, args: [engagementId] });
  return (r.rows as Row[]).map((row) => parseRow<Row>(row));
}

export async function getSectionImagesBySection(engagementId: string, sectionKey: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM SectionImage WHERE engagementId = ? AND sectionKey = ? ORDER BY createdAt`, args: [engagementId, sectionKey] });
  return (r.rows as Row[]).map((row) => parseRow<Row>(row));
}

export async function addSectionImage(engagementId: string, sectionKey: string, filename: string, originalName: string, mimeType: string) {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO SectionImage (id, engagementId, sectionKey, filename, originalName, mimeType) VALUES (?,?,?,?,?,?)`,
    args: [id, engagementId, sectionKey, filename, originalName, mimeType],
  });
  const r = await db.execute({ sql: `SELECT * FROM SectionImage WHERE id = ?`, args: [id] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

export async function deleteSectionImage(imageId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM SectionImage WHERE id = ?`, args: [imageId] });
  const image = r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
  await db.execute({ sql: `DELETE FROM SectionImage WHERE id = ?`, args: [imageId] });
  return image;
}

// ─── AIAdvice ─────────────────────────────────────────────────────────────────

export async function getAIAdvice(engagementId: string, sectionKey: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM AIAdvice WHERE engagementId = ? AND sectionKey = ?`, args: [engagementId, sectionKey] });
  if (!r.rows[0]) return null;
  const row = parseRow<Row>(r.rows[0] as Row);
  if (typeof row.advice === 'string') row.advice = JSON.parse(row.advice as string);
  return row;
}

export async function getAllAIAdvice(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM AIAdvice WHERE engagementId = ? ORDER BY sectionKey`, args: [engagementId] });
  return (r.rows as Row[]).map((row) => {
    const parsed = parseRow<Row>(row);
    if (typeof parsed.advice === 'string') parsed.advice = JSON.parse(parsed.advice as string);
    return parsed;
  });
}

export async function upsertAIAdvice(engagementId: string, sectionKey: string, advice: unknown, answersHash: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const adviceJson = JSON.stringify(advice);
  const existing = await db.execute({ sql: `SELECT id FROM AIAdvice WHERE engagementId = ? AND sectionKey = ?`, args: [engagementId, sectionKey] });
  if (existing.rows[0]) {
    await db.execute({
      sql: `UPDATE AIAdvice SET advice = ?, answersHash = ?, createdAt = ? WHERE engagementId = ? AND sectionKey = ?`,
      args: [adviceJson, answersHash, now, engagementId, sectionKey],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO AIAdvice (id, engagementId, sectionKey, advice, answersHash, createdAt) VALUES (?,?,?,?,?,?)`,
      args: [createId(), engagementId, sectionKey, adviceJson, answersHash, now],
    });
  }
  return getAIAdvice(engagementId, sectionKey);
}

// ─── Risk Register ────────────────────────────────────────────────────────────

export async function listRisks(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM RiskItem WHERE engagementId = ? ORDER BY createdAt DESC`, args: [engagementId] });
  return (r.rows as Row[]).map((row) => parseRow<Row>(row));
}

export async function createRisk(engagementId: string, data: { title: string; description?: string; probability?: string; impact?: string; owner?: string; mitigation?: string }) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO RiskItem (id, engagementId, title, description, probability, impact, owner, mitigation, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [id, engagementId, data.title, data.description ?? null, data.probability ?? 'MEDIUM', data.impact ?? 'MEDIUM', data.owner ?? null, data.mitigation ?? null, now, now],
  });
  const r = await db.execute({ sql: `SELECT * FROM RiskItem WHERE id = ?`, args: [id] });
  return parseRow<Row>(r.rows[0] as Row);
}

export async function updateRisk(id: string, data: Partial<{ title: string; description: string; probability: string; impact: string; status: string; owner: string; mitigation: string }>) {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (data.title !== undefined) { sets.push('title = ?'); args.push(data.title); }
  if (data.description !== undefined) { sets.push('description = ?'); args.push(data.description); }
  if (data.probability !== undefined) { sets.push('probability = ?'); args.push(data.probability); }
  if (data.impact !== undefined) { sets.push('impact = ?'); args.push(data.impact); }
  if (data.status !== undefined) { sets.push('status = ?'); args.push(data.status); }
  if (data.owner !== undefined) { sets.push('owner = ?'); args.push(data.owner); }
  if (data.mitigation !== undefined) { sets.push('mitigation = ?'); args.push(data.mitigation); }
  sets.push("updatedAt = datetime('now')");
  args.push(id);
  await db.execute({ sql: `UPDATE RiskItem SET ${sets.join(', ')} WHERE id = ?`, args: args as (string | number | boolean | null)[] });
  const r = await db.execute({ sql: `SELECT * FROM RiskItem WHERE id = ?`, args: [id] });
  return parseRow<Row>(r.rows[0] as Row);
}

export async function deleteRisk(id: string) {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM RiskItem WHERE id = ?`, args: [id] });
}

// ─── Issue Tracker ─────────────────────────────────────────────────────────────

export async function listIssues(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM IssueItem WHERE engagementId = ? ORDER BY createdAt DESC`, args: [engagementId] });
  return (r.rows as Row[]).map((row) => parseRow<Row>(row));
}

export async function createIssue(engagementId: string, data: { title: string; description?: string; priority?: string; owner?: string }) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO IssueItem (id, engagementId, title, description, priority, owner, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)`,
    args: [id, engagementId, data.title, data.description ?? null, data.priority ?? 'MEDIUM', data.owner ?? null, now, now],
  });
  const r = await db.execute({ sql: `SELECT * FROM IssueItem WHERE id = ?`, args: [id] });
  return parseRow<Row>(r.rows[0] as Row);
}

export async function updateIssue(id: string, data: Partial<{ title: string; description: string; priority: string; status: string; owner: string; resolution: string }>) {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (data.title !== undefined) { sets.push('title = ?'); args.push(data.title); }
  if (data.description !== undefined) { sets.push('description = ?'); args.push(data.description); }
  if (data.priority !== undefined) { sets.push('priority = ?'); args.push(data.priority); }
  if (data.status !== undefined) { sets.push('status = ?'); args.push(data.status); }
  if (data.owner !== undefined) { sets.push('owner = ?'); args.push(data.owner); }
  if (data.resolution !== undefined) { sets.push('resolution = ?'); args.push(data.resolution); }
  sets.push("updatedAt = datetime('now')");
  args.push(id);
  await db.execute({ sql: `UPDATE IssueItem SET ${sets.join(', ')} WHERE id = ?`, args: args as (string | number | boolean | null)[] });
  const r = await db.execute({ sql: `SELECT * FROM IssueItem WHERE id = ?`, args: [id] });
  return parseRow<Row>(r.rows[0] as Row);
}

export async function deleteIssue(id: string) {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM IssueItem WHERE id = ?`, args: [id] });
}

// ─── Decision Log ─────────────────────────────────────────────────────────────

export async function listDecisions(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM DecisionItem WHERE engagementId = ? ORDER BY createdAt DESC`, args: [engagementId] });
  return (r.rows as Row[]).map((row) => parseRow<Row>(row));
}

export async function createDecision(engagementId: string, data: { title: string; description?: string; decidedBy?: string; decidedAt?: string; rationale?: string }) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO DecisionItem (id, engagementId, title, description, decidedBy, decidedAt, rationale, createdAt) VALUES (?,?,?,?,?,?,?,?)`,
    args: [id, engagementId, data.title, data.description ?? null, data.decidedBy ?? null, data.decidedAt ?? null, data.rationale ?? null, now],
  });
  const r = await db.execute({ sql: `SELECT * FROM DecisionItem WHERE id = ?`, args: [id] });
  return parseRow<Row>(r.rows[0] as Row);
}

export async function updateDecision(id: string, data: Partial<{ title: string; description: string; decidedBy: string; decidedAt: string; rationale: string }>) {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (data.title !== undefined) { sets.push('title = ?'); args.push(data.title); }
  if (data.description !== undefined) { sets.push('description = ?'); args.push(data.description); }
  if (data.decidedBy !== undefined) { sets.push('decidedBy = ?'); args.push(data.decidedBy); }
  if (data.decidedAt !== undefined) { sets.push('decidedAt = ?'); args.push(data.decidedAt); }
  if (data.rationale !== undefined) { sets.push('rationale = ?'); args.push(data.rationale); }
  args.push(id);
  await db.execute({ sql: `UPDATE DecisionItem SET ${sets.join(', ')} WHERE id = ?`, args: args as (string | number | boolean | null)[] });
  const r = await db.execute({ sql: `SELECT * FROM DecisionItem WHERE id = ?`, args: [id] });
  return parseRow<Row>(r.rows[0] as Row);
}

export async function deleteDecision(id: string) {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM DecisionItem WHERE id = ?`, args: [id] });
}

// ─── Meeting Notes ────────────────────────────────────────────────────────────

export async function listMeetings(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM MeetingNote WHERE engagementId = ? ORDER BY meetingDate DESC`, args: [engagementId] });
  return (r.rows as Row[]).map((row) => {
    const parsed = parseRow<Row>(row);
    if (typeof parsed.attendees === 'string') parsed.attendees = JSON.parse(parsed.attendees as string);
    if (typeof parsed.actionItems === 'string') parsed.actionItems = JSON.parse(parsed.actionItems as string);
    return parsed;
  });
}

export async function createMeeting(engagementId: string, data: { title: string; meetingDate: string; attendees?: string[]; notes?: string; actionItems?: Array<{text: string; owner?: string; done?: boolean}> }) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO MeetingNote (id, engagementId, title, meetingDate, attendees, notes, actionItems, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [id, engagementId, data.title, data.meetingDate, JSON.stringify(data.attendees ?? []), data.notes ?? null, JSON.stringify(data.actionItems ?? []), now, now],
  });
  const r = await db.execute({ sql: `SELECT * FROM MeetingNote WHERE id = ?`, args: [id] });
  const parsed = parseRow<Row>(r.rows[0] as Row);
  if (typeof parsed.attendees === 'string') parsed.attendees = JSON.parse(parsed.attendees as string);
  if (typeof parsed.actionItems === 'string') parsed.actionItems = JSON.parse(parsed.actionItems as string);
  return parsed;
}

export async function updateMeeting(id: string, data: Partial<{ title: string; meetingDate: string; attendees: string[]; notes: string; actionItems: Array<{text: string; owner?: string; done?: boolean}> }>) {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (data.title !== undefined) { sets.push('title = ?'); args.push(data.title); }
  if (data.meetingDate !== undefined) { sets.push('meetingDate = ?'); args.push(data.meetingDate); }
  if (data.attendees !== undefined) { sets.push('attendees = ?'); args.push(JSON.stringify(data.attendees)); }
  if (data.notes !== undefined) { sets.push('notes = ?'); args.push(data.notes); }
  if (data.actionItems !== undefined) { sets.push('actionItems = ?'); args.push(JSON.stringify(data.actionItems)); }
  sets.push("updatedAt = datetime('now')");
  args.push(id);
  await db.execute({ sql: `UPDATE MeetingNote SET ${sets.join(', ')} WHERE id = ?`, args: args as (string | number | boolean | null)[] });
  const r = await db.execute({ sql: `SELECT * FROM MeetingNote WHERE id = ?`, args: [id] });
  const parsed = parseRow<Row>(r.rows[0] as Row);
  if (typeof parsed.attendees === 'string') parsed.attendees = JSON.parse(parsed.attendees as string);
  if (typeof parsed.actionItems === 'string') parsed.actionItems = JSON.parse(parsed.actionItems as string);
  return parsed;
}

export async function deleteMeeting(id: string) {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM MeetingNote WHERE id = ?`, args: [id] });
}

// ─── Migration Tracker ────────────────────────────────────────────────────────

export async function listMigrationItems(engagementId: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM MigrationItem WHERE engagementId = ? ORDER BY createdAt DESC`, args: [engagementId] });
  return (r.rows as Row[]).map((row) => parseRow<Row>(row));
}

export async function createMigrationItem(engagementId: string, data: { objectName: string; source?: string; recordCount?: number; owner?: string; notes?: string }) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO MigrationItem (id, engagementId, objectName, source, recordCount, owner, notes, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [id, engagementId, data.objectName, data.source ?? null, data.recordCount ?? null, data.owner ?? null, data.notes ?? null, now, now],
  });
  const r = await db.execute({ sql: `SELECT * FROM MigrationItem WHERE id = ?`, args: [id] });
  return parseRow<Row>(r.rows[0] as Row);
}

export async function updateMigrationItem(id: string, data: Partial<{ objectName: string; source: string; recordCount: number; owner: string; status: string; notes: string }>) {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (data.objectName !== undefined) { sets.push('objectName = ?'); args.push(data.objectName); }
  if (data.source !== undefined) { sets.push('source = ?'); args.push(data.source); }
  if (data.recordCount !== undefined) { sets.push('recordCount = ?'); args.push(data.recordCount); }
  if (data.owner !== undefined) { sets.push('owner = ?'); args.push(data.owner); }
  if (data.status !== undefined) { sets.push('status = ?'); args.push(data.status); }
  if (data.notes !== undefined) { sets.push('notes = ?'); args.push(data.notes); }
  sets.push("updatedAt = datetime('now')");
  args.push(id);
  await db.execute({ sql: `UPDATE MigrationItem SET ${sets.join(', ')} WHERE id = ?`, args: args as (string | number | boolean | null)[] });
  const r = await db.execute({ sql: `SELECT * FROM MigrationItem WHERE id = ?`, args: [id] });
  return parseRow<Row>(r.rows[0] as Row);
}

export async function deleteMigrationItem(id: string) {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM MigrationItem WHERE id = ?`, args: [id] });
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

export async function logActivity(engagementId: string, firmId: string, action: string, details?: string) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO ActivityLog (id, engagementId, firmId, action, details, createdAt) VALUES (?,?,?,?,?,?)`,
    args: [id, engagementId, firmId, action, details ?? null, now],
  });
  const r = await db.execute({ sql: `SELECT * FROM ActivityLog WHERE id = ?`, args: [id] });
  return parseRow<Row>(r.rows[0] as Row);
}

export async function listActivity(engagementId: string, limit: number = 50) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM ActivityLog WHERE engagementId = ? ORDER BY createdAt DESC LIMIT ?`, args: [engagementId, limit] });
  return (r.rows as Row[]).map((row) => parseRow<Row>(row));
}

// ─── Client Portal Token ──────────────────────────────────────────────────────

export async function upsertPortalToken(engagementId: string): Promise<string> {
  const db = getDb();
  const token = generateSecureToken();
  const id = createId();
  const now = new Date().toISOString();

  // Delete any existing token first
  await db.execute({ sql: `DELETE FROM ClientPortalToken WHERE engagementId = ?`, args: [engagementId] });

  // Insert new token
  await db.execute({
    sql: `INSERT INTO ClientPortalToken (id, engagementId, token, createdAt) VALUES (?,?,?,?)`,
    args: [id, engagementId, token, now],
  });

  return token;
}

export async function findEngagementByPortalToken(token: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT engagementId FROM ClientPortalToken WHERE token = ?`, args: [token] });
  if (!r.rows[0]) return null;

  const engagementId = (r.rows[0] as Row).engagementId as string;
  const r2 = await db.execute({ sql: `SELECT * FROM Engagement WHERE id = ?`, args: [engagementId] });
  if (!r2.rows[0]) return null;

  const eng = parseRow<Row>(r2.rows[0] as Row);
  return enrichEngagement(eng, { includeProfile: true, includeLicense: true, includeMembers: true });
}

// ─── Portal Settings ──────────────────────────────────────────────────────────

export interface PortalSettings {
  showStage: boolean;
  showTimeline: boolean;
  showClientTeam: boolean;
  showConsultantTeam: boolean;
  showRisks: boolean;
  showIssues: boolean;
  showDecisions: boolean;
  showDataCollection: boolean;
  showTodos: boolean;
  showMeetings: boolean;
  customMessage: string;
}

const DEFAULT_PORTAL_SETTINGS: PortalSettings = {
  showStage: true,
  showTimeline: true,
  showClientTeam: true,
  showConsultantTeam: true,
  showRisks: true,
  showIssues: true,
  showDecisions: false,
  showDataCollection: true,
  showTodos: true,
  showMeetings: false,
  customMessage: '',
};

// ─── Portal Member Invite Tokens ─────────────────────────────────────────────

export async function generateMemberInviteTokens(engagementId: string): Promise<number> {
  const db = getDb();
  // Get all CLIENT members with email addresses
  const r = await db.execute({
    sql: `SELECT id FROM ProjectMember WHERE engagementId = ? AND team = 'CLIENT' AND email IS NOT NULL AND email != ''`,
    args: [engagementId],
  });
  let count = 0;
  for (const row of r.rows) {
    const token = generateSecureToken();
    await db.execute({
      sql: `UPDATE ProjectMember SET inviteToken = ? WHERE id = ?`,
      args: [token, (row as Row).id],
    });
    count++;
  }
  return count;
}

export async function getClientMembersWithEmail(engagementId: string): Promise<Array<{ id: string; name: string; role: string; email: string; inviteToken: string | null }>> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, name, role, email, inviteToken FROM ProjectMember WHERE engagementId = ? AND team = 'CLIENT' AND email IS NOT NULL AND email != ''`,
    args: [engagementId],
  });
  return r.rows.map((row) => ({
    id: (row as Row).id as string,
    name: (row as Row).name as string,
    role: (row as Row).role as string,
    email: (row as Row).email as string,
    inviteToken: (row as Row).inviteToken as string | null,
  }));
}

export async function findMemberByInviteToken(inviteToken: string): Promise<{ id: string; name: string; role: string; email: string; engagementId: string } | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, name, role, email, engagementId FROM ProjectMember WHERE inviteToken = ?`,
    args: [inviteToken],
  });
  if (!r.rows[0]) return null;
  const row = r.rows[0] as Row;
  return {
    id: row.id as string,
    name: row.name as string,
    role: row.role as string,
    email: row.email as string,
    engagementId: row.engagementId as string,
  };
}

// ─── Portal Todos ─────────────────────────────────────────────────────────────

export interface PortalTodo {
  id: string;
  engagementId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  assignedTo: string | null;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  completedAt: string | null;
  completedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listPortalTodos(engagementId: string): Promise<PortalTodo[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM PortalTodo WHERE engagementId = ? ORDER BY priority DESC, createdAt ASC`,
    args: [engagementId],
  });
  return r.rows.map((row) => parseRow<PortalTodo>(row as Row));
}

export async function createPortalTodo(engagementId: string, data: {
  title: string; description?: string; dueDate?: string; assignedTo?: string; priority?: string;
}): Promise<PortalTodo> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO PortalTodo (id, engagementId, title, description, dueDate, assignedTo, priority, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [id, engagementId, data.title, data.description ?? null, data.dueDate ?? null,
           data.assignedTo ?? null, data.priority ?? 'MEDIUM', now, now],
  });
  const r = await db.execute({ sql: `SELECT * FROM PortalTodo WHERE id = ?`, args: [id] });
  return parseRow<PortalTodo>(r.rows[0] as Row);
}

export async function updatePortalTodo(todoId: string, engagementId: string, data: Partial<{
  title: string; description: string; dueDate: string; assignedTo: string; priority: string;
  completedAt: string | null; completedBy: string | null;
}>): Promise<PortalTodo | null> {
  const db = getDb();
  const now = new Date().toISOString();
  const fields: string[] = ['updatedAt = ?'];
  const args: unknown[] = [now];
  for (const [k, v] of Object.entries(data)) {
    fields.push(`${k} = ?`);
    args.push(v ?? null);
  }
  args.push(todoId, engagementId);
  await db.execute({
    sql: `UPDATE PortalTodo SET ${fields.join(', ')} WHERE id = ? AND engagementId = ?`,
    args,
  });
  const r = await db.execute({ sql: `SELECT * FROM PortalTodo WHERE id = ?`, args: [todoId] });
  return r.rows[0] ? parseRow<PortalTodo>(r.rows[0] as Row) : null;
}

export async function deletePortalTodo(todoId: string, engagementId: string): Promise<void> {
  await getDb().execute({
    sql: `DELETE FROM PortalTodo WHERE id = ? AND engagementId = ?`,
    args: [todoId, engagementId],
  });
}

export async function getPortalSettings(engagementId: string): Promise<PortalSettings> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT portalSettings FROM Engagement WHERE id = ?`, args: [engagementId] });
  const raw = (r.rows[0] as Row)?.portalSettings as string | null;
  if (!raw) return { ...DEFAULT_PORTAL_SETTINGS };
  try {
    return { ...DEFAULT_PORTAL_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PORTAL_SETTINGS };
  }
}

export async function updatePortalSettings(engagementId: string, settings: Partial<PortalSettings>): Promise<PortalSettings> {
  const current = await getPortalSettings(engagementId);
  const merged = { ...current, ...settings };
  await getDb().execute({
    sql: `UPDATE Engagement SET portalSettings = ?, updatedAt = ? WHERE id = ?`,
    args: [JSON.stringify(merged), new Date().toISOString(), engagementId],
  });
  return merged;
}

// ─── Vertical Workspace ───────────────────────────────────────────────────────

export async function listVerticalWorkspaces(parentEngagementId: string) {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM Engagement WHERE parentEngagementId = ? ORDER BY createdAt DESC`,
    args: [parentEngagementId],
  });
  return (r.rows as Row[]).map((row) => parseRow<Row>(row));
}

export async function createVerticalEngagement(data: {
  firmId: string;
  clientName: string;
  verticalType: string;
  parentEngagementId: string;
  verticalSettings?: Record<string, unknown>;
}) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, verticalType, parentEngagementId, verticalSettings, createdAt, updatedAt)
          VALUES (?, ?, ?, 'DISCOVERY', ?, ?, ?, ?, ?)`,
    args: [
      id,
      data.firmId,
      data.clientName,
      data.verticalType,
      data.parentEngagementId,
      data.verticalSettings ? JSON.stringify(data.verticalSettings) : null,
      now, now,
    ],
  });
  const r = await db.execute({ sql: `SELECT * FROM Engagement WHERE id = ?`, args: [id] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

export async function getVerticalSettings(engagementId: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT verticalSettings FROM Engagement WHERE id = ?`, args: [engagementId] });
  const raw = (r.rows[0] as Row)?.verticalSettings as string | null;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function updateVerticalSettings(engagementId: string, settings: Record<string, unknown>) {
  const current = await getVerticalSettings(engagementId);
  const merged = { ...current, ...settings };
  await getDb().execute({
    sql: `UPDATE Engagement SET verticalSettings = ?, updatedAt = ? WHERE id = ?`,
    args: [JSON.stringify(merged), new Date().toISOString(), engagementId],
  });
  return merged;
}

// ─── Data Template Schemas (AI-generated per engagement) ──────────────────────

export async function listDataTemplateSchemas(engagementId: string) {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM DataTemplateSchema WHERE engagementId = ? ORDER BY category, name`,
    args: [engagementId],
  });
  return (r.rows as Row[]).map((row) => {
    const parsed = parseRow<Row>(row);
    if (typeof parsed.fields === 'string') parsed.fields = JSON.parse(parsed.fields as string);
    if (typeof parsed.validationRules === 'string') parsed.validationRules = JSON.parse(parsed.validationRules as string);
    return parsed;
  });
}

export async function upsertDataTemplateSchema(engagementId: string, schema: {
  templateId: string;
  name: string;
  category: string;
  description?: string;
  sheetName: string;
  fields: unknown[];
  validationRules?: string[];
  generatedBy?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = await db.execute({
    sql: `SELECT id FROM DataTemplateSchema WHERE engagementId = ? AND templateId = ?`,
    args: [engagementId, schema.templateId],
  });
  if (existing.rows[0]) {
    const id = (existing.rows[0] as Row).id as string;
    await db.execute({
      sql: `UPDATE DataTemplateSchema SET name=?, category=?, description=?, sheetName=?, fields=?, validationRules=?, generatedBy=?, updatedAt=? WHERE id=?`,
      args: [
        schema.name, schema.category, schema.description ?? null, schema.sheetName,
        JSON.stringify(schema.fields), JSON.stringify(schema.validationRules ?? []),
        schema.generatedBy ?? 'AI', now, id,
      ],
    });
    return id;
  } else {
    const id = createId();
    await db.execute({
      sql: `INSERT INTO DataTemplateSchema (id, engagementId, templateId, name, category, description, sheetName, fields, validationRules, generatedBy, createdAt, updatedAt)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        id, engagementId, schema.templateId, schema.name, schema.category,
        schema.description ?? null, schema.sheetName,
        JSON.stringify(schema.fields), JSON.stringify(schema.validationRules ?? []),
        schema.generatedBy ?? 'AI', now, now,
      ],
    });
    return id;
  }
}

export async function deleteDataTemplateSchema(id: string) {
  const db = getDb();
  await getDb().execute({ sql: `DELETE FROM DataTemplateSchema WHERE id = ?`, args: [id] });
}

// ─── Data Collection Items ────────────────────────────────────────────────────

export async function listDataCollectionItems(engagementId: string) {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT dci.*, dts.fields, dts.validationRules, dts.sheetName
          FROM DataCollectionItem dci
          LEFT JOIN DataTemplateSchema dts ON dts.id = dci.templateSchemaId
          WHERE dci.engagementId = ?
          ORDER BY dci.category, dci.name`,
    args: [engagementId],
  });
  return (r.rows as Row[]).map((row) => {
    const parsed = parseRow<Row>(row);
    if (typeof parsed.fields === 'string') parsed.fields = JSON.parse(parsed.fields as string);
    if (typeof parsed.validationRules === 'string') parsed.validationRules = JSON.parse(parsed.validationRules as string);
    return parsed;
  });
}

export async function createDataCollectionItem(engagementId: string, data: {
  templateId: string;
  templateSchemaId?: string;
  name: string;
  category: string;
  assignedTo?: string;
  dueDate?: string;
}) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO DataCollectionItem (id, engagementId, templateId, templateSchemaId, name, category, assignedTo, dueDate, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id, engagementId, data.templateId, data.templateSchemaId ?? null,
      data.name, data.category, data.assignedTo ?? null, data.dueDate ?? null, now, now,
    ],
  });
  const r = await db.execute({ sql: `SELECT * FROM DataCollectionItem WHERE id = ?`, args: [id] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

export async function updateDataCollectionItem(id: string, data: Partial<{
  status: string; assignedTo: string; dueDate: string;
  sentAt: string; receivedAt: string; validatedAt: string; uploadedAt: string; notes: string;
}>) {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  const fields: [string, unknown][] = [
    ['status', data.status], ['assignedTo', data.assignedTo], ['dueDate', data.dueDate],
    ['sentAt', data.sentAt], ['receivedAt', data.receivedAt], ['validatedAt', data.validatedAt],
    ['uploadedAt', data.uploadedAt], ['notes', data.notes],
  ];
  for (const [col, val] of fields) {
    if (val !== undefined) { sets.push(`${col} = ?`); args.push(val); }
  }
  sets.push(`updatedAt = ?`);
  args.push(new Date().toISOString());
  args.push(id);
  await db.execute({ sql: `UPDATE DataCollectionItem SET ${sets.join(', ')} WHERE id = ?`, args: args as (string | number | boolean | null)[] });
  const r = await db.execute({ sql: `SELECT * FROM DataCollectionItem WHERE id = ?`, args: [id] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

export async function deleteDataCollectionItem(id: string) {
  await getDb().execute({ sql: `DELETE FROM DataCollectionItem WHERE id = ?`, args: [id] });
}

// ─── Data Files ───────────────────────────────────────────────────────────────

export async function listDataFiles(dataCollectionItemId: string) {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM DataFile WHERE dataCollectionItemId = ? ORDER BY createdAt DESC`,
    args: [dataCollectionItemId],
  });
  return (r.rows as Row[]).map((row) => {
    const parsed = parseRow<Row>(row);
    if (typeof parsed.validationResult === 'string') {
      try { parsed.validationResult = JSON.parse(parsed.validationResult as string); } catch {}
    }
    return parsed;
  });
}

export async function listAllDataFilesForEngagement(engagementId: string) {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT df.* FROM DataFile df
          JOIN DataCollectionItem dci ON dci.id = df.dataCollectionItemId
          WHERE dci.engagementId = ? ORDER BY df.createdAt DESC`,
    args: [engagementId],
  });
  return (r.rows as Row[]).map((row) => {
    const parsed = parseRow<Row>(row);
    if (typeof parsed.validationResult === 'string') {
      try { parsed.validationResult = JSON.parse(parsed.validationResult as string); } catch {}
    }
    return parsed;
  });
}

export async function createDataFile(data: {
  engagementId: string;
  dataCollectionItemId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy?: string;
}) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO DataFile (id, engagementId, dataCollectionItemId, filename, originalName, mimeType, sizeBytes, uploadedBy, createdAt)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [id, data.engagementId, data.dataCollectionItemId, data.filename, data.originalName, data.mimeType, data.sizeBytes, data.uploadedBy ?? null, now],
  });
  const r = await db.execute({ sql: `SELECT * FROM DataFile WHERE id = ?`, args: [id] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

export async function updateDataFileValidation(id: string, data: {
  validationStatus: string;
  validationResult?: unknown;
  rowCount?: number;
  errorCount?: number;
  warningCount?: number;
}) {
  const db = getDb();
  await db.execute({
    sql: `UPDATE DataFile SET validationStatus=?, validationResult=?, rowCount=?, errorCount=?, warningCount=? WHERE id=?`,
    args: [
      data.validationStatus,
      data.validationResult ? JSON.stringify(data.validationResult) : null,
      data.rowCount ?? null,
      data.errorCount ?? null,
      data.warningCount ?? null,
      id,
    ],
  });
  const r = await db.execute({ sql: `SELECT * FROM DataFile WHERE id = ?`, args: [id] });
  const parsed = r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
  if (parsed && typeof parsed.validationResult === 'string') {
    try { parsed.validationResult = JSON.parse(parsed.validationResult as string); } catch {}
  }
  return parsed;
}

export async function deleteDataFile(id: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM DataFile WHERE id = ?`, args: [id] });
  const file = r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
  await db.execute({ sql: `DELETE FROM DataFile WHERE id = ?`, args: [id] });
  return file;
}


// ─── Re-exports for Phase 5.A portal auth ─────────────────────────────────────
export {
  createPortalSession,
  findPortalSessionByJtiHash,
  touchPortalSession,
  revokePortalSession,
  revokeAllSessionsForMember,
  purgeExpiredPortalSessions,
} from './portalSession.js';
export type { PortalSession } from './portalSession.js';
export {
  getFirmBranding,
  getFirmBrandingByEngagementId,
  DEFAULT_BRANDING,
} from './firmBranding.js';
export type { FirmBranding } from './firmBranding.js';

// ─── Re-exports for Phase 5.A-2 email + OTP ──────────────────────────────────
export {
  upsertFirmEmailSettings,
  getFirmEmailSettings,
  deleteFirmEmailSettings,
  recordFirmEmailTestResult,
} from './firmEmailSettings.js';
export type { FirmEmailSettings, FirmEmailSettingsInput, InboundProtocol } from './firmEmailSettings.js';
export {
  createPortalMagicLink,
  findActivePortalMagicLink,
  recordPortalMagicLinkAttempt,
  consumePortalMagicLink,
  invalidateActiveLinksForMember,
  purgeExpiredPortalMagicLinks,
} from './portalMagicLink.js';
export type { PortalMagicLink } from './portalMagicLink.js';
