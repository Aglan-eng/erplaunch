/**
 * Phase 52.5 — role-based Inbox aggregator.
 *
 * Builds the per-user `InboxResponse` from six signal sources:
 *
 *   STAGE_OVERDUE             — daysInCurrentStage > STAGE_TARGET_DAYS
 *   BLOCKER_OPEN              — IssueItem rows with status='OPEN'
 *   DECISION_PENDING          — DecisionItem rows un-decided > 14 days
 *   QUESTIONNAIRE_INCOMPLETE  — BusinessProfile.completeness avg < 70%
 *                               on pre-launch stages (LEAD..UAT)
 *   HANDOFF_INCOMING          — OWNER_HANDOFF activity rows in the
 *                               last 14 days where toOwnerId = me
 *   RENEWAL_DUE_SOON          — stage = RENEWAL_DUE OR (stage =
 *                               LIVE_SLA AND contractEndDate within
 *                               30 days)
 *
 * Bucketing:
 *   forYou    → items where the user is the EFFECTIVE owner for the
 *               customer's current stage (per lock #2 mapping)
 *   watching  → items where the user owns ANY of the four columns
 *               but is NOT the active-stage owner
 *   firmWide  → admin only; every item in the firm, regardless of
 *               whether the admin is on the owner roster
 *
 * Dismissal: items dismissed within the last 7 days are filtered
 * out (per `InboxDismissal` table). The composite itemId
 * `${customerId}:${itemType}` lets the same logical alert be
 * dismissed even when the underlying source row (e.g. a new
 * IssueItem) was added after the dismissal — the user's intent was
 * "I've seen this customer has blockers; come back in a week."
 */

import { getDb } from '../../db/index.js';
import {
  CUSTOMER_STAGES,
  type CustomerStage,
  effectiveOwnerUserId,
  isCustomerStage,
} from '../../db/customer.js';
import { STAGE_TARGET_DAYS } from '../customer/health.js';

// ─── Public types ──────────────────────────────────────────────────────────

export type InboxItemType =
  | 'STAGE_OVERDUE'
  | 'BLOCKER_OPEN'
  | 'DECISION_PENDING'
  | 'QUESTIONNAIRE_INCOMPLETE'
  | 'HANDOFF_INCOMING'
  | 'RENEWAL_DUE_SOON';

export type InboxSeverity = 'critical' | 'warning' | 'info';

export interface InboxItem {
  id: string;
  itemType: InboxItemType;
  customerId: string;
  customerName: string;
  currentStage: CustomerStage;
  severity: InboxSeverity;
  summary: string;
  ageDays: number;
  createdAt: string;
}

export interface InboxResponse {
  forYou: InboxItem[];
  watching: InboxItem[];
  /** `null` for non-admin callers; populated array for APP_ADMIN. */
  firmWide: InboxItem[] | null;
}

const BUCKET_CAP = 50;
const HANDOFF_WINDOW_DAYS = 14;
const RENEWAL_WINDOW_DAYS = 30;
const QUESTIONNAIRE_THRESHOLD = 0.7;
const DECISION_PENDING_DAYS = 14;

const SEVERITY_RANK: Record<InboxSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function daysBetween(later: string, earlier: string): number {
  const a = new Date(later).getTime();
  const b = new Date(earlier).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((a - b) / 86_400_000));
}

function nowIso(): string {
  return new Date().toISOString();
}

function questionnairePct(completenessJson: string | null): number {
  if (!completenessJson) return 0;
  try {
    const obj = JSON.parse(completenessJson) as Record<string, unknown>;
    const vals = Object.values(obj).filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v),
    );
    if (vals.length === 0) return 0;
    const sum = vals.reduce((acc, v) => acc + Math.max(0, Math.min(1, v)), 0);
    return sum / vals.length;
  } catch {
    return 0;
  }
}

