/**
 * Database layer — uses @libsql/client (SQLite, no binary downloads).
 * Replaces Prisma for the local/dev run.
 */
import { createClient, type Client, type InValue } from '@libsql/client';
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

  // Phase 43.7 — backfill APP_ADMIN on every firm that lacks one.
  // Idempotent: re-running on every boot is the same as running it
  // once. Print a single summary line so ops can confirm the
  // migration ran (and didn't silently grant unexpected admins).
  // Lazy-imported to avoid the circular dep with db/rbac.ts.
  try {
    const { backfillAppAdmins } = await import('./rbac.js');
    const result = await backfillAppAdmins();
    if (result.granted.length > 0 || result.skippedNoUsers > 0) {
      // Always log when we acted; quiet when there was nothing to do.
      console.log(
        `[db] backfillAppAdmins: granted=${result.granted.length}, skipped(has-admin)=${result.skippedHasAdmin}, skipped(no-users)=${result.skippedNoUsers}`,
      );
      for (const g of result.granted) {
        console.log(`[db] backfillAppAdmins: granted APP_ADMIN to ${g.email} on firm ${g.firmId}`);
      }
    }
  } catch (err) {
    // Non-fatal — RBAC backfill failures shouldn't block the API
    // from starting. The Phase 43.6 walkthrough has manual SQL
    // anyone can run to fix it after the fact.
    console.error('[db] backfillAppAdmins failed:', err instanceof Error ? err.message : String(err));
  }

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
  try { await db.execute(`ALTER TABLE Firm ADD COLUMN displayName TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }
  try { await db.execute(`ALTER TABLE Firm ADD COLUMN logoUrl TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }
  try { await db.execute(`ALTER TABLE Firm ADD COLUMN primaryColor TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }
  try { await db.execute(`ALTER TABLE Firm ADD COLUMN secondaryColor TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }
  try { await db.execute(`ALTER TABLE Firm ADD COLUMN supportEmail TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }

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
  // Idempotent ALTER for the Google OAuth sub claim. Stored once and used
  // as the primary key for re-login (an email change in Google never breaks
  // the link, unlike matching on email). Indexed for the lookup hot path.
  try { await db.execute(`ALTER TABLE User ADD COLUMN googleSub TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }
  try { await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_googleSub ON User(googleSub) WHERE googleSub IS NOT NULL`); } catch { /* swallow — idempotent migration / parse fallback */ }

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
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN startDate TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN contractEndDate TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN portalSettings TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN verticalType TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN parentEngagementId TEXT REFERENCES Engagement(id)`); } catch { /* swallow — idempotent migration / parse fallback */ }
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN verticalSettings TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }
  // Platform adaptor (Phase 1A). Every existing engagement defaults to NetSuite
  // since that's what the pilot was — zero behavior change from this column.
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN adaptorId TEXT NOT NULL DEFAULT 'netsuite'`); } catch { /* swallow — idempotent migration / parse fallback */ }
  // Phase 37.1 — soft-archive support. previousStatus stashes the status the
  // engagement was in just before being archived so unarchive can restore it.
  // Nullable / TEXT — engagements that have never been archived have NULL.
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN previousStatus TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }

  // Phase 46.1 — sales-side metadata. All optional; pre-existing
  // engagements get nulls. leadSource/lostReason are TEXT with the
  // route layer enforcing the enum (WEBSITE | REFERRAL | OUTBOUND |
  // EVENT | OTHER for source; PRICE | TIMING | NO_DECISION |
  // LOST_TO_COMPETITOR | INTERNAL_BUILD | OTHER for loss).
  // estimatedValue is REAL — monetary values fit fine in a double for
  // the deal sizes we'd ever see; if a customer had > $9 quadrillion
  // pipeline they have bigger problems than precision.
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN leadSource TEXT`); } catch { /* idempotent */ }
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN prospectScore INTEGER`); } catch { /* idempotent */ }
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN estimatedValue REAL`); } catch { /* idempotent */ }
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN estimatedCloseDate TEXT`); } catch { /* idempotent */ }
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN lostReason TEXT`); } catch { /* idempotent */ }
  // Sales rep ownership — denormalised pointer for fast pipeline
  // queries without a join through EngagementRole. The
  // EngagementRole(SALES_REP) row is still authoritative; this is a
  // cache the createProspect path populates.
  try { await db.execute(`ALTER TABLE Engagement ADD COLUMN salesRepUserId TEXT`); } catch { /* idempotent */ }


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
  try { await db.execute(`ALTER TABLE ProjectMember ADD COLUMN team TEXT NOT NULL DEFAULT 'CLIENT'`); } catch { /* swallow — idempotent migration / parse fallback */ }
  // Add inviteToken for per-member portal auth
  try { await db.execute(`ALTER TABLE ProjectMember ADD COLUMN inviteToken TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }
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
  // Phase 38.2 — section comments expand from single-per-section legacy notes
  // to a thread-style log with author + mentions. Idempotent column adds
  // happen first; then the UNIQUE(engagementId, sectionKey) constraint is
  // dropped (table-recreate pattern) so multiple comments per section can
  // coexist. Re-running the migration is a no-op.
  try { await db.execute(`ALTER TABLE SectionComment ADD COLUMN body TEXT`); } catch { /* swallow — idempotent */ }
  try { await db.execute(`ALTER TABLE SectionComment ADD COLUMN mentionMemberIds TEXT`); } catch { /* swallow — idempotent */ }
  try { await db.execute(`ALTER TABLE SectionComment ADD COLUMN authorUserId TEXT`); } catch { /* swallow — idempotent */ }
  try { await db.execute(`ALTER TABLE SectionComment ADD COLUMN createdAt TEXT`); } catch { /* swallow — idempotent */ }
  await db.execute(`UPDATE SectionComment SET body = text WHERE body IS NULL AND text IS NOT NULL`);
  await db.execute(`UPDATE SectionComment SET createdAt = updatedAt WHERE createdAt IS NULL AND updatedAt IS NOT NULL`);
  const sectionCommentIndexes = await db.execute(`PRAGMA index_list(SectionComment)`);
  const hasUnique = (sectionCommentIndexes.rows as Array<Record<string, unknown>>).some((row) =>
    typeof row.name === 'string' && row.name.startsWith('sqlite_autoindex_SectionComment'),
  );
  if (hasUnique) {
    await db.execute('BEGIN');
    try {
      await db.execute(`
        CREATE TABLE SectionComment_new (
          id                TEXT PRIMARY KEY,
          engagementId      TEXT NOT NULL REFERENCES Engagement(id),
          sectionKey        TEXT NOT NULL,
          text              TEXT NOT NULL DEFAULT '',
          body              TEXT,
          mentionMemberIds  TEXT,
          authorUserId      TEXT,
          createdAt         TEXT,
          updatedAt         TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await db.execute(`
        INSERT INTO SectionComment_new (id, engagementId, sectionKey, text, body, mentionMemberIds, authorUserId, createdAt, updatedAt)
        SELECT id, engagementId, sectionKey, text, body, mentionMemberIds, authorUserId, createdAt, updatedAt FROM SectionComment
      `);
      await db.execute(`DROP TABLE SectionComment`);
      await db.execute(`ALTER TABLE SectionComment_new RENAME TO SectionComment`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_section_comment_engagement_section ON SectionComment(engagementId, sectionKey)`);
      await db.execute('COMMIT');
    } catch (err) {
      try { await db.execute('ROLLBACK'); } catch { /* swallow */ }
      throw err;
    }
  }

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
  // Phase 38.3 — top-level "data request" shape adds free-form description
  // and createdBy. Idempotent ALTERs.
  try { await db.execute(`ALTER TABLE DataCollectionItem ADD COLUMN description TEXT`); } catch { /* swallow — idempotent */ }
  try { await db.execute(`ALTER TABLE DataCollectionItem ADD COLUMN createdBy TEXT`); } catch { /* swallow — idempotent */ }

  // Phase 38.3 — Action Items table. Lightweight project-scoped to-do
  // surface that complements PortalTodo (which is portal-only). Status
  // uses OPEN/IN_PROGRESS/DONE/CANCELLED to align with the consultant's
  // mental model.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ActionItem (
      id              TEXT PRIMARY KEY,
      engagementId    TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      description     TEXT,
      owner           TEXT,
      priority        TEXT NOT NULL DEFAULT 'MEDIUM',
      dueDate         TEXT,
      status          TEXT NOT NULL DEFAULT 'OPEN',
      createdBy       TEXT,
      completedAt     TEXT,
      createdAt       TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_action_item_engagement ON ActionItem(engagementId)`);

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

  // ─── Custom Adaptors (Phase 2 — firm-authored platform adaptors) ───────────
  // A custom adaptor is a firm-owned PlatformAdaptor produced by the "bring
  // your own ERP" wizard: the firm uploads vendor docs / their own
  // implementation playbook, the AI parser drafts a QuestionnaireSchema +
  // LicenseModel + PhaseModel, and after firm review the adaptor is
  // published. Stored here (not in an external registry file) so every
  // lookup is tenant-scoped — custom adaptors never leak across firms.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS CustomAdaptor (
      id              TEXT PRIMARY KEY,
      firmId          TEXT NOT NULL REFERENCES Firm(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      slug            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'DRAFT',
      sourceDocuments TEXT NOT NULL DEFAULT '[]',
      parsedManifest  TEXT,
      parsedSchema    TEXT,
      parsedLicense   TEXT,
      parsedPhases    TEXT,
      parsedGenerators TEXT,
      parseError      TEXT,
      publishedAt     TEXT,
      createdAt       TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (firmId, slug)
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_customadaptor_firm   ON CustomAdaptor(firmId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_customadaptor_status ON CustomAdaptor(status)`);
  // Phase 14: custom adaptors carry their own rule pack. Additive ALTER so
  // existing pilot data (where the column doesn't yet exist) keeps working.
  try { await db.execute(`ALTER TABLE CustomAdaptor ADD COLUMN parsedRules TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }

  // ─── Password Reset Tokens (Phase 16) ──────────────────────────────────────
  // Per-user reset tokens for consultant-side accounts. The raw token is
  // never stored — only its SHA-256 hash (tokenHash) is on disk. Invalidated
  // by consumedAt OR expiresAt; a new token issued for the same user
  // invalidates all prior active tokens (see invalidateActivePasswordResetsForUser).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS PasswordResetToken (
      id         TEXT PRIMARY KEY,
      userId     TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
      tokenHash  TEXT NOT NULL UNIQUE,
      expiresAt  TEXT NOT NULL,
      consumedAt TEXT,
      ipHash     TEXT,
      createdAt  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_password_reset_user    ON PasswordResetToken(userId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON PasswordResetToken(expiresAt)`);

  // ─── Email Verification Tokens (Phase 19) ──────────────────────────────────
  // Same shape as PasswordResetToken but dedicated so invalidation and TTLs
  // can be tuned independently per flow. User.emailVerifiedAt tracks the
  // verification status; null means not yet verified.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS EmailVerificationToken (
      id         TEXT PRIMARY KEY,
      userId     TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
      tokenHash  TEXT NOT NULL UNIQUE,
      expiresAt  TEXT NOT NULL,
      consumedAt TEXT,
      createdAt  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_email_verify_user    ON EmailVerificationToken(userId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_email_verify_expires ON EmailVerificationToken(expiresAt)`);
  // Additive column on User for existing pilot rows. Null = not yet verified.
  try { await db.execute(`ALTER TABLE User ADD COLUMN emailVerifiedAt TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }

  // ─── Phase 28 — PendingSubmission (§5 client-portal continuation foundation) ─
  //
  // Polymorphic single table for client-submitted artifacts that require
  // consultant accept/reject before they become source of truth. Supports
  // four target types: WIZARD_ANSWER (Phase 29), DATA_FILE (Phase 30),
  // QA_MESSAGE (Phase 31), DECISION_SIGNOFF (Phase 32). Plus 'TEST' used
  // exclusively by Phase 28 unit tests for the no-op acceptor coverage.
  //
  // payload is JSON TEXT — schema is per-targetType, validated at the API
  // layer via the Zod registry in services/pendingSubmissionPayloadSchemas.ts.
  // Phases 29-32 each register their schema + acceptor at module load.
  //
  // The ENGAGEMENT FK is ON DELETE CASCADE so portal cleanup removes
  // submissions automatically. The MEMBER FK is RESTRICT (default) so a
  // member with audit-historical submissions can't be deleted silently —
  // the route layer surfaces this if it ever happens.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS PendingSubmission (
      id             TEXT PRIMARY KEY,
      engagementId   TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      memberId       TEXT NOT NULL REFERENCES ProjectMember(id),
      targetType     TEXT NOT NULL,
      targetId       TEXT,
      payload        TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'PENDING',
      reviewerId     TEXT,
      reviewedAt     TEXT,
      reviewComment  TEXT,
      createdAt      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_pendingsubmission_engagement_status
      ON PendingSubmission(engagementId, status, createdAt)
  `);

  // ─── Phase 30 — StagedFile (client uploads awaiting consultant review) ─────
  //
  // Holds files the client uploaded via /portal/data-files/staged. The
  // file lives on disk under UPLOADS_DIR/staged/<filename>; this row
  // tracks the metadata + the engagement/member it belongs to. On
  // submission accept the DATA_FILE acceptor moves the file to permanent
  // storage and creates a real DataFile row, then deletes this row. On
  // reject the route handler unlinks the file + deletes the row.
  // Orphans (24h+ old, never submitted) are GC'd by stagedFileGc.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS StagedFile (
      id                   TEXT PRIMARY KEY,
      engagementId         TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      memberId             TEXT NOT NULL REFERENCES ProjectMember(id),
      dataCollectionItemId TEXT,
      filename             TEXT NOT NULL,
      originalName         TEXT NOT NULL,
      mimeType             TEXT,
      sizeBytes            INTEGER NOT NULL DEFAULT 0,
      storagePath          TEXT NOT NULL,
      createdAt            TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_stagedfile_engagement_created
      ON StagedFile(engagementId, createdAt)
  `);

  // Phase 30 — track which submission (if any) promoted a DataFile from
  // staging. Used by the dataFileAcceptor's idempotent re-accept guard:
  // if staged file is already gone but a DataFile with this submissionId
  // exists, the prior accept already succeeded; treat as no-op.
  try { await db.execute(`ALTER TABLE DataFile ADD COLUMN sourceSubmissionId TEXT`); } catch { /* swallow — idempotent migration / parse fallback */ }

  // ─── Phase 31 — Two-way Q&A messaging (§5.1 asymmetry) ─────────────────────
  //
  // Per §5.1: client→consultant messages go through pending-review (the
  // QA_MESSAGE acceptor inserts the Message row on accept); consultant→
  // client messages bypass pending-review (consultant is already source
  // of truth — the routes/threads.ts POST handler inserts directly with
  // acknowledgedAt = createdAt).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ConversationThread (
      id                  TEXT PRIMARY KEY,
      engagementId        TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      subject             TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'OPEN',
      createdByMemberId   TEXT,
      createdByUserId     TEXT,
      createdAt           TEXT NOT NULL DEFAULT (datetime('now')),
      lastMessageAt       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_thread_engagement_lastmsg
      ON ConversationThread(engagementId, lastMessageAt)
  `);

  // ─── Phase 45.3 — ConversationThread kind + pinned (additive) ─────────────
  //
  // `kind` distinguishes ordinary client/consultant Q&A threads ('STANDARD')
  // from system-created cross-team handoff threads ('HANDOFF') auto-spawned
  // when an engagement enters CLOSEOUT. Pinned threads always sort first in
  // the Threads UI so the SLA team can find the handoff thread immediately.
  // These ALTERs are idempotent (column may already exist on a re-run);
  // SQLite throws and we swallow.
  try { await db.execute(`ALTER TABLE ConversationThread ADD COLUMN kind TEXT NOT NULL DEFAULT 'STANDARD'`); } catch { /* idempotent */ }
  try { await db.execute(`ALTER TABLE ConversationThread ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`); } catch { /* idempotent */ }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS Message (
      id                  TEXT PRIMARY KEY,
      threadId            TEXT NOT NULL REFERENCES ConversationThread(id) ON DELETE CASCADE,
      senderType          TEXT NOT NULL,
      senderMemberId      TEXT,
      senderUserId        TEXT,
      body                TEXT NOT NULL,
      acknowledgedAt      TEXT,
      sourceSubmissionId  TEXT,
      createdAt           TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_message_thread_created
      ON Message(threadId, createdAt)
  `);

  // ─── Phase 32 — DecisionItem client-signoff columns (additive) ─────────────
  //
  // Extends the existing DecisionItem table with the §5 client sign-off
  // state machine. Default 'NONE' means no client interaction; PENDING
  // is set when a client submits a DECISION_SIGNOFF; SIGNED/DECLINED/
  // REJECTED are terminal.
  // The catch blocks below are intentionally empty — these ALTERs are
  // idempotent (column may already exist on a re-run); SQLite throws and
  // we swallow. Same pattern as the other ALTERs in this file.
  try { await db.execute(`ALTER TABLE DecisionItem ADD COLUMN clientSignoffStatus TEXT DEFAULT 'NONE'`); } catch { /* idempotent */ }
  try { await db.execute(`ALTER TABLE DecisionItem ADD COLUMN clientSignoffAt TEXT`); } catch { /* idempotent */ }
  try { await db.execute(`ALTER TABLE DecisionItem ADD COLUMN clientSignoffComment TEXT`); } catch { /* idempotent */ }
  try { await db.execute(`ALTER TABLE DecisionItem ADD COLUMN clientSignoffMemberId TEXT`); } catch { /* idempotent */ }
  try { await db.execute(`ALTER TABLE DecisionItem ADD COLUMN clientSignoffSourceSubmissionId TEXT`); } catch { /* idempotent */ }

  // ─── Phase 43.1 — RBAC schema ──────────────────────────────────────────────
  // FirmRole holds the four firm-level roles (APP_ADMIN, SALES_MANAGER,
  // SUPPORT_LEAD, INTERNAL_ACCOUNTANT). The (firmId, userId, role)
  // triple is unique so duplicate grants are no-ops.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS FirmRole (
      id        TEXT PRIMARY KEY,
      firmId    TEXT NOT NULL REFERENCES Firm(id) ON DELETE CASCADE,
      userId    TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
      role      TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (firmId, userId, role)
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_firmrole_user ON FirmRole(userId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_firmrole_firm ON FirmRole(firmId)`);

  // EngagementRole holds the eleven per-engagement roles. assignedModules
  // is a JSON array of module ids (e.g. ["r2r","p2p"]) for the
  // module-scoped roles (FUNCTIONAL_CONSULTANT, TECHNICAL_CONSULTANT,
  // CLIENT_SME); NULL means "all modules" or "not module-scoped".
  await db.execute(`
    CREATE TABLE IF NOT EXISTS EngagementRole (
      id               TEXT PRIMARY KEY,
      engagementId     TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      userId           TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
      role             TEXT NOT NULL,
      assignedModules  TEXT,
      createdAt        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (engagementId, userId, role)
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_engagementrole_user       ON EngagementRole(userId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_engagementrole_engagement ON EngagementRole(engagementId)`);

  // RoleAuditLog: append-only forensic trail. Every grant/revoke writes
  // one row so audits can reconstruct the role timeline. Scope is
  // either 'FIRM' or 'ENGAGEMENT:<id>'.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS RoleAuditLog (
      id            TEXT PRIMARY KEY,
      firmId        TEXT NOT NULL REFERENCES Firm(id) ON DELETE CASCADE,
      actorUserId   TEXT NOT NULL,
      targetUserId  TEXT NOT NULL,
      action        TEXT NOT NULL,
      role          TEXT NOT NULL,
      scope         TEXT NOT NULL,
      createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_roleauditlog_firm ON RoleAuditLog(firmId)`);

  // ─── Phase 45.1 — Closeout checklist ─────────────────────────────────────
  // One row per (engagementId, key) — the 9 keys are auto-inserted when
  // the engagement transitions into CLOSEOUT (lifecycle hook in
  // services/lifecycleTransitions). Idempotent: re-running the
  // transition is a no-op thanks to the UNIQUE constraint.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS CloseoutChecklistItem (
      id            TEXT PRIMARY KEY,
      engagementId  TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      key           TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'NOT_STARTED',
      completedBy   TEXT,
      completedAt   TEXT,
      notes         TEXT,
      createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (engagementId, key)
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_closeout_engagement ON CloseoutChecklistItem(engagementId)`);

  // ─── Phase 45.6 — In-app ticket queue ────────────────────────────────────
  //
  // Once an engagement enters SLA_ACTIVE the implementation portal is
  // largely quiet — clients raise issues by opening a Ticket instead.
  // The Ticket row is the canonical record (severity, status, owner);
  // TicketMessage holds the threaded back-and-forth (mirrors the
  // ConversationThread/Message split for consistency); TicketStatusChange
  // is a thin audit row written every time status flips so we can graph
  // resolution times without a window function over messages.
  //
  // Status enum: OPEN | IN_PROGRESS | WAITING_CUSTOMER | RESOLVED | CLOSED.
  // Severity enum: CRITICAL | HIGH | MEDIUM | LOW (mirrors IssueItem so
  // the SLA portfolio rollup can include tickets later).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS Ticket (
      id            TEXT PRIMARY KEY,
      engagementId  TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      firmId        TEXT NOT NULL REFERENCES Firm(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      description   TEXT,
      severity      TEXT NOT NULL DEFAULT 'MEDIUM',
      status        TEXT NOT NULL DEFAULT 'OPEN',
      /** ProjectMember.id when opened by a client through the portal,
       *  User.id when opened internally by the SLA team. */
      openedByUserId   TEXT,
      openedByMemberId TEXT,
      /** Currently-assigned User.id (SUPPORT_LEAD or SUPPORT_ENGINEER). */
      assigneeUserId   TEXT,
      /** Stamped on first transition to RESOLVED. Null when never resolved. */
      firstResolvedAt  TEXT,
      /** Stamped on transition to CLOSED. Distinct from firstResolvedAt
       *  so a re-opened ticket doesn't lose its original resolution time. */
      closedAt         TEXT,
      createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ticket_engagement ON Ticket(engagementId, createdAt)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ticket_firm_status ON Ticket(firmId, status)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS TicketMessage (
      id              TEXT PRIMARY KEY,
      ticketId        TEXT NOT NULL REFERENCES Ticket(id) ON DELETE CASCADE,
      /** 'CLIENT' for portal members, 'SUPPORT' for firm users. */
      senderType      TEXT NOT NULL,
      senderUserId    TEXT,
      senderMemberId  TEXT,
      body            TEXT NOT NULL,
      createdAt       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ticket_message_ticket ON TicketMessage(ticketId, createdAt)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS TicketStatusChange (
      id            TEXT PRIMARY KEY,
      ticketId      TEXT NOT NULL REFERENCES Ticket(id) ON DELETE CASCADE,
      fromStatus    TEXT NOT NULL,
      toStatus      TEXT NOT NULL,
      /** User.id of the SUPPORT user who made the change. NULL for
       *  system-driven transitions (e.g. auto-close after inactivity
       *  in a future Phase 45.x sweep). */
      byUserId      TEXT,
      createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ticket_status_change_ticket ON TicketStatusChange(ticketId, createdAt)`);

  // ─── Phase 46.4 — SOW version tracking ───────────────────────────────────
  //
  // One row per generated SOW version per engagement. The
  // GenerationJob.id is the canonical artifact pointer; this table
  // adds the version + supersedes chain so the route layer can
  // enumerate "every SOW we've ever generated for this client" for
  // the audit trail. signedFileUrl is populated by Phase 46.5 when
  // the signed PDF lands.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS EngagementSowVersion (
      id                TEXT PRIMARY KEY,
      engagementId      TEXT NOT NULL REFERENCES Engagement(id) ON DELETE CASCADE,
      jobId             TEXT NOT NULL REFERENCES GenerationJob(id) ON DELETE CASCADE,
      version           INTEGER NOT NULL,
      supersedesVersion INTEGER,
      signedFileUrl     TEXT,
      generatedAt       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (engagementId, version)
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sow_engagement_version ON EngagementSowVersion(engagementId, version)`);

  // ─── Phase 46.2 — Discovery Lite questionnaire ───────────────────────────
  //
  // One row per engagement. Holds the answers blob (JSON) plus
  // completion + share-link fields. The shareToken is opaque and
  // only set when the sales rep generates a self-serve link for the
  // prospect; nullified when revoked.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS EngagementDiscoveryLite (
      engagementId       TEXT PRIMARY KEY REFERENCES Engagement(id) ON DELETE CASCADE,
      answers            TEXT NOT NULL DEFAULT '{}',
      completedAt        TEXT,
      shareToken         TEXT,
      shareTokenIssuedAt TEXT,
      shareTokenExpiresAt TEXT,
      lastEditedBy       TEXT,
      createdAt          TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt          TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_dl_share_token ON EngagementDiscoveryLite(shareToken) WHERE shareToken IS NOT NULL`);

  // ─── Phase 45.8 — Renewal + expansion tracker ─────────────────────────────
  //
  // One row per engagement. The ACCOUNT_MANAGER (or APP_ADMIN) edits
  // contract dates + renewal status + expansion-opportunity bullets;
  // the SLA portfolio dashboard surfaces upcoming renewals so they
  // don't slip. expansionOpportunities is JSON ([{title,size,notes}]).
  //
  // renewalStatus enum: NOT_STARTED | DISCUSSING | PROPOSAL_OUT |
  // SIGNED | LOST | NA. NA covers month-to-month or perpetual deals.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS EngagementRenewalState (
      engagementId           TEXT PRIMARY KEY REFERENCES Engagement(id) ON DELETE CASCADE,
      contractStartAt        TEXT,
      contractEndAt          TEXT,
      renewalStatus          TEXT NOT NULL DEFAULT 'NOT_STARTED',
      expansionOpportunities TEXT,
      notes                  TEXT,
      updatedAt              TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
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

// ─── Firm + User row shapes ──────────────────────────────────────────────────
//
// Explicit interfaces so callers don't have to read column names off a
// `Record<string, unknown>` and TypeScript's spread doesn't collapse the
// record's index signature when we return `{ ...user, firm }`. Every
// field below is a real DB column (one ALTER per optional). New columns
// land here AND in the migrations above.

export interface FirmRow {
  id: string;
  name: string;
  plan: string;
  slug: string;
  createdAt: string;
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  supportEmail: string | null;
}

export interface UserRow {
  id: string;
  firmId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: string;
  createdAt: string;
  googleSub: string | null;
  emailVerifiedAt: string | null;
}

/** User joined with their firm. The shape returned by find* helpers below. */
export interface UserWithFirm extends UserRow {
  firm: FirmRow | null;
}

// ─── Firm ─────────────────────────────────────────────────────────────────────

export async function createFirm(data: { name: string; slug: string; plan?: string }): Promise<FirmRow | null> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan) VALUES (?, ?, ?, ?)`,
    args: [id, data.name, data.slug, data.plan ?? 'STARTER'],
  });
  return findFirmById(id);
}

export async function findFirmById(id: string): Promise<FirmRow | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM Firm WHERE id = ?`, args: [id] });
  return r.rows[0] ? parseRow<FirmRow>(r.rows[0] as Row) : null;
}

export async function findFirmBySlug(slug: string): Promise<FirmRow | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM Firm WHERE slug = ?`, args: [slug] });
  return r.rows[0] ? parseRow<FirmRow>(r.rows[0] as Row) : null;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export async function createUser(data: {
  firmId: string; email: string; name: string; passwordHash: string; role?: string;
}): Promise<UserWithFirm | null> {
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

/** Read a User row + its Firm. We type parseRow as UserRow (named props,
 *  not a Record) so the `{ ...user, firm }` return preserves the row's
 *  static-side keys instead of collapsing to `{ firm }`. */
export async function findUserByEmail(email: string): Promise<UserWithFirm | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM User WHERE email = ?`, args: [email] });
  if (!r.rows[0]) return null;
  const user = parseRow<UserRow>(r.rows[0] as Row);
  const firm = await findFirmById(user.firmId);
  return { ...user, firm };
}

export async function findUserById(id: string): Promise<UserWithFirm | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM User WHERE id = ?`, args: [id] });
  if (!r.rows[0]) return null;
  const user = parseRow<UserRow>(r.rows[0] as Row);
  const firm = await findFirmById(user.firmId);
  return { ...user, firm };
}

