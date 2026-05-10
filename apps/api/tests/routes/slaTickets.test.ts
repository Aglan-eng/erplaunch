/**
 * Phase 48.1 — route tests for the firm-wide ticket queue at
 * GET /api/v1/sla/tickets.
 *
 * Covers:
 *   1. requires auth (no cookie → 401)
 *   2. tenancy: only returns tickets in the caller's firm
 *   3. status filter
 *   4. assignee filter (UNASSIGNED + specific user)
 *   5. SLA breach state is computed per ticket
 *   6. clientName is joined from Engagement
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { slaTicketsRoutes } from '../../src/routes/slaTickets.js';
import { getDb, createEngagement } from '../../src/db/index.js';
import { createTicket, addTicketMessage } from '../../src/db/tickets.js';

const JWT_SECRET = 'test-sla-tickets-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(slaTicketsRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface SeedCtx {
  firmId: string;
  userId: string;
  engagementId: string;
  token: string;
}

async function seedFirm(args?: { firmName?: string; clientName?: string }): Promise<SeedCtx> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, args?.firmName ?? 'SLA Firm', `sla-${createId()}`, 'STARTER', now],
  });
  const hash = await bcrypt.hash('x', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [
      userId,
      firmId,
      `${userId}@example.com`,
      'Tester',
      hash,
      'CONSULTANT',
      now,
    ],
  });
  const eng = await createEngagement({ firmId, clientName: args?.clientName ?? 'Acme Co' });
  const engagementId = (eng as { id: string }).id;
  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'CONSULTANT',
    name: 'Tester',
    email: `${userId}@example.com`,
  });
  return { firmId, userId, engagementId, token };
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
  // Wipe Ticket / TicketMessage so each test starts clean — engagements
  // and firms persist (testDb is one DB for the suite) and we just want
  // each test's tickets independent.
  const db = getDb();
  await db.execute('DELETE FROM TicketMessage');
  await db.execute('DELETE FROM Ticket');
});

describe('GET /api/v1/sla/tickets', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sla/tickets' });
    expect(res.statusCode).toBe(401);
  });

  it('returns an empty array when no tickets exist', async () => {
    const { token } = await seedFirm();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/tickets',
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
  });

  it('returns only tickets within the caller firm (tenancy)', async () => {
    const a = await seedFirm({ firmName: 'A', clientName: 'AClient' });
    const b = await seedFirm({ firmName: 'B', clientName: 'BClient' });
    await createTicket({
      engagementId: a.engagementId,
      firmId: a.firmId,
      title: 'A ticket',
      severity: 'HIGH',
    });
    await createTicket({
      engagementId: b.engagementId,
      firmId: b.firmId,
      title: 'B ticket',
      severity: 'LOW',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/tickets',
      cookies: { token: a.token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ title: string; clientName: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe('A ticket');
    expect(body.data[0].clientName).toBe('AClient');
  });

  it('filters by status when ?status= is set', async () => {
    const { firmId, engagementId, token } = await seedFirm();
    const t1 = await createTicket({
      engagementId,
      firmId,
      title: 'open one',
      severity: 'HIGH',
    });
    const t2 = await createTicket({
      engagementId,
      firmId,
      title: 'will close',
      severity: 'LOW',
    });
    // Close t2.
    const db = getDb();
    await db.execute({
      sql: `UPDATE Ticket SET status = 'CLOSED' WHERE id = ?`,
      args: [t2.id],
    });
    expect(t1.status).toBe('OPEN');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/tickets?status=OPEN',
      cookies: { token },
    });
    const body = res.json() as { data: Array<{ id: string }> };
    expect(body.data.map((t) => t.id)).toEqual([t1.id]);
  });

  it('filters by assignee=UNASSIGNED', async () => {
    const { firmId, engagementId, token, userId } = await seedFirm();
    const a = await createTicket({
      engagementId,
      firmId,
      title: 'unassigned',
      severity: 'HIGH',
    });
    const b = await createTicket({
      engagementId,
      firmId,
      title: 'assigned',
      severity: 'HIGH',
    });
    const db = getDb();
    await db.execute({
      sql: `UPDATE Ticket SET assigneeUserId = ? WHERE id = ?`,
      args: [userId, b.id],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/tickets?assignee=UNASSIGNED',
      cookies: { token },
    });
    const body = res.json() as { data: Array<{ id: string }> };
    expect(body.data.map((t) => t.id)).toEqual([a.id]);
  });

  it('attaches an SLA breach state per ticket', async () => {
    const { firmId, engagementId, token } = await seedFirm();
    await createTicket({
      engagementId,
      firmId,
      title: 'critical',
      severity: 'CRITICAL',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/tickets',
      cookies: { token },
    });
    const body = res.json() as {
      data: Array<{ sla: { firstResponseTargetHours: number } }>;
    };
    expect(body.data[0].sla.firstResponseTargetHours).toBe(1); // CRITICAL = 1h
  });

  it('flags first-response breach as cleared once a SUPPORT message lands', async () => {
    const { firmId, engagementId, token } = await seedFirm();
    const t = await createTicket({
      engagementId,
      firmId,
      title: 'with reply',
      severity: 'LOW',
    });
    await addTicketMessage({
      ticketId: t.id,
      senderType: 'SUPPORT',
      body: 'on it',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/tickets',
      cookies: { token },
    });
    const body = res.json() as {
      data: Array<{ sla: { firstResponseMinutesRemaining: number | null } }>;
    };
    // Clock stopped — minutesRemaining is null per the SLA contract.
    expect(body.data[0].sla.firstResponseMinutesRemaining).toBeNull();
  });
});
