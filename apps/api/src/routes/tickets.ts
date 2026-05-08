/**
 * Phase 45.6 — Ticket queue routes (consultant side).
 *
 *   GET    /engagements/:id/tickets               — list, optional ?status=
 *   POST   /engagements/:id/tickets               — open a new ticket
 *   GET    /engagements/:id/tickets/:tid          — detail + messages + sla state
 *   POST   /engagements/:id/tickets/:tid/messages — append a SUPPORT message
 *   PATCH  /engagements/:id/tickets/:tid          — status / assignee
 *
 * Gated on the matrix's ISSUES resource — the same permission used for
 * the per-engagement Issues board (which tickets are SLA-stage's
 * version of). SUPPORT_LEAD + SUPPORT_ENGINEER both have WRITE in
 * SLA_ACTIVE; APP_ADMIN bypasses; PROJECT_MANAGER + PROJECT_LEAD have
 * WRITE during implementation stages so they can pre-populate
 * known issues before handover.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';
import {
  computeTicketSla,
  isTicketSeverity,
  isTicketStatus,
  canTransition,
  type TicketSeverity,
  type TicketStatus,
} from '../services/ticketSla.js';

export async function ticketRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements/:id/tickets — list (optionally filter by status)
  fastify.get(
    '/engagements/:id/tickets',
    { preHandler: requirePermission('READ', 'ISSUES') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const q = request.query as { status?: string };
      const filter =
        q.status && (q.status === 'ALL' || isTicketStatus(q.status))
          ? (q.status as TicketStatus | 'ALL')
          : undefined;
      const tickets = await db.listTicketsByEngagement(id, filter ? { status: filter } : undefined);
      return reply.send({ data: tickets });
    },
  );

  // POST /engagements/:id/tickets — open a new ticket
  fastify.post(
    '/engagements/:id/tickets',
    { preHandler: requirePermission('WRITE', 'ISSUES') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

      const body = (request.body ?? {}) as {
        title?: unknown;
        description?: unknown;
        severity?: unknown;
      };
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'title is required' },
        });
      }
      if (typeof body.severity !== 'string' || !isTicketSeverity(body.severity)) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'severity must be CRITICAL, HIGH, MEDIUM, or LOW' },
        });
      }
      const description =
        typeof body.description === 'string' ? body.description : null;

      const ticket = await db.createTicket({
        engagementId: id,
        firmId: request.jwtUser.firmId,
        title: body.title.trim(),
        description,
        severity: body.severity as TicketSeverity,
        openedByUserId: request.jwtUser.userId,
      });
      await db.logActivity(
        id,
        request.jwtUser.firmId,
        'TICKET_OPENED',
        `[${ticket.severity}] ${ticket.title}`,
      );
      return reply.code(201).send({ data: ticket });
    },
  );

  // GET /engagements/:id/tickets/:tid — detail bundle
  fastify.get(
    '/engagements/:id/tickets/:tid',
    { preHandler: requirePermission('READ', 'ISSUES') },
    async (request, reply) => {
      const { id, tid } = request.params as { id: string; tid: string };
      const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

      const ticket = await db.findTicketById(tid);
      if (!ticket || ticket.engagementId !== id) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      const messages = await db.listTicketMessages(tid);
      const firstSupportReplyAt = await db.findFirstSupportReplyAt(tid);
      const sla = computeTicketSla({
        severity: ticket.severity,
        status: ticket.status,
        createdAt: ticket.createdAt,
        firstSupportReplyAt,
        firstResolvedAt: ticket.firstResolvedAt,
      });
      return reply.send({
        data: { ticket, messages, sla, firstSupportReplyAt },
      });
    },
  );

  // POST /engagements/:id/tickets/:tid/messages — SUPPORT message
  fastify.post(
    '/engagements/:id/tickets/:tid/messages',
    { preHandler: requirePermission('WRITE', 'ISSUES') },
    async (request, reply) => {
      const { id, tid } = request.params as { id: string; tid: string };
      const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const ticket = await db.findTicketById(tid);
      if (!ticket || ticket.engagementId !== id) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      const body = (request.body ?? {}) as { body?: unknown };
      if (typeof body.body !== 'string' || body.body.trim().length === 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'body is required' },
        });
      }
      const message = await db.addTicketMessage({
        ticketId: tid,
        senderType: 'SUPPORT',
        senderUserId: request.jwtUser.userId,
        body: body.body.trim(),
      });
      return reply.code(201).send({ data: message });
    },
  );

  // PATCH /engagements/:id/tickets/:tid — status / assignee
  fastify.patch(
    '/engagements/:id/tickets/:tid',
    { preHandler: requirePermission('WRITE', 'ISSUES') },
    async (request, reply) => {
      const { id, tid } = request.params as { id: string; tid: string };
      const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const ticket = await db.findTicketById(tid);
      if (!ticket || ticket.engagementId !== id) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      const body = (request.body ?? {}) as {
        status?: unknown;
        assigneeUserId?: unknown;
      };

      let updated = ticket;
      if (body.status !== undefined) {
        if (typeof body.status !== 'string' || !isTicketStatus(body.status)) {
          return reply.code(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'invalid status value' },
          });
        }
        if (!canTransition(ticket.status, body.status)) {
          return reply.code(409).send({
            error: {
              code: 'INVALID_TRANSITION',
              message: `Cannot move ticket from ${ticket.status} to ${body.status}.`,
            },
          });
        }
        const next = await db.updateTicketStatus({
          ticketId: tid,
          toStatus: body.status,
          byUserId: request.jwtUser.userId,
        });
        if (next) updated = next;
      }
      if (body.assigneeUserId !== undefined) {
        const next = await db.assignTicket({
          ticketId: tid,
          assigneeUserId:
            body.assigneeUserId === null ? null : String(body.assigneeUserId),
        });
        if (next) updated = next;
      }
      return reply.send({ data: updated });
    },
  );
}
