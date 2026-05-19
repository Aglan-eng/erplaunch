/**
 * Phase 52.9 — Lifecycle seed.
 *
 * Creates one [DEMO]-prefixed customer per lifecycle stage with
 * realistic attached data (BusinessProfile completeness, open
 * blockers / decisions, ActivityLog stage transitions, etc.) so
 * every Phase 52 dashboard renders with meaningful numbers.
 *
 * Idempotent: existing `[DEMO] ...` customers are upserted by name.
 * Owner assignment distributes round-robin across the firm's users
 * (or all-to-Hesham when the firm has only one).
 *
 * Run as:
 *   - CLI:      `pnpm -F @ofoq/api seed:lifecycle`
 *   - Endpoint: `POST /api/v1/admin/seed-lifecycle`
 */
import { createId } from '@paralleldrive/cuid2';
import {
  initDb,
  getDb,
  insertCustomer,
  type CustomerStage,
} from '../src/db/index.js';
import { ensureCustomerMetadataColumn } from '../src/services/customer/stageWidget.js';
import { recomputeAndPersistHealth } from '../src/services/customer/health.js';

const DEMO_PREFIX = '[DEMO]';

interface DemoCustomerSpec {
  name: string;
  stage: CustomerStage;
  daysInStage: number;
  arrDollars: number | null;
  leadSource?: string | null;
  contractEndDateDaysFromNow?: number | null;
  targetGoLiveDaysFromNow?: number | null;
  renewalCount?: number;
  isArchived?: boolean;
  lostReason?: string | null;
  metadata?: Record<string, unknown>;
  /** When non-zero, seed this many IssueItems with status='OPEN'. */
  openBlockers?: number;
  /** Seed N DecisionItems with decidedAt=NULL. */
  openDecisions?: number;
  /** BusinessProfile.completeness JSON (section → 0..1 score). */
  questionnaireSections?: Record<string, number>;
  /** Activity transitions to record (oldest → newest). */
  transitions?: Array<{ from: CustomerStage; to: CustomerStage; daysAgo: number; reason?: string }>;
}

// ─── Spec ──────────────────────────────────────────────────────────────────