// ─── Google OAuth helpers ────────────────────────────────────────────────────

/** Look up a user by their Google OIDC `sub` claim. Used on every Google
 *  re-login as the primary lookup — matching by email second. Returns the
 *  user with the firm joined, or null when no link exists yet. */
export async function findUserByGoogleSub(sub: string): Promise<UserWithFirm | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM User WHERE googleSub = ?`, args: [sub] });
  if (!r.rows[0]) return null;
  const user = parseRow<UserRow>(r.rows[0] as Row);
  const firm = await findFirmById(user.firmId);
  return { ...user, firm };
}

/** Attach a Google identity to an existing email-signup user. Last-write-wins:
 *  if the user previously had a different sub, the old link is dropped. The
 *  unique index on googleSub means binding the same sub to a different user
 *  later would error — handled at the route layer with a clearer message. */
export async function linkUserGoogleSub(userId: string, sub: string) {
  const db = getDb();
  await db.execute({ sql: `UPDATE User SET googleSub = ? WHERE id = ?`, args: [sub, userId] });
}

/** First-time Google sign-up: create a new firm with the user as ADMIN
 *  and the Google sub already linked. Password is set to a random
 *  unguessable hash so password login is impossible until the user runs
 *  "Forgot password" to set one (the email column is the link).
 *
 *  Caller is expected to have already collision-checked the firm slug and
 *  email; this function does no validation beyond the schema constraints. */
export async function createGoogleUserAndFirm(args: {
  email: string;
  name: string;
  firmName: string;
  firmSlug: string;
  googleSub: string;
}): Promise<{ user: UserWithFirm; firm: FirmRow } | null> {
  const firm = await createFirm({ name: args.firmName, slug: args.firmSlug });
  if (!firm) return null;
  // Use a node-built-in dynamic import so this module stays light (no top
  // -level bcrypt import needed for the rest of db/index.ts).
  const bcrypt = (await import('bcryptjs')).default;
  const crypto = (await import('crypto')).default;
  const unguessable = crypto.randomBytes(48).toString('hex');
  const passwordHash = await bcrypt.hash(unguessable, 10);

  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, googleSub) VALUES (?,?,?,?,?,?,?)`,
    args: [id, firm.id, args.email, args.name, passwordHash, 'ADMIN', args.googleSub],
  });
  // Google has already verified the email — mark it verified so we don't
  // send a verification email to a user who proved ownership via OAuth.
  await db.execute({
    sql: `UPDATE User SET emailVerifiedAt = ? WHERE id = ?`,
    args: [new Date().toISOString(), id],
  });
  // Phase 43.1 — first user of a freshly-created firm gets APP_ADMIN
  // automatically. Lazy-imported to avoid a circular import between
  // db/index.ts and db/rbac.ts (which imports from this module).
  try {
    const { bootstrapFirmAdmin } = await import('./rbac.js');
    await bootstrapFirmAdmin({ firmId: firm.id, userId: id });
  } catch {
    // Non-fatal — firm + user exist, admin can be promoted manually.
  }
  const user = await findUserById(id);
  return user ? { user, firm } : null;
}

