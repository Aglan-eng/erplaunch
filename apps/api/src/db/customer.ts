/**
 * Phase 52.1 — Unified Customer model.
 *
 * One table (`Customer`) replaces the parallel concepts the codebase
 * grew over time:
 *   - "Sales pipeline" = Engagement rows with status IN (PROSPECT,
 *     PROPOSED, CONTRACTED). There is no separate SalesPipeline
 *     table in this codebase (despite the Phase 52 spec mentioning
 *     one — it described a theoretical original state). The unified
 *     Customer.currentStage covers both pre-sales and delivery.
 *   - "Delivery engagements" = Engagement rows with status IN
 *     (DISCOVERY..GOLIVE).
 *   - "SLA accounts" = Engagement rows with status SLA_ACTIVE.
 *
 * The 14-stage unified lifecycle (see docs/ia-rebuild.md) tracks the
 * full journey from LEAD through RENEWED, with LOST and CHURNED as
 * terminal-negative side branches.
 *
 * This module is the public API every Phase 52.3+ surface consumes.
 * The backfill that populates Customer from Engagement lives in
 * `customerBackfill.ts` (separate file so it can be unit-tested
 * without coupling to the runtime singleton).
 */

import { getDb } from './index.js';

// ─── The 14-stage lifecycle ─────────────────────────────────────────────────

/**
 * Customer lifecycle stages. Listed in journey order. Terminal
 * negatives (LOST, CHURNED) and renewed-loop terminal positive
 * (RENEWED) are at the end.
 *
 * RENEWED behaviour (per locked decision 1, 2026-05-17): when a
 * customer at RENEWAL_DUE closes the renewal, the stage transitions
 * BACK to LIVE_SLA and `renewalCount` is incremented. RENEWED is
 * never the stored value — it's a transient UI badge derived from
 * `renewalCount > 0`. The constant is kept here for completeness +
 * forward-compat if we ever want a true terminal "no further
 * renewals" state.
 */
export const CUSTOMER_STAGES = [
  'LEAD',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'DISCOVERY',
  'SCOPING',
  'BUILD',
  'UAT',
  'GOLIVE',
  'HYPERCARE',
  'LIVE_SLA',
  'RENEWAL_DUE',
  'RENEWED',
  // Terminal negatives — not in the linear bar.
  'LOST',
  'CHURNED',
] as const;

export type CustomerStage = (typeof CUSTOMER_STAGES)[number];

export function isCustomerStage(value: unknown): value is CustomerStage {
  return typeof value === 'string' && (CUSTOMER_STAGES as readonly string[]).includes(value);
}

/**
 * The six stage groups used by the kanban columns at /customers and
 * the sidebar visibility rules at /customers/:id.
 */
export type StageGroup =
  | 'pre-sales'
  | 'closing'
  | 'delivery'
  | 'launch'
  | 'live'
  | 'terminal';

const STAGE_GROUP_MAP: Record<CustomerStage, StageGroup> = {
  LEAD: 'pre-sales',
  QUALIFIED: 'pre-sales',
  PROPOSAL: 'pre-sales',
  NEGOTIATION: 'pre-sales',
  WON: 'closing',
  DISCOVERY: 'delivery',
  SCOPING: 'delivery',
  BUILD: 'delivery',
  UAT: 'delivery',
  GOLIVE: 'launch',
  HYPERCARE: 'launch',
  LIVE_SLA: 'live',
  RENEWAL_DUE: 'live',
  RENEWED: 'terminal',
  LOST: 'terminal',
  CHURNED: 'terminal',
};

export function stageGroup(stage: CustomerStage): StageGroup {
  return STAGE_GROUP_MAP[stage];
}

// ─── Engagement.status → Customer.currentStage mapping ──────────────────────

/**
 * Maps the legacy `Engagement.status` enum to the unified
 * Customer.currentStage. Used by the backfill (`customerBackfill.ts`)
 * AND by the thin-shim helpers that translate live Engagement rows
 * into Customer rows during the transition window before Phase 52.6
 * cutover.
 *
 * Inputs:
 *   - status: the live `Engagement.status` value
 *   - previousStatus: only consulted when status === 'ARCHIVED', to
 *     recover the stage the engagement was in before archival
 *
 * The function does NOT return isArchived — caller decides based on
 * `status === 'ARCHIVED'`. Returning the pair would muddle the type.
 */