interface CustomerRow {
  id: unknown;
  firmId: unknown;
  name: unknown;
  currentStage: unknown;
  salesOwnerUserId: unknown;
  projectLeadUserId: unknown;
  csmUserId: unknown;
  arOwnerUserId: unknown;
  createdAt: unknown;
  sourceEngagementId: unknown;
  contractEndDate: unknown;
  isArchived: unknown;
}

interface ParsedCustomer {
  id: string;
  firmId: string;
  name: string;
  currentStage: CustomerStage;
  salesOwnerUserId: string | null;
  projectLeadUserId: string | null;
  csmUserId: string | null;
  arOwnerUserId: string | null;
  createdAt: string;
  sourceEngagementId: string | null;
  contractEndDate: string | null;
  isArchived: boolean;
}

function parseCustomer(row: CustomerRow): ParsedCustomer {
  const stageStr = String(row.currentStage ?? 'LEAD');
  const stage = isCustomerStage(stageStr) ? stageStr : 'LEAD';
  const orNull = (v: unknown): string | null => (v == null ? null : String(v));
  return {
    id: String(row.id),
    firmId: String(row.firmId),
    name: String(row.name ?? ''),
    currentStage: stage,
    salesOwnerUserId: orNull(row.salesOwnerUserId),
    projectLeadUserId: orNull(row.projectLeadUserId),
    csmUserId: orNull(row.csmUserId),
    arOwnerUserId: orNull(row.arOwnerUserId),
    createdAt: String(row.createdAt ?? nowIso()),
    sourceEngagementId: orNull(row.sourceEngagementId),
    contractEndDate: orNull(row.contractEndDate),
    isArchived: Number(row.isArchived ?? 0) === 1,
  };
}

/**
 * Returns the set of customer ids the given user "owns" through any
 * of the four owner columns. Used to short-circuit the watching
 * bucket calculation when a customer has no relationship to the
 * caller at all.
 */
function ownerRoles(
  customer: ParsedCustomer,
  userId: string,
): { isActiveOwner: boolean; ownsAnyColumn: boolean } {
  const activeOwnerId = effectiveOwnerUserId({
    currentStage: customer.currentStage,
    salesOwnerUserId: customer.salesOwnerUserId,
    projectLeadUserId: customer.projectLeadUserId,
    csmUserId: customer.csmUserId,
  });
  const isActiveOwner = activeOwnerId === userId;
  const ownsAnyColumn =
    customer.salesOwnerUserId === userId ||
    customer.projectLeadUserId === userId ||
    customer.csmUserId === userId ||
    customer.arOwnerUserId === userId;
  return { isActiveOwner, ownsAnyColumn };
}

// ─── Per-customer signal extractors ────────────────────────────────────────

async function checkStageOverdue(
  customer: ParsedCustomer,
): Promise<InboxItem | null> {
  if (customer.isArchived) return null;
  // Pull the latest STAGE_TRANSITION-into-currentStage timestamp;
  // fall back to Customer.createdAt when none exists yet.
  const db = getDb();
  const ts = await db.execute({
    sql: `SELECT MAX(createdAt) AS ts FROM ActivityLog
          WHERE action = 'STAGE_TRANSITION' AND toStage = ?
            AND (customerId = ? OR (customerId IS NULL AND engagementId = ?))`,
    args: [customer.currentStage, customer.id, customer.sourceEngagementId ?? ''],
  });
  const transitionTs =
    (ts.rows[0] as { ts?: string | null } | undefined)?.ts ?? customer.createdAt;
  const days = daysBetween(nowIso(), transitionTs);
  const target = STAGE_TARGET_DAYS[customer.currentStage] ?? 30;
  if (days <= target) return null;
  const over = days - target;
  return {
    id: `${customer.id}:STAGE_OVERDUE`,
    itemType: 'STAGE_OVERDUE',
    customerId: customer.id,
    customerName: customer.name,
    currentStage: customer.currentStage,
    severity: over >= 30 ? 'critical' : over >= 7 ? 'warning' : 'info',
    summary: `${customer.name} has been in ${customer.currentStage} for ${days} days (${over} over target).`,
    ageDays: over,
    createdAt: transitionTs,
  };
}