// ─── Engagement ───────────────────────────────────────────────────────────────

export async function createEngagement(data: {
  firmId: string;
  clientName: string;
  adaptorId?: string;
  // Phase 46.1 — optional sales-side fields. Pass these to seed a
  // PROSPECT directly; existing call sites pass none and get the
  // pre-46.1 default DISCOVERY-stage shape.
  status?: string;
  leadSource?: string | null;
  prospectScore?: number | null;
  estimatedValue?: number | null;
  estimatedCloseDate?: string | null;
  salesRepUserId?: string | null;
}) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  const adaptorId = data.adaptorId ?? 'netsuite';
  // Build the column list dynamically so legacy callers that don't
  // pass any sales fields keep their current behaviour and the
  // status column stays NULL (existing tests rely on null-defaulted
  // status that means "DISCOVERY-equivalent").
  const cols: string[] = ['id', 'firmId', 'clientName', 'adaptorId', 'updatedAt'];
  const vals: (string | number | null)[] = [id, data.firmId, data.clientName, adaptorId, now];
  if (data.status !== undefined) {
    cols.push('status');
    vals.push(data.status);
  }
  if (data.leadSource !== undefined) {
    cols.push('leadSource');
    vals.push(data.leadSource);
  }
  if (data.prospectScore !== undefined) {
    cols.push('prospectScore');
    vals.push(data.prospectScore);
  }
  if (data.estimatedValue !== undefined) {
    cols.push('estimatedValue');
    vals.push(data.estimatedValue);
  }
  if (data.estimatedCloseDate !== undefined) {
    cols.push('estimatedCloseDate');
    vals.push(data.estimatedCloseDate);
  }
  if (data.salesRepUserId !== undefined) {
    cols.push('salesRepUserId');
    vals.push(data.salesRepUserId);
  }
  const placeholders = vals.map(() => '?').join(',');
  await db.execute({
    sql: `INSERT INTO Engagement (${cols.join(', ')}) VALUES (${placeholders})`,
    args: vals,
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

export async function listEngagements(firmId: string, opts?: { includeArchived?: boolean }) {
  const db = getDb();
  // Phase 37.1 — by default the dashboard hides archived engagements. Call
  // sites that need the full list (an admin "Archived Engagements" panel,
  // for instance) opt in via includeArchived: true.
  const includeArchived = opts?.includeArchived === true;
  const sql = includeArchived
    ? `SELECT * FROM Engagement WHERE firmId = ? ORDER BY updatedAt DESC`
    : `SELECT * FROM Engagement WHERE firmId = ? AND (status IS NULL OR status != 'ARCHIVED') ORDER BY updatedAt DESC`;
  const r = await db.execute({ sql, args: [firmId] });
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

// Phase 37.1 — soft-archive. Idempotent: re-archiving an ARCHIVED row leaves
// previousStatus untouched (we don't want repeated archive calls to overwrite
// the original previousStatus with 'ARCHIVED'). Returns the row after the
// transition, or null if the engagement doesn't exist.
export async function archiveEngagement(id: string) {
  const db = getDb();
  const now = new Date().toISOString();
  // Atomic guarded UPDATE: only fires when the row exists AND is not already
  // ARCHIVED. If the row is already archived, this is a no-op and we return
  // the current row unchanged.
  await db.execute({
    sql: `UPDATE Engagement
            SET previousStatus = status,
                status = 'ARCHIVED',
                updatedAt = ?
          WHERE id = ? AND status != 'ARCHIVED'`,
    args: [now, id],
  });
  return findEngagementById(id);
}

// Phase 37.1 — reverse of archiveEngagement. Restores the stashed previousStatus
// or falls back to DISCOVERY when no prior state was recorded (e.g., an old row
// that was archived directly via SQL). Returns the row after the transition,
// or null if the engagement doesn't exist.
export async function unarchiveEngagement(id: string) {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT previousStatus FROM Engagement WHERE id = ?`,
    args: [id],
  });
  if (!r.rows[0]) return null;
  const prev = ((r.rows[0] as Record<string, unknown>).previousStatus as string | null) ?? 'DISCOVERY';
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE Engagement
            SET status = ?,
                previousStatus = NULL,
                updatedAt = ?
          WHERE id = ?`,
    args: [prev, now, id],
  });
  return findEngagementById(id);
}

// Phase 37.1 — cascade-delete an engagement and every child row that
// references it. Wraps the deletes in a transaction so a partial failure
// rolls the whole operation back. Returns true when the engagement existed
// (and was deleted), false when it did not — letting the route layer
// translate "false" into a 404 instead of the previous 500.
//
// Why this is needed: most child tables have ON DELETE CASCADE, but several
// older tables (BusinessProfile, LicenseProfile, Phase, ConflictLog,
// GenerationJob, SectionComment, SectionImage, AIAdvice, ProjectMember)
// do not — those tables predate the cascade convention. Without explicit
// cleanup the FK pragma blocks the parent delete with SQLITE_CONSTRAINT.
export async function deleteEngagementCascade(id: string): Promise<boolean> {
  const db = getDb();
  // Existence check outside the transaction — cheaper than starting a TX
  // for a no-op, and lets us return false cleanly.
  const exists = await db.execute({
    sql: `SELECT 1 FROM Engagement WHERE id = ?`,
    args: [id],
  });
  if (!exists.rows[0]) return false;

  await db.execute('BEGIN');
  try {
    // Tables with engagementId but no ON DELETE CASCADE — must be deleted
    // explicitly before the parent row.
    const tablesNoCascade = [
      'BusinessProfile', 'LicenseProfile', 'Phase', 'ConflictLog',
      'GenerationJob', 'SectionComment', 'SectionImage', 'AIAdvice',
    ];
    for (const t of tablesNoCascade) {
      await db.execute({
        sql: `DELETE FROM ${t} WHERE engagementId = ?`,
        args: [id],
      });
    }
    // ProjectMember: also no cascade. Delete it AFTER any tables that FK
    // into it (PortalSession, PortalMagicLink, PendingSubmission, StagedFile)
    // have been cleaned. Those tables have ON DELETE CASCADE on engagementId
    // but their memberId FK on ProjectMember is also CASCADE / NO ACTION, so
    // wiping engagement-level rows first is safest.
    await db.execute({
      sql: `DELETE FROM ProjectMember WHERE engagementId = ?`,
      args: [id],
    });
    // Vertical-workspace children: orphan them rather than cascade-deleting
    // (preserves child engagements that may have independent value).
    await db.execute({
      sql: `UPDATE Engagement SET parentEngagementId = NULL WHERE parentEngagementId = ?`,
      args: [id],
    });
    // The remaining tables (PortalTodo, RiskItem, IssueItem, DecisionItem,
    // MeetingNote, MigrationItem, ActivityLog, ClientPortalToken,
    // DataCollectionItem, DataFile, PortalSession, PortalMagicLink,
    // PendingSubmission, StagedFile, ConversationThread, Message) have
    // ON DELETE CASCADE on engagementId or threadId — they vanish
    // automatically when the parent row goes.
    await db.execute({
      sql: `DELETE FROM Engagement WHERE id = ?`,
      args: [id],
    });
    await db.execute('COMMIT');
    return true;
  } catch (err) {
    try { await db.execute('ROLLBACK'); } catch { /* swallow secondary error */ }
    throw err;
  }
}

export async function updateEngagement(
  id: string,
  data: Partial<{
    clientName: string;
    status: string;
    startDate: string | null;
    contractEndDate: string | null;
    // Phase 46.1 — sales-side fields. Each is independently nullable
    // so the route layer can clear a field by sending null without
    // having to remember the others.
    leadSource: string | null;
    prospectScore: number | null;
    estimatedValue: number | null;
    estimatedCloseDate: string | null;
    lostReason: string | null;
    salesRepUserId: string | null;
  }>,
) {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (data.clientName !== undefined) { sets.push('clientName = ?'); args.push(data.clientName); }
  if (data.status !== undefined) { sets.push('status = ?'); args.push(data.status); }
  if (data.startDate !== undefined) { sets.push('startDate = ?'); args.push(data.startDate); }
  if (data.contractEndDate !== undefined) { sets.push('contractEndDate = ?'); args.push(data.contractEndDate); }
  if (data.leadSource !== undefined) { sets.push('leadSource = ?'); args.push(data.leadSource); }
  if (data.prospectScore !== undefined) { sets.push('prospectScore = ?'); args.push(data.prospectScore); }
  if (data.estimatedValue !== undefined) { sets.push('estimatedValue = ?'); args.push(data.estimatedValue); }
  if (data.estimatedCloseDate !== undefined) { sets.push('estimatedCloseDate = ?'); args.push(data.estimatedCloseDate); }
  if (data.lostReason !== undefined) { sets.push('lostReason = ?'); args.push(data.lostReason); }
  if (data.salesRepUserId !== undefined) { sets.push('salesRepUserId = ?'); args.push(data.salesRepUserId); }
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
  const args: InValue[] = [];
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
  // Phase 38.2 — order by createdAt DESC so the most-recent comments per
  // section appear first. Falls back to updatedAt for legacy rows that
  // pre-date the createdAt column.
  const r = await db.execute({
    sql: `SELECT * FROM SectionComment WHERE engagementId = ? ORDER BY COALESCE(createdAt, updatedAt) DESC`,
    args: [engagementId],
  });
  return (r.rows as Row[]).map((row) => {
    const parsed = parseRow<Row>(row);
    if (typeof parsed.mentionMemberIds === 'string' && parsed.mentionMemberIds) {
      try { parsed.mentionMemberIds = JSON.parse(parsed.mentionMemberIds as string); }
      catch { /* leave as raw string if parse fails */ }
    } else if (parsed.mentionMemberIds == null) {
      parsed.mentionMemberIds = [];
    }
    return parsed;
  });
}

// Phase 38.2 — multi-comment-per-section creator. Returns the new row with
// mentionMemberIds parsed back to an array.
export async function createSectionComment(input: {
  engagementId: string;
  sectionKey: string;
  body: string;
  authorUserId: string;
  mentionMemberIds?: string[];
}) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  const mentions = JSON.stringify(input.mentionMemberIds ?? []);
  await db.execute({
    sql: `INSERT INTO SectionComment (id, engagementId, sectionKey, text, body, mentionMemberIds, authorUserId, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [id, input.engagementId, input.sectionKey, input.body, input.body, mentions, input.authorUserId, now, now],
  });
  return findSectionCommentById(id);
}

export async function findSectionCommentById(id: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM SectionComment WHERE id = ?`, args: [id] });
  if (!r.rows[0]) return null;
  const parsed = parseRow<Row>(r.rows[0] as Row);
  if (typeof parsed.mentionMemberIds === 'string' && parsed.mentionMemberIds) {
    try { parsed.mentionMemberIds = JSON.parse(parsed.mentionMemberIds as string); }
    catch { /* leave as raw */ }
  } else if (parsed.mentionMemberIds == null) {
    parsed.mentionMemberIds = [];
  }
  return parsed;
}