const SPECS: ReadonlyArray<DemoCustomerSpec> = [
  {
    name: `${DEMO_PREFIX} Acme Sales Lead`,
    stage: 'LEAD',
    daysInStage: 5,
    arrDollars: 50_000,
    leadSource: 'Inbound',
    transitions: [{ from: 'LEAD', to: 'LEAD', daysAgo: 5, reason: 'New lead created' }],
  },
  {
    name: `${DEMO_PREFIX} Beta Qualified`,
    stage: 'QUALIFIED',
    daysInStage: 10,
    arrDollars: 80_000,
    leadSource: 'Outbound',
    transitions: [
      { from: 'LEAD', to: 'QUALIFIED', daysAgo: 10, reason: 'BANT confirmed' },
    ],
  },
  {
    name: `${DEMO_PREFIX} Gamma Proposal`,
    stage: 'PROPOSAL',
    daysInStage: 7,
    arrDollars: 120_000,
    metadata: { proposalGeneratedAt: isoDaysAgo(7) },
    transitions: [
      { from: 'QUALIFIED', to: 'PROPOSAL', daysAgo: 7, reason: 'Proposal sent' },
    ],
  },
  {
    name: `${DEMO_PREFIX} Delta Negotiation`,
    stage: 'NEGOTIATION',
    daysInStage: 5,
    arrDollars: 150_000,
    openDecisions: 2,
    transitions: [
      { from: 'PROPOSAL', to: 'NEGOTIATION', daysAgo: 5, reason: 'Pricing under review' },
    ],
  },
  {
    name: `${DEMO_PREFIX} Echo Won`,
    stage: 'WON',
    daysInStage: 2,
    arrDollars: 150_000,
    metadata: { sowGeneratedAt: isoDaysAgo(2), kickoffScheduled: true },
    transitions: [
      { from: 'NEGOTIATION', to: 'WON', daysAgo: 2, reason: 'Contract signed' },
    ],
  },
  {
    name: `${DEMO_PREFIX} Foxtrot Discovery`,
    stage: 'DISCOVERY',
    daysInStage: 12,
    arrDollars: 180_000,
    questionnaireSections: { company: 1, finance: 1, ops: 1, hr: 0, it: 0 },
    transitions: [
      { from: 'WON', to: 'DISCOVERY', daysAgo: 12, reason: 'Kickoff complete' },
    ],
  },
  {
    name: `${DEMO_PREFIX} Golf Scoping`,
    stage: 'SCOPING',
    daysInStage: 8,
    arrDollars: 175_000,
    openDecisions: 4,
    metadata: { pendingScopeSignoff: true },
    transitions: [
      { from: 'DISCOVERY', to: 'SCOPING', daysAgo: 8, reason: 'Discovery wrapped' },
    ],
  },
  {
    name: `${DEMO_PREFIX} Hotel Build`,
    stage: 'BUILD',
    daysInStage: 40,
    arrDollars: 250_000,
    openBlockers: 3,
    openDecisions: 1,
    transitions: [
      { from: 'SCOPING', to: 'BUILD', daysAgo: 40, reason: 'Scope signed off' },
    ],
  },
  {
    name: `${DEMO_PREFIX} India UAT`,
    stage: 'UAT',
    daysInStage: 15,
    arrDollars: 220_000,
    openBlockers: 1,
    metadata: { testsPassedPct: 75 },
    transitions: [
      { from: 'BUILD', to: 'UAT', daysAgo: 15, reason: 'Build complete' },
    ],
  },
  {
    name: `${DEMO_PREFIX} Juliet GoLive`,
    stage: 'GOLIVE',
    daysInStage: 5,
    arrDollars: 240_000,
    targetGoLiveDaysFromNow: 7,
    metadata: { cutoverChecklistComplete: 3, cutoverChecklistTotal: 5 },
    transitions: [
      { from: 'UAT', to: 'GOLIVE', daysAgo: 5, reason: 'UAT sign-off' },
    ],
  },
  {
    name: `${DEMO_PREFIX} Kilo Hypercare`,
    stage: 'HYPERCARE',
    daysInStage: 10,
    arrDollars: 240_000,
    metadata: {
      hypercareOpenIncidents: 2,
      hypercareP1Count: 0,
      hypercareStartDate: isoDaysAgo(10),
      hypercareDurationDays: 30,
    },
    transitions: [
      { from: 'GOLIVE', to: 'HYPERCARE', daysAgo: 10, reason: 'Cut over' },
    ],
  },
  {
    name: `${DEMO_PREFIX} Lima Live SLA`,
    stage: 'LIVE_SLA',
    daysInStage: 165,
    arrDollars: 200_000,
    contractEndDateDaysFromNow: 200,
    metadata: { slaUptimePct: 99.5, lastIncidentDaysAgo: 14 },
    transitions: [
      { from: 'HYPERCARE', to: 'LIVE_SLA', daysAgo: 165, reason: 'Hypercare exit' },
    ],
  },
  {
    name: `${DEMO_PREFIX} Mike Renewal Due`,
    stage: 'RENEWAL_DUE',
    daysInStage: 60,
    arrDollars: 200_000,
    contractEndDateDaysFromNow: 30,
    metadata: { quoteGenerated: false },
    transitions: [
      { from: 'LIVE_SLA', to: 'RENEWAL_DUE', daysAgo: 60, reason: 'Renewal window opened' },
    ],
  },
  {
    name: `${DEMO_PREFIX} November Renewed`,
    stage: 'LIVE_SLA',
    daysInStage: 30,
    arrDollars: 220_000,
    contractEndDateDaysFromNow: 335,
    renewalCount: 2,
    transitions: [
      { from: 'LIVE_SLA', to: 'RENEWAL_DUE', daysAgo: 90, reason: 'Auto-flagged' },
      { from: 'RENEWAL_DUE', to: 'LIVE_SLA', daysAgo: 30, reason: 'Renewed for 12mo' },
    ],
  },
  {
    name: `${DEMO_PREFIX} Oscar Lost`,
    stage: 'LOST',
    daysInStage: 90,
    arrDollars: 100_000,
    isArchived: true,
    lostReason: 'Price too high',
    metadata: { lostValue: 100_000 },
    transitions: [
      { from: 'NEGOTIATION', to: 'LOST', daysAgo: 90, reason: 'Price too high' },
    ],
  },
  {
    name: `${DEMO_PREFIX} Papa Churned`,
    stage: 'CHURNED',
    daysInStage: 60,
    arrDollars: 180_000,
    isArchived: true,
    lostReason: 'Switched to competitor',
    metadata: { churnReason: 'Switched to competitor', churnedAt: isoDaysAgo(60) },
    transitions: [
      { from: 'LIVE_SLA', to: 'CHURNED', daysAgo: 60, reason: 'Switched to competitor' },
    ],
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

async function getFirmUsers(firmId: string): Promise<string[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id FROM User WHERE firmId = ? ORDER BY createdAt ASC`,
    args: [firmId],
  });
  return r.rows.map((row) => String((row as unknown as { id: unknown }).id));
}

async function findExistingDemoCustomerId(firmId: string, name: string): Promise<string | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id FROM Customer WHERE firmId = ? AND name = ? LIMIT 1`,
    args: [firmId, name],
  });
  const row = r.rows[0] as { id?: string } | undefined;
  return row?.id ?? null;
}

