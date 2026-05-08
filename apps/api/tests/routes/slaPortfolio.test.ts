/**
 * Phase 45.5 — integration tests for GET /sla/portfolio.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { slaPortfolioRoutes } from '../../src/routes/slaPortfolio.js';
import { getDb, bootstrapFirmAdmin } from '../../src/db/index.js';

const JWT_SECRET = 'sla-portfolio-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-sla-portfolio-test',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(slaPortfolioRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  userId: string;
  token: string;
}

async function seedFirmAndUser(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Portfolio Firm', `portfolio-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('x', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Owner', passwordHash, 'CONSULTANT'],
  });
  await bootstrapFirmAdmin({ firmId, userId });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Owner', email: `${userId}@example.com` });
  return { firmId, userId, token };
}

async function seedEngagement(
  firmId: string,
  status: string,
  clientName: string,
): Promise<string> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [id, firmId, clientName, status, now, now],
  });
  return id;
}

async function seedActivity(
  firmId: string,
  engagementId: string,
  action: string,
  daysAgo: number,
): Promise<void> {
  const db = getDb();
  const ts = new Date(Date.now() - daysAgo * 86400_000).toISOString();
  await db.execute({
    sql: `INSERT INTO ActivityLog (id, engagementId, firmId, action, details, createdAt) VALUES (?,?,?,?,?,?)`,
    args: [createId(), engagementId, firmId, action, '', ts],
  });
}

async function seedIssue(
  engagementId: string,
  priority: string,
  status: string,
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO IssueItem (id, engagementId, title, priority, status) VALUES (?,?,?,?,?)`,
    args: [createId(), engagementId, 'Test issue', priority, status],
  });
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
  await db.execute(`DELETE FROM IssueItem`);
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM RoleAuditLog`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM FirmRole`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

describe('GET /sla/portfolio', () => {
  it('returns an empty array when no engagements are SLA_ACTIVE', async () => {
    const f = await seedFirmAndUser();
    await seedEngagement(f.firmId, 'BUILD', 'Pre-go-live'); // not SLA_ACTIVE
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/portfolio',
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { data: unknown[] }).data).toEqual([]);
  });

  it('lists every SLA_ACTIVE engagement with health metadata', async () => {
    const f = await seedFirmAndUser();
    const e1 = await seedEngagement(f.firmId, 'SLA_ACTIVE', 'Apex Co');
    const e2 = await seedEngagement(f.firmId, 'SLA_ACTIVE', 'Bravo Inc');
    // e1: clean (GREEN)
    await seedActivity(f.firmId, e1, 'HANDOFF_TO_SLA', 30);
    await seedActivity(f.firmId, e1, 'STAGE_ADVANCED', 1);
    // e2: critical issue (RED)
    await seedActivity(f.firmId, e2, 'HANDOFF_TO_SLA', 60);
    await seedActivity(f.firmId, e2, 'STAGE_ADVANCED', 2);
    await seedIssue(e2, 'CRITICAL', 'OPEN');

    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/portfolio',
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<{ engagementId: string; clientName: string; health: string }> };
    expect(body.data).toHaveLength(2);
    // Worst-first sort: RED before GREEN.
    expect(body.data[0].health).toBe('RED');
    expect(body.data[0].clientName).toBe('Bravo Inc');
    expect(body.data[1].health).toBe('GREEN');
    expect(body.data[1].clientName).toBe('Apex Co');
  });

  it('does not leak engagements from other firms', async () => {
    const f = await seedFirmAndUser();
    const otherFirmId = createId();
    const now = new Date().toISOString();
    await getDb().execute({
      sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
      args: [otherFirmId, 'Other', `other-${createId()}`, 'STARTER', now],
    });
    await seedEngagement(otherFirmId, 'SLA_ACTIVE', 'Other Co');
    await seedEngagement(f.firmId, 'SLA_ACTIVE', 'Mine Co');
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/portfolio',
      headers: { authorization: `Bearer ${f.token}` },
    });
    const body = r.json() as { data: Array<{ clientName: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].clientName).toBe('Mine Co');
  });

  it('flags AMBER for engagements with open HIGH issues but no critical', async () => {
    const f = await seedFirmAndUser();
    const e = await seedEngagement(f.firmId, 'SLA_ACTIVE', 'High-issue Co');
    await seedActivity(f.firmId, e, 'HANDOFF_TO_SLA', 30);
    await seedActivity(f.firmId, e, 'STAGE_ADVANCED', 1);
    await seedIssue(e, 'HIGH', 'OPEN');
    await seedIssue(e, 'HIGH', 'OPEN');
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/portfolio',
      headers: { authorization: `Bearer ${f.token}` },
    });
    const body = r.json() as { data: Array<{ health: string; openIssueCounts: { HIGH: number } }> };
    expect(body.data[0].health).toBe('AMBER');
    expect(body.data[0].openIssueCounts.HIGH).toBe(2);
  });

  it('reports null enteredSlaAt when no HANDOFF_TO_SLA activity exists', async () => {
    const f = await seedFirmAndUser();
    const e = await seedEngagement(f.firmId, 'SLA_ACTIVE', 'Legacy Co');
    // Old engagement that pre-dates the lifecycle event flow.
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/portfolio',
      headers: { authorization: `Bearer ${f.token}` },
    });
    const body = r.json() as { data: Array<{ enteredSlaAt: string | null; clientName: string }> };
    expect(body.data[0].clientName).toBe('Legacy Co');
    expect(body.data[0].enteredSlaAt).toBeNull();
    void e;
  });

  it('401s a request without an auth token', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/portfolio',
    });
    expect(r.statusCode).toBe(401);
  });
});
