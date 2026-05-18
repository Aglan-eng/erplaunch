/**
 * Phase 52.3 — `CustomerSummary` aggregator.
 *
 * The `GET /api/customers` list endpoint and the `PATCH
 * /api/customers/:id/stage` response both return a flat row shape
 * tuned for the kanban + list views: id, name, currentStage,
 * primaryOwner (resolved name + id via the locked multi-owner
 * contract), healthScore + band, renewalCount, lastActivityAt, arr.
 *
 * This module hides the per-summary joins (User name lookup,
 * ActivityLog max(createdAt)) so the route layer stays a thin
 * filter/sort/pagination shell.
 */

import { getDb } from './index.js';
import {
  CUSTOMER_STAGES,
  type Customer,
  type CustomerStage,
  type ListCustomersFilters,
  effectiveOwnerUserId,
  healthBand,
  listCustomersByFirm,
} from './customer.js';

export interface CustomerSummary {
  id: string;
  name: string;
  currentStage: CustomerStage;
  primaryOwnerName: string;
  primaryOwnerId: string;
  healthScore: number;
  healthBand: 'red' | 'yellow' | 'green';
  renewalCount: number;
  lastActivityAt: string | null;
  /** Dollar value (NOT cents) — Customer.dealValue is stored as
   *  cents and this field divides by 100 at the boundary so the
   *  UI doesn't have to know. */
  arr: number | null;
}

/**
 * Look up the display name for a userId. Falls through to the
 * userId itself when the user can't be found (so the UI still
 * renders something rather than crashing on a missing join).
 */
async function resolveUserName(userId: string | null): Promise<string> {
  if (!userId) return '';
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT name FROM User WHERE id = ? LIMIT 1`,
    args: [userId],
  });
  const row = r.rows[0] as { name?: string } | undefined;
  return row?.name ?? userId;
}

/**
 * Most-recent ActivityLog row for a customer. Returns ISO string
 * of `createdAt` or null when the customer has no activity yet.
 * Reads the `customerId` parallel column (added in Phase 52.1) so
 * native-create customers from Phase 52.2+ also get coverage once
 * they have activity rows. Falls back to engagementId-via-
 * sourceEngagementId for backfilled customers whose existing
 * activity rows pre-date the customerId column population.
 */
async function getLastActivityAt(
  customerId: string,
  sourceEngagementId: string | null,
): Promise<string | null> {
  const db = getDb();
  // Prefer customerId — it's the canonical link going forward.
  const direct = await db.execute({
    sql: `SELECT MAX(createdAt) AS ts FROM ActivityLog WHERE customerId = ?`,
    args: [customerId],
  });
  const directTs = (direct.rows[0] as { ts?: string | null } | undefined)?.ts;
  if (directTs) return directTs;

  if (!sourceEngagementId) return null;
  const fallback = await db.execute({
    sql: `SELECT MAX(createdAt) AS ts FROM ActivityLog WHERE engagementId = ?`,
    args: [sourceEngagementId],
  });
  return (fallback.rows[0] as { ts?: string | null } | undefined)?.ts ?? null;
}

/**
 * Build a CustomerSummary for a single Customer row. The per-row
 * cost is one Customer fetch (already in hand), one User lookup,
 * one ActivityLog max(createdAt), one computeHealth. For the
 * list endpoint we call this in parallel via Promise.all — at the
 * expected scale (low hundreds of customers per firm) the N+1 cost
 * is acceptable. If we ever cross thousands of rows per request we
 * promote to a single JOIN'd query.
 */
export async function buildCustomerSummary(customer: Customer): Promise<CustomerSummary> {
  const ownerId =
    effectiveOwnerUserId({
      currentStage: customer.currentStage,
      salesOwnerUserId: customer.salesOwnerUserId,
      projectLeadUserId: customer.projectLeadUserId,
      csmUserId: customer.csmUserId,
    }) ?? '';
  const [ownerName, lastActivityAt] = await Promise.all([
    resolveUserName(ownerId || null),
    getLastActivityAt(customer.id, customer.sourceEngagementId),
  ]);
  // Phase 52.3.1 — read the persisted column rather than calling
  // the old computeHealth stub. The reconcile worker + the stage-
  // transition hook keep the column fresh; archived customers
  // floor to 0 as the canonical "no signal" value.
  const healthScore = customer.isArchived
    ? 0
    : customer.health ?? 0;
  const band = healthBand(healthScore);
  const summaryBand: 'red' | 'yellow' | 'green' = band === 'unknown' ? 'red' : band;
  return {
    id: customer.id,
    name: customer.name,
    currentStage: customer.currentStage,
    primaryOwnerName: ownerName,
    primaryOwnerId: ownerId,
    healthScore,
    healthBand: summaryBand,
    renewalCount: customer.renewalCount,
    lastActivityAt,
    arr: customer.dealValue == null ? null : customer.dealValue / 100,
  };
}

export type CustomerSortField = 'name' | 'stage' | 'health' | 'lastActivity';
export type SortOrder = 'asc' | 'desc';

export interface ListCustomerSummariesOptions extends ListCustomersFilters {
  sortField?: CustomerSortField;
  sortOrder?: SortOrder;
  /** Optional health-band filter applied AFTER summaries are built
   *  (health is computed, not a column). */
  healthBands?: Array<'red' | 'yellow' | 'green'>;
}

const STAGE_ORDER_INDEX = new Map<string, number>(
  (CUSTOMER_STAGES as ReadonlyArray<string>).map((s, i) => [s, i] as [string, number]),
);

function stageIndex(stage: string): number {
  return STAGE_ORDER_INDEX.get(stage) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Public list entrypoint for the `GET /api/customers` route. Pulls
 * the Customer rows via the existing `listCustomersByFirm` helper,
 * builds a summary for each, applies the post-query health-band
 * filter (since health is computed), and sorts.
 */
export async function listCustomerSummaries(
  firmId: string,
  options: ListCustomerSummariesOptions = {},
): Promise<CustomerSummary[]> {
  const customers = await listCustomersByFirm(firmId, {
    stages: options.stages,
    group: options.group,
    ownerUserId: options.ownerUserId,
    includeArchived: options.includeArchived,
    search: options.search,
    // Pull more than the requested limit so the post-filter health-
    // band cut still has rows to return. For the v1 scale (firms <
    // ~500 customers) this is fine; promote to a SQL CASE expression
    // if it ever matters.
    limit: (options.limit ?? 200) * 2,
    offset: 0,
  });

  let summaries = await Promise.all(customers.map(buildCustomerSummary));

  if (options.healthBands && options.healthBands.length > 0) {
    const wanted = new Set(options.healthBands);
    summaries = summaries.filter((s) => wanted.has(s.healthBand));
  }

  // Sort
  const sortField = options.sortField ?? 'name';
  const sortOrder = options.sortOrder ?? 'asc';
  const dir = sortOrder === 'desc' ? -1 : 1;
  summaries.sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'stage':
        cmp = stageIndex(a.currentStage) - stageIndex(b.currentStage);
        break;
      case 'health':
        cmp = a.healthScore - b.healthScore;
        break;
      case 'lastActivity': {
        const av = a.lastActivityAt ?? '';
        const bv = b.lastActivityAt ?? '';
        cmp = av.localeCompare(bv);
        break;
      }
    }
    return cmp * dir;
  });

  // Paginate AFTER sort.
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 200;
  return summaries.slice(offset, offset + limit);
}
