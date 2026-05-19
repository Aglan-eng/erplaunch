/**
 * Phase 52.6 — five role-based dashboards.
 *
 * Each function aggregates a firm-scoped Customer slice into the
 * shape the matching `/api/v1/reports/<dashboard>` endpoint
 * returns. Heavy reads are scoped to the firm so a per-firm sweep
 * stays under ~1k rows even at scale.
 *
 * Pipeline      → pre-Won funnel + conversion + velocity
 * Delivery      → active implementations + slip detection
 * Health        → Live SLA + Hypercare red/yellow/green distribution
 * Renewals      → 90-day exposure with ARR-at-risk breakdown
 * Utilization   → per-owner workload across the four owner columns
 */

import { getDb } from '../../db/index.js';
import {
  CUSTOMER_STAGES,
  type CustomerStage,
  type Customer,
} from '../../db/customer.js';
import { STAGE_TARGET_DAYS } from '../customer/health.js';

// ─── Shared helpers ────────────────────────────────────────────────────────

interface CustomerSlice {
  id: string;
  firmId: string;
  name: string;
  currentStage: CustomerStage;
  salesOwnerUserId: string | null;
  projectLeadUserId: string | null;
  csmUserId: string | null;
  arOwnerUserId: string | null;
  dealValue: number | null;
  contractEndDate: string | null;
  health: number | null;
  createdAt: string;
  sourceEngagementId: string | null;
  isArchived: boolean;
}

function parseRow(raw: unknown): CustomerSlice {
  const row = raw as Record<string, unknown>;
  const stage = String(row.currentStage ?? 'LEAD');
  return {
    id: String(row.id),
    firmId: String(row.firmId),
    name: String(row.name ?? ''),
    currentStage: (CUSTOMER_STAGES as readonly string[]).includes(stage)
      ? (stage as CustomerStage)
      : 'LEAD',
    salesOwnerUserId: row.salesOwnerUserId == null ? null : String(row.salesOwnerUserId),
    projectLeadUserId: row.projectLeadUserId == null ? null : String(row.projectLeadUserId),
    csmUserId: row.csmUserId == null ? null : String(row.csmUserId),
    arOwnerUserId: row.arOwnerUserId == null ? null : String(row.arOwnerUserId),
    dealValue: row.dealValue == null ? null : Number(row.dealValue),
    contractEndDate: row.contractEndDate == null ? null : String(row.contractEndDate),
    health: row.health == null ? null : Number(row.health),
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    sourceEngagementId: row.sourceEngagementId == null ? null : String(row.sourceEngagementId),
    isArchived: Number(row.isArchived ?? 0) === 1,
  };
}

async function loadCustomers(firmId: string): Promise<CustomerSlice[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, firmId, name, currentStage,
                 salesOwnerUserId, projectLeadUserId, csmUserId, arOwnerUserId,
                 dealValue, contractEndDate, health,
                 createdAt, sourceEngagementId, isArchived
          FROM Customer WHERE firmId = ?`,
    args: [firmId],
  });
  return r.rows.map(parseRow);
}

/**
 * Days between two ISO strings, floor to int. Negative returns clamp
 * at 0 (we never want a negative "days in stage" or "days overdue").
 */
function daysBetween(later: string, earlier: string): number {
  const a = new Date(later).getTime();
  const b = new Date(earlier).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((a - b) / 86_400_000));
}

/**
 * Resolve user names for a list of userIds in one round-trip. Used
 * by every dashboard that surfaces a "csmName", "projectLeadName",
 * etc. column.
 */
async function resolveUserNames(userIds: ReadonlyArray<string>): Promise<Record<string, string>> {
  const ids = Array.from(new Set(userIds.filter((id) => id && id.length > 0)));
  if (ids.length === 0) return {};
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, name FROM User WHERE id IN (${ids.map(() => '?').join(',')})`,
    args: ids,
  });
  const out: Record<string, string> = {};
  for (const row of r.rows) {
    const obj = row as unknown as { id: string; name?: string };
    out[obj.id] = obj.name ?? obj.id;
  }
  return out;
}