async function ensureEngagementShell(firmId: string, customerName: string, demoId: string): Promise<string> {
  // Use the same id for both rows so FKs line up with the Phase 52.1
  // backfill contract (Customer.id == Engagement.id when sourced).
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT OR IGNORE INTO Engagement
            (id, firmId, clientName, status, createdAt, updatedAt)
          VALUES (?, ?, ?, 'DISCOVERY', ?, ?)`,
    args: [demoId, firmId, customerName, now, now],
  });
  return demoId;
}

async function setCustomerMetadata(customerId: string, meta: Record<string, unknown>): Promise<void> {
  await ensureCustomerMetadataColumn();
  const db = getDb();
  await db.execute({
    sql: `UPDATE Customer SET metadata = ? WHERE id = ?`,
    args: [JSON.stringify(meta), customerId],
  });
}

async function clearChildRows(engagementId: string): Promise<void> {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM IssueItem WHERE engagementId = ?`, args: [engagementId] });
  await db.execute({ sql: `DELETE FROM DecisionItem WHERE engagementId = ?`, args: [engagementId] });
  await db.execute({ sql: `DELETE FROM BusinessProfile WHERE engagementId = ?`, args: [engagementId] });
  await db.execute({
    sql: `DELETE FROM ActivityLog
          WHERE (engagementId = ? OR customerId = ?)
            AND action IN ('STAGE_TRANSITION','OWNER_HANDOFF')`,
    args: [engagementId, engagementId],
  });
}

async function seedBlockers(engagementId: string, count: number): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  for (let i = 0; i < count; i++) {
    await db.execute({
      sql: `INSERT INTO IssueItem (id, engagementId, title, priority, status, createdAt, updatedAt)
            VALUES (?, ?, ?, 'HIGH', 'OPEN', ?, ?)`,
      args: [createId(), engagementId, `[DEMO] Blocker ${i + 1}`, now, now],
    });
  }
}

async function seedPendingDecisions(engagementId: string, count: number): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  for (let i = 0; i < count; i++) {
    await db.execute({
      sql: `INSERT INTO DecisionItem (id, engagementId, title, description, createdAt)
            VALUES (?, ?, ?, ?, ?)`,
      args: [createId(), engagementId, `[DEMO] Decision ${i + 1}`, 'Awaiting input', now],
    });
  }
}

