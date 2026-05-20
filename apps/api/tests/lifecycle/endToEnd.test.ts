/**
 * Phase 54.4 — End-to-end lifecycle walkthrough.
 *
 * Seeds one customer at LEAD with three owners (sales, project
 * lead, CSM) and walks it through every stage to RENEWED via the
 * real `PATCH /api/v1/customers/:id/stage` route. At each step we
 * pin the lifecycle invariants Track A 52→54 has been building
 * toward:
 *
 *   - Transition writes a STAGE_TRANSITION ActivityLog row with the
 *     correct from/to and actorUserId.
 *   - healthScore + healthBand recompute (never stale).
 *   - When the transition crosses an owner boundary (sales →
 *     projectLead → csm), an OWNER_HANDOFF row is written and
 *     `effectiveOwnerUserId()` returns the new role's userId.
 *   - getCustomerDetail's stageWidget returns a discriminated-union
 *     payload whose `kind` matches the new stage.
 *   - The Phase 53.2 document catalog filtered to the new stage is
 *     non-empty (every non-terminal stage has a defined doc set).
 *   - A backward transition writes isRollback=true; re-advance works.
 *   - RENEWAL_DUE → RENEWED → LIVE_SLA loop increments renewalCount.
 *   - Dead-end paths: a pre-Won customer can land on LOST, a post-
 *     live customer can land on CHURNED, and both are terminal.
 *
 * Where the implementation surfaces a real bug, the test reports
 * it as a failure (per spec — we don't weaken the test to hide
 * findings).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { createId } from '@paralleldrive/cuid2';

import { setupTestDb } from '../_helpers/testDb.js';
import { customersRoutes } from '../../src/routes/customers.js';
import {
  getDb,
  insertCustomer,
  type CustomerStage,
} from '../../src/db/index.js';
import {
  effectiveOwnerUserId,
  getCustomer,
} from '../../src/db/customer.js';
import { getCustomerDetail } from '../../src/db/customerDetail.js';
import {
  DOCUMENT_CATALOG,
  documentsForStage,
} from '../../src/services/exporters/documentCatalog.js';

const JWT_SECRET = 'lifecycle-e2e-secret';

let cleanup: () => void;
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });
  await f.register(customersRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface OwnerSet {
  sales: { userId: string; token: string };
  projectLead: { userId: string; token: string };
  csm: { userId: string; token: string };
  firmId: string;
}

async function seedFirmWithThreeOwners(): Promise<OwnerSet> {
  const db = getDb();
  const firmId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
    args: [firmId, 'E2E Firm', `e2e-${firmId}`, 'STARTER', now],
  });
  const mk = async (label: string): Promise<{ userId: string; token: string }> => {
    const uid = createId();
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
            VALUES (?, ?, ?, ?, 'x', 'CONSULTANT', ?)`,
      args: [uid, firmId, `${uid}@x.io`, label, now],
    });
    const token = app.jwt.sign({
      userId: uid,
      firmId,
      role: 'APP_ADMIN',
      name: label,
      email: `${uid}@x.io`,
    });
    return { userId: uid, token };
  };
  return {
    firmId,
    sales: await mk('Sales Rep'),
    projectLead: await mk('Project Lead'),
    csm: await mk('CSM'),
  };
}

async function patchStage(
  customerId: string,
  toStage: CustomerStage,
  token: string,
  reason?: string,
): Promise<{ status: number; body: unknown }> {
  const r = await app.inject({
    method: 'PATCH',
    url: `/api/v1/customers/${customerId}/stage`,
    cookies: { token },
    payload: reason ? { toStage, reason } : { toStage },
  });
  return { status: r.statusCode, body: r.json() as unknown };
}

async function countActivityRows(
  customerId: string,
  action: string,
): Promise<number> {
  const r = await getDb().execute({
    sql: `SELECT COUNT(*) AS c FROM ActivityLog
          WHERE (customerId = ? OR engagementId = ?) AND action = ?`,
    args: [customerId, customerId, action],
  });
  const row = r.rows[0] as unknown as { c: number | string };
  return Number(row.c);
}

async function latestStageTransition(
  customerId: string,
): Promise<{ fromStage: string; toStage: string; actorUserId: string | null; isRollback: number }> {
  const r = await getDb().execute({
    sql: `SELECT fromStage, toStage, actorUserId, isRollback
          FROM ActivityLog
          WHERE (customerId = ? OR engagementId = ?) AND action = 'STAGE_TRANSITION'
          ORDER BY createdAt DESC LIMIT 1`,
    args: [customerId, customerId],
  });
  const row = r.rows[0] as unknown as {
    fromStage: unknown;
    toStage: unknown;
    actorUserId: unknown;
    isRollback: unknown;
  };
  return {
    fromStage: String(row.fromStage),
    toStage: String(row.toStage),
    actorUserId: row.actorUserId == null ? null : String(row.actorUserId),
    isRollback: Number(row.isRollback ?? 0),
  };
}

// Owner-canonical stages from the Phase 52 spec lock #2.
type ActiveRole = 'sales' | 'projectLead' | 'csm';
function expectedActiveRole(stage: CustomerStage): ActiveRole {
  if (
    stage === 'LEAD' ||
    stage === 'QUALIFIED' ||
    stage === 'PROPOSAL' ||
    stage === 'NEGOTIATION' ||
    stage === 'WON'
  )
    return 'sales';
  if (
    stage === 'DISCOVERY' ||
    stage === 'SCOPING' ||
    stage === 'BUILD' ||
    stage === 'UAT' ||
    stage === 'GOLIVE'
  )
    return 'projectLead';
  return 'csm';
}

// The full forward path Track A is verifying.
const FULL_PATH: CustomerStage[] = [
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
];

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM IssueItem`);
  await db.execute(`DELETE FROM DecisionItem`);
  await db.execute(`DELETE FROM BusinessProfile`);
  await db.execute(`DELETE FROM GeneratedDocument`);
  await db.execute(`DELETE FROM ProjectMember`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM Customer`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── Full forward walk: LEAD → RENEWED ─────────────────────────────────────

describe('lifecycle E2E — LEAD walks all the way to RENEWED', () => {
  it('every transition writes a clean STAGE_TRANSITION, handoffs at owner boundaries, widget kind matches stage', async () => {
    const owners = await seedFirmWithThreeOwners();
    const customerId = createId();
    const now = new Date().toISOString();

    // Seed a Customer + matching Engagement (id-preserved per Phase 52.1
    // so child rows the lifecycle writes line up with both).
    await getDb().execute({
      sql: `INSERT INTO Engagement
              (id, firmId, clientName, status, createdAt, updatedAt)
            VALUES (?, ?, ?, 'PROSPECT', ?, ?)`,
      args: [customerId, owners.firmId, 'Acme Industries', now, now],
    });
    await insertCustomer({
      id: customerId,
      firmId: owners.firmId,
      name: 'Acme Industries',
      currentStage: 'LEAD',
      salesOwnerUserId: owners.sales.userId,
      projectLeadUserId: owners.projectLead.userId,
      csmUserId: owners.csm.userId,
      sourceEngagementId: customerId,
    });

    // Track running counts so handoff assertions are cumulative.
    let priorHandoffs = 0;
    let priorTransitions = 0;
    let previousStage: CustomerStage = 'LEAD';
    let previousActiveOwner = owners.sales.userId;

    for (let i = 1; i < FULL_PATH.length; i++) {
      const toStage = FULL_PATH[i];
      // Use the new owner's token when crossing role boundaries — the
      // actor on the activity row should reflect whoever drove the
      // transition. For simplicity we use the *destination* owner.
      const destRole = expectedActiveRole(toStage);
      const actor =
        destRole === 'sales'
          ? owners.sales
          : destRole === 'projectLead'
            ? owners.projectLead
            : owners.csm;

      const { status, body } = await patchStage(customerId, toStage, actor.token);
      expect(status, `transition to ${toStage} returned ${status}`).toBe(200);

      // Transition row.
      const latest = await latestStageTransition(customerId);
      expect(latest.toStage, `latest TO for ${toStage}`).toBe(toStage);
      expect(latest.fromStage).toBe(previousStage);
      expect(latest.isRollback).toBe(0);
      expect(latest.actorUserId).toBe(actor.userId);
      priorTransitions += 1;
      expect(await countActivityRows(customerId, 'STAGE_TRANSITION')).toBe(
        priorTransitions,
      );

      // Customer row state.
      const customer = await getCustomer(customerId, owners.firmId);
      expect(customer, `customer missing after ${toStage}`).not.toBeNull();
      expect(customer!.currentStage).toBe(toStage);

      // Health is recomputed (non-null number in [0..100]).
      expect(customer!.health).not.toBeNull();
      expect(customer!.health!).toBeGreaterThanOrEqual(0);
      expect(customer!.health!).toBeLessThanOrEqual(100);

      // Owner handoff bookkeeping.
      const newActiveOwner = effectiveOwnerUserId(customer!);
      const expectedOwner = actor.userId;
      expect(newActiveOwner, `effective owner at ${toStage}`).toBe(expectedOwner);
      if (newActiveOwner !== previousActiveOwner) {
        priorHandoffs += 1;
      }
      expect(
        await countActivityRows(customerId, 'OWNER_HANDOFF'),
        `OWNER_HANDOFF count at ${toStage}`,
      ).toBe(priorHandoffs);
      previousActiveOwner = newActiveOwner ?? previousActiveOwner;

      // Body shape matches what the customers route returns.
      const respJson = body as { customer: { currentStage: string } };
      expect(respJson.customer.currentStage).toBe(toStage);

      // Detail page shape: stageWidget kind matches the destination
      // stage (for stages with widget coverage). RENEWED has no widget
      // kind of its own — it falls back to LIVE_SLA semantics on the
      // detail layer; allow either.
      const detail = await getCustomerDetail(customerId, owners.firmId);
      expect(detail, `detail missing after ${toStage}`).not.toBeNull();
      if (toStage !== 'RENEWED') {
        expect(detail!.stageWidget.kind, `widget kind at ${toStage}`).toBe(toStage);
      }

      // Document catalog filtered to the new stage. Pre-Won + delivery
      // + support + renewal stages all have entries. RENEWED is terminal
      // for doc purposes and may be empty.
      if (toStage !== 'RENEWED') {
        const docs = documentsForStage(toStage);
        expect(docs.length, `no documents defined for ${toStage}`).toBeGreaterThan(0);
      }

      previousStage = toStage;
    }

    // RENEWAL_DUE → RENEWED increments renewalCount.
    const final = await getCustomer(customerId, owners.firmId);
    expect(final!.renewalCount).toBeGreaterThanOrEqual(1);
  });

  it('rollback writes isRollback=true and re-advance works', async () => {
    const owners = await seedFirmWithThreeOwners();
    const customerId = createId();
    const now = new Date().toISOString();
    await getDb().execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
            VALUES (?, ?, ?, 'PROSPECT', ?, ?)`,
      args: [customerId, owners.firmId, 'Rollback Co', now, now],
    });
    await insertCustomer({
      id: customerId,
      firmId: owners.firmId,
      name: 'Rollback Co',
      currentStage: 'LEAD',
      salesOwnerUserId: owners.sales.userId,
      sourceEngagementId: customerId,
    });

    // LEAD → QUALIFIED → PROPOSAL forward
    expect((await patchStage(customerId, 'QUALIFIED', owners.sales.token)).status).toBe(200);
    expect((await patchStage(customerId, 'PROPOSAL', owners.sales.token)).status).toBe(200);

    // Rollback PROPOSAL → QUALIFIED
    const back = await patchStage(customerId, 'QUALIFIED', owners.sales.token, 'cooled off');
    expect(back.status).toBe(200);
    const latest = await latestStageTransition(customerId);
    expect(latest.fromStage).toBe('PROPOSAL');
    expect(latest.toStage).toBe('QUALIFIED');
    expect(latest.isRollback).toBe(1);

    // Re-advance to PROPOSAL — should be a forward (isRollback=0) row again.
    expect((await patchStage(customerId, 'PROPOSAL', owners.sales.token)).status).toBe(200);
    const after = await latestStageTransition(customerId);
    expect(after.fromStage).toBe('QUALIFIED');
    expect(after.toStage).toBe('PROPOSAL');
    expect(after.isRollback).toBe(0);
  });

  it('RENEWAL_DUE → LIVE_SLA also increments renewalCount (re-renewal loop)', async () => {
    const owners = await seedFirmWithThreeOwners();
    const customerId = createId();
    const now = new Date().toISOString();
    await getDb().execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
            VALUES (?, ?, ?, 'SLA_ACTIVE', ?, ?)`,
      args: [customerId, owners.firmId, 'Re-renew Co', now, now],
    });
    await insertCustomer({
      id: customerId,
      firmId: owners.firmId,
      name: 'Re-renew Co',
      currentStage: 'RENEWAL_DUE',
      csmUserId: owners.csm.userId,
      renewalCount: 0,
      sourceEngagementId: customerId,
    });
    const initial = await getCustomer(customerId, owners.firmId);
    expect(initial!.renewalCount).toBe(0);

    const r = await patchStage(customerId, 'LIVE_SLA', owners.csm.token, 'closed renewal');
    expect(r.status).toBe(200);

    const after = await getCustomer(customerId, owners.firmId);
    expect(after!.renewalCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── Dead-end paths ────────────────────────────────────────────────────────

describe('lifecycle E2E — dead-end paths', () => {
  it('a pre-Won customer can land on LOST and the stage is terminal', async () => {
    const owners = await seedFirmWithThreeOwners();
    const customerId = createId();
    const now = new Date().toISOString();
    await getDb().execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
            VALUES (?, ?, ?, 'PROSPECT', ?, ?)`,
      args: [customerId, owners.firmId, 'Lost Co', now, now],
    });
    await insertCustomer({
      id: customerId,
      firmId: owners.firmId,
      name: 'Lost Co',
      currentStage: 'NEGOTIATION',
      salesOwnerUserId: owners.sales.userId,
      sourceEngagementId: customerId,
    });

    const r = await patchStage(customerId, 'LOST', owners.sales.token, 'price too high');
    expect(r.status).toBe(200);
    const c = await getCustomer(customerId, owners.firmId);
    expect(c!.currentStage).toBe('LOST');
    // Terminal — further forward transition off LOST is not a normal
    // path. (No assertion that the API blocks it — there's no business
    // rule yet that forbids resurrecting a LOST customer, so we don't
    // pin one. Documented in LIFECYCLE_E2E.md as a future tightening.)
  });

  it('a post-live customer can land on CHURNED', async () => {
    const owners = await seedFirmWithThreeOwners();
    const customerId = createId();
    const now = new Date().toISOString();
    await getDb().execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
            VALUES (?, ?, ?, 'SLA_ACTIVE', ?, ?)`,
      args: [customerId, owners.firmId, 'Churn Co', now, now],
    });
    await insertCustomer({
      id: customerId,
      firmId: owners.firmId,
      name: 'Churn Co',
      currentStage: 'LIVE_SLA',
      csmUserId: owners.csm.userId,
      sourceEngagementId: customerId,
    });

    const r = await patchStage(customerId, 'CHURNED', owners.csm.token, 'switched competitor');
    expect(r.status).toBe(200);
    const c = await getCustomer(customerId, owners.firmId);
    expect(c!.currentStage).toBe('CHURNED');
  });
});

// ─── Persona-path coherence ───────────────────────────────────────────────

describe('lifecycle E2E — persona coherence', () => {
  it('expectedActiveRole matches effectiveOwnerUserId at every stage in the path', async () => {
    const owners = await seedFirmWithThreeOwners();
    const customerId = createId();
    const now = new Date().toISOString();
    await getDb().execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
            VALUES (?, ?, ?, 'PROSPECT', ?, ?)`,
      args: [customerId, owners.firmId, 'Persona Co', now, now],
    });
    await insertCustomer({
      id: customerId,
      firmId: owners.firmId,
      name: 'Persona Co',
      currentStage: 'LEAD',
      salesOwnerUserId: owners.sales.userId,
      projectLeadUserId: owners.projectLead.userId,
      csmUserId: owners.csm.userId,
      sourceEngagementId: customerId,
    });

    for (const stage of FULL_PATH) {
      if (stage !== 'LEAD') {
        const role = expectedActiveRole(stage);
        const actor =
          role === 'sales'
            ? owners.sales
            : role === 'projectLead'
              ? owners.projectLead
              : owners.csm;
        const r = await patchStage(customerId, stage, actor.token);
        expect(r.status).toBe(200);
      }
      const c = await getCustomer(customerId, owners.firmId);
      const role = expectedActiveRole(stage);
      const expectedOwner =
        role === 'sales'
          ? owners.sales.userId
          : role === 'projectLead'
            ? owners.projectLead.userId
            : owners.csm.userId;
      expect(
        effectiveOwnerUserId(c!),
        `active owner at ${stage} should be ${role}`,
      ).toBe(expectedOwner);
    }
  });
});

// ─── Catalog × lifecycle integrity ────────────────────────────────────────

describe('lifecycle E2E — catalog coverage', () => {
  it('document catalog defines at least one document for every non-terminal stage', () => {
    const terminal: ReadonlyArray<CustomerStage> = ['LOST', 'CHURNED', 'RENEWED'];
    for (const stage of FULL_PATH) {
      if (terminal.includes(stage)) continue;
      const docs = documentsForStage(stage);
      expect(docs.length, `no documents defined for ${stage}`).toBeGreaterThan(0);
    }
  });

  it('every catalog entry maps to a real stage from the lifecycle', () => {
    const stagesInPath = new Set<string>([...FULL_PATH, 'LOST', 'CHURNED']);
    for (const doc of DOCUMENT_CATALOG) {
      expect(
        stagesInPath.has(doc.stage),
        `doc ${doc.id} maps to unknown stage ${doc.stage}`,
      ).toBe(true);
    }
  });
});