/**
 * Compute days the customer has been in its current stage. Pulls
 * the latest STAGE_TRANSITION ActivityLog row landing on the
 * current stage; falls back to `createdAt`.
 */
async function daysInCurrentStage(c: CustomerSlice): Promise<number> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT MAX(createdAt) AS ts FROM ActivityLog
          WHERE action = 'STAGE_TRANSITION' AND toStage = ?
            AND (customerId = ? OR (customerId IS NULL AND engagementId = ?))`,
    args: [c.currentStage, c.id, c.sourceEngagementId ?? ''],
  });
  const ts =
    (r.rows[0] as { ts?: string | null } | undefined)?.ts ?? c.createdAt;
  return daysBetween(new Date().toISOString(), ts);
}

// ─── 1. Pipeline ───────────────────────────────────────────────────────────

const PRE_WON_STAGES: ReadonlyArray<CustomerStage> = [
  'LEAD',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
];

export interface PipelineReport {
  funnel: Array<{ stage: CustomerStage; count: number; totalArr: number }>;
  conversionRates: Array<{ from: CustomerStage; to: CustomerStage; ratePct: number }>;
  avgDaysInStage: Array<{ stage: CustomerStage; days: number }>;
  stalledCount: number;
}

interface StageTransitionRow {
  customerId: unknown;
  engagementId: unknown;
  fromStage: unknown;
  toStage: unknown;
  createdAt: unknown;
}

export async function buildPipelineReport(firmId: string): Promise<PipelineReport> {
  const customers = (await loadCustomers(firmId)).filter((c) => !c.isArchived);
  const inFunnel = customers.filter((c) => PRE_WON_STAGES.includes(c.currentStage));

  // Funnel = count + total ARR per stage
  const funnel: PipelineReport['funnel'] = PRE_WON_STAGES.map((stage) => {
    const rows = inFunnel.filter((c) => c.currentStage === stage);
    const totalArr = rows.reduce(
      (acc, r) => acc + (r.dealValue == null ? 0 : r.dealValue / 100),
      0,
    );
    return { stage, count: rows.length, totalArr };
  });

  // Conversion rates from ActivityLog STAGE_TRANSITION rows in
  // the last 180 days. We pull all transitions for the firm's
  // customers, then bucket from→to pairs.
  const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const db = getDb();
  const transitionsResult = await db.execute({
    sql: `SELECT a.customerId, a.engagementId, a.fromStage, a.toStage, a.createdAt
          FROM ActivityLog a
          INNER JOIN Customer c
            ON (a.customerId = c.id) OR (a.customerId IS NULL AND a.engagementId = c.sourceEngagementId)
          WHERE c.firmId = ?
            AND a.action = 'STAGE_TRANSITION'
            AND a.createdAt >= ?`,
    args: [firmId, cutoff],
  });
  const transitions = transitionsResult.rows.map((raw) => {
    const r = raw as unknown as StageTransitionRow;
    return {
      from: String(r.fromStage ?? '') as CustomerStage,
      to: String(r.toStage ?? '') as CustomerStage,
      createdAt: String(r.createdAt),
      customerId: String(r.customerId ?? r.engagementId ?? ''),
    };
  });

  // Conversion rate from STAGE_A → STAGE_B = (# transitions that
  // landed on STAGE_B from STAGE_A) / (total customers who ever
  // sat in STAGE_A in the window). We approximate "sat in" by
  // counting any transition INTO STAGE_A.
  const cohortInto: Record<string, Set<string>> = {};
  const advancedTo: Record<string, Set<string>> = {};
  for (const t of transitions) {
    if (!cohortInto[t.to]) cohortInto[t.to] = new Set();
    cohortInto[t.to]!.add(t.customerId);
    if (!advancedTo[`${t.from}->${t.to}`]) advancedTo[`${t.from}->${t.to}`] = new Set();
    advancedTo[`${t.from}->${t.to}`]!.add(t.customerId);
  }
  const conversionPairs: Array<[CustomerStage, CustomerStage]> = [
    ['LEAD', 'QUALIFIED'],
    ['QUALIFIED', 'PROPOSAL'],
    ['PROPOSAL', 'NEGOTIATION'],
    ['NEGOTIATION', 'WON'],
  ];
  const conversionRates: PipelineReport['conversionRates'] = conversionPairs.map(([from, to]) => {
    const cohort = cohortInto[from]?.size ?? 0;
    const advanced = advancedTo[`${from}->${to}`]?.size ?? 0;
    const ratePct = cohort === 0 ? 0 : Math.round((advanced / cohort) * 100);
    return { from, to, ratePct };
  });

  // Avg days in stage: for each stage, look at completed time
  // intervals — i.e. pairs of (transition INTO stage, transition
  // OUT of stage) per customer. Pick the most recent completed
  // pair per customer to keep the noise down.
  const enterTimes: Record<string, Record<string, string>> = {}; // customerId → stage → ISO
  const intervals: Record<string, number[]> = {};
  for (const t of transitions.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!enterTimes[t.customerId]) enterTimes[t.customerId] = {};
    // The transition's `from` was exited; if we recorded when they
    // entered `from`, record the interval.
    const enteredAt = enterTimes[t.customerId]![t.from];
    if (enteredAt) {
      if (!intervals[t.from]) intervals[t.from] = [];
      intervals[t.from]!.push(daysBetween(t.createdAt, enteredAt));
      delete enterTimes[t.customerId]![t.from];
    }
    enterTimes[t.customerId]![t.to] = t.createdAt;
  }
  const avgDaysInStage: PipelineReport['avgDaysInStage'] = PRE_WON_STAGES.map((stage) => {
    const samples = intervals[stage] ?? [];
    const days =
      samples.length === 0 ? 0 : Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
    return { stage, days };
  });

  // Stalled = currently in a pre-Won stage AND days-in-stage > target
  let stalled = 0;
  for (const c of inFunnel) {
    const target = STAGE_TARGET_DAYS[c.currentStage] ?? 30;
    const days = await daysInCurrentStage(c);
    if (days > target) stalled++;
  }

  return { funnel, conversionRates, avgDaysInStage, stalledCount: stalled };
}

// ─── 2. Delivery ───────────────────────────────────────────────────────────

const DELIVERY_STAGES: ReadonlyArray<CustomerStage> = [
  'DISCOVERY',
  'SCOPING',
  'BUILD',
  'UAT',
  'GOLIVE',
];

export interface DeliveryReport {
  activeProjects: number;
  byStage: Array<{ stage: CustomerStage; total: number; onTrack: number; slipping: number }>;
  slippingList: Array<{
    customerId: string;
    customerName: string;
    stage: CustomerStage;
    daysOverdue: number;
    projectLeadName: string | null;
  }>;
  blockersByStage: Array<{ stage: CustomerStage; openBlockers: number }>;
  forecastedGoLives: Array<{
    customerId: string;
    customerName: string;
    estimatedGoLiveDate: string;
  }>;
}

export async function buildDeliveryReport(firmId: string): Promise<DeliveryReport> {
  const customers = (await loadCustomers(firmId)).filter(
    (c) => !c.isArchived && DELIVERY_STAGES.includes(c.currentStage),
  );

  // For each customer compute days in current stage so we can
  // tag them on-track vs slipping.
  const annotated: Array<CustomerSlice & { daysInStage: number; daysOverdue: number; slipping: boolean }> =
    [];
  for (const c of customers) {
    const days = await daysInCurrentStage(c);
    const target = STAGE_TARGET_DAYS[c.currentStage] ?? 30;
    annotated.push({
      ...c,
      daysInStage: days,
      daysOverdue: Math.max(0, days - target),
      slipping: days > target,
    });
  }

  const byStage: DeliveryReport['byStage'] = DELIVERY_STAGES.map((stage) => {
    const rows = annotated.filter((c) => c.currentStage === stage);
    return {
      stage,
      total: rows.length,
      onTrack: rows.filter((r) => !r.slipping).length,
      slipping: rows.filter((r) => r.slipping).length,
    };
  });

  const slipping = annotated.filter((c) => c.slipping).sort((a, b) => b.daysOverdue - a.daysOverdue);
  const leadNames = await resolveUserNames(
    slipping.map((c) => c.projectLeadUserId ?? '').filter(Boolean),
  );
  const slippingList: DeliveryReport['slippingList'] = slipping.map((c) => ({
    customerId: c.id,
    customerName: c.name,
    stage: c.currentStage,
    daysOverdue: c.daysOverdue,
    projectLeadName: c.projectLeadUserId ? (leadNames[c.projectLeadUserId] ?? null) : null,
  }));

  // Blockers = count of IssueItem.status='OPEN' grouped by the
  // customer's current stage.
  const db = getDb();
  const blockersByStage: DeliveryReport['blockersByStage'] = [];
  for (const stage of DELIVERY_STAGES) {
    const rows = annotated.filter((c) => c.currentStage === stage);
    if (rows.length === 0) {
      blockersByStage.push({ stage, openBlockers: 0 });
      continue;
    }
    const engIds = rows.map((r) => r.sourceEngagementId).filter((id): id is string => Boolean(id));
    if (engIds.length === 0) {
      blockersByStage.push({ stage, openBlockers: 0 });
      continue;
    }
    const r = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM IssueItem
            WHERE status = 'OPEN' AND engagementId IN (${engIds.map(() => '?').join(',')})`,
      args: engIds,
    });
    blockersByStage.push({
      stage,
      openBlockers: Number((r.rows[0] as { c?: number | string } | undefined)?.c ?? 0),
    });
  }

  // Forecasted go-live = project remaining-stage targets forward
  // from "now − days already in current stage" + sum of remaining
  // stage targets. Skip GOLIVE customers (they're effectively there).
  const stageOrder = DELIVERY_STAGES;
  const forecasted: DeliveryReport['forecastedGoLives'] = [];
  for (const c of annotated) {
    if (c.currentStage === 'GOLIVE') continue;
    const idx = stageOrder.indexOf(c.currentStage);
    if (idx < 0) continue;
    const remainingTarget = Math.max(0, (STAGE_TARGET_DAYS[c.currentStage] ?? 30) - c.daysInStage);
    let extraDays = remainingTarget;
    for (let i = idx + 1; i < stageOrder.length; i++) {
      extraDays += STAGE_TARGET_DAYS[stageOrder[i]!] ?? 30;
    }
    const projected = new Date(Date.now() + extraDays * 86_400_000).toISOString().slice(0, 10);
    forecasted.push({
      customerId: c.id,
      customerName: c.name,
      estimatedGoLiveDate: projected,
    });
  }
  forecasted.sort((a, b) => a.estimatedGoLiveDate.localeCompare(b.estimatedGoLiveDate));

  return {
    activeProjects: customers.length,
    byStage,
    slippingList,
    blockersByStage,
    forecastedGoLives: forecasted,
  };
}