async function checkBlockerOpen(
  customer: ParsedCustomer,
): Promise<InboxItem | null> {
  if (customer.isArchived) return null;
  if (!customer.sourceEngagementId) return null;
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c, MIN(createdAt) AS oldest
          FROM IssueItem
          WHERE engagementId = ? AND status = 'OPEN'`,
    args: [customer.sourceEngagementId],
  });
  const row = r.rows[0] as { c?: number | string; oldest?: string | null } | undefined;
  const count = Number(row?.c ?? 0);
  if (count === 0) return null;
  const oldest = row?.oldest ?? customer.createdAt;
  const age = daysBetween(nowIso(), oldest);
  return {
    id: `${customer.id}:BLOCKER_OPEN`,
    itemType: 'BLOCKER_OPEN',
    customerId: customer.id,
    customerName: customer.name,
    currentStage: customer.currentStage,
    severity: count >= 3 ? 'critical' : count >= 1 ? 'warning' : 'info',
    summary: `${count} open blocker${count === 1 ? '' : 's'} on ${customer.name}.`,
    ageDays: age,
    createdAt: oldest,
  };
}

async function checkDecisionPending(
  customer: ParsedCustomer,
): Promise<InboxItem | null> {
  if (customer.isArchived) return null;
  if (!customer.sourceEngagementId) return null;
  const cutoff = new Date(Date.now() - DECISION_PENDING_DAYS * 86_400_000).toISOString();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c, MIN(createdAt) AS oldest
          FROM DecisionItem
          WHERE engagementId = ? AND decidedAt IS NULL AND createdAt < ?`,
    args: [customer.sourceEngagementId, cutoff],
  });
  const row = r.rows[0] as { c?: number | string; oldest?: string | null } | undefined;
  const count = Number(row?.c ?? 0);
  if (count === 0) return null;
  const oldest = row?.oldest ?? customer.createdAt;
  const age = daysBetween(nowIso(), oldest);
  return {
    id: `${customer.id}:DECISION_PENDING`,
    itemType: 'DECISION_PENDING',
    customerId: customer.id,
    customerName: customer.name,
    currentStage: customer.currentStage,
    severity: count >= 3 || age >= 30 ? 'critical' : 'warning',
    summary: `${count} pending decision${count === 1 ? '' : 's'} on ${customer.name} (>${DECISION_PENDING_DAYS} days).`,
    ageDays: age,
    createdAt: oldest,
  };
}

/**
 * The questionnaire only matters on pre-launch stages — once a
 * customer is in GOLIVE+ the BusinessProfile is locked. We threshold
 * at 70% completion across all sections; below that flags the
 * Inbox row.
 */
const QUESTIONNAIRE_STAGES: ReadonlyArray<CustomerStage> = [
  'DISCOVERY',
  'SCOPING',
  'BUILD',
  'UAT',
];

