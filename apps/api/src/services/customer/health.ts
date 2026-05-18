/**
 * Phase 52.3.1 — Customer composite health score.
 *
 * Implements Phase 52 locked decision 4 EXACTLY:
 *
 *   30 pts × (questionnaire completion %, 0..1)
 *   25 pts × max(0, 1 − openBlockerCount × 0.05)
 *   25 pts × max(0, 1 − daysOverdueOnStageAdvance / 30)
 *   20 pts × max(0, 1 − decisionsPendingOver14Days × 0.2)
 *
 *   Sum, clamp 0..100.
 *   Band: <30 red · 30..69 yellow · ≥70 green.
 *
 * Data sources:
 *   - Questionnaire completion → BusinessProfile.completeness JSON
 *     (avg of values, 0..1).
 *   - Open blocker count → IssueItem rows with status='OPEN' on the
 *     customer's engagement.
 *   - Days overdue on stage advance → (now − lastStageTransition)
 *     − STAGE_TARGET_DAYS[currentStage]; if there's no transition
 *     row yet, count from Customer.createdAt.
 *   - Decisions pending > 14d → DecisionItem with decidedAt IS NULL
 *     AND createdAt < now − 14 days.
 *
 * For "blockers" the canonical signal in this codebase is IssueItem
 * (status enum has OPEN). RiskItem also has status but is the more
 * abstract "what might go wrong" log — issues are the things that
 * have gone wrong already, which matches the spec's "blocker"
 * connotation better.
 */

import { getDb } from '../../db/index.js';
import type { CustomerStage } from '../../db/customer.js';

/**
 * Target days per stage. Once a customer has been in a stage longer
 * than its target, every additional day chips at the health score.
 * Numbers are deliberately conservative — they're a "you should be
 * concerned" threshold, not a hard SLA.
 */
export const STAGE_TARGET_DAYS: Record<CustomerStage, number> = {
  LEAD: 14,
  QUALIFIED: 14,
  PROPOSAL: 21,
  NEGOTIATION: 14,
  WON: 7,
  DISCOVERY: 30,
  SCOPING: 21,
  BUILD: 60,
  UAT: 21,
  GOLIVE: 14,
  HYPERCARE: 30,
  LIVE_SLA: 365,
  RENEWAL_DUE: 90,
  // Terminal stages — no expiry pressure; large numbers neutralise
  // the score component without special-casing.
  RENEWED: 365,
  LOST: 365,
  CHURNED: 365,
};

export type HealthBand = 'red' | 'yellow' | 'green';

export interface HealthResult {
  score: number;
  band: HealthBand;
}

interface CustomerRowForHealth {
  id: unknown;
  currentStage: unknown;
  createdAt: unknown;
  sourceEngagementId: unknown;
  isArchived: unknown;
}

function bandFor(score: number): HealthBand {
  if (score < 30) return 'red';
  if (score < 70) return 'yellow';
  return 'green';
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * BusinessProfile.completeness is a JSON object — typically a
 * section-keyed map of 0..1 numbers. We average the values. Empty
 * object → 0 (no signal yet). Single overall value → that value.
 */
function questionnaireCompletion(completenessJson: string | null): number {
  if (!completenessJson) return 0;
  try {
    const obj = JSON.parse(completenessJson) as Record<string, unknown>;
    const values = Object.values(obj).filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v),
    );
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, v) => acc + clamp01(v), 0);
    return clamp01(sum / values.length);
  } catch {
    return 0;
  }
}

async function getOpenBlockerCount(engagementId: string | null): Promise<number> {
  if (!engagementId) return 0;
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM IssueItem WHERE engagementId = ? AND status = 'OPEN'`,
    args: [engagementId],
  });
  return Number((r.rows[0] as { c?: number | string } | undefined)?.c ?? 0);
}

async function getDecisionsPendingOver14Days(engagementId: string | null): Promise<number> {
  if (!engagementId) return 0;
  const db = getDb();
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM DecisionItem
          WHERE engagementId = ? AND decidedAt IS NULL AND createdAt < ?`,
    args: [engagementId, cutoff],
  });
  return Number((r.rows[0] as { c?: number | string } | undefined)?.c ?? 0);
}