export async function updateSectionCommentBody(id: string, body: string) {
  const db = getDb();
  const now = new Date().toISOString();
  // Update both body (new) and text (legacy) so the wizard's PUT-driven
  // single-comment view doesn't go stale when a comment is edited via
  // the new PATCH endpoint.
  await db.execute({
    sql: `UPDATE SectionComment SET body = ?, text = ?, updatedAt = ? WHERE id = ?`,
    args: [body, body, now, id],
  });
  return findSectionCommentById(id);
}

export async function deleteSectionCommentById(id: string): Promise<boolean> {
  const db = getDb();
  const exists = await db.execute({ sql: `SELECT 1 FROM SectionComment WHERE id = ?`, args: [id] });
  if (!exists.rows[0]) return false;
  await db.execute({ sql: `DELETE FROM SectionComment WHERE id = ?`, args: [id] });
  return true;
}

/**
 * Phase 39.4 — pull every comment for a section in chronological order
 * and join their bodies with newlines. Used by the AI Advisor route so
 * it sees the full thread context instead of just the first row.
 *
 * Falls back to the legacy `text` column when `body` is null (rows that
 * predate Phase 38.2's column add), so engagements with old-shape
 * comments still surface them to the advisor.
 */
export async function listSectionCommentBodies(engagementId: string, sectionKey: string): Promise<string> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT COALESCE(body, text) AS content
            FROM SectionComment
            WHERE engagementId = ? AND sectionKey = ?
            ORDER BY COALESCE(createdAt, updatedAt) ASC`,
    args: [engagementId, sectionKey],
  });
  const bodies = (r.rows as Array<Record<string, unknown>>)
    .map((row) => (row.content as string | null) ?? '')
    .filter((s) => s.trim().length > 0);
  return bodies.join('\n\n');
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

// Phase 32 — fetch a single decision (by id) for the sign-off acceptor.
export async function findDecisionById(id: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM DecisionItem WHERE id = ?`, args: [id] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