// ─── 3. Customer Health ────────────────────────────────────────────────────

const MANAGED_STAGES: ReadonlyArray<CustomerStage> = ['HYPERCARE', 'LIVE_SLA', 'RENEWAL_DUE'];

export interface HealthReport {
  totalManagedCustomers: number;
  distribution: { red: number; yellow: number; green: number };
  redCustomers: Array<{
    customerId: string;
    customerName: string;
    healthScore: number;
    lastActivityDaysAgo: number;
    csmName: string | null;
  }>;
  churnRiskScore: number;
  byStage: Array<{ stage: CustomerStage; red: number; yellow: number; green: number }>;
}

function bandOf(score: number | null): 'red' | 'yellow' | 'green' {
  const s = score ?? 0;
  if (s < 30) return 'red';
  if (s < 70) return 'yellow';
  return 'green';
}

export async function buildHealthReport(firmId: string): Promise<HealthReport> {
  const customers = (await loadCustomers(firmId)).filter(
    (c) => !c.isArchived && MANAGED_STAGES.includes(c.currentStage),
  );
  const distribution = { red: 0, yellow: 0, green: 0 };
  const byStageMap: Record<string, { red: number; yellow: number; green: number }> = {};
  for (const stage of MANAGED_STAGES) byStageMap[stage] = { red: 0, yellow: 0, green: 0 };

  for (const c of customers) {
    const band = bandOf(c.health);
    distribution[band]++;
    if (byStageMap[c.currentStage]) byStageMap[c.currentStage]![band]++;
  }

  // Red list: ordered by lowest health score asc, take top 25.
  // Last activity = max ActivityLog.createdAt for the customer.
  const reds = customers.filter((c) => bandOf(c.health) === 'red');
  reds.sort((a, b) => (a.health ?? 0) - (b.health ?? 0));
  const top = reds.slice(0, 25);
  const csmNames = await resolveUserNames(
    top.map((c) => c.csmUserId ?? '').filter(Boolean),
  );
  const db = getDb();
  const redCustomers: HealthReport['redCustomers'] = [];
  for (const c of top) {
    const r = await db.execute({
      sql: `SELECT MAX(createdAt) AS ts FROM ActivityLog
            WHERE customerId = ? OR (customerId IS NULL AND engagementId = ?)`,
      args: [c.id, c.sourceEngagementId ?? ''],
    });
    const ts = (r.rows[0] as { ts?: string | null } | undefined)?.ts ?? c.createdAt;
    redCustomers.push({
      customerId: c.id,
      customerName: c.name,
      healthScore: c.health ?? 0,
      lastActivityDaysAgo: daysBetween(new Date().toISOString(), ts),
      csmName: c.csmUserId ? (csmNames[c.csmUserId] ?? null) : null,
    });
  }

  const churnRiskScore =
    customers.length === 0 ? 0 : Math.round((distribution.red / customers.length) * 100);

  const byStage: HealthReport['byStage'] = MANAGED_STAGES.map((stage) => ({
    stage,
    red: byStageMap[stage]!.red,
    yellow: byStageMap[stage]!.yellow,
    green: byStageMap[stage]!.green,
  }));

  return {
    totalManagedCustomers: customers.length,
    distribution,
    redCustomers,
    churnRiskScore,
    byStage,
  };
}