export function mapEngagementStatusToStage(
  status: string | null | undefined,
  previousStatus: string | null | undefined,
): CustomerStage {
  // If archived, recover the pre-archive stage. Falls through to
  // status='ARCHIVED' handling if previousStatus is also missing.
  const effective = status === 'ARCHIVED' ? (previousStatus ?? 'ARCHIVED') : (status ?? 'DISCOVERY');
  switch (effective) {
    case 'PROSPECT':
      return 'LEAD';
    case 'PROPOSED':
      return 'PROPOSAL';
    case 'CONTRACTED':
      return 'WON';
    case 'DISCOVERY':
      return 'DISCOVERY';
    case 'SCOPING':
      return 'SCOPING';
    case 'BUILD':
      return 'BUILD';
    case 'UAT':
      return 'UAT';
    case 'GOLIVE':
      return 'GOLIVE';
    case 'CLOSEOUT':
      // The old CLOSEOUT phase mapped to "post-go-live tail" which is
      // HYPERCARE in the new vocabulary.
      return 'HYPERCARE';
    case 'SLA_ACTIVE':
      return 'LIVE_SLA';
    case 'ARCHIVED':
      // Archived with no recoverable previousStatus — treat as DISCOVERY
      // (the default Engagement.status) so the customer surfaces in
      // the right kanban column once unarchived. isArchived=1 still
      // hides it from the default view.
      return 'DISCOVERY';
    default:
      // Forward-compat: unknown enum values from a future schema
      // fall through to the safest default rather than throwing.
      return 'DISCOVERY';
  }
}

// ─── Computed-owner helper ──────────────────────────────────────────────────

/**
 * Multi-owner pattern (per locked decision 2, 2026-05-17): different
 * owners per stage with auto-handoff at stage transition. The
 * Customer row has 4 dedicated owner columns; this helper returns
 * the effective primary owner for the customer's current stage.
 *
 * Stage → owner:
 *   LEAD .. WON                 → salesOwnerUserId
 *   DISCOVERY .. GOLIVE         → projectLeadUserId
 *   HYPERCARE .. RENEWAL_DUE    → csmUserId
 *   RENEWED                     → csmUserId (renewal cycle stays with CSM)
 *   LOST, CHURNED               → previous owner (whatever it was) — return
 *                                 first non-null in priority order
 *
 * The arOwnerUserId is intentionally NOT returned by this helper — AR
 * ownership is always-on (billing tab is always present from WON+),
 * the route layer reads it directly.
 */
export function effectiveOwnerUserId(customer: {
  currentStage: CustomerStage;
  salesOwnerUserId: string | null;
  projectLeadUserId: string | null;
  csmUserId: string | null;
}): string | null {
  const group = stageGroup(customer.currentStage);
  if (group === 'pre-sales' || customer.currentStage === 'WON') {
    return customer.salesOwnerUserId;
  }
  if (group === 'delivery' || group === 'launch' && customer.currentStage === 'GOLIVE') {
    return customer.projectLeadUserId;
  }
  if (group === 'live' || customer.currentStage === 'HYPERCARE' || customer.currentStage === 'RENEWED') {
    return customer.csmUserId;
  }
  // Terminal negatives (LOST, CHURNED): return first non-null in
  // priority order so the audit trail still has a "who owned this."
  return customer.csmUserId ?? customer.projectLeadUserId ?? customer.salesOwnerUserId;
}

// ─── The Customer interface ─────────────────────────────────────────────────

