/**
 * Phase 45.8 — integration tests for the renewal tracker routes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { renewalRoutes } from '../../src/routes/renewal.js';
import { getDb, bootstrapFirmAdmin } from '../../src/db/index.js';

const JWT_SECRET = 'renewal-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-renewal-test',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(renewalRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  engagementId: string;
  adminToken: string;
}

async function seed(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Renewal Firm', `renewal-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Renewal Co', 'SLA_ACTIVE', now, now],
  });
  const passwordHash = await bcrypt.hash('x', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, userId, passwordHash, 'CONSULTANT'],
  });
  await bootstrapFirmAdmin({ firmId, userId });
  const adminToken = app.jwt.sign({
    userId, firmId, role: 'CONSULTANT', name: userId, email: `${userId}@example.com`,
  });
  return { firmId, engagementId, adminToken };
}

beforeAll(async () => {
  ({ cleanup } = await setupTestDb());
  app = await buildTestApp();
});
afterAll(async () => {
  await app.close();
  cleanup();
});
beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM EngagementRenewalState`);
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM RoleAuditLog`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM FirmRole`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /engagements/:id/renewal-state', () => {
  it('returns a default-shaped state when no row exists', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/renewal-state`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      data: { renewalStatus: string; urgency: string; daysToExpiry: number | null };
    };
    expect(body.data.renewalStatus).toBe('NOT_STARTED');
    expect(body.data.urgency).toBe('GREEN');
    expect(body.data.daysToExpiry).toBeNull();
  });
});

// ─── PATCH ───────────────────────────────────────────────────────────────────

describe('PATCH /engagements/:id/renewal-state', () => {
  it('upserts a fresh row and returns the computed urgency', async () => {
    const f = await seed();
    const future = new Date(Date.now() + 45 * 86_400_000).toISOString();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/renewal-state`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: {
        contractEndAt: future,
        renewalStatus: 'DISCUSSING',
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { urgency: string; renewalStatus: string } };
    // 45 days out → AMBER.
    expect(body.data.urgency).toBe('AMBER');
    expect(body.data.renewalStatus).toBe('DISCUSSING');
  });

  it('rejects an invalid renewalStatus value', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/renewal-state`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { renewalStatus: 'WAFFLING' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('persists expansionOpportunities + reads back', async () => {
    const f = await seed();
    const ops = [
      { title: 'Add Inventory module', size: '+$25k ARR', notes: 'Q4 push' },
      { title: 'Migration consulting', size: '+$10k one-time' },
    ];
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/renewal-state`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { expansionOpportunities: ops },
    });
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/renewal-state`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const body = get.json() as { data: { expansionOpportunities: Array<{ title: string }> } };
    expect(body.data.expansionOpportunities).toHaveLength(2);
    expect(body.data.expansionOpportunities[0].title).toBe('Add Inventory module');
  });

  it('writes a RENEWAL_UPDATED activity entry', async () => {
    const f = await seed();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/renewal-state`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { renewalStatus: 'PROPOSAL_OUT' },
    });
    const log = await getDb().execute({
      sql: `SELECT action, details FROM ActivityLog WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    expect(log.rows).toHaveLength(1);
    const row = log.rows[0] as unknown as { action: string; details: string };
    expect(row.action).toBe('RENEWAL_UPDATED');
    expect(row.details).toContain('PROPOSAL_OUT');
  });

  it('partial updates do not clobber other fields', async () => {
    const f = await seed();
    // First patch sets contract end + status.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/renewal-state`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: {
        contractEndAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
        renewalStatus: 'DISCUSSING',
      },
    });
    // Second patch only sets notes.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/renewal-state`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { notes: 'Awaiting commercials team review' },
    });
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/renewal-state`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const body = get.json() as { data: { renewalStatus: string; notes: string; contractEndAt: string | null } };
    expect(body.data.renewalStatus).toBe('DISCUSSING');
    expect(body.data.notes).toContain('commercials');
    expect(body.data.contractEndAt).toBeTruthy();
  });
});

// ─── Phase 45.9 — route registration + canonical path regression ─────────────
//
// Pin both ends so a future rename can't reintroduce the prod 404:
//
//   1. The canonical path /renewal-state is reachable on a freshly
//      built app (no auth bypass shortcuts) — the 401 confirms the
//      route is wired into the request lifecycle, not silently absent.
//   2. The old, incorrect path /renewal returns 404 — guards against a
//      well-meaning revert that re-adds the buggy path "for back-compat".
//   3. A defensive smoke test that lists every Fastify route prefixes
//      `renewal` and asserts only the canonical path appears.

describe('Phase 45.9 — renewal route registration', () => {
  it('canonical /renewal-state is reachable (auth gate fires, not 404)', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/renewal-state`,
      // No auth header — should hit the auth gate (401), NOT a 404.
    });
    // 401 here means the route is registered + the auth preHandler ran.
    // 404 would mean the route is silently absent (the original prod bug).
    expect(r.statusCode).toBe(401);
  });

  it('old /renewal path returns 404 (no longer registered)', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/renewal`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    // 404 confirms the buggy path isn't being kept around as a shadow.
    expect(r.statusCode).toBe(404);
  });

  it('Fastify route table contains renewal-state, not renewal', async () => {
    const printed = app.printRoutes({ commonPrefix: false });
    expect(printed).toContain('/engagements/:id/renewal-state');
    // Negative match — make sure the bare path didn't sneak back in.
    // We look for the standalone path with a quote/whitespace boundary
    // so /renewal-state doesn't false-positive the substring search.
    expect(printed).not.toMatch(/\/renewal(\s|$|[^-])/);
  });
});