async function seedBusinessProfile(
  engagementId: string,
  sections: Record<string, number>,
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO BusinessProfile
            (id, engagementId, version, answers, completeness, updatedAt)
          VALUES (?, ?, 1, '{}', ?, ?)`,
    args: [createId(), engagementId, JSON.stringify(sections), new Date().toISOString()],
  });
}

async function seedTransitions(
  customerId: string,
  engagementId: string,
  firmId: string,
  actorUserId: string,
  transitions: NonNullable<DemoCustomerSpec['transitions']>,
): Promise<void> {
  const db = getDb();
  for (const t of transitions) {
    const ts = isoDaysAgo(t.daysAgo);
    await db.execute({
      sql: `INSERT INTO ActivityLog
              (id, engagementId, customerId, firmId, action, details,
               actorUserId, fromStage, toStage, isRollback, createdAt)
            VALUES (?, ?, ?, ?, 'STAGE_TRANSITION', ?, ?, ?, ?, 0, ?)`,
      args: [
        createId(),
        engagementId,
        customerId,
        firmId,
        JSON.stringify({ from: t.from, to: t.to, reason: t.reason ?? null }),
        actorUserId,
        t.from,
        t.to,
        ts,
      ],
    });
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

export interface SeedLifecycleResult {
  firmId: string;
  created: number;
  upserted: number;
  skippedDeadEnds: number;
  customerIds: string[];
}

export async function seedLifecycleForFirm(
  firmId: string,
  options: { includeDeadEnds?: boolean } = {},
): Promise<SeedLifecycleResult> {
  await ensureCustomerMetadataColumn();
  const includeDeadEnds = options.includeDeadEnds !== false;
  const users = await getFirmUsers(firmId);
  if (users.length === 0) {
    throw new Error(`seedLifecycleForFirm: no users in firm ${firmId}`);
  }
  const ownerRoles: ReadonlyArray<'salesOwnerUserId' | 'projectLeadUserId' | 'csmUserId' | 'arOwnerUserId'> = [
    'salesOwnerUserId',
    'projectLeadUserId',
    'csmUserId',
    'arOwnerUserId',
  ];

  let created = 0;
  let upserted = 0;
  let skipped = 0;
  const customerIds: string[] = [];

  for (let idx = 0; idx < SPECS.length; idx++) {
    const spec = SPECS[idx];
    const isDeadEnd = spec.stage === 'LOST' || spec.stage === 'CHURNED';
    if (isDeadEnd && !includeDeadEnds) {
      skipped++;
      continue;
    }

    const existingId = await findExistingDemoCustomerId(firmId, spec.name);
    const demoId = existingId ?? createId();
    await ensureEngagementShell(firmId, spec.name, demoId);

    // Round-robin sales owner across available users so Utilization has
    // variation; PM and CSM default to the first user.
    const salesUser = users[idx % users.length];
    const pmUser = users[(idx + 1) % users.length];
    const csmUser = users[(idx + 2) % users.length];
    const arUser = users[0];
    void ownerRoles;

    const dealValueCents = spec.arrDollars == null ? null : Math.round(spec.arrDollars * 100);
    const contractEnd =
      spec.contractEndDateDaysFromNow == null ? null : isoDaysFromNow(spec.contractEndDateDaysFromNow);
    const targetGoLive =
      spec.targetGoLiveDaysFromNow == null ? null : isoDaysFromNow(spec.targetGoLiveDaysFromNow);

    if (existingId) {
      const db = getDb();
      await db.execute({
        sql: `UPDATE Customer
              SET currentStage = ?, salesOwnerUserId = ?, projectLeadUserId = ?,
                  csmUserId = ?, arOwnerUserId = ?, leadSource = ?, dealValue = ?,
                  contractEndDate = ?, targetGoLive = ?, renewalCount = ?,
                  lostReason = ?, isArchived = ?, updatedAt = ?
              WHERE id = ?`,
        args: [
          spec.stage,
          salesUser,
          pmUser,
          csmUser,
          arUser,
          spec.leadSource ?? null,
          dealValueCents,
          contractEnd,
          targetGoLive,
          spec.renewalCount ?? 0,
          spec.lostReason ?? null,
          spec.isArchived ? 1 : 0,
          new Date().toISOString(),
          existingId,
        ],
      });
      upserted++;
    } else {
      await insertCustomer({
        id: demoId,
        firmId,
        name: spec.name,
        currentStage: spec.stage,
        salesOwnerUserId: salesUser,
        projectLeadUserId: pmUser,
        csmUserId: csmUser,
        arOwnerUserId: arUser,
        leadSource: spec.leadSource ?? null,
        dealValue: dealValueCents,
        contractEndDate: contractEnd,
        targetGoLive,
        renewalCount: spec.renewalCount ?? 0,
        isArchived: spec.isArchived ?? false,
        sourceEngagementId: demoId,
      });
      created++;
    }
    customerIds.push(demoId);

    // Refresh child rows so reruns stay accurate.
    await clearChildRows(demoId);
    if (spec.openBlockers) await seedBlockers(demoId, spec.openBlockers);
    if (spec.openDecisions) await seedPendingDecisions(demoId, spec.openDecisions);
    if (spec.questionnaireSections) await seedBusinessProfile(demoId, spec.questionnaireSections);
    if (spec.transitions && spec.transitions.length > 0) {
      await seedTransitions(demoId, demoId, firmId, salesUser, spec.transitions);
    }
    if (spec.metadata) await setCustomerMetadata(demoId, spec.metadata);
    if (spec.lostReason) {
      const db = getDb();
      await db.execute({
        sql: `UPDATE Customer SET lostReason = ? WHERE id = ?`,
        args: [spec.lostReason, demoId],
      });
    }

    // Recompute health so dashboards show realistic numbers.
    try {
      await recomputeAndPersistHealth(demoId);
    } catch {
      /* non-fatal */
    }
  }

  return {
    firmId,
    created,
    upserted,
    skippedDeadEnds: skipped,
    customerIds,
  };
}

// ─── CLI entry ─────────────────────────────────────────────────────────────

async function pickDefaultFirm(): Promise<string> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id FROM Firm ORDER BY createdAt ASC LIMIT 1`,
  });
  const row = r.rows[0] as { id?: string } | undefined;
  if (!row?.id) throw new Error('No firms in DB — create one before seeding lifecycle.');
  return row.id;
}

async function runCli(): Promise<void> {
  await initDb();
  const firmId = process.env.SEED_FIRM_ID ?? (await pickDefaultFirm());
  const result = await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
  // eslint-disable-next-line no-console
  console.log(
    `[seed:lifecycle] firm=${firmId} created=${result.created} upserted=${result.upserted} total=${result.customerIds.length}`,
  );
}

// Run only when invoked directly (not when imported).
const isDirectInvocation = (() => {
  try {
    const argv1 = process.argv[1] ?? '';
    return argv1.replace(/\\/g, '/').endsWith('scripts/seed-lifecycle.ts');
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  runCli().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[seed:lifecycle] failed:', e);
    process.exit(1);
  });
}