async function checkQuestionnaire(
  customer: ParsedCustomer,
): Promise<InboxItem | null> {
  if (customer.isArchived) return null;
  if (!QUESTIONNAIRE_STAGES.includes(customer.currentStage)) return null;
  if (!customer.sourceEngagementId) return null;
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT completeness, updatedAt FROM BusinessProfile WHERE engagementId = ? LIMIT 1`,
    args: [customer.sourceEngagementId],
  });
  const row = r.rows[0] as { completeness?: string | null; updatedAt?: string | null } | undefined;
  const pct = questionnairePct(row?.completeness ?? null);
  if (pct >= QUESTIONNAIRE_THRESHOLD) return null;
  const lastTouch = row?.updatedAt ?? customer.createdAt;
  const age = daysBetween(nowIso(), lastTouch);
  const pctRounded = Math.round(pct * 100);
  return {
    id: `${customer.id}:QUESTIONNAIRE_INCOMPLETE`,
    itemType: 'QUESTIONNAIRE_INCOMPLETE',
    customerId: customer.id,
    customerName: customer.name,
    currentStage: customer.currentStage,
    severity: pct < 0.3 ? 'critical' : 'warning',
    summary: `Discovery questionnaire is ${pctRounded}% complete on ${customer.name}.`,
    ageDays: age,
    createdAt: lastTouch,
  };
}

async function checkHandoffIncoming(
  customer: ParsedCustomer,
  forUserId: string,
): Promise<InboxItem | null> {
  if (customer.isArchived) return null;
  const cutoff = new Date(Date.now() - HANDOFF_WINDOW_DAYS * 86_400_000).toISOString();
  const db = getDb();
  // OWNER_HANDOFF rows carry the resolved fromOwnerId/toOwnerId
  // inside the `details` JSON. We pre-filter by customer + window
  // in SQL, then post-filter on the JSON payload in JS.
  const r = await db.execute({
    sql: `SELECT id, details, createdAt FROM ActivityLog
          WHERE action = 'OWNER_HANDOFF'
            AND createdAt >= ?
            AND (customerId = ? OR (customerId IS NULL AND engagementId = ?))
          ORDER BY createdAt DESC LIMIT 5`,
    args: [cutoff, customer.id, customer.sourceEngagementId ?? ''],
  });
  for (const raw of r.rows) {
    const row = raw as unknown as { id: unknown; details: unknown; createdAt: unknown };
    const detailsStr = row.details == null ? null : String(row.details);
    if (!detailsStr) continue;
    try {
      const parsed = JSON.parse(detailsStr) as { toOwnerId?: string | null };
      if (parsed.toOwnerId === forUserId) {
        const created = String(row.createdAt);
        return {
          id: `${customer.id}:HANDOFF_INCOMING`,
          itemType: 'HANDOFF_INCOMING',
          customerId: customer.id,
          customerName: customer.name,
          currentStage: customer.currentStage,
          severity: 'info',
          summary: `${customer.name} was handed off to you (${customer.currentStage}).`,
          ageDays: daysBetween(nowIso(), created),
          createdAt: created,
        };
      }
    } catch {
      // ignore malformed details
    }
  }
  return null;
}

async function checkRenewalDueSoon(
  customer: ParsedCustomer,
): Promise<InboxItem | null> {
  if (customer.isArchived) return null;
  if (customer.currentStage === 'RENEWAL_DUE') {
    const target = customer.contractEndDate ?? customer.createdAt;
    const age = daysBetween(nowIso(), target);
    return {
      id: `${customer.id}:RENEWAL_DUE_SOON`,
      itemType: 'RENEWAL_DUE_SOON',
      customerId: customer.id,
      customerName: customer.name,
      currentStage: customer.currentStage,
      severity: 'critical',
      summary: `${customer.name} is in RENEWAL_DUE.`,
      ageDays: age,
      createdAt: target,
    };
  }
  if (customer.currentStage === 'LIVE_SLA' && customer.contractEndDate) {
    const end = new Date(customer.contractEndDate).getTime();
    if (!Number.isFinite(end)) return null;
    const daysUntilEnd = Math.floor((end - Date.now()) / 86_400_000);
    if (daysUntilEnd > RENEWAL_WINDOW_DAYS) return null;
    if (daysUntilEnd < 0) {
      // past end date — definitely critical
      return {
        id: `${customer.id}:RENEWAL_DUE_SOON`,
        itemType: 'RENEWAL_DUE_SOON',
        customerId: customer.id,
        customerName: customer.name,
        currentStage: customer.currentStage,
        severity: 'critical',
        summary: `${customer.name} contract expired ${Math.abs(daysUntilEnd)} days ago.`,
        ageDays: Math.abs(daysUntilEnd),
        createdAt: customer.contractEndDate,
      };
    }
    return {
      id: `${customer.id}:RENEWAL_DUE_SOON`,
      itemType: 'RENEWAL_DUE_SOON',
      customerId: customer.id,
      customerName: customer.name,
      currentStage: customer.currentStage,
      severity: daysUntilEnd <= 14 ? 'critical' : 'warning',
      summary: `${customer.name} renewal due in ${daysUntilEnd} day${daysUntilEnd === 1 ? '' : 's'}.`,
      ageDays: 0,
      createdAt: customer.contractEndDate,
    };
  }
  return null;
}

// ─── Public entrypoint ────────────────────────────────────────────────────

export interface BuildInboxOptions {
  firmId: string;
  userId: string;
  /** When true, the `firmWide` bucket is populated. */
  isAdmin: boolean;
}

export async function buildInbox(opts: BuildInboxOptions): Promise<InboxResponse> {
  const db = getDb();
  const customersRaw = await db.execute({
    sql: `SELECT id, firmId, name, currentStage,
                 salesOwnerUserId, projectLeadUserId, csmUserId, arOwnerUserId,
                 createdAt, sourceEngagementId, contractEndDate, isArchived
          FROM Customer WHERE firmId = ? AND isArchived = 0`,
    args: [opts.firmId],
  });
  const customers = customersRaw.rows.map((row) => parseCustomer(row as unknown as CustomerRow));

  // Load all live dismissals for this user inside the 7-day window
  // up-front so the per-item filter is a Set lookup.
  const dismissCutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const dismissals = await db.execute({
    sql: `SELECT itemId FROM InboxDismissal WHERE userId = ? AND dismissedAt >= ?`,
    args: [opts.userId, dismissCutoff],
  });
  const dismissedIds = new Set(
    dismissals.rows.map((r) => String((r as unknown as { itemId: unknown }).itemId)),
  );

  const forYou: InboxItem[] = [];
  const watching: InboxItem[] = [];
  const firmWide: InboxItem[] = [];

  for (const customer of customers) {
    const { isActiveOwner, ownsAnyColumn } = ownerRoles(customer, opts.userId);
    // Non-admins who don't own any column on this customer are
    // skipped entirely — there's nothing to put in either bucket.
    if (!opts.isAdmin && !ownsAnyColumn) continue;

    const candidates = await Promise.all([
      checkStageOverdue(customer),
      checkBlockerOpen(customer),
      checkDecisionPending(customer),
      checkQuestionnaire(customer),
      checkHandoffIncoming(customer, opts.userId),
      checkRenewalDueSoon(customer),
    ]);

    for (const item of candidates) {
      if (!item) continue;
      if (dismissedIds.has(item.id)) continue;
      // firmWide always populated for admins; bucketing into For You /
      // Watching depends on the user's owner relationship to this
      // customer specifically.
      if (opts.isAdmin) firmWide.push(item);
      if (isActiveOwner) {
        forYou.push(item);
      } else if (ownsAnyColumn) {
        watching.push(item);
      }
    }
  }

  // Sort: critical → warning → info, then ageDays desc.
  const sortFn = (a: InboxItem, b: InboxItem): number => {
    const sevDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sevDelta !== 0) return sevDelta;
    return b.ageDays - a.ageDays;
  };
  forYou.sort(sortFn);
  watching.sort(sortFn);
  firmWide.sort(sortFn);

  // Cap each bucket.
  return {
    forYou: forYou.slice(0, BUCKET_CAP),
    watching: watching.slice(0, BUCKET_CAP),
    firmWide: opts.isAdmin ? firmWide.slice(0, BUCKET_CAP) : null,
  };
}

// Exported so the route layer can offer a "show dismissed too"
// debug query param OR future analytics can read it.
export async function recordDismissal(userId: string, itemId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO InboxDismissal (userId, itemId, dismissedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(userId, itemId) DO UPDATE SET dismissedAt = excluded.dismissedAt`,
    args: [userId, itemId, nowIso()],
  });
}

// ESLint silence — CUSTOMER_STAGES is imported above for the type
// narrowing; this `void` keeps tree-shakers honest if the route
// layer adds a stage-filter query param later.
void CUSTOMER_STAGES;
