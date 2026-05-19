/**
 * Phase 52.7 — Stage-specific widget payload.
 *
 * Computes a discriminated-union `StageWidget` for a Customer, based
 * on its `currentStage`. The Customer Detail page's Overview tab
 * renders a different mini-panel per stage:
 *
 *   - DISCOVERY → questionnaire completion + next section
 *   - BUILD    → open blockers + open decisions + days-in-stage gauge
 *   - LIVE_SLA → open tickets + uptime placeholder + next renewal date
 *   - RENEWAL_DUE → countdown to contractEndDate + value at risk
 *   - …14 stages total
 *
 * Data sources reuse what already exists in the DB:
 *   - BusinessProfile.completeness — questionnaire %
 *   - IssueItem (status='OPEN')    — blocker count
 *   - DecisionItem (decidedAt IS NULL) — open decision count
 *   - Ticket (status NOT IN ('RESOLVED','CLOSED')) — open tickets
 *   - ActivityLog STAGE_TRANSITION + Customer.createdAt — days-in-stage
 *   - Customer.contractEndDate     — renewal countdown
 *   - Customer.metadata (JSON)     — leadSource / lostReason /
 *                                    churnReason / cutoverChecklist /
 *                                    hypercareIncidents (set by future
 *                                    phases when those flows ship)
 *
 * For metrics with no real source yet (cutover checklist, hypercare
 * incident counts, SLA uptime, tests-passed %), we return reasonable
 * defaults and mark each with a TODO pointing at the future phase.
 */

import { getDb } from '../../db/index.js';
import {
  CUSTOMER_STAGES,
  type Customer,
  type CustomerStage,
} from '../../db/customer.js';
import { STAGE_TARGET_DAYS } from './health.js';

// ─── The discriminated union ───────────────────────────────────────────────

export type StageWidget =
  | {
      kind: 'LEAD' | 'QUALIFIED';
      daysInStage: number;
      targetDays: number;
      leadSource: string | null;
    }
  | {
      kind: 'PROPOSAL' | 'NEGOTIATION';
      daysInStage: number;
      targetDays: number;
      proposalGeneratedAt: string | null;
      arr: number | null;
    }
  | {
      kind: 'WON';
      sowGeneratedAt: string | null;
      kickoffScheduled: boolean;
    }
  | {
      kind: 'DISCOVERY';
      questionnaireCompletionPct: number;
      questionnaireSectionsComplete: number;
      questionnaireSectionsTotal: number;
      nextSectionName: string | null;
    }
  | {
      kind: 'SCOPING';
      openDecisionsCount: number;
      pendingScopeSignoff: boolean;
    }
  | {
      kind: 'BUILD';
      openBlockerCount: number;
      openDecisionCount: number;
      daysInStage: number;
      targetDays: number;
    }
  | {
      kind: 'UAT';
      openBlockerCount: number;
      daysInStage: number;
      targetDays: number;
      testsPassedPct: number | null;
    }
  | {
      kind: 'GOLIVE';
      daysUntilGoLive: number | null;
      cutoverChecklistComplete: number;
      cutoverChecklistTotal: number;
    }
  | {
      kind: 'HYPERCARE';
      openIncidentCount: number;
      p1Count: number;
      daysRemainingInHypercare: number;
      hypercareStartDate: string | null;
    }
  | {
      kind: 'LIVE_SLA';
      openTicketCount: number;
      slaUptimePct: number | null;
      lastIncidentDaysAgo: number | null;
      nextRenewalDate: string | null;
    }
  | {
      kind: 'RENEWAL_DUE';
      daysUntilRenewal: number;
      renewalValueArr: number | null;
      healthBand: 'red' | 'yellow' | 'green';
      quoteGenerated: boolean;
    }
  | {
      kind: 'RENEWED';
      renewalCount: number;
      lastRenewalDate: string | null;
      nextRenewalDate: string | null;
    }
  | {
      kind: 'LOST';
      lostReason: string | null;
      lostValue: number | null;
    }
  | {
      kind: 'CHURNED';
      churnReason: string | null;
      churnedAt: string | null;
    };

// ─── Customer.metadata schema (idempotent ALTER) ───────────────────────────

let _ensuredMetadataColumn = false;

