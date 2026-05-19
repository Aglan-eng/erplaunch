/**
 * Phase 52.7 — stage-specific widget builder tests.
 *
 * Exercises `buildStageWidget` across every stage in the union. For
 * stages with data-source plumbing (DISCOVERY questionnaire, BUILD
 * blockers/decisions, LIVE_SLA tickets, RENEWAL_DUE countdown) we
 * seed fixtures and pin the computed values. For stages whose data
 * sources don't exist yet (cutover checklist, hypercare incidents,
 * SLA uptime), we pin only the `kind` discriminator + that the
 * defaults are present.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../../_helpers/testDb.js';
import { getDb, insertCustomer } from '../../../src/db/index.js';
import {
  buildStageWidget,
  ensureCustomerMetadataColumn,
} from '../../../src/services/customer/stageWidget.js';
import { getCustomer, type CustomerStage } from '../../../src/db/customer.js';

let cleanup: () => void;
let firmId: string;

async function seedFirm(): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
    args: [id, 'Test Firm', `tf-${id}`, 'STARTER', new Date().toISOString()],
  });
  return id;
}

async function seedEngagement(firmIdArg: string, status = 'BUILD'): Promise<string> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Engagement
            (id, firmId, clientName, status, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, firmIdArg, `Client ${id.slice(0, 6)}`, status, now, now],
  });
  return id;
}

async function makeCustomer(
  stage: CustomerStage,
  patch: { contractEndDate?: string | null; targetGoLive?: string | null; dealValue?: number | null; health?: number | null } = {},
): Promise<string> {
  const engId = await seedEngagement(firmId);
  await insertCustomer({
    id: engId,
    firmId,
    name: `Cust ${stage}`,
    currentStage: stage,
    sourceEngagementId: engId,
    contractEndDate: patch.contractEndDate ?? null,
    targetGoLive: patch.targetGoLive ?? null,
    dealValue: patch.dealValue ?? null,
  });
  if (patch.health != null) {
    const db = getDb();
    await db.execute({
      sql: `UPDATE Customer SET health = ? WHERE id = ?`,
      args: [patch.health, engId],
    });
  }
  return engId;
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  await ensureCustomerMetadataColumn();
});

afterAll(() => cleanup());

beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM IssueItem`);
  await db.execute(`DELETE FROM DecisionItem`);
  await db.execute(`DELETE FROM BusinessProfile`);
  try {
    await db.execute(`DELETE FROM Ticket`);
  } catch {
    /* table may not exist in older test DBs */
  }
  await db.execute(`DELETE FROM Customer`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM Firm`);
  firmId = await seedFirm();
});

async function widgetFor(customerId: string) {
  const c = await getCustomer(customerId, firmId);
  if (!c) throw new Error(`fixture missing customer ${customerId}`);
  return buildStageWidget(c);
}

// ─── Shape per stage (kind discriminator) ──────────────────────────────────

describe('buildStageWidget — kind matches currentStage for every stage', () => {
  const stages: CustomerStage[] = [
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
    'LOST',
    'CHURNED',
  ];
  for (const stage of stages) {
    it(`returns kind=${stage} for a ${stage}-stage customer`, async () => {
      const id = await makeCustomer(stage, {
        contractEndDate:
          stage === 'RENEWAL_DUE' || stage === 'LIVE_SLA' || stage === 'RENEWED'
            ? new Date(Date.now() + 30 * 86_400_000).toISOString()
            : null,
      });
      const w = await widgetFor(id);
      expect(w.kind).toBe(stage);
    });
  }
});

// ─── DISCOVERY — questionnaire pct matches BusinessProfile mean ────────────

describe('buildStageWidget — DISCOVERY', () => {
  it('computes questionnaire completion % from BusinessProfile.completeness mean', async () => {
    const id = await makeCustomer('DISCOVERY');
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO BusinessProfile (id, engagementId, version, answers, completeness, updatedAt)
            VALUES (?, ?, 1, '{}', ?, ?)`,
      args: [
        createId(),
        id,
        JSON.stringify({ company: 1, finance: 0.5, ops: 0 }), // mean = 0.5 → 50%
        new Date().toISOString(),
      ],
    });
    const w = await widgetFor(id);
    expect(w.kind).toBe('DISCOVERY');
    if (w.kind !== 'DISCOVERY') return;
    expect(w.questionnaireCompletionPct).toBe(50);
    expect(w.questionnaireSectionsTotal).toBe(3);
    expect(w.questionnaireSectionsComplete).toBe(1);
    expect(w.nextSectionName).toBe('finance');
  });

  it('returns zeros when no BusinessProfile row exists', async () => {
    const id = await makeCustomer('DISCOVERY');
    const w = await widgetFor(id);
    if (w.kind !== 'DISCOVERY') throw new Error('wrong kind');
    expect(w.questionnaireCompletionPct).toBe(0);
    expect(w.questionnaireSectionsTotal).toBe(0);
    expect(w.nextSectionName).toBeNull();
  });
});

// ─── BUILD — open blocker + decision counts ────────────────────────────────

