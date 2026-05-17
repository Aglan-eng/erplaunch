/**
 * Phase 52.1 — Engagement → Customer backfill migration.
 *
 * Runs once on first boot after the Phase 52.1 deploy (idempotent —
 * subsequent boots are a true no-op once Customer is populated).
 *
 * Strategy: Customer.id is set EQUAL to Engagement.id during
 * backfill. This means:
 *   1. Every existing `engagementId` foreign key on the ~35 child
 *      tables keeps resolving without a rewrite.
 *   2. The parallel `customerId` column we add to each child table
 *      can be populated by a single `UPDATE <child> SET customerId =
 *      engagementId WHERE customerId IS NULL` — no per-row mapping.
 *   3. The Phase 52.6 cutover drops `engagementId` columns once all
 *      route-layer queries have migrated to `customerId`.
 *
 * Spec note: the Phase 52 spec describes merging a separate
 * `SalesPipeline` table into Customer. No such table exists in this
 * codebase — sales pipeline lived on `Engagement.status` IN
 * (PROSPECT, PROPOSED, CONTRACTED). The unified `currentStage` from
 * `mapEngagementStatusToStage` covers both sides of the journey.
 */

import { getDb } from './index.js';
import { insertCustomer, mapEngagementStatusToStage } from './customer.js';

export interface CustomerBackfillResult {
  status:
    | 'BACKFILLED'
    | 'SKIPPED_ALREADY_POPULATED'
    | 'SKIPPED_NO_ENGAGEMENTS'
    | 'PARTIAL_FAILURE';
  migratedCount: number;
  childRowsLinked: number;
  childTablesTouched: number;
  errors: string[];
}

/**
 * The complete list of child tables that today reference
 * `Engagement.id` via an `engagementId` column. Phase 52.1 adds a
 * parallel `customerId` column to each (idempotent ALTER) and
 * backfills it.
 *
 * Order doesn't matter for the backfill since the SQL is per-table
 * idempotent. Listed alphabetically for review.
 */
const CHILD_TABLES_WITH_ENGAGEMENT_FK: ReadonlyArray<string> = [
  'ActionItem',
  'ActivityLog',
  'AIAdvice',
  'BusinessProfile',
  'ClientPortalToken',
  'CloseoutChecklistItem',
  'ConflictLog',
  'ConversationThread',
  'DataCollectionItem',
  'DataFile',
  'DataTemplateSchema',
  'DecisionItem',
  'EngagementDiscoveryLite',
  'EngagementLossDetail',
  'EngagementRenewalState',
  'EngagementRole',
  'EngagementSowSignature',
  'EngagementSowVersion',
  'GeneratedDocument',
  'GenerationJob',
  'IssueItem',
  'LicenseProfile',
  'MeetingNote',
  'MigrationItem',
  'PendingSubmission',
  'Phase',
  'PortalMagicLink',
  'PortalSession',
  'PortalTodo',
  'ProjectMember',
  'RiskItem',
  'SectionComment',
  'SectionImage',
  'StagedFile',
  'Ticket',
];

/**
 * Add a `customerId TEXT REFERENCES Customer(id)` column to every
 * child table. Idempotent — re-runs are no-ops because libSQL throws
 * on duplicate column.
 *
 * We intentionally do NOT add `ON DELETE CASCADE` here, even on tables
 * whose existing engagementId FK has it. The Customer row should
 * never be deleted (it's the audit anchor for the whole history);
 * archival sets `isArchived = 1` instead. Cascade semantics stay on
 * the legacy `engagementId` FK until Phase 52.6 cutover removes it.
 */
export async function ensureChildCustomerIdColumns(): Promise<{ touchedCount: number; errors: string[] }> {
  const db = getDb();
  const errors: string[] = [];
  let touchedCount = 0;
  for (const table of CHILD_TABLES_WITH_ENGAGEMENT_FK) {
    try {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN customerId TEXT REFERENCES Customer(id)`);
      touchedCount++;
    } catch (err) {
      // libSQL throws on "duplicate column name" — the column
      // already exists from a prior boot. That's the success path
      // for an idempotent run; swallow.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes('duplicate') && !msg.toLowerCase().includes('exists')) {
        errors.push(`${table}: ${msg}`);
      }
    }
  }
  return { touchedCount, errors };
}

/**
 * Populate the new `customerId` column on each child table by
 * copying the existing `engagementId` value. Since
 * `Customer.id = Engagement.id` (set by the backfill itself), this
 * is a one-shot UPDATE per table.
 *
 * Skips rows where customerId is already set (idempotent on partial
 * backfills).
 */
async function linkChildRowsToCustomers(): Promise<{ rowsLinked: number; tablesTouched: number; errors: string[] }> {
  const db = getDb();
  const errors: string[] = [];
  let rowsLinked = 0;
  let tablesTouched = 0;
  for (const table of CHILD_TABLES_WITH_ENGAGEMENT_FK) {
    try {
      const r = await db.execute(
        `UPDATE ${table} SET customerId = engagementId WHERE customerId IS NULL AND engagementId IS NOT NULL`,
      );
      // libSQL returns `rowsAffected` (camelCase) on the result.
      const affected = Number((r as unknown as { rowsAffected?: number }).rowsAffected ?? 0);
      if (affected > 0) {
        rowsLinked += affected;
        tablesTouched++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${table}: ${msg}`);
    }
  }
  return { rowsLinked, tablesTouched, errors };
}

