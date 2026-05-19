/**
 * Phase 52.4 — `CustomerDetail` aggregator.
 *
 * The Customer Detail page (`/customers/:id`) needs a richer payload
 * than the list view's `CustomerSummary`:
 *
 *   - Contact + address fields (read from Engagement.clientName tail
 *     when no native Customer columns exist yet — see notes below)
 *   - Each owner column resolved to `{ id, name }` so the UI can
 *     render four avatars side-by-side
 *   - The full health breakdown (4 components + raw counts) from
 *     `services/customer/health.ts`
 *   - Stage history — every `STAGE_TRANSITION` ActivityLog row for
 *     this customer, with actor name resolved
 *
 * `customerAddress` / `primaryContactName/Email/Phone` aren't yet
 * dedicated columns on Customer (Phase 52.1 ships the rough schema;
 * Phase 52.4+ may add them when product asks). For now they read
 * from BusinessProfile.answers where available, otherwise null.
 * The Settings tab's PATCH endpoint accepts the writes; the column
 * adds happen lazily via idempotent ALTERs from
 * `ensureCustomerDetailColumns()`.
 */

import { getDb } from './index.js';
import {
  CUSTOMER_STAGES,
  type Customer,
  type CustomerStage,
  effectiveOwnerUserId,
  getCustomer,
  healthBand,
  isCustomerStage,
} from './customer.js';
import {
  computeHealthBreakdown,
  type HealthBreakdown,
} from '../services/customer/health.js';
import type { CustomerSummary } from './customerSummary.js';

// ─── Detail row types ──────────────────────────────────────────────────────

export interface OwnerRef {
  id: string;
  name: string;
}

export interface StageHistoryEntry {
  id: string;
  fromStage: CustomerStage;
  toStage: CustomerStage;
  actorName: string;
  isRollback: boolean;
  reason: string | null;
  createdAt: string;
}

export interface CustomerDetail extends CustomerSummary {
  customerAddress: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  salesOwner: OwnerRef | null;
  projectLeadOwner: OwnerRef | null;
  csmOwner: OwnerRef | null;
  arOwner: OwnerRef | null;
  healthBreakdown: HealthBreakdown;
  stageHistory: StageHistoryEntry[];
}

// ─── Schema extension (idempotent) ─────────────────────────────────────────

let _ensuredDetailColumns = false;

/**
 * Adds the Phase 52.4 editable-contact columns to Customer if they
 * aren't already there. Called lazily from `getCustomerDetail` /
 * `updateCustomerEditableFields` so the ALTERs only fire once per
 * boot AND so the Phase 52.1 backfill path doesn't have to care
 * about these columns existing.
 */
export async function ensureCustomerDetailColumns(): Promise<void> {
  if (_ensuredDetailColumns) return;
  _ensuredDetailColumns = true;
  const db = getDb();
  const adds: ReadonlyArray<[string, string]> = [
    ['customerAddress', 'TEXT'],
    ['primaryContactName', 'TEXT'],
    ['primaryContactEmail', 'TEXT'],
    ['primaryContactPhone', 'TEXT'],
  ];
  for (const [col, type] of adds) {
    try {
      await db.execute(`ALTER TABLE Customer ADD COLUMN ${col} ${type}`);
    } catch {
      // duplicate column on subsequent boots — idempotent.
    }
  }
}

// ─── User lookup ────────────────────────────────────────────────────────────