/**
 * Adds a free-form JSON `metadata` column to Customer for storing the
 * widget-specific blobs that don't yet have dedicated tables
 * (leadSource override, kickoffScheduled flag, cutover checklist
 * progress, hypercare incident snapshot, quote-generated flag, churn
 * reason, etc.). Future phases that own those flows can promote
 * specific keys into dedicated columns or tables.
 */
export async function ensureCustomerMetadataColumn(): Promise<void> {
  if (_ensuredMetadataColumn) return;
  _ensuredMetadataColumn = true;
  const db = getDb();
  try {
    await db.execute(`ALTER TABLE Customer ADD COLUMN metadata TEXT`);
  } catch {
    // duplicate column on subsequent boots — idempotent.
  }
}

interface CustomerMetadata {
  leadSource?: string | null;
  proposalGeneratedAt?: string | null;
  sowGeneratedAt?: string | null;
  kickoffScheduled?: boolean;
  pendingScopeSignoff?: boolean;
  testsPassedPct?: number | null;
  cutoverChecklistComplete?: number;
  cutoverChecklistTotal?: number;
  hypercareStartDate?: string | null;
  hypercareDurationDays?: number;
  hypercareOpenIncidents?: number;
  hypercareP1Count?: number;
  slaUptimePct?: number | null;
  lastIncidentDaysAgo?: number | null;
  quoteGenerated?: boolean;
  lostReason?: string | null;
  lostValue?: number | null;
  churnReason?: string | null;
  churnedAt?: string | null;
}

async function loadMetadata(customerId: string): Promise<CustomerMetadata> {
  await ensureCustomerMetadataColumn();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT metadata FROM Customer WHERE id = ? LIMIT 1`,
    args: [customerId],
  });
  const row = r.rows[0] as { metadata?: string | null } | undefined;
  if (!row?.metadata) return {};
  try {
    return JSON.parse(row.metadata) as CustomerMetadata;
  } catch {
    return {};
  }
}

// ─── Data-source helpers ───────────────────────────────────────────────────

async function getOpenBlockerCount(engagementId: string | null): Promise<number> {
  if (!engagementId) return 0;
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM IssueItem WHERE engagementId = ? AND status = 'OPEN'`,
    args: [engagementId],
  });
  return Number((r.rows[0] as { c?: number | string } | undefined)?.c ?? 0);
}

async function getOpenDecisionCount(engagementId: string | null): Promise<number> {
  if (!engagementId) return 0;
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM DecisionItem WHERE engagementId = ? AND decidedAt IS NULL`,
    args: [engagementId],
  });
  return Number((r.rows[0] as { c?: number | string } | undefined)?.c ?? 0);
}

async function getOpenTicketCount(engagementId: string | null): Promise<number> {
  if (!engagementId) return 0;
  const db = getDb();
  // Ticket.status enum: OPEN | IN_PROGRESS | WAITING_CUSTOMER | RESOLVED | CLOSED.
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM Ticket
          WHERE engagementId = ? AND status NOT IN ('RESOLVED', 'CLOSED')`,
    args: [engagementId],
  });
  return Number((r.rows[0] as { c?: number | string } | undefined)?.c ?? 0);
}

