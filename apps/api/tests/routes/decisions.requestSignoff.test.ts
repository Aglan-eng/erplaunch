import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { decisionRoutes } from '../../src/routes/decisions.js';
import { getDb, createDecision, updateDecisionSignoff, findDecisionById } from '../../src/db/index.js';

const JWT_SECRET = 'test-decisions-request-signoff-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(decisionRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface SeedFixture {
  firmId: string;
  userId: string;
  engagementId: string;
  decisionId: string;
  token: string;
}

async function seed(): Promise<SeedFixture> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const engagementId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Decision Firm', `decision-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Test Consultant', passwordHash, 'CONSULTANT', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Decision Client', 'DISCOVERY', now, now],
  });
  const decision = await createDecision(engagementId, {
    title: 'Use NetSuite OneWorld',
    rationale: 'Multi-entity client',
  });
  const decisionId = (decision as { id: string }).id;
  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'CONSULTANT',
    name: 'Test Consultant',
    email: `${userId}@example.com`,
  });
  return { firmId, userId, engagementId, decisionId, token };
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
  // Clear ActivityLog between tests so we can assert on the count cleanly.
  const db = getDb();
  await db.execute(`DELETE FROM ActivityLog`);
});

describe('POST /api/v1/engagements/:id/decisions/:decisionId/request-signoff', () => {
  it('requires authentication', async () => {
    const { engagementId, decisionId } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/decisions/${decisionId}/request-signoff`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('flips clientSignoffStatus from NONE to PENDING and returns the updated decision', async () => {
    const { engagementId, decisionId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/decisions/${decisionId}/request-signoff`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data.clientSignoffStatus).toBe('PENDING');

    // Persisted in DB
    const fresh = await findDecisionById(decisionId);
    expect((fresh as Record<string, unknown>).clientSignoffStatus).toBe('PENDING');
  });

  it('writes a DECISION_SIGNOFF_REQUESTED activity log entry', async () => {
    const { engagementId, decisionId, token } = await seed();
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/decisions/${decisionId}/request-signoff`,
      cookies: { token },
    });
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT action, details FROM ActivityLog WHERE engagementId = ? ORDER BY createdAt DESC LIMIT 1`,
      args: [engagementId],
    });
    const row = r.rows[0] as unknown as { action: string; details: string } | undefined;
    expect(row?.action).toBe('DECISION_SIGNOFF_REQUESTED');
    expect(row?.details).toContain('Use NetSuite OneWorld');
  });

  it('returns 409 when the decision is already PENDING', async () => {
    const { engagementId, decisionId, token } = await seed();
    // Move to PENDING first.
    await updateDecisionSignoff(decisionId, {
      clientSignoffStatus: 'PENDING',
      clientSignoffAt: null,
      clientSignoffComment: null,
      clientSignoffMemberId: null,
      clientSignoffSourceSubmissionId: null,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/decisions/${decisionId}/request-signoff`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_TRANSITION');
  });

  it('returns 409 when the decision is already SIGNED', async () => {
    const { engagementId, decisionId, token } = await seed();
    await updateDecisionSignoff(decisionId, {
      clientSignoffStatus: 'SIGNED',
      clientSignoffAt: new Date().toISOString(),
      clientSignoffComment: 'Approved',
      clientSignoffMemberId: null,
      clientSignoffSourceSubmissionId: null,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/decisions/${decisionId}/request-signoff`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for a missing engagement', async () => {
    const { decisionId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${createId()}/decisions/${decisionId}/request-signoff`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a missing decision', async () => {
    const { engagementId, token } = await seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/decisions/${createId()}/request-signoff`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the decision belongs to a different engagement', async () => {
    const a = await seed();
    const b = await seed();
    // Try to request sign-off on decision A using engagement B's id.
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${b.engagementId}/decisions/${a.decisionId}/request-signoff`,
      cookies: { token: b.token },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the firm does not own the engagement', async () => {
    const a = await seed();
    const b = await seed();
    // Use firm B's auth token but target firm A's engagement.
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${a.engagementId}/decisions/${a.decisionId}/request-signoff`,
      cookies: { token: b.token },
    });
    expect(res.statusCode).toBe(404);
  });
});