interface EngagementRow {
  id: unknown;
  firmId: unknown;
  clientName: unknown;
  status: unknown;
  previousStatus: unknown;
  startDate: unknown;
  contractEndDate: unknown;
  leadSource: unknown;
  estimatedValue: unknown;
  salesRepUserId: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

/**
 * Convert a row's deal value (stored as `Engagement.estimatedValue REAL`,
 * representing dollars with decimals — e.g. 25000.50) to the Customer
 * schema's INTEGER cents. NULL stays NULL.
 */
function dollarsToCents(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Derive a URL slug from the customer name. Lowercase, alnum + hyphens
 * only, truncated to 60 chars. Not guaranteed unique across the firm —
 * Phase 52.2+ surfaces handle collisions if it matters; for backfill we
 * accept duplicates.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'customer';
}

/**
 * Public entrypoint. Wired into `initDb()` at the bottom of the boot
 * sequence (after Brand Pack seed).
 */
export async function backfillCustomersFromEngagements(): Promise<CustomerBackfillResult> {
  const db = getDb();

  // Idempotency gate: if Customer is already populated, skip
  // entirely. This is the steady-state path on every boot after the
  // first.
  const existingCustomerCount = await db.execute(`SELECT COUNT(*) AS c FROM Customer`);
  const customerCount = Number(
    (existingCustomerCount.rows[0] as { c?: number | string } | undefined)?.c ?? 0,
  );
  if (customerCount > 0) {
    // Still ensure the child-customerId columns exist and any
    // newly-created Engagement rows (from old code paths still
    // running pre-cutover) get their child rows linked. This is the
    // bridge that keeps Customer in sync during the transition
    // window.
    await ensureChildCustomerIdColumns();
    const link = await linkChildRowsToCustomers();
    return {
      status: 'SKIPPED_ALREADY_POPULATED',
      migratedCount: 0,
      childRowsLinked: link.rowsLinked,
      childTablesTouched: link.tablesTouched,
      errors: link.errors,
    };
  }

  // No customers yet — does the Engagement table have anything to
  // migrate?
  const engagementCount = await db.execute(`SELECT COUNT(*) AS c FROM Engagement`);
  const engCount = Number(
    (engagementCount.rows[0] as { c?: number | string } | undefined)?.c ?? 0,
  );
  if (engCount === 0) {
    // Fresh deploy / fresh dev DB. Ensure the child columns exist
    // anyway so subsequent native creates work; nothing to backfill.
    await ensureChildCustomerIdColumns();
    return {
      status: 'SKIPPED_NO_ENGAGEMENTS',
      migratedCount: 0,
      childRowsLinked: 0,
      childTablesTouched: 0,
      errors: [],
    };
  }

  // Real backfill. Add the customerId columns first so the
  // link-children step at the end has a column to write to.
  const columnsResult = await ensureChildCustomerIdColumns();
  const errors: string[] = [...columnsResult.errors];

  // Pull every Engagement row. For prod-sized datasets (low
  // thousands) this is fine; if we ever cross 100k engagements per
  // boot we'd batch — but at that scale this is a one-shot migration
  // anyway.
  const rows = await db.execute(`
    SELECT id, firmId, clientName, status, previousStatus,
           startDate, contractEndDate,
           leadSource, estimatedValue, salesRepUserId,
           createdAt, updatedAt
    FROM Engagement
  `);

  let migratedCount = 0;
  for (const raw of rows.rows) {
    const row = raw as unknown as EngagementRow;
    try {
      const status = String(row.status ?? 'DISCOVERY');
      const previousStatus = row.previousStatus == null ? null : String(row.previousStatus);
      const stage = mapEngagementStatusToStage(status, previousStatus);
      const isArchived = status === 'ARCHIVED';
      const name = String(row.clientName ?? '');
      await insertCustomer({
        id: String(row.id),
        firmId: String(row.firmId),
        name,
        slug: slugify(name),
        currentStage: stage,
        // Engagement.salesRepUserId backfills the Customer's sales
        // owner column directly (Phase 46.1 stamped this on
        // createProspect). Project lead, CSM, and AR owner are
        // unset at backfill — the app populates them as engagements
        // progress through the new IA.
        salesOwnerUserId: row.salesRepUserId == null ? null : String(row.salesRepUserId),
        projectLeadUserId: null,
        csmUserId: null,
        arOwnerUserId: null,
        leadSource: row.leadSource == null ? null : String(row.leadSource),
        industry: null,
        dealValue: dollarsToCents(row.estimatedValue),
        modules: null,
        startDate: row.startDate == null ? null : String(row.startDate),
        targetGoLive: null,
        contractEndDate: row.contractEndDate == null ? null : String(row.contractEndDate),
        cutoverStrategy: null,
        renewalCount: 0,
        isArchived,
        sourceEngagementId: String(row.id),
        createdAt: row.createdAt == null ? new Date().toISOString() : String(row.createdAt),
        updatedAt: row.updatedAt == null ? new Date().toISOString() : String(row.updatedAt),
      });
      migratedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Engagement ${String(row.id)}: ${msg}`);
    }
  }

  // Now link the child rows. Since we preserved Engagement.id ==
  // Customer.id, this is a flat UPDATE per table.
  const link = await linkChildRowsToCustomers();
  errors.push(...link.errors);

  return {
    status: errors.length === 0 ? 'BACKFILLED' : 'PARTIAL_FAILURE',
    migratedCount,
    childRowsLinked: link.rowsLinked,
    childTablesTouched: link.tablesTouched,
    errors,
  };
}
