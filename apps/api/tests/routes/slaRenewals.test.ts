/**
 * Phase 48.2 — route tests for the firm-wide renewal pipeline at
 * GET /api/v1/sla/renewals.
 *
 * Pins:
 *   1. requires auth
 *   2. only returns engagements in the caller firm
 *   3. only returns engagements in SLA_ACTIVE status
 *   4. computes urgency window from contractEndAt
 *   5. uses default NOT_STARTED row when no EngagementRenewalState exists
 *   6. sorts RED → AMBER → GREEN, then by daysToExpiry ascending
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { slaRenewalsRoutes } from '../../src/routes/slaRenewals.js';
import { getDb, upsertRenewalState } from '../../src/db/index.js';

const JWT_SECRET = 'test-sla-renewals-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(slaRenewalsRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface SeedCtx {
  firmId: string;
  userId: string;
  token: string;
}

async function seedFirm(): Promise<SeedCtx> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Renewals Firm', `renewals-${createId()}`, 'STARTER', now],
  });
  const hash = await bcrypt.hash('x', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'AM', hash, 'APP_ADMIN', now],
  });
  // Grant ACCOUNT_MANAGER firm-level role for BILLING:READ.
  await db.execute({
    sql: `INSERT INTO FirmRole (id, firmId, userId, role, createdAt) VALUES (?,?,?,?,?)`,
    args: [createId(), firmId, userId, 'APP_ADMIN', now],
  });
  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'APP_ADMIN',
    name: 'AM',
    email: `${userId}@example.com`,
  });
  return { firmId, userId, token };
}

async function seedEngagement(
  firmId: string,
  args: { clientName: string; status: string },
): Promise<string> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [id, firmId, args.clientName, args.status, now, now],
  });
  return id;
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.execute('DELETE FROM EngagementRenewalState');
  await db.execute('DELETE FROM Engagement');
});

describe('GET /api/v1/sla/renewals', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sla/renewals' });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty array when no SLA_ACTIVE engagements exist', async () => {
    const { token } = await seedFirm();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/renewals',
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
  });

  it('only returns engagements in SLA_ACTIVE status', async () => {
    const { firmId, token } = await seedFirm();
    await seedEngagement(firmId, { clientName: 'In Discovery', status: 'DISCOVERY' });
    await seedEngagement(firmId, { clientName: 'Active', status: 'SLA_ACTIVE' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/renewals',
      cookies: { token },
    });
    const body = res.json() as { data: Array<{ clientName: string }> };
    expect(body.data.map((r) => r.clientName)).toEqual(['Active']);
  });

  it('returns a default NOT_STARTED row when no renewal state exists', async () => {
    const { firmId, token } = await seedFirm();
    await seedEngagement(firmId, { clientName: 'NoState', status: 'SLA_ACTIVE' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/renewals',
      cookies: { token },
    });
    const body = res.json() as {
      data: Array<{ renewalStatus: string; urgency: string; daysToExpiry: number | null }>;
    };
    expect(body.data[0].renewalStatus).toBe('NOT_STARTED');
    expect(body.data[0].urgency).toBe('GREEN');
    expect(body.data[0].daysToExpiry).toBeNull();
  });

  it('computes RED urgency for engagements expiring inside 30 days', async () => {
    const { firmId, token } = await seedFirm();
    const engId = await seedEngagement(firmId, { clientName: 'NearExpiry', status: 'SLA_ACTIVE' });
    const in15Days = new Date(Date.now() + 15 * 86_400_000).toISOString();
    await upsertRenewalState({
      engagementId: engId,
      contractEndAt: in15Days,
      renewalStatus: 'DISCUSSING',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/renewals',
      cookies: { token },
    });
    const body = res.json() as {
      data: Array<{ urgency: string; daysToExpiry: number; expired: boolean }>;
    };
    expect(body.data[0].urgency).toBe('RED');
    expect(body.data[0].daysToExpiry).toBeGreaterThanOrEqual(14);
    expect(body.data[0].daysToExpiry).toBeLessThanOrEqual(15);
    expect(body.data[0].expired).toBe(false);
  });

  it('sorts RED → AMBER → GREEN, then by daysToExpiry asc', async () => {
    const { firmId, token } = await seedFirm();
    const e1 = await seedEngagement(firmId, { clientName: 'AMBER45', status: 'SLA_ACTIVE' });
    const e2 = await seedEngagement(firmId, { clientName: 'RED10', status: 'SLA_ACTIVE' });
    const e3 = await seedEngagement(firmId, { clientName: 'GREEN200', status: 'SLA_ACTIVE' });
    const e4 = await seedEngagement(firmId, { clientName: 'RED25', status: 'SLA_ACTIVE' });

    await upsertRenewalState({
      engagementId: e1,
      contractEndAt: new Date(Date.now() + 45 * 86_400_000).toISOString(),
      renewalStatus: 'DISCUSSING',
    });
    await upsertRenewalState({
      engagementId: e2,
      contractEndAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      renewalStatus: 'DISCUSSING',
    });
    await upsertRenewalState({
      engagementId: e3,
      contractEndAt: new Date(Date.now() + 200 * 86_400_000).toISOString(),
      renewalStatus: 'DISCUSSING',
    });
    await upsertRenewalState({
      engagementId: e4,
      contractEndAt: new Date(Date.now() + 25 * 86_400_000).toISOString(),
      renewalStatus: 'DISCUSSING',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/renewals',
      cookies: { token },
    });
    const body = res.json() as { data: Array<{ clientName: string; urgency: string }> };
    // Two RED rows first (10d before 25d), then AMBER, then GREEN.
    expect(body.data.map((r) => r.clientName)).toEqual([
      'RED10',
      'RED25',
      'AMBER45',
      'GREEN200',
    ]);
  });
});