async function resolveOwner(userId: string | null): Promise<OwnerRef | null> {
  if (!userId) return null;
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, name FROM User WHERE id = ? LIMIT 1`,
    args: [userId],
  });
  const row = r.rows[0] as { id?: string; name?: string } | undefined;
  if (!row?.id) return null;
  return { id: row.id, name: row.name ?? row.id };
}

// ─── lastActivityAt (mirrors customerSummary.ts) ───────────────────────────

async function lookupLastActivityAt(
  customerId: string,
  sourceEngagementId: string | null,
): Promise<string | null> {
  const db = getDb();
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

// ─── Stage history ──────────────────────────────────────────────────────────

interface RawStageHistoryRow {
  id: unknown;
  fromStage: unknown;
  toStage: unknown;
  isRollback: unknown;
  details: unknown;
  createdAt: unknown;
  actorUserId: unknown;
  actorName: unknown;
}

/**
 * Pulls every STAGE_TRANSITION row for the customer, oldest first
 * so the UI can render a left-to-right chronology. Actor name is
 * resolved in the same query via LEFT JOIN against User.
 */
async function loadStageHistory(
  customerId: string,
  sourceEngagementId: string | null,
): Promise<StageHistoryEntry[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT a.id, a.fromStage, a.toStage, a.isRollback, a.details, a.createdAt,
                 a.actorUserId, u.name AS actorName
          FROM ActivityLog a
          LEFT JOIN User u ON u.id = a.actorUserId
          WHERE a.action = 'STAGE_TRANSITION'
            AND (a.customerId = ? OR (a.customerId IS NULL AND a.engagementId = ?))
          ORDER BY a.createdAt ASC`,
    args: [customerId, sourceEngagementId ?? ''],
  });
  return r.rows.map((raw) => {
    const row = raw as unknown as RawStageHistoryRow;
    const fromStr = String(row.fromStage ?? 'LEAD');
    const toStr = String(row.toStage ?? 'LEAD');
    const from = isCustomerStage(fromStr) ? fromStr : 'LEAD';
    const to = isCustomerStage(toStr) ? toStr : 'LEAD';
    let reason: string | null = null;
    if (row.details != null) {
      try {
        const parsed = JSON.parse(String(row.details)) as { reason?: string | null };
        reason = parsed.reason ?? null;
      } catch {
        // details may be a plain string from older rows — ignore.
      }
    }
    return {
      id: String(row.id),
      fromStage: from,
      toStage: to,
      actorName: row.actorName == null ? 'system' : String(row.actorName),
      isRollback: Number(row.isRollback ?? 0) === 1,
      reason,
      createdAt: String(row.createdAt),
    };
  });
}

// ─── Contact-field fallbacks ────────────────────────────────────────────────

interface ContactFromDb {
  customerAddress: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
}