/**
 * Time spent IN the current stage. Reads the most recent
 * STAGE_TRANSITION ActivityLog row where toStage matches the
 * customer's current stage; falls back to the customer's
 * createdAt timestamp if no transition row exists.
 *
 * Customer.id is the primary link (Phase 52.1's parallel customerId
 * column on ActivityLog); the legacy engagementId path is the
 * fallback for old rows that pre-date the column being populated.
 */
async function getDaysInCurrentStage(
  customerId: string,
  currentStage: string,
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

/**
 * Compose the four components per the locked formula. Returns
 * {score, band} where score ∈ [0, 100].
 *
 * Returns {score: 0, band: 'red'} for a missing customer or an
 * archived one — archived customers don't surface in active
 * dashboards, so the floor signal is the right semantic.
 */
export async function computeHealthScore(customerId: string): Promise<HealthResult> {
  const db = getDb();
  const customerRow = await db.execute({
    sql: `SELECT id, currentStage, createdAt, sourceEngagementId, isArchived
          FROM Customer WHERE id = ? LIMIT 1`,
    args: [customerId],
  });
  const row = customerRow.rows[0] as unknown as CustomerRowForHealth | undefined;
  if (!row) return { score: 0, band: 'red' };
  if (Number(row.isArchived ?? 0) === 1) return { score: 0, band: 'red' };

  const currentStage = String(row.currentStage ?? 'LEAD') as CustomerStage;
  const createdAt = String(row.createdAt ?? new Date().toISOString());
  const engagementId =
    row.sourceEngagementId == null ? null : String(row.sourceEngagementId);

  // ─── Questionnaire completion (30 pts) ────────────────────────────────
  let questionnairePct = 0;
  if (engagementId) {
    const bp = await db.execute({
      sql: `SELECT completeness FROM BusinessProfile WHERE engagementId = ? LIMIT 1`,
      args: [engagementId],
    });
    const completenessJson =
      (bp.rows[0] as { completeness?: string | null } | undefined)?.completeness ?? null;
    questionnairePct = questionnaireCompletion(completenessJson);
  }
  const questionnaireComponent = 30 * questionnairePct;

  // ─── Open blockers (25 pts, drops by 5% per blocker) ──────────────────
  const blockerCount = await getOpenBlockerCount(engagementId);
  const blockerComponent = 25 * Math.max(0, 1 - blockerCount * 0.05);

  // ─── Days overdue on stage advance (25 pts, drops by 1/30 per day) ───
  const daysInStage = await getDaysInCurrentStage(
    customerId,
    currentStage,
    createdAt,
    engagementId,
  );
  const targetDays = STAGE_TARGET_DAYS[currentStage] ?? 30;
  const daysOverdue = Math.max(0, daysInStage - targetDays);
  const stageComponent = 25 * Math.max(0, 1 - daysOverdue / 30);

  // ─── Decisions pending > 14 days (20 pts, drops by 20% per pending) ──
  const pendingDecisions = await getDecisionsPendingOver14Days(engagementId);
  const decisionsComponent = 20 * Math.max(0, 1 - pendingDecisions * 0.2);

  const raw =
    questionnaireComponent + blockerComponent + stageComponent + decisionsComponent;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, band: bandFor(score) };
}

/**
 * Persist a freshly computed score onto the Customer.health column.
 * Wraps computeHealthScore and the UPDATE so the reconcile worker +
 * the advanceStage hook can both call a single function.
 */
export async function recomputeAndPersistHealth(customerId: string): Promise<HealthResult> {
  const result = await computeHealthScore(customerId);
  const db = getDb();
  await db.execute({
    sql: `UPDATE Customer SET health = ?, updatedAt = ? WHERE id = ?`,
    args: [result.score, new Date().toISOString(), customerId],
  });
  return result;
}

/**
 * Exposed for tests so we can pin the band thresholds without
 * spinning up a DB fixture per case.
 */
export function _testOnlyBandFor(score: number): HealthBand {
  return bandFor(score);
}