// ─── 4. Renewals ───────────────────────────────────────────────────────────

export interface RenewalsReport {
  next90Days: Array<{
    customerId: string;
    customerName: string;
    renewalDueDate: string;
    daysUntilDue: number;
    arr: number | null;
    healthBand: 'red' | 'yellow' | 'green';
    csmName: string | null;
  }>;
  totalArrAtRisk: number;
  byMonth: Array<{ monthLabel: string; count: number; arrAtRisk: number }>;
  riskBreakdown: { healthyRenewals: number; atRiskRenewals: number };
}

function projectedRenewalDate(c: CustomerSlice): string | null {
  if (c.contractEndDate) return c.contractEndDate;
  // Proxy: createdAt + 365 days. Same convention the spec calls for.
  const start = new Date(c.createdAt).getTime();
  if (!Number.isFinite(start)) return null;
  return new Date(start + 365 * 86_400_000).toISOString().slice(0, 10);
}

export async function buildRenewalsReport(firmId: string): Promise<RenewalsReport> {
  const customers = (await loadCustomers(firmId)).filter(
    (c) => !c.isArchived && (c.currentStage === 'LIVE_SLA' || c.currentStage === 'RENEWAL_DUE' || c.currentStage === 'HYPERCARE'),
  );
  const now = Date.now();
  const ninetyDaysOut = now + 90 * 86_400_000;

  const due: Array<CustomerSlice & { dueDate: string; daysUntilDue: number }> = [];
  for (const c of customers) {
    const d = projectedRenewalDate(c);
    if (!d) continue;
    const dueTime = new Date(d).getTime();
    if (!Number.isFinite(dueTime)) continue;
    if (dueTime > ninetyDaysOut) continue;
    due.push({
      ...c,
      dueDate: d,
      daysUntilDue: Math.floor((dueTime - now) / 86_400_000),
    });
  }
  due.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const csmNames = await resolveUserNames(due.map((c) => c.csmUserId ?? '').filter(Boolean));

  // Last-30-day activity check for "at-risk" classification.
  const db = getDb();
  const next90Days: RenewalsReport['next90Days'] = [];
  let totalArrAtRisk = 0;
  let atRiskCount = 0;
  let healthyCount = 0;
  for (const c of due) {
    const band = bandOf(c.health);
    const ar = c.dealValue == null ? null : c.dealValue / 100;
    next90Days.push({
      customerId: c.id,
      customerName: c.name,
      renewalDueDate: c.dueDate,
      daysUntilDue: c.daysUntilDue,
      arr: ar,
      healthBand: band,
      csmName: c.csmUserId ? (csmNames[c.csmUserId] ?? null) : null,
    });
    // At-risk = health red OR no activity in last 30 days
    const lastActivity = await db.execute({
      sql: `SELECT MAX(createdAt) AS ts FROM ActivityLog
            WHERE customerId = ? OR (customerId IS NULL AND engagementId = ?)`,
      args: [c.id, c.sourceEngagementId ?? ''],
    });
    const lastTs =
      (lastActivity.rows[0] as { ts?: string | null } | undefined)?.ts ?? c.createdAt;
    const daysSinceActivity = daysBetween(new Date().toISOString(), lastTs);
    const atRisk = band === 'red' || daysSinceActivity > 30;
    if (atRisk) {
      atRiskCount++;
      totalArrAtRisk += ar ?? 0;
    } else {
      healthyCount++;
    }
  }

  // Group by YYYY-MM label, in ascending order.
  const monthly: Record<string, { count: number; arrAtRisk: number }> = {};
  for (const row of next90Days) {
    const label = row.renewalDueDate.slice(0, 7); // YYYY-MM
    if (!monthly[label]) monthly[label] = { count: 0, arrAtRisk: 0 };
    monthly[label]!.count++;
    if (row.healthBand === 'red') monthly[label]!.arrAtRisk += row.arr ?? 0;
  }
  const byMonth: RenewalsReport['byMonth'] = Object.entries(monthly)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([monthLabel, v]) => ({ monthLabel, count: v.count, arrAtRisk: v.arrAtRisk }));

  return {
    next90Days,
    totalArrAtRisk,
    byMonth,
    riskBreakdown: { healthyRenewals: healthyCount, atRiskRenewals: atRiskCount },
  };
}

