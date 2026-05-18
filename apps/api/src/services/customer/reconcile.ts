/**
 * Phase 52.3.1 — backfill-gap reconciliation.
 *
 * Three idempotent operations that close the gaps the new /customers
 * page surfaced from the original Phase 52.1 backfill:
 *
 *   1. `reconcileEngagementsToCustomers(firmId)` — for every
 *      Engagement in the firm that has no matching Customer row
 *      (id === id), insert one. Stage mapped via
 *      `mapEngagementStatusToStage`. Owner field chosen by lock #2
 *      based on the resulting stage.
 *
 *   2. `backfillCustomerOwners(firmId)` — for every Customer with
 *      all four owner fields null, look up the matching Engagement +
 *      its EngagementRole rows and populate the right owner field
 *      per lock #2. Falls back to Engagement.salesRepUserId when no
 *      role row matches.
 *
 *   3. `recomputeAllHealth(firmId)` — loop every Customer in the
 *      firm and persist a freshly computed score (composite formula
 *      from `health.ts`) onto the `Customer.health` column.
 *
 * All three are idempotent: rerunning is a no-op when there's
 * nothing to do, and partial-failure paths don't corrupt the row.
 * They're called from `server.ts` at startup per firm AND from the
 * admin route `POST /api/v1/admin/customer/reconcile`.
 */

import { getDb } from '../../db/index.js';
import {
  CUSTOMER_STAGES,
  type CustomerStage,
  mapEngagementStatusToStage,
  stageGroup,
} from '../../db/customer.js';
import { recomputeAndPersistHealth } from './health.js';

export interface ReconcileResult {
  firmId: string;
  created: number;
  ownersFilled: number;
  healthUpdated: number;
}

interface EngagementRowForReconcile {
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
 * Which owner column on Customer should carry the engagement's
 * named owner for the given stage. Mirrors the
 * `effectiveOwnerUserId` mapping but here it's the WRITE side of
 * the same contract.
 */
type OwnerColumn = 'salesOwnerUserId' | 'projectLeadUserId' | 'csmUserId';

function ownerColumnForStage(stage: CustomerStage): OwnerColumn {
  const group = stageGroup(stage);
  // Lock #2:
  //   LEAD..WON                 → salesOwnerUserId
  //   DISCOVERY..GOLIVE         → projectLeadUserId
  //   HYPERCARE..RENEWED        → csmUserId
  if (group === 'pre-sales' || stage === 'WON') return 'salesOwnerUserId';
  if (group === 'delivery' || stage === 'GOLIVE') return 'projectLeadUserId';
  return 'csmUserId';
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'customer'
  );
}

