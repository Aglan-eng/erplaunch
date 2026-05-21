/**
 * Phase 56.2 — Accounts + Projects route tests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { createId } from '@paralleldrive/cuid2';

import { setupTestDb } from '../_helpers/testDb.js';
import { accountsRoutes } from '../../src/routes/accounts.js';
import { getDb, insertCustomer } from '../../src/db/index.js';
import { backfillAccounts, _testOnlyResetAccountMigrationFlags } from '../../src/db/account.js';

const JWT_SECRET = 'accounts-route-test';

let cleanup: () => void;
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(accountsRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

async function seedUser(): Promise<{ firmId: string; userId: string; token: string }> {
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await getDb().execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
    args: [firmId, 'Firm', `f-${firmId}`, 'STARTER', now],
  });
  await getDb().execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
          VALUES (?, ?, ?, ?, 'x', 'CONSULTANT', ?)`,
    args: [userId, firmId, `${userId}@x.io`, 'User', now],
  });
  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'APP_ADMIN',
    name: 'User',
    email: `${userId}@x.io`,
  });
  return { firmId, userId, token };
}

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
  await db.execute(`DELETE FROM Customer`);
  await db.execute(`DELETE FROM Account`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
  _testOnlyResetAccountMigrationFlags();
});

describe('GET /accounts', () => {
  it('401 without auth', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/accounts' });
    expect(r.statusCode).toBe(401);
  });

  it('returns the firm\'s accounts with project count + worst health', async () => {
    const u = await seedUser();
    // Seed one customer that the backfill will lift up to an Account.
    const cid = createId();
    const now = new Date().toISOString();
    await getDb().execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
            VALUES (?, ?, 'Acme', 'PROSPECT', ?, ?)`,
      args: [cid, u.firmId, now, now],
    });
    await insertCustomer({
      id: cid,
      firmId: u.firmId,
      name: 'Acme',
      currentStage: 'BUILD',
      sourceEngagementId: cid,
    });
    await getDb().execute({
      sql: `UPDATE Customer SET health = 25 WHERE id = ?`,
      args: [cid],
    });
    await backfillAccounts();

    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts',
      cookies: { token: u.token },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      accounts: Array<{ name: string; projectCount: number; worstHealth: number; worstHealthBand: string }>;
    };
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].name).toBe('Acme');
    expect(body.accounts[0].projectCount).toBe(1);
    expect(body.accounts[0].worstHealth).toBe(25);
    expect(body.accounts[0].worstHealthBand).toBe('red');
  });
});

describe('GET /accounts/:id', () => {
  it('returns account + projects, scoped to firm', async () => {
    const u = await seedUser();
    const r0 = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      cookies: { token: u.token },
      payload: { name: 'Beta Co' },
    });
    const accountId = (r0.json() as { account: { id: string } }).account.id;
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accountId}`,
      cookies: { token: u.token },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { account: { id: string; name: string }; projects: unknown[] };
    expect(body.account.id).toBe(accountId);
    expect(body.account.name).toBe('Beta Co');
    expect(body.projects).toEqual([]);
  });

  it('cross-firm read returns 404', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const r0 = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      cookies: { token: a.token },
      payload: { name: 'A Co' },
    });
    const accountId = (r0.json() as { account: { id: string } }).account.id;
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accountId}`,
      cookies: { token: b.token },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('POST /accounts', () => {
  it('creates an account', async () => {
    const u = await seedUser();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      cookies: { token: u.token },
      payload: {
        name: 'Gamma Co',
        primaryContactName: 'Lina',
        primaryContactEmail: 'lina@gamma.example',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { account: { id: string; name: string; primaryContactName: string } };
    expect(body.account.name).toBe('Gamma Co');
    expect(body.account.primaryContactName).toBe('Lina');
  });

  it('rejects empty name', async () => {
    const u = await seedUser();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      cookies: { token: u.token },
      payload: { name: '' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('POST /accounts/:id/projects', () => {
  it('creates a second project under an existing account (multi-project model)', async () => {
    const u = await seedUser();
    const r0 = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      cookies: { token: u.token },
      payload: { name: 'Delta Co' },
    });
    const accountId = (r0.json() as { account: { id: string } }).account.id;

    // First project — initial implementation.
    const p1 = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accountId}/projects`,
      cookies: { token: u.token },
      payload: { projectName: 'NetSuite initial rollout' },
    });
    expect(p1.statusCode).toBe(201);

    // Second project — Phase 2.
    const p2 = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accountId}/projects`,
      cookies: { token: u.token },
      payload: {
        projectName: 'Subsidiary onboarding',
        projectKind: 'PHASE_2',
        startStage: 'DISCOVERY',
      },
    });
    expect(p2.statusCode).toBe(201);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accountId}`,
      cookies: { token: u.token },
    });
    const body = detail.json() as {
      projects: Array<{ projectName: string; projectKind: string; currentStage: string }>;
    };
    expect(body.projects).toHaveLength(2);
    const kinds = body.projects.map((p) => p.projectKind).sort();
    expect(kinds).toEqual(['INITIAL_IMPLEMENTATION', 'PHASE_2'].sort());
    const phase2 = body.projects.find((p) => p.projectKind === 'PHASE_2');
    expect(phase2?.currentStage).toBe('DISCOVERY');
  });

  it('writes a PROJECT_CREATED ActivityLog row', async () => {
    const u = await seedUser();
    const acct = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      cookies: { token: u.token },
      payload: { name: 'Audit Co' },
    });
    const accountId = (acct.json() as { account: { id: string } }).account.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accountId}/projects`,
      cookies: { token: u.token },
      payload: { projectName: 'Watch me write activity' },
    });
    const r = await getDb().execute({
      sql: `SELECT COUNT(*) AS c FROM ActivityLog WHERE action = 'PROJECT_CREATED'`,
    });
    expect(Number((r.rows[0] as unknown as { c: number }).c)).toBe(1);
  });
});

describe('POST /leads', () => {
  it('with newAccount: creates Account + Project at LEAD in one call', async () => {
    const u = await seedUser();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/leads',
      cookies: { token: u.token },
      payload: {
        newAccount: { name: 'Echo Co', primaryContactName: 'Sam' },
        projectName: 'NetSuite — initial inquiry',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { accountId: string; projectId: string; createdNewAccount: boolean };
    expect(body.createdNewAccount).toBe(true);

    // Project lives at LEAD stage and on the new account.
    const db = getDb();
    const projRow = await db.execute({
      sql: `SELECT currentStage, accountId FROM Customer WHERE id = ?`,
      args: [body.projectId],
    });
    const row = projRow.rows[0] as unknown as { currentStage: unknown; accountId: unknown };
    expect(String(row.currentStage)).toBe('LEAD');
    expect(String(row.accountId)).toBe(body.accountId);

    // ActivityLog entry: LEAD_CREATED.
    const act = await db.execute({
      sql: `SELECT action FROM ActivityLog WHERE customerId = ? ORDER BY createdAt DESC LIMIT 1`,
      args: [body.projectId],
    });
    expect(String((act.rows[0] as unknown as { action: unknown }).action)).toBe('LEAD_CREATED');
  });

  it('with existing accountId: creates Project at LEAD under existing account', async () => {
    const u = await seedUser();
    const r0 = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      cookies: { token: u.token },
      payload: { name: 'Foxtrot Co' },
    });
    const accountId = (r0.json() as { account: { id: string } }).account.id;
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/leads',
      cookies: { token: u.token },
      payload: { accountId, projectName: 'Another inquiry' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { accountId: string; createdNewAccount: boolean };
    expect(body.accountId).toBe(accountId);
    expect(body.createdNewAccount).toBe(false);
  });

  it('rejects when both accountId AND newAccount are provided', async () => {
    const u = await seedUser();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/leads',
      cookies: { token: u.token },
      payload: {
        accountId: 'abc',
        newAccount: { name: 'X' },
        projectName: 'Y',
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects when neither is provided', async () => {
    const u = await seedUser();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/leads',
      cookies: { token: u.token },
      payload: { projectName: 'Y' },
    });
    expect(r.statusCode).toBe(400);
  });
});
