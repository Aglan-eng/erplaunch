/**
 * Phase 45.6 — integration tests for the ticket queue routes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { ticketRoutes } from '../../src/routes/tickets.js';
import {
  getDb,
  bootstrapFirmAdmin,
  grantFirmRole,
} from '../../src/db/index.js';

const JWT_SECRET = 'tickets-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-tickets-test',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(ticketRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  engagementId: string;
  adminUserId: string;
  supportUserId: string;
  adminToken: string;
  supportToken: string;
}

async function seed(stage = 'SLA_ACTIVE'): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const adminUserId = createId();
  const supportUserId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Tickets Firm', `tickets-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Apex Co', stage, now, now],
  });
  const passwordHash = await bcrypt.hash('x', 4);
  for (const id of [adminUserId, supportUserId]) {
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
      args: [id, firmId, `${id}@example.com`, id, passwordHash, 'CONSULTANT'],
    });
  }
  await bootstrapFirmAdmin({ firmId, userId: adminUserId });
  await grantFirmRole({
    firmId,
    userId: supportUserId,
    role: 'SUPPORT_LEAD',
    actorUserId: adminUserId,
  });
  const sign = (id: string) =>
    app.jwt.sign({ userId: id, firmId, role: 'CONSULTANT', name: id, email: `${id}@example.com` });
  return {
    firmId,
    engagementId,
    adminUserId,
    supportUserId,
    adminToken: sign(adminUserId),
    supportToken: sign(supportUserId),
  };
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
  await db.execute(`DELETE FROM TicketStatusChange`);
  await db.execute(`DELETE FROM TicketMessage`);
  await db.execute(`DELETE FROM Ticket`);
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM RoleAuditLog`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM FirmRole`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── POST /tickets ───────────────────────────────────────────────────────────

describe('POST /engagements/:id/tickets', () => {
  it('opens a ticket and writes a TICKET_OPENED activity entry', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: 'Cannot post invoice', severity: 'HIGH', description: 'Got an error.' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { data: { id: string; status: string; severity: string } };
    expect(body.data.status).toBe('OPEN');
    expect(body.data.severity).toBe('HIGH');
    const log = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    expect(log.rows).toHaveLength(1);
    expect((log.rows[0] as unknown as { action: string }).action).toBe('TICKET_OPENED');
  });

  it('rejects an invalid severity', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: 'X', severity: 'NUCLEAR' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects an empty title', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: '   ', severity: 'LOW' },
    });
    expect(r.statusCode).toBe(400);
  });
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /engagements/:id/tickets', () => {
  it('lists tickets newest-first', async () => {
    const f = await seed();
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: 'first', severity: 'LOW' },
    });
    await new Promise((r) => setTimeout(r, 10));
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: 'second', severity: 'HIGH' },
    });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const body = r.json() as { data: Array<{ title: string }> };
    expect(body.data[0].title).toBe('second');
    expect(body.data[1].title).toBe('first');
  });

  it('filters by ?status=', async () => {
    const f = await seed();
    const open = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: 'open one', severity: 'LOW' },
    });
    const tid = (open.json() as { data: { id: string } }).data.id;
    // Move to RESOLVED
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${tid}`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'RESOLVED' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: 'still open', severity: 'LOW' },
    });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/tickets?status=OPEN`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const body = r.json() as { data: Array<{ title: string; status: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].status).toBe('OPEN');
  });
});

// ─── Detail bundle ───────────────────────────────────────────────────────────

describe('GET /engagements/:id/tickets/:tid', () => {
  it('returns ticket + messages + sla state', async () => {
    const f = await seed();
    const open = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: 'Detail check', severity: 'CRITICAL' },
    });
    const tid = (open.json() as { data: { id: string } }).data.id;
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${tid}`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const body = r.json() as {
      data: {
        ticket: { id: string };
        messages: unknown[];
        sla: { firstResponseTargetHours: number; firstResponseBreached: boolean };
      };
    };
    expect(body.data.ticket.id).toBe(tid);
    expect(body.data.messages).toEqual([]);
    expect(body.data.sla.firstResponseTargetHours).toBe(1); // CRITICAL
    expect(body.data.sla.firstResponseBreached).toBe(false);
  });
});

// ─── Messages ───────────────────────────────────────────────────────────────

describe('POST /engagements/:id/tickets/:tid/messages', () => {
  it('appends a SUPPORT message and stops the first-response clock', async () => {
    const f = await seed();
    const open = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: 'Message check', severity: 'MEDIUM' },
    });
    const tid = (open.json() as { data: { id: string } }).data.id;
    const post = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${tid}/messages`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { body: 'Looking into this now.' },
    });
    expect(post.statusCode).toBe(201);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${tid}`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const body = detail.json() as {
      data: {
        messages: Array<{ senderType: string; body: string }>;
        firstSupportReplyAt: string | null;
      };
    };
    expect(body.data.messages).toHaveLength(1);
    expect(body.data.messages[0].senderType).toBe('SUPPORT');
    expect(body.data.firstSupportReplyAt).toBeTruthy();
  });
});

// ─── PATCH (status / assignee) ──────────────────────────────────────────────

describe('PATCH /engagements/:id/tickets/:tid', () => {
  it('moves OPEN → IN_PROGRESS and writes a TicketStatusChange row', async () => {
    const f = await seed();
    const open = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: 'Transition', severity: 'HIGH' },
    });
    const tid = (open.json() as { data: { id: string } }).data.id;
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${tid}`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'IN_PROGRESS' },
    });
    expect(r.statusCode).toBe(200);
    const changes = await getDb().execute({
      sql: `SELECT fromStatus, toStatus FROM TicketStatusChange WHERE ticketId = ? ORDER BY createdAt ASC`,
      args: [tid],
    });
    expect(changes.rows).toHaveLength(1);
    expect((changes.rows[0] as unknown as { fromStatus: string; toStatus: string }))
      .toEqual({ fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' });
  });

  it('stamps firstResolvedAt on the first RESOLVED transition', async () => {
    const f = await seed();
    const open = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: 'Resolves', severity: 'LOW' },
    });
    const tid = (open.json() as { data: { id: string } }).data.id;
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${tid}`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'RESOLVED' },
    });
    const body = r.json() as { data: { firstResolvedAt: string | null; status: string } };
    expect(body.data.status).toBe('RESOLVED');
    expect(body.data.firstResolvedAt).toBeTruthy();
  });

  it('refuses an illegal transition with 409', async () => {
    const f = await seed();
    const open = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: 'Illegal', severity: 'LOW' },
    });
    const tid = (open.json() as { data: { id: string } }).data.id;
    // Move OPEN → CLOSED → try CLOSED → RESOLVED (not allowed; only OPEN re-open)
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${tid}`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'CLOSED' },
    });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${tid}`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { status: 'RESOLVED' },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('INVALID_TRANSITION');
  });

  it('assigns a ticket to a support user', async () => {
    const f = await seed();
    const open = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { title: 'Assign me', severity: 'LOW' },
    });
    const tid = (open.json() as { data: { id: string } }).data.id;
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${tid}`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { assigneeUserId: f.supportUserId },
    });
    const body = r.json() as { data: { assigneeUserId: string } };
    expect(body.data.assigneeUserId).toBe(f.supportUserId);
  });
});