// Phase 32 — apply the client sign-off state to an existing DecisionItem.
// Used by the DECISION_SIGNOFF acceptor on accept (status = SIGNED|DECLINED)
// and by the reject route handler (status = REJECTED).
export async function updateDecisionSignoff(
  id: string,
  data: {
    clientSignoffStatus: 'NONE' | 'PENDING' | 'SIGNED' | 'DECLINED' | 'REJECTED';
    clientSignoffAt?: string | null;
    clientSignoffComment?: string | null;
    clientSignoffMemberId?: string | null;
    clientSignoffSourceSubmissionId?: string | null;
  },
) {
  const db = getDb();
  await db.execute({
    sql: `UPDATE DecisionItem SET
            clientSignoffStatus = ?,
            clientSignoffAt = ?,
            clientSignoffComment = ?,
            clientSignoffMemberId = ?,
            clientSignoffSourceSubmissionId = ?
          WHERE id = ?`,
    args: [
      data.clientSignoffStatus,
      data.clientSignoffAt ?? null,
      data.clientSignoffComment ?? null,
      data.clientSignoffMemberId ?? null,
      data.clientSignoffSourceSubmissionId ?? null,
      id,
    ],
  });
  const r = await db.execute({ sql: `SELECT * FROM DecisionItem WHERE id = ?`, args: [id] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
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

// ─── Action Items (Phase 38.3) ────────────────────────────────────────────────

export async function listActionItems(engagementId: string) {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM ActionItem WHERE engagementId = ? ORDER BY createdAt DESC`,
    args: [engagementId],
  });
  return (r.rows as Row[]).map((row) => parseRow<Row>(row));
}

export async function findActionItemById(id: string) {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM ActionItem WHERE id = ?`, args: [id] });
  return r.rows[0] ? parseRow<Row>(r.rows[0] as Row) : null;
}

export async function createActionItem(engagementId: string, data: {
  title: string;
  description?: string;
  owner?: string;
  priority?: string;
  dueDate?: string;
  status?: string;
  createdBy?: string;
}) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO ActionItem (id, engagementId, title, description, owner, priority, dueDate, status, createdBy, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id, engagementId, data.title, data.description ?? null,
      data.owner ?? null, data.priority ?? 'MEDIUM', data.dueDate ?? null,
      data.status ?? 'OPEN', data.createdBy ?? null, now, now,
    ],
  });
  return findActionItemById(id);
}