export interface Customer {
  id: string;
  firmId: string;
  name: string;
  slug: string | null;
  currentStage: CustomerStage;
  salesOwnerUserId: string | null;
  projectLeadUserId: string | null;
  csmUserId: string | null;
  arOwnerUserId: string | null;
  leadSource: string | null;
  industry: string | null;
  /** Stored as cents (INTEGER). Use `dollars(c)` helper at the
   *  route boundary for display. */
  dealValue: number | null;
  modules: string | null;
  startDate: string | null;
  targetGoLive: string | null;
  contractEndDate: string | null;
  cutoverStrategy: 'BIG_BANG' | 'PHASED' | null;
  /** 0–100, recomputed nightly + on every status-changing write. */
  health: number | null;
  /** Increments on each successful renewal close. Surfaced as a UI
   *  badge ("3rd renewal") on the customer card. */
  renewalCount: number;
  /** Set when stage transitions to LOST or CHURNED. Free-text. */
  lostReason: string | null;
  isArchived: boolean;
  /** Tracks which Engagement (if any) this Customer was backfilled
   *  from. NULL for customers created natively at Phase 52.2+. */
  sourceEngagementId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CustomerRow {
  id: unknown;
  firmId: unknown;
  name: unknown;
  slug: unknown;
  currentStage: unknown;
  salesOwnerUserId: unknown;
  projectLeadUserId: unknown;
  csmUserId: unknown;
  arOwnerUserId: unknown;
  leadSource: unknown;
  industry: unknown;
  dealValue: unknown;
  modules: unknown;
  startDate: unknown;
  targetGoLive: unknown;
  contractEndDate: unknown;
  cutoverStrategy: unknown;
  health: unknown;
  renewalCount: unknown;
  lostReason: unknown;
  isArchived: unknown;
  sourceEngagementId: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

function rowToCustomer(row: CustomerRow): Customer {
  const stage = String(row.currentStage ?? 'LEAD');
  return {
    id: String(row.id ?? ''),
    firmId: String(row.firmId ?? ''),
    name: String(row.name ?? ''),
    slug: row.slug == null ? null : String(row.slug),
    currentStage: isCustomerStage(stage) ? stage : 'LEAD',
    salesOwnerUserId: row.salesOwnerUserId == null ? null : String(row.salesOwnerUserId),
    projectLeadUserId: row.projectLeadUserId == null ? null : String(row.projectLeadUserId),
    csmUserId: row.csmUserId == null ? null : String(row.csmUserId),
    arOwnerUserId: row.arOwnerUserId == null ? null : String(row.arOwnerUserId),
    leadSource: row.leadSource == null ? null : String(row.leadSource),
    industry: row.industry == null ? null : String(row.industry),
    dealValue: row.dealValue == null ? null : Number(row.dealValue),
    modules: row.modules == null ? null : String(row.modules),
    startDate: row.startDate == null ? null : String(row.startDate),
    targetGoLive: row.targetGoLive == null ? null : String(row.targetGoLive),
    contractEndDate: row.contractEndDate == null ? null : String(row.contractEndDate),
    cutoverStrategy: normaliseCutoverStrategy(row.cutoverStrategy),
    health: row.health == null ? null : Number(row.health),
    renewalCount: Number(row.renewalCount ?? 0),
    lostReason: row.lostReason == null ? null : String(row.lostReason),
    isArchived: Number(row.isArchived ?? 0) === 1,
    sourceEngagementId: row.sourceEngagementId == null ? null : String(row.sourceEngagementId),
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
  };
}

function normaliseCutoverStrategy(value: unknown): 'BIG_BANG' | 'PHASED' | null {
  if (value === 'BIG_BANG' || value === 'PHASED') return value;
  return null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getCustomer(id: string, firmId: string): Promise<Customer | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM Customer WHERE id = ? AND firmId = ? LIMIT 1`,
    args: [id, firmId],
  });
  const row = r.rows[0];
  if (!row) return null;
  return rowToCustomer(row as unknown as CustomerRow);
}

export interface ListCustomersFilters {
  /** Restrict to a single stage OR an explicit list of stages. */
  stages?: CustomerStage[];
  /** Restrict to a single stage group (kanban swimlane). */
  group?: StageGroup;
  /** Restrict to customers where the effective owner = this user. */
  ownerUserId?: string;
  /** When true, includes isArchived=1 rows. Defaults to false. */
  includeArchived?: boolean;
  /** Case-insensitive substring search against `name`. */
  search?: string;
  /** Limit + offset for paging. */
  limit?: number;
  offset?: number;
}

export async function listCustomersByFirm(
  firmId: string,
  filters: ListCustomersFilters = {},
): Promise<Customer[]> {
  const db = getDb();
  const where: string[] = ['firmId = ?'];
  const args: (string | number)[] = [firmId];

  if (!filters.includeArchived) {
    where.push('isArchived = 0');
  }

  if (filters.stages && filters.stages.length > 0) {
    where.push(`currentStage IN (${filters.stages.map(() => '?').join(',')})`);
    args.push(...filters.stages);
  } else if (filters.group) {
    const stagesInGroup = (CUSTOMER_STAGES as readonly CustomerStage[]).filter(
      (s) => stageGroup(s) === filters.group,
    );
    if (stagesInGroup.length > 0) {
      where.push(`currentStage IN (${stagesInGroup.map(() => '?').join(',')})`);
      args.push(...stagesInGroup);
    }
  }

  if (filters.ownerUserId) {
    // Match any of the four owner columns — effective ownership is
    // computed, so the surface query has to be permissive.
    where.push(
      `(salesOwnerUserId = ? OR projectLeadUserId = ? OR csmUserId = ? OR arOwnerUserId = ?)`,
    );
    args.push(filters.ownerUserId, filters.ownerUserId, filters.ownerUserId, filters.ownerUserId);
  }

  if (filters.search) {
    where.push('LOWER(name) LIKE LOWER(?)');
    args.push(`%${filters.search}%`);
  }

  const limit = filters.limit ?? 200;
  const offset = filters.offset ?? 0;

  const r = await db.execute({
    sql: `SELECT * FROM Customer WHERE ${where.join(' AND ')} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });
  return r.rows.map((row) => rowToCustomer(row as unknown as CustomerRow));
}