// ─── 5. Utilization ───────────────────────────────────────────────────────

export interface UtilizationReport {
  byUser: Array<{
    userId: string;
    userName: string;
    salesCount: number;
    projectLeadCount: number;
    csmCount: number;
    arCount: number;
    totalActive: number;
    isOverloaded: boolean;
  }>;
  overloadedUsers: number;
  unbalancedRoles: {
    role: 'sales' | 'projectLead' | 'csm' | 'ar';
    topUser: string;
    bottomUser: string;
    ratio: number;
  } | null;
}

const OVERLOAD_THRESHOLD = 15;

function userInActiveStage(stages: ReadonlyArray<CustomerStage>, c: Customer): boolean {
  return stages.includes(c.currentStage);
}

const SALES_OWNER_STAGES: ReadonlyArray<CustomerStage> = [
  'LEAD',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
];
const PM_OWNER_STAGES: ReadonlyArray<CustomerStage> = [
  'DISCOVERY',
  'SCOPING',
  'BUILD',
  'UAT',
  'GOLIVE',
];
const CSM_OWNER_STAGES: ReadonlyArray<CustomerStage> = [
  'HYPERCARE',
  'LIVE_SLA',
  'RENEWAL_DUE',
  'RENEWED',
];

export async function buildUtilizationReport(firmId: string): Promise<UtilizationReport> {
  const customers = (await loadCustomers(firmId)).filter((c) => !c.isArchived);

  // Gather every userId that appears in ANY owner column for this firm.
  const userIds = new Set<string>();
  for (const c of customers) {
    for (const col of [c.salesOwnerUserId, c.projectLeadUserId, c.csmUserId, c.arOwnerUserId]) {
      if (col) userIds.add(col);
    }
  }
  const userNames = await resolveUserNames(Array.from(userIds));

  const byUser: UtilizationReport['byUser'] = Array.from(userIds)
    .map((userId) => {
      const salesCount = customers.filter(
        (c) =>
          c.salesOwnerUserId === userId &&
          userInActiveStage(SALES_OWNER_STAGES, c as unknown as Customer),
      ).length;
      const projectLeadCount = customers.filter(
        (c) =>
          c.projectLeadUserId === userId &&
          userInActiveStage(PM_OWNER_STAGES, c as unknown as Customer),
      ).length;
      const csmCount = customers.filter(
        (c) =>
          c.csmUserId === userId &&
          userInActiveStage(CSM_OWNER_STAGES, c as unknown as Customer),
      ).length;
      // AR owners count across all stages.
      const arCount = customers.filter((c) => c.arOwnerUserId === userId).length;
      const totalActive = salesCount + projectLeadCount + csmCount + arCount;
      return {
        userId,
        userName: userNames[userId] ?? userId,
        salesCount,
        projectLeadCount,
        csmCount,
        arCount,
        totalActive,
        isOverloaded: totalActive > OVERLOAD_THRESHOLD,
      };
    })
    .sort((a, b) => b.totalActive - a.totalActive);

  const overloadedUsers = byUser.filter((u) => u.isOverloaded).length;

  // Find the most-skewed role by ratio of top to bottom non-zero count.
  let unbalancedRoles: UtilizationReport['unbalancedRoles'] = null;
  const roles: Array<{ key: UtilizationReport['unbalancedRoles'] extends infer T ? T extends null ? never : 'sales' | 'projectLead' | 'csm' | 'ar' : never; field: keyof typeof byUser[number] }> = [
    { key: 'sales' as const, field: 'salesCount' },
    { key: 'projectLead' as const, field: 'projectLeadCount' },
    { key: 'csm' as const, field: 'csmCount' },
    { key: 'ar' as const, field: 'arCount' },
  ];
  let worstRatio = 1;
  for (const r of roles) {
    const counts = byUser
      .map((u) => ({ name: u.userName, n: Number(u[r.field]) }))
      .filter((c) => c.n > 0);
    if (counts.length < 2) continue;
    counts.sort((a, b) => b.n - a.n);
    const top = counts[0]!;
    const bottom = counts[counts.length - 1]!;
    const ratio = top.n / bottom.n;
    if (ratio > worstRatio) {
      worstRatio = ratio;
      unbalancedRoles = {
        role: r.key,
        topUser: top.name,
        bottomUser: bottom.name,
        ratio: Math.round(ratio * 10) / 10,
      };
    }
  }

  return { byUser, overloadedUsers, unbalancedRoles };
}