async function getQuestionnaireCompleteness(
  engagementId: string | null,
): Promise<{ pct: number; sectionsComplete: number; sectionsTotal: number; nextSection: string | null }> {
  if (!engagementId) {
    return { pct: 0, sectionsComplete: 0, sectionsTotal: 0, nextSection: null };
  }
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT completeness FROM BusinessProfile WHERE engagementId = ? LIMIT 1`,
    args: [engagementId],
  });
  const json = (r.rows[0] as { completeness?: string | null } | undefined)?.completeness ?? null;
  if (!json) return { pct: 0, sectionsComplete: 0, sectionsTotal: 0, nextSection: null };
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const entries = Object.entries(obj).filter(
      (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]),
    );
    if (entries.length === 0) return { pct: 0, sectionsComplete: 0, sectionsTotal: 0, nextSection: null };
    const sum = entries.reduce((acc, [, v]) => acc + Math.max(0, Math.min(1, v)), 0);
    const pct = Math.round((sum / entries.length) * 100);
    const sectionsComplete = entries.filter(([, v]) => v >= 1).length;
    const sectionsTotal = entries.length;
    const next = entries.find(([, v]) => v < 1);
    return {
      pct,
      sectionsComplete,
      sectionsTotal,
      nextSection: next ? next[0] : null,
    };
  } catch {
    return { pct: 0, sectionsComplete: 0, sectionsTotal: 0, nextSection: null };
  }
}

async function getDaysInCurrentStage(
  customerId: string,
  currentStage: CustomerStage,
  customerCreatedAt: string,
  engagementId: string | null,
): Promise<number> {
  const db = getDb();
  const direct = await db.execute({
    sql: `SELECT MAX(createdAt) AS ts FROM ActivityLog
          WHERE customerId = ? AND action = 'STAGE_TRANSITION' AND toStage = ?`,
    args: [customerId, currentStage],
  });
  let ts = (direct.rows[0] as { ts?: string | null } | undefined)?.ts ?? null;
  if (!ts && engagementId) {
    const fallback = await db.execute({
      sql: `SELECT MAX(createdAt) AS ts FROM ActivityLog
            WHERE engagementId = ? AND action = 'STAGE_TRANSITION' AND toStage = ?`,
      args: [engagementId, currentStage],
    });
    ts = (fallback.rows[0] as { ts?: string | null } | undefined)?.ts ?? null;
  }
  const start = ts ? new Date(ts).getTime() : new Date(customerCreatedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000));
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function healthBandFor(score: number | null): 'red' | 'yellow' | 'green' {
  if (score == null) return 'red';
  if (score < 30) return 'red';
  if (score < 70) return 'yellow';
  return 'green';
}

async function getMostRecentRenewalDate(customerId: string): Promise<string | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT MAX(createdAt) AS ts FROM ActivityLog
          WHERE customerId = ? AND action = 'STAGE_TRANSITION'
            AND fromStage = 'RENEWAL_DUE'`,
    args: [customerId],
  });
  return (r.rows[0] as { ts?: string | null } | undefined)?.ts ?? null;
}

// ─── Public entrypoint ─────────────────────────────────────────────────────

/**
 * Build the StageWidget payload for a Customer. Pure read — no
 * side-effects. Callers pass an already-fetched Customer so the
 * detail aggregator doesn't double-query.
 */