export async function listCustomersByFirmAndStage(
  firmId: string,
  stage: CustomerStage,
): Promise<Customer[]> {
  return listCustomersByFirm(firmId, { stages: [stage] });
}

/**
 * Insert a Customer row from a free-form patch. Used by Phase 52.2+
 * native-create flows and by the Phase 52.1 backfill.
 *
 * `id` is REQUIRED — the caller mints it (so the backfill can preserve
 * Engagement.id for FK stability). For native creates, callers use
 * `createId()` from `@paralleldrive/cuid2`.
 */
export interface CreateCustomerInput {
  id: string;
  firmId: string;
  name: string;
  slug?: string | null;
  currentStage?: CustomerStage;
  salesOwnerUserId?: string | null;
  projectLeadUserId?: string | null;
  csmUserId?: string | null;
  arOwnerUserId?: string | null;
  leadSource?: string | null;
  industry?: string | null;
  dealValue?: number | null;
  modules?: string | null;
  startDate?: string | null;
  targetGoLive?: string | null;
  contractEndDate?: string | null;
  cutoverStrategy?: 'BIG_BANG' | 'PHASED' | null;
  renewalCount?: number;
  isArchived?: boolean;
  sourceEngagementId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export async function insertCustomer(input: CreateCustomerInput): Promise<Customer> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `
      INSERT INTO Customer (
        id, firmId, name, slug, currentStage,
        salesOwnerUserId, projectLeadUserId, csmUserId, arOwnerUserId,
        leadSource, industry, dealValue, modules,
        startDate, targetGoLive, contractEndDate, cutoverStrategy,
        renewalCount, isArchived, sourceEngagementId,
        createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      input.id,
      input.firmId,
      input.name,
      input.slug ?? null,
      input.currentStage ?? 'LEAD',
      input.salesOwnerUserId ?? null,
      input.projectLeadUserId ?? null,
      input.csmUserId ?? null,
      input.arOwnerUserId ?? null,
      input.leadSource ?? null,
      input.industry ?? null,
      input.dealValue ?? null,
      input.modules ?? null,
      input.startDate ?? null,
      input.targetGoLive ?? null,
      input.contractEndDate ?? null,
      input.cutoverStrategy ?? null,
      input.renewalCount ?? 0,
      input.isArchived ? 1 : 0,
      input.sourceEngagementId ?? null,
      input.createdAt ?? now,
      input.updatedAt ?? now,
    ],
  });
  const created = await getCustomer(input.id, input.firmId);
  if (!created) {
    throw new Error(`insertCustomer: failed to read back row id=${input.id}`);
  }
  return created;
}

/**
 * Advance the customer to a new stage. Logs the transition via
 * ActivityLog (Phase 52.2+ surfaces it on the customer timeline per
 * locked decision 3). Stage-precondition enforcement is the route
 * layer's job — this helper assumes the caller has already validated.
 *
 * If the new stage is LIVE_SLA AND the previous stage was
 * RENEWAL_DUE, `renewalCount` increments (per locked decision 1).
 */
export interface AdvanceStageOptions {
  /** Free-text reason recorded on the audit row. Required for
   *  backward transitions; optional for forward. */
  reason?: string;
  /** The userId triggering the transition. */
  actorUserId: string;
  /** When true, marks the transition as a rollback (red icon on the
   *  activity timeline). */
  isRollback?: boolean;
}

export async function advanceStage(
  id: string,
  firmId: string,
  toStage: CustomerStage,
  options: AdvanceStageOptions,
): Promise<Customer> {
  const db = getDb();
  const existing = await getCustomer(id, firmId);
  if (!existing) {
    throw new Error(`advanceStage: customer not found id=${id} firmId=${firmId}`);
  }

  const isRenewalClose =
    existing.currentStage === 'RENEWAL_DUE' && toStage === 'LIVE_SLA';
  const newRenewalCount = isRenewalClose ? existing.renewalCount + 1 : existing.renewalCount;

  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE Customer
          SET currentStage = ?, renewalCount = ?, updatedAt = ?
          WHERE id = ? AND firmId = ?`,
    args: [toStage, newRenewalCount, now, id, firmId],
  });

  // ActivityLog row for the audit trail. The Customer-specific
  // activity surface is Phase 52.4; for now we use the existing
  // engagement-scoped ActivityLog so the data is captured. The Phase
  // 52.4 timeline reads from the same table filtered by customerId
  // (added in Phase 52.6 cleanup) OR by sourceEngagementId.
  if (existing.sourceEngagementId) {
    try {
      await db.execute({
        sql: `INSERT INTO ActivityLog (id, engagementId, firmId, type, message, actorUserId, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          `act_${id}_${Date.now()}`,
          existing.sourceEngagementId,
          firmId,
          options.isRollback ? 'STAGE_REVERTED' : 'STAGE_ADVANCED',
          `${existing.currentStage} → ${toStage}${options.reason ? ` (${options.reason})` : ''}`,
          options.actorUserId,
          now,
        ],
      });
    } catch {
      // Non-fatal — the transition landed; audit-log gap is OK for
      // Phase 52.1. Phase 52.4 hardens this with a dedicated
      // CustomerActivity table.
    }
  }

  const next = await getCustomer(id, firmId);
  if (!next) {
    throw new Error(`advanceStage: customer disappeared after update id=${id}`);
  }
  return next;
}

export async function archiveCustomer(
  id: string,
  firmId: string,
  lostReason: string | null,
): Promise<Customer> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE Customer
          SET isArchived = 1, lostReason = ?, updatedAt = ?
          WHERE id = ? AND firmId = ?`,
    args: [lostReason, now, id, firmId],
  });
  const next = await getCustomer(id, firmId);
  if (!next) {
    throw new Error(`archiveCustomer: customer not found id=${id} firmId=${firmId}`);
  }
  return next;
}

// ─── Health computation ─────────────────────────────────────────────────────

/**
 * Compute the customer's 0–100 health score per the locked formula
 * (decision 4, 2026-05-17):
 *
 *   30 pts: questionnaire completion %
 *   25 pts: 1 − (open blocker count × 5), floored 0
 *   25 pts: 1 − (days overdue on stage advance / 30), floored 0
 *   20 pts: 1 − (decisions pending > 14 days / 5), floored 0
 *
 * Phase 52.1 ships the SHAPE of the function with placeholder data
 * sources (returns 100 for healthy customers, 0 if archived). The
 * real wiring against questionnaire %, blocker count, etc., depends
 * on cross-table queries that Phase 52.4 fleshes out alongside the
 * customer-detail UI. This stub-but-correct-shape keeps the public
 * API stable so callers don't need to change when the formula's
 * data sources land.
 */
export async function computeHealth(customerId: string, firmId: string): Promise<number> {
  const customer = await getCustomer(customerId, firmId);
  if (!customer) return 0;
  if (customer.isArchived) return 0;
  // TODO(Phase 52.4): replace with the real formula once Decision /
  // Risk / WizardAnswer cross-table queries land.
  return 100;
}

/**
 * Health band for UI badges (per locked decision 4).
 */
export function healthBand(health: number | null): 'red' | 'yellow' | 'green' | 'unknown' {
  if (health == null) return 'unknown';
  if (health < 30) return 'red';
  if (health < 70) return 'yellow';
  return 'green';
}