export async function updateActionItem(id: string, data: Partial<{
  title: string; description: string; owner: string;
  priority: string; dueDate: string; status: string;
  completedAt: string;
}>) {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  const fields: [string, unknown][] = [
    ['title', data.title], ['description', data.description], ['owner', data.owner],
    ['priority', data.priority], ['dueDate', data.dueDate], ['status', data.status],
    ['completedAt', data.completedAt],
  ];
  for (const [k, v] of fields) {
    if (v !== undefined) { sets.push(`${k} = ?`); args.push(v); }
  }
  if (sets.length === 0) return findActionItemById(id);
  sets.push(`updatedAt = ?`); args.push(new Date().toISOString());
  args.push(id);
  await db.execute({
    sql: `UPDATE ActionItem SET ${sets.join(', ')} WHERE id = ?`,
    args: args as (string | number | boolean | null)[],
  });
  return findActionItemById(id);
}

export async function deleteActionItem(id: string): Promise<boolean> {
  const db = getDb();
  const exists = await db.execute({ sql: `SELECT 1 FROM ActionItem WHERE id = ?`, args: [id] });
  if (!exists.rows[0]) return false;
  await db.execute({ sql: `DELETE FROM ActionItem WHERE id = ?`, args: [id] });
  return true;
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
  // Phase 29 — per-engagement allowlist of wizard question IDs the
  // client may answer from the portal. Defaults to []; the consultant
  // PATCHes the list via the existing /engagements/:id/portal-settings
  // endpoint (Phase 28's body merge accepts unknown fields so no route
  // changes needed). Per-engagement (option b from the design spec)
  // because client-vs-consultant question splits vary per pilot.
  clientAnsweredQuestionIds: string[];
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
  clientAnsweredQuestionIds: [],
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
      args: [token, String((row as Row).id)],
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

/**
 * Lookup a CLIENT-team member by email within a specific engagement.
 * Case-insensitive on email. Returns null if not found.
 */
export async function findClientMemberByEngagementAndEmail(
  engagementId: string,
  email: string,
): Promise<{ id: string; name: string; role: string; email: string; engagementId: string } | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, name, role, email, engagementId FROM ProjectMember
          WHERE engagementId = ? AND team = 'CLIENT' AND LOWER(email) = LOWER(?)
          LIMIT 1`,
    args: [engagementId, email],
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
  const args: InValue[] = [now];
  for (const [k, v] of Object.entries(data)) {
    fields.push(`${k} = ?`);
    args.push((v ?? null) as InValue);
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
  templateId?: string;
  templateSchemaId?: string;
  name: string;
  category: string;
  description?: string;
  assignedTo?: string;
  dueDate?: string;
  status?: string;
  createdBy?: string;
}) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  // Phase 38.3 — templateId is now optional. Top-level "data request"
  // creates from POST /data-collection don't bind to a template; the
  // existing template-driven creates (verticals.ts, reseed.ts) still
  // pass an explicit templateId. Default to '__custom__' for the
  // request-shape rows so the legacy NOT NULL stays satisfied without
  // forcing every caller to invent a sentinel.
  const templateId = data.templateId ?? '__custom__';
  const status = data.status ?? 'PENDING';
  await db.execute({
    sql: `INSERT INTO DataCollectionItem (id, engagementId, templateId, templateSchemaId, name, category, description, status, assignedTo, dueDate, createdBy, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id, engagementId, templateId, data.templateSchemaId ?? null,
      data.name, data.category, data.description ?? null, status,
      data.assignedTo ?? null, data.dueDate ?? null, data.createdBy ?? null, now, now,
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

// Phase 38.3 — used by dataFileAcceptor to emit DATA_REQUEST_FULFILLED
// activity entries with the item's name in the detail string.
export async function findDataCollectionItemById(id: string) {
  const db = getDb();
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
      try { parsed.validationResult = JSON.parse(parsed.validationResult as string); } catch { /* swallow — idempotent migration / parse fallback */ }
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
      try { parsed.validationResult = JSON.parse(parsed.validationResult as string); } catch { /* swallow — idempotent migration / parse fallback */ }
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
  /** Phase 30 — optional submission ID that promoted this DataFile from
   *  staging via the §5.1 pending-review flow. Used by the dataFileAcceptor's
   *  idempotency guard. NULL for direct (legacy) uploads. */
  sourceSubmissionId?: string;
}) {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO DataFile (id, engagementId, dataCollectionItemId, filename, originalName, mimeType, sizeBytes, uploadedBy, sourceSubmissionId, createdAt)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [id, data.engagementId, data.dataCollectionItemId, data.filename, data.originalName, data.mimeType, data.sizeBytes, data.uploadedBy ?? null, data.sourceSubmissionId ?? null, now],
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
    try { parsed.validationResult = JSON.parse(parsed.validationResult as string); } catch { /* swallow — idempotent migration / parse fallback */ }
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

// ─── Custom Adaptor (Phase 2) ────────────────────────────────────────────────

export type CustomAdaptorStatus = 'DRAFT' | 'PARSING' | 'READY' | 'PUBLISHED' | 'FAILED' | 'ARCHIVED';

export interface CustomAdaptorRow {
  id: string;
  firmId: string;
  name: string;
  slug: string;
  status: CustomAdaptorStatus;
  sourceDocuments: Array<{ filename: string; originalName: string; mimeType: string; size: number; uploadedAt: string }>;
  parsedManifest: unknown;
  parsedSchema: unknown;
  parsedLicense: unknown;
  parsedPhases: unknown;
  parsedGenerators: unknown;
  parsedRules: unknown;
  parseError: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function createCustomAdaptor(data: {
  firmId: string;
  name: string;
  slug: string;
}): Promise<CustomAdaptorRow> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO CustomAdaptor (id, firmId, name, slug, status) VALUES (?, ?, ?, ?, 'DRAFT')`,
    args: [id, data.firmId, data.name, data.slug],
  });
  const row = await findCustomAdaptorById(id);
  if (!row) throw new Error('custom adaptor insert failed');
  return row;
}

export async function findCustomAdaptorById(id: string): Promise<CustomAdaptorRow | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM CustomAdaptor WHERE id = ?`, args: [id] });
  if (!r.rows[0]) return null;
  return parseRow<CustomAdaptorRow>(r.rows[0] as Row);
}