function dollarsToCents(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

// ─── EngagementRole resolver ───────────────────────────────────────────────

/**
 * Find the user assigned to a given role on an engagement. Returns
 * null when no row matches. The role names used in this codebase
 * are PROJECT_LEAD, SALES_REP, SME, CLIENT_SPONSOR, SUPPORT (etc.).
 * Only the first two matter for the Phase 52.1 owner backfill.
 */
async function findRoleUserId(
  engagementId: string,
  role: string,
): Promise<string | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT userId FROM EngagementRole
          WHERE engagementId = ? AND role = ?
          ORDER BY createdAt ASC
          LIMIT 1`,
    args: [engagementId, role],
  });
  const row = r.rows[0] as { userId?: string } | undefined;
  return row?.userId ?? null;
}

// ─── Pass 1: reconcile Engagements → Customers ─────────────────────────────

export async function reconcileEngagementsToCustomers(firmId: string): Promise<number> {
  const db = getDb();
  // Find Engagement rows in this firm with no matching Customer.
  const orphans = await db.execute({
    sql: `SELECT e.id, e.firmId, e.clientName, e.status, e.previousStatus,
                 e.startDate, e.contractEndDate, e.leadSource, e.estimatedValue,
                 e.salesRepUserId, e.createdAt, e.updatedAt
          FROM Engagement e
          LEFT JOIN Customer c ON c.id = e.id
          WHERE e.firmId = ? AND c.id IS NULL`,
    args: [firmId],
  });

  let created = 0;
  for (const raw of orphans.rows) {
    const row = raw as unknown as EngagementRowForReconcile;
    try {
      const engagementId = String(row.id);
      const status = String(row.status ?? 'DISCOVERY');
      const previousStatus =
        row.previousStatus == null ? null : String(row.previousStatus);
      const stage = mapEngagementStatusToStage(status, previousStatus);
      const isArchived = status === 'ARCHIVED' ? 1 : 0;
      const name = String(row.clientName ?? `Customer ${engagementId.slice(0, 8)}`);

      // Resolve the right owner column for the resulting stage.
      // For pre-sales stages we keep the engagement's salesRepUserId
      // (Phase 46.1 stamped this on createProspect). For post-Won
      // stages we look up the PROJECT_LEAD role; CSM-stage rows fall
      // through to "all null" and let the second pass handle them.
      const salesRep = row.salesRepUserId == null ? null : String(row.salesRepUserId);
      let salesOwner: string | null = null;
      let projectLead: string | null = null;
      let csm: string | null = null;
      const ownerCol = ownerColumnForStage(stage);
      if (ownerCol === 'salesOwnerUserId') {
        salesOwner = salesRep;
      } else if (ownerCol === 'projectLeadUserId') {
        projectLead = (await findRoleUserId(engagementId, 'PROJECT_LEAD')) ?? salesRep;
      } else {
        // CSM column — no role conventionally maps; populate
        // salesRep on the sales column as a record-keeping tail so
        // it isn't lost, and leave csmUserId null for backfill 2.
        salesOwner = salesRep;
      }

      const now = new Date().toISOString();
      await db.execute({
        sql: `INSERT INTO Customer (
                id, firmId, name, slug, currentStage,
                salesOwnerUserId, projectLeadUserId, csmUserId, arOwnerUserId,
                leadSource, industry, dealValue, modules,
                startDate, targetGoLive, contractEndDate, cutoverStrategy,
                renewalCount, isArchived, sourceEngagementId,
                createdAt, updatedAt
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          engagementId,
          String(row.firmId),
          name,
          slugify(name),
          stage,
          salesOwner,
          projectLead,
          csm,
          null,
          row.leadSource == null ? null : String(row.leadSource),
          null,
          dollarsToCents(row.estimatedValue),
          null,
          row.startDate == null ? null : String(row.startDate),
          null,
          row.contractEndDate == null ? null : String(row.contractEndDate),
          null,
          0,
          isArchived,
          engagementId,
          row.createdAt == null ? now : String(row.createdAt),
          row.updatedAt == null ? now : String(row.updatedAt),
        ],
      });
      created++;
    } catch (err) {
      // Non-fatal — log and continue with the next row.
      // eslint-disable-next-line no-console
      console.error(
        `[52.3.1 reconcile] firm=${firmId} engagement=${String(row.id)} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return created;
}

// ─── Pass 2: backfill owner columns on Customers that landed null ──────────

interface CustomerOwnerRow {
  id: unknown;
  currentStage: unknown;
  sourceEngagementId: unknown;
  firmId: unknown;
}

export async function backfillCustomerOwners(firmId: string): Promise<number> {
  const db = getDb();
  // Pick customers in the firm with ALL four owner columns null.
  // Customers that have at least one owner are left alone — we don't
  // overwrite explicit assignments.
  const targets = await db.execute({
    sql: `SELECT id, currentStage, sourceEngagementId, firmId
          FROM Customer
          WHERE firmId = ?
            AND salesOwnerUserId IS NULL
            AND projectLeadUserId IS NULL
            AND csmUserId IS NULL
            AND arOwnerUserId IS NULL`,
    args: [firmId],
  });

  let filled = 0;
  for (const raw of targets.rows) {
    const row = raw as unknown as CustomerOwnerRow;
    try {
      const customerId = String(row.id);
      const rawStage = String(row.currentStage ?? 'LEAD');
      const stage = (CUSTOMER_STAGES as readonly string[]).includes(rawStage)
        ? (rawStage as CustomerStage)
        : 'LEAD';
      const engagementId =
        row.sourceEngagementId == null ? null : String(row.sourceEngagementId);

      // Try to resolve a userId from the matching Engagement.
      let userId: string | null = null;
      if (engagementId) {
        const ownerCol = ownerColumnForStage(stage);
        if (ownerCol === 'projectLeadUserId') {
          userId = await findRoleUserId(engagementId, 'PROJECT_LEAD');
        }
        if (!userId) {
          // Fall back to salesRepUserId on the engagement row.
          const eng = await db.execute({
            sql: `SELECT salesRepUserId FROM Engagement WHERE id = ?`,
            args: [engagementId],
          });
          const rep = (eng.rows[0] as { salesRepUserId?: string | null } | undefined)
            ?.salesRepUserId;
          if (rep) userId = String(rep);
        }
      }
      // Last-resort fallback per spec §1: the firm's primary owner.
      // Take the oldest APP_ADMIN user on the firm — that's the most
      // stable proxy for "the firm's owner" we have at the data layer.
      if (!userId) {
        const admin = await db.execute({
          sql: `SELECT id FROM User
                WHERE firmId = ?
                ORDER BY CASE role WHEN 'APP_ADMIN' THEN 0 ELSE 1 END, createdAt ASC
                LIMIT 1`,
          args: [String(row.firmId)],
        });
        const id = (admin.rows[0] as { id?: string } | undefined)?.id;
        if (id) userId = id;
      }
      if (!userId) continue;

      const ownerCol = ownerColumnForStage(stage);
      const now = new Date().toISOString();
      await db.execute({
        sql: `UPDATE Customer SET ${ownerCol} = ?, updatedAt = ? WHERE id = ?`,
        args: [userId, now, customerId],
      });
      filled++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[52.3.1 reconcile] firm=${firmId} customer=${String(row.id)} owner-backfill failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return filled;
}

// ─── Pass 3: recompute + persist health for every Customer ─────────────────

export async function recomputeAllHealth(firmId: string): Promise<number> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id FROM Customer WHERE firmId = ?`,
    args: [firmId],
  });
  let updated = 0;
  for (const row of r.rows) {
    const id = String((row as unknown as { id: unknown }).id);
    try {
      await recomputeAndPersistHealth(id);
      updated++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[52.3.1 reconcile] firm=${firmId} customer=${id} health-recompute failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return updated;
}

// ─── Combined entrypoint ───────────────────────────────────────────────────

export async function reconcileFirmCustomers(firmId: string): Promise<ReconcileResult> {
  const created = await reconcileEngagementsToCustomers(firmId);
  const ownersFilled = await backfillCustomerOwners(firmId);
  const healthUpdated = await recomputeAllHealth(firmId);
  return { firmId, created, ownersFilled, healthUpdated };
}

/**
 * Run the three passes across every firm in the DB. Used by the
 * server.ts startup hook + the admin endpoint when no firmId is
 * specified.
 */
export async function reconcileAllFirms(): Promise<ReconcileResult[]> {
  const db = getDb();
  const firms = await db.execute(`SELECT id FROM Firm`);
  const out: ReconcileResult[] = [];
  for (const row of firms.rows) {
    const firmId = String((row as unknown as { id: unknown }).id);
    try {
      const result = await reconcileFirmCustomers(firmId);
      out.push(result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[52.3.1 reconcile] firm=${firmId} reconcileAllFirms failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return out;
}