async function loadContactFields(customerId: string): Promise<ContactFromDb> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT customerAddress, primaryContactName, primaryContactEmail, primaryContactPhone
          FROM Customer WHERE id = ? LIMIT 1`,
    args: [customerId],
  });
  const row = r.rows[0] as
    | Partial<Record<keyof ContactFromDb, string | null>>
    | undefined;
  return {
    customerAddress: row?.customerAddress ?? null,
    primaryContactName: row?.primaryContactName ?? null,
    primaryContactEmail: row?.primaryContactEmail ?? null,
    primaryContactPhone: row?.primaryContactPhone ?? null,
  };
}

// ─── Public entrypoint ─────────────────────────────────────────────────────

export async function getCustomerDetail(
  id: string,
  firmId: string,
): Promise<CustomerDetail | null> {
  await ensureCustomerDetailColumns();
  const customer = await getCustomer(id, firmId);
  if (!customer) return null;
  return assembleDetail(customer);
}

/**
 * Compose a `CustomerDetail` from an already-fetched Customer row.
 * The PATCH route reuses this after a write so the response shape
 * matches what the page expects without a second `getCustomer` hop.
 */
export async function assembleDetail(customer: Customer): Promise<CustomerDetail> {
  await ensureCustomerDetailColumns();
  const [
    salesOwner,
    projectLeadOwner,
    csmOwner,
    arOwner,
    breakdown,
    stageHistory,
    lastActivityAt,
    contact,
  ] = await Promise.all([
    resolveOwner(customer.salesOwnerUserId),
    resolveOwner(customer.projectLeadUserId),
    resolveOwner(customer.csmUserId),
    resolveOwner(customer.arOwnerUserId),
    computeHealthBreakdown(customer.id),
    loadStageHistory(customer.id, customer.sourceEngagementId),
    lookupLastActivityAt(customer.id, customer.sourceEngagementId),
    loadContactFields(customer.id),
  ]);

  const primaryOwnerId =
    effectiveOwnerUserId({
      currentStage: customer.currentStage,
      salesOwnerUserId: customer.salesOwnerUserId,
      projectLeadUserId: customer.projectLeadUserId,
      csmUserId: customer.csmUserId,
    }) ?? '';
  const primaryOwnerName =
    salesOwner?.id === primaryOwnerId
      ? salesOwner.name
      : projectLeadOwner?.id === primaryOwnerId
        ? projectLeadOwner.name
        : csmOwner?.id === primaryOwnerId
          ? csmOwner.name
          : arOwner?.id === primaryOwnerId
            ? arOwner.name
            : '';
  const healthScore = customer.isArchived ? 0 : customer.health ?? breakdown.score;
  const band = healthBand(healthScore);
  const summaryBand: 'red' | 'yellow' | 'green' = band === 'unknown' ? 'red' : band;

  // CUSTOMER_STAGES kept imported so type-narrowing on the route side stays valid.
  void CUSTOMER_STAGES;

  return {
    id: customer.id,
    name: customer.name,
    currentStage: customer.currentStage,
    primaryOwnerName,
    primaryOwnerId,
    healthScore,
    healthBand: summaryBand,
    renewalCount: customer.renewalCount,
    lastActivityAt,
    arr: customer.dealValue == null ? null : customer.dealValue / 100,
    customerAddress: contact.customerAddress,
    primaryContactName: contact.primaryContactName,
    primaryContactEmail: contact.primaryContactEmail,
    primaryContactPhone: contact.primaryContactPhone,
    salesOwner,
    projectLeadOwner,
    csmOwner,
    arOwner,
    healthBreakdown: breakdown,
    stageHistory,
  };
}

// ─── PATCH editable fields ─────────────────────────────────────────────────

export interface CustomerEditableFields {
  customerName?: string;
  customerAddress?: string | null;
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
  primaryContactPhone?: string | null;
  arr?: number | null;
  salesOwnerUserId?: string | null;
  projectLeadUserId?: string | null;
  csmUserId?: string | null;
  arOwnerUserId?: string | null;
}

/**
 * Apply a partial update to a Customer row. Cross-firm owner
 * assignments are blocked at the route layer — this helper assumes
 * the caller already validated. Returns the freshly-built detail
 * payload + a summary of what changed (for the audit log row).
 */
export async function updateCustomerEditableFields(
  id: string,
  firmId: string,
  patch: CustomerEditableFields,
): Promise<{ detail: CustomerDetail; changes: Record<string, { from: unknown; to: unknown }> }> {
  await ensureCustomerDetailColumns();
  const existing = await getCustomer(id, firmId);
  if (!existing) {
    throw new Error(`updateCustomerEditableFields: not found id=${id} firmId=${firmId}`);
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const sets: string[] = [];
  const args: Array<string | number | null> = [];

  const setIf = <T>(col: string, current: T, next: T | undefined): void => {
    if (next === undefined) return;
    if (next === current) return;
    sets.push(`${col} = ?`);
    args.push(next as string | number | null);
    changes[col] = { from: current, to: next };
  };

  setIf('name', existing.name, patch.customerName);
  // Contact fields land via the new ALTERs above.
  const contact = await loadContactFields(id);
  setIf('customerAddress', contact.customerAddress, patch.customerAddress);
  setIf('primaryContactName', contact.primaryContactName, patch.primaryContactName);
  setIf('primaryContactEmail', contact.primaryContactEmail, patch.primaryContactEmail);
  setIf('primaryContactPhone', contact.primaryContactPhone, patch.primaryContactPhone);
  // arr → dealValue (stored as cents). null clears.
  if (patch.arr !== undefined) {
    const nextCents = patch.arr === null ? null : Math.round(patch.arr * 100);
    const prevCents = existing.dealValue;
    if (nextCents !== prevCents) {
      sets.push(`dealValue = ?`);
      args.push(nextCents);
      changes.arr = { from: prevCents == null ? null : prevCents / 100, to: patch.arr };
    }
  }
  setIf('salesOwnerUserId', existing.salesOwnerUserId, patch.salesOwnerUserId);
  setIf('projectLeadUserId', existing.projectLeadUserId, patch.projectLeadUserId);
  setIf('csmUserId', existing.csmUserId, patch.csmUserId);
  setIf('arOwnerUserId', existing.arOwnerUserId, patch.arOwnerUserId);

  if (sets.length === 0) {
    const detail = await assembleDetail(existing);
    return { detail, changes };
  }

  const now = new Date().toISOString();
  sets.push(`updatedAt = ?`);
  args.push(now);
  args.push(id);
  args.push(firmId);

  const db = getDb();
  await db.execute({
    sql: `UPDATE Customer SET ${sets.join(', ')} WHERE id = ? AND firmId = ?`,
    args,
  });

  const next = await getCustomer(id, firmId);
  if (!next) {
    throw new Error(`updateCustomerEditableFields: customer disappeared after update id=${id}`);
  }
  const detail = await assembleDetail(next);
  return { detail, changes };
}