export async function findCustomAdaptorByFirmAndSlug(firmId: string, slug: string): Promise<CustomAdaptorRow | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM CustomAdaptor WHERE firmId = ? AND slug = ?`,
    args: [firmId, slug],
  });
  if (!r.rows[0]) return null;
  return parseRow<CustomAdaptorRow>(r.rows[0] as Row);
}

export async function listCustomAdaptorsForFirm(firmId: string): Promise<CustomAdaptorRow[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM CustomAdaptor WHERE firmId = ? AND status != 'ARCHIVED' ORDER BY createdAt DESC`,
    args: [firmId],
  });
  return r.rows.map((row) => parseRow<CustomAdaptorRow>(row as Row));
}

export async function listPublishedCustomAdaptorsForFirm(firmId: string): Promise<CustomAdaptorRow[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM CustomAdaptor WHERE firmId = ? AND status = 'PUBLISHED' ORDER BY createdAt DESC`,
    args: [firmId],
  });
  return r.rows.map((row) => parseRow<CustomAdaptorRow>(row as Row));
}

export async function appendCustomAdaptorDocument(
  id: string,
  doc: { filename: string; originalName: string; mimeType: string; size: number },
): Promise<CustomAdaptorRow> {
  const row = await findCustomAdaptorById(id);
  if (!row) throw new Error('custom adaptor not found');
  const docs = Array.isArray(row.sourceDocuments) ? row.sourceDocuments : [];
  docs.push({ ...doc, uploadedAt: new Date().toISOString() });
  const db = getDb();
  await db.execute({
    sql: `UPDATE CustomAdaptor SET sourceDocuments = ?, updatedAt = datetime('now') WHERE id = ?`,
    args: [JSON.stringify(docs), id],
  });
  const updated = await findCustomAdaptorById(id);
  if (!updated) throw new Error('custom adaptor update failed');
  return updated;
}

export async function updateCustomAdaptorStatus(
  id: string,
  status: CustomAdaptorStatus,
  parseError?: string | null,
): Promise<CustomAdaptorRow> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE CustomAdaptor SET status = ?, parseError = ?, updatedAt = datetime('now') WHERE id = ?`,
    args: [status, parseError ?? null, id],
  });
  const updated = await findCustomAdaptorById(id);
  if (!updated) throw new Error('custom adaptor not found');
  return updated;
}