export async function buildStageWidget(customer: Customer): Promise<StageWidget> {
  await ensureCustomerMetadataColumn();
  const meta = await loadMetadata(customer.id);
  const stage = customer.currentStage;
  const engagementId = customer.sourceEngagementId;
  const targetDays = STAGE_TARGET_DAYS[stage] ?? 30;
  const arr = customer.dealValue == null ? null : customer.dealValue / 100;
  // RENEWED is never the stored stage (per Customer.ts comment) but
  // included for completeness — falls through to renewedFallback.
  void CUSTOMER_STAGES;

  switch (stage) {
    case 'LEAD':
    case 'QUALIFIED': {
      const days = await getDaysInCurrentStage(
        customer.id,
        stage,
        customer.createdAt,
        engagementId,
      );
      return {
        kind: stage,
        daysInStage: days,
        targetDays,
        leadSource: meta.leadSource ?? customer.leadSource ?? null,
      };
    }
    case 'PROPOSAL':
    case 'NEGOTIATION': {
      const days = await getDaysInCurrentStage(
        customer.id,
        stage,
        customer.createdAt,
        engagementId,
      );
      return {
        kind: stage,
        daysInStage: days,
        targetDays,
        proposalGeneratedAt: meta.proposalGeneratedAt ?? null,
        arr,
      };
    }
    case 'WON':
      return {
        kind: 'WON',
        sowGeneratedAt: meta.sowGeneratedAt ?? null,
        // TODO(future): wire to a real KickoffMeeting table once it lands.
        kickoffScheduled: meta.kickoffScheduled === true,
      };
    case 'DISCOVERY': {
      const q = await getQuestionnaireCompleteness(engagementId);
      return {
        kind: 'DISCOVERY',
        questionnaireCompletionPct: q.pct,
        questionnaireSectionsComplete: q.sectionsComplete,
        questionnaireSectionsTotal: q.sectionsTotal,
        nextSectionName: q.nextSection,
      };
    }
    case 'SCOPING':
      return {
        kind: 'SCOPING',
        openDecisionsCount: await getOpenDecisionCount(engagementId),
        // TODO(future): wire to a real ScopeSignoff event once it lands.
        pendingScopeSignoff: meta.pendingScopeSignoff !== false,
      };
    case 'BUILD': {
      const [blockers, decisions, days] = await Promise.all([
        getOpenBlockerCount(engagementId),
        getOpenDecisionCount(engagementId),
        getDaysInCurrentStage(customer.id, 'BUILD', customer.createdAt, engagementId),
      ]);
      return {
        kind: 'BUILD',
        openBlockerCount: blockers,
        openDecisionCount: decisions,
        daysInStage: days,
        targetDays,
      };
    }
    case 'UAT': {
      const [blockers, days] = await Promise.all([
        getOpenBlockerCount(engagementId),
        getDaysInCurrentStage(customer.id, 'UAT', customer.createdAt, engagementId),
      ]);
      return {
        kind: 'UAT',
        openBlockerCount: blockers,
        daysInStage: days,
        targetDays,
        // TODO(future): wire to a real test-execution tracker.
        testsPassedPct: meta.testsPassedPct ?? null,
      };
    }
    case 'GOLIVE': {
      const days =
        customer.targetGoLive == null
          ? null
          : daysBetween(new Date().toISOString(), customer.targetGoLive);
      return {
        kind: 'GOLIVE',
        daysUntilGoLive: days,
        // TODO(future): wire to a real CutoverChecklist table.
        cutoverChecklistComplete: meta.cutoverChecklistComplete ?? 0,
        cutoverChecklistTotal: meta.cutoverChecklistTotal ?? 5,
      };
    }
    case 'HYPERCARE': {
      const duration = meta.hypercareDurationDays ?? 30;
      const startIso =
        meta.hypercareStartDate ??
        (await (async () => {
          const days = await getDaysInCurrentStage(
            customer.id,
            'HYPERCARE',
            customer.createdAt,
            engagementId,
          );
          return new Date(Date.now() - days * 86_400_000).toISOString();
        })());
      const elapsed = daysBetween(startIso, new Date().toISOString());
      return {
        kind: 'HYPERCARE',
        // TODO(future): wire to live IncidentReport table.
        openIncidentCount: meta.hypercareOpenIncidents ?? 0,
        p1Count: meta.hypercareP1Count ?? 0,
        daysRemainingInHypercare: Math.max(0, duration - elapsed),
        hypercareStartDate: startIso,
      };
    }
    case 'LIVE_SLA': {
      const openTickets = await getOpenTicketCount(engagementId);
      return {
        kind: 'LIVE_SLA',
        openTicketCount: openTickets,
        // TODO(future): wire to a real uptime telemetry source.
        slaUptimePct: meta.slaUptimePct ?? null,
        lastIncidentDaysAgo: meta.lastIncidentDaysAgo ?? null,
        nextRenewalDate: customer.contractEndDate,
      };
    }
    case 'RENEWAL_DUE': {
      const renewalDate =
        customer.contractEndDate ?? new Date(Date.now() + 30 * 86_400_000).toISOString();
      const days = Math.max(0, daysBetween(new Date().toISOString(), renewalDate));
      return {
        kind: 'RENEWAL_DUE',
        daysUntilRenewal: days,
        renewalValueArr: arr,
        healthBand: healthBandFor(customer.health),
        quoteGenerated: meta.quoteGenerated === true,
      };
    }
    case 'RENEWED': {
      const last = await getMostRecentRenewalDate(customer.id);
      return {
        kind: 'RENEWED',
        renewalCount: customer.renewalCount,
        lastRenewalDate: last,
        nextRenewalDate: customer.contractEndDate,
      };
    }
    case 'LOST':
      return {
        kind: 'LOST',
        lostReason: customer.lostReason ?? meta.lostReason ?? null,
        lostValue: meta.lostValue ?? arr,
      };
    case 'CHURNED':
      return {
        kind: 'CHURNED',
        churnReason: meta.churnReason ?? customer.lostReason ?? null,
        churnedAt: meta.churnedAt ?? customer.updatedAt,
      };
  }
}