describe('buildStageWidget — BUILD', () => {
  it('counts open blockers + open decisions for the engagement', async () => {
    const id = await makeCustomer('BUILD');
    const db = getDb();
    const now = new Date().toISOString();
    // 3 open blockers, 1 resolved
    for (let i = 0; i < 3; i++) {
      await db.execute({
        sql: `INSERT INTO IssueItem (id, engagementId, title, status, createdAt, updatedAt)
              VALUES (?, ?, ?, 'OPEN', ?, ?)`,
        args: [createId(), id, `Blocker ${i}`, now, now],
      });
    }
    await db.execute({
      sql: `INSERT INTO IssueItem (id, engagementId, title, status, createdAt, updatedAt)
            VALUES (?, ?, 'Done', 'RESOLVED', ?, ?)`,
      args: [createId(), id, now, now],
    });
    // 2 pending decisions, 1 decided
    for (let i = 0; i < 2; i++) {
      await db.execute({
        sql: `INSERT INTO DecisionItem (id, engagementId, title, createdAt)
              VALUES (?, ?, ?, ?)`,
        args: [createId(), id, `Dec ${i}`, now],
      });
    }
    await db.execute({
      sql: `INSERT INTO DecisionItem (id, engagementId, title, decidedAt, createdAt)
            VALUES (?, ?, 'Decided', ?, ?)`,
      args: [createId(), id, now, now],
    });
    const w = await widgetFor(id);
    if (w.kind !== 'BUILD') throw new Error('wrong kind');
    expect(w.openBlockerCount).toBe(3);
    expect(w.openDecisionCount).toBe(2);
    expect(w.targetDays).toBeGreaterThan(0);
  });
});

// ─── RENEWAL_DUE — days countdown from contractEndDate ─────────────────────

describe('buildStageWidget — RENEWAL_DUE', () => {
  it('computes daysUntilRenewal from contractEndDate', async () => {
    const future = new Date(Date.now() + 45 * 86_400_000).toISOString();
    const id = await makeCustomer('RENEWAL_DUE', {
      contractEndDate: future,
      dealValue: 1_000_000, // $10k ARR (cents)
      health: 65,
    });
    const w = await widgetFor(id);
    if (w.kind !== 'RENEWAL_DUE') throw new Error('wrong kind');
    expect(w.daysUntilRenewal).toBeGreaterThanOrEqual(44);
    expect(w.daysUntilRenewal).toBeLessThanOrEqual(46);
    expect(w.renewalValueArr).toBe(10_000);
    expect(w.healthBand).toBe('yellow');
    expect(w.quoteGenerated).toBe(false);
  });
});

// ─── LIVE_SLA — open ticket count + nextRenewalDate pass-through ───────────

describe('buildStageWidget — LIVE_SLA', () => {
  it('counts open tickets and surfaces the next renewal date', async () => {
    const future = new Date(Date.now() + 200 * 86_400_000).toISOString();
    const id = await makeCustomer('LIVE_SLA', { contractEndDate: future });
    const db = getDb();
    const now = new Date().toISOString();
    for (const status of ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED']) {
      await db.execute({
        sql: `INSERT INTO Ticket (id, engagementId, firmId, title, status, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [createId(), id, firmId, `T-${status}`, status, now, now],
      });
    }
    const w = await widgetFor(id);
    if (w.kind !== 'LIVE_SLA') throw new Error('wrong kind');
    // OPEN, IN_PROGRESS, WAITING_CUSTOMER are still active; RESOLVED + CLOSED are not.
    expect(w.openTicketCount).toBe(3);
    expect(w.nextRenewalDate).toBe(future);
  });
});

// ─── GOLIVE — daysUntilGoLive + checklist defaults ─────────────────────────

describe('buildStageWidget — GOLIVE', () => {
  it('computes daysUntilGoLive from targetGoLive', async () => {
    const future = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const id = await makeCustomer('GOLIVE', { targetGoLive: future });
    const w = await widgetFor(id);
    if (w.kind !== 'GOLIVE') throw new Error('wrong kind');
    expect(w.daysUntilGoLive).toBeGreaterThanOrEqual(13);
    expect(w.daysUntilGoLive).toBeLessThanOrEqual(15);
    // Checklist defaults until the future phase wires real data.
    expect(w.cutoverChecklistTotal).toBe(5);
    expect(w.cutoverChecklistComplete).toBe(0);
  });

  it('returns null daysUntilGoLive when targetGoLive is not set', async () => {
    const id = await makeCustomer('GOLIVE', { targetGoLive: null });
    const w = await widgetFor(id);
    if (w.kind !== 'GOLIVE') throw new Error('wrong kind');
    expect(w.daysUntilGoLive).toBeNull();
  });
});

// ─── LEAD — leadSource pulled from Customer ────────────────────────────────

describe('buildStageWidget — LEAD', () => {
  it('exposes daysInStage + targetDays + leadSource', async () => {
    const id = await makeCustomer('LEAD');
    const db = getDb();
    await db.execute({
      sql: `UPDATE Customer SET leadSource = ? WHERE id = ?`,
      args: ['Inbound — website', id],
    });
    const w = await widgetFor(id);
    if (w.kind !== 'LEAD') throw new Error('wrong kind');
    expect(w.leadSource).toBe('Inbound — website');
    expect(w.targetDays).toBeGreaterThan(0);
    expect(w.daysInStage).toBeGreaterThanOrEqual(0);
  });
});