export async function savePlatformAdaptorDraft(
  id: string,
  parsed: {
    manifest: unknown;
    schema: unknown;
    license: unknown;
    phases: unknown;
    generators: unknown;
    rules?: unknown;
  },
): Promise<CustomAdaptorRow> {
  const db = getDb();
  await db.execute({
    sql: `
      UPDATE CustomAdaptor
         SET parsedManifest   = ?,
             parsedSchema     = ?,
             parsedLicense    = ?,
             parsedPhases     = ?,
             parsedGenerators = ?,
             parsedRules      = ?,
             status           = 'READY',
             parseError       = NULL,
             updatedAt        = datetime('now')
       WHERE id = ?
    `,
    args: [
      JSON.stringify(parsed.manifest),
      JSON.stringify(parsed.schema),
      JSON.stringify(parsed.license),
      JSON.stringify(parsed.phases),
      JSON.stringify(parsed.generators),
      // rules is optional on the input — pass null when absent so existing
      // AI-parse callers (which don't yet emit rule packs) keep working.
      parsed.rules === undefined ? null : JSON.stringify(parsed.rules),
      id,
    ],
  });
  const updated = await findCustomAdaptorById(id);
  if (!updated) throw new Error('custom adaptor save failed');
  return updated;
}

export async function publishCustomAdaptor(id: string): Promise<CustomAdaptorRow> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE CustomAdaptor SET status = 'PUBLISHED', publishedAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?`,
    args: [id],
  });
  const updated = await findCustomAdaptorById(id);
  if (!updated) throw new Error('custom adaptor not found');
  return updated;
}

export async function archiveCustomAdaptor(id: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE CustomAdaptor SET status = 'ARCHIVED', updatedAt = datetime('now') WHERE id = ?`,
    args: [id],
  });
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
  updateFirmBranding,
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

// ─── Re-exports for Phase 16 password reset ──────────────────────────────────
export {
  createPasswordResetToken,
  findActivePasswordResetTokenByHash,
  consumePasswordResetToken,
  invalidateActivePasswordResetsForUser,
  purgeExpiredPasswordResetTokens,
} from './passwordResetToken.js';
export type { PasswordResetToken } from './passwordResetToken.js';

// ─── Re-exports for Phase 19 email verification ──────────────────────────────
export {
  createEmailVerificationToken,
  findActiveEmailVerificationTokenByHash,
  consumeEmailVerificationToken,
  invalidateActiveEmailVerificationsForUser,
  markUserEmailVerified,
} from './emailVerificationToken.js';
export type { EmailVerificationToken } from './emailVerificationToken.js';

// ─── Re-exports for Phase 43.1 RBAC helpers ─────────────────────────────────
export {
  grantFirmRole,
  revokeFirmRole,
  listFirmRolesForUser,
  listFirmUsersWithRoles,
  listFirmUsersByRole,
  listEngagementUsersByRole,
  grantEngagementRole,
  revokeEngagementRole,
  listEngagementRolesForUser,
  listEngagementRolesForEngagement,
  listRoleAuditLog,
  bootstrapFirmAdmin,
  backfillAppAdmins,
} from './rbac.js';
export type {
  RoleAuditEntry,
  GrantFirmRoleArgs,
  GrantEngagementRoleArgs,
  RevokeEngagementRoleArgs,
  EngagementRoleAssignment,
  EngagementRoleRow,
  FirmUserWithRoles,
  FirmRoleUserContact,
  BackfillResult,
} from './rbac.js';

// ─── Re-exports for Phase 46.4 SOW versioning ───────────────────────────────
export {
  nextSowVersion,
  recordSowVersion,
  listSowVersionsByEngagement,
  findLatestSowVersion,
  setSowSignedFileUrl,
} from './sowVersion.js';
export type { EngagementSowVersion } from './sowVersion.js';

// ─── Re-exports for Phase 46.2 Discovery Lite ───────────────────────────────
export {
  findDiscoveryLite,
  findDiscoveryLiteByShareToken,
  upsertDiscoveryLite,
  listDiscoveryLiteByEngagementIds,
  newShareToken,
} from './discoveryLite.js';
export type { EngagementDiscoveryLite } from './discoveryLite.js';

// ─── Re-exports for Phase 45.8 renewal tracker ──────────────────────────────
export {
  findRenewalState,
  upsertRenewalState,
} from './renewalState.js';
export type {
  EngagementRenewalState,
  UpsertRenewalStateArgs,
} from './renewalState.js';

// ─── Re-exports for Phase 45.6 ticket queue ─────────────────────────────────
export {
  createTicket,
  findTicketById,
  listTicketsByEngagement,
  listOpenTicketsByFirm,
  addTicketMessage,
  listTicketMessages,
  findFirstSupportReplyAt,
  updateTicketStatus,
  assignTicket,
} from './tickets.js';
export type { Ticket, TicketMessage, TicketStatusChange } from './tickets.js';

// ─── Re-exports for Phase 45.1 closeout checklist ───────────────────────────
export {
  createCloseoutChecklist,
  listCloseoutChecklist,
  updateCloseoutChecklistItem,
} from './closeoutChecklist.js';
export type {
  CloseoutChecklistRow,
  UpdateCloseoutChecklistItemArgs,
} from './closeoutChecklist.js';
