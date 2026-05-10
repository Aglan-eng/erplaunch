/**
 * Phase 48.1 — Firm-wide ticket queue route.
 *
 *   GET /sla/tickets[?status=OPEN|IN_PROGRESS|...|ALL]
 *
 * Powers the SLA Engineer's tickets page (/sla/tickets). Returns every
 * ticket in the user's firm, joined to engagement clientName, plus the
 * computed SLA breach state per ticket so the page can sort by breach
 * proximity without a second round-trip.
 *
 * RBAC: any user in the firm can READ the queue (the page itself
 * filters per-role what's actionable — Engineer sees only own assigned,
 * Lead sees all). Per-ticket WRITE goes through the existing engagement-
 * scoped routes in routes/tickets.ts.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import {
  computeTicketSla,
  isTicketStatus,
  type TicketSeverity,
  type TicketStatus,
} from '../services/ticketSla.js';
import {
  findFirstSupportReplyAt,
  type Ticket,
} from '../db/tickets.js';

interface FirmTicketRow extends Ticket {
  clientName: string;
  sla: {
    firstResponseTargetHours: number;
    resolutionTargetHours: number;
    firstResponseBreached: boolean;
    resolutionBreached: boolean;
    firstResponseMinutesRemaining: number | null;
    resolutionMinutesRemaining: number | null;
  };
}

export async function slaTicketsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/sla/tickets', async (request, reply) => {
    const firmId = request.jwtUser.firmId;
    const q = request.query as { status?: string; assignee?: string };

    const statusFilter =
      q.status && (q.status === 'ALL' || isTicketStatus(q.status))
        ? (q.status as TicketStatus | 'ALL')
        : undefined;

    const dbClient = getDb();
    // Join Ticket → Engagement so the queue page can render the client
    // name without a second per-row fetch.
    const baseSql =
      `SELECT t.*, e.clientName AS clientName
       FROM Ticket t
       JOIN Engagement e ON e.id = t.engagementId
       WHERE t.firmId = ?`;
    const orderSql = ` ORDER BY t.createdAt DESC`;
    let sql = baseSql;
    const args: Array<string | number> = [firmId];
    if (statusFilter && statusFilter !== 'ALL') {
      sql += ` AND t.status = ?`;
      args.push(statusFilter);
    }
    if (q.assignee && q.assignee !== 'ALL') {
      if (q.assignee === 'UNASSIGNED') {
        sql += ` AND t.assigneeUserId IS NULL`;
      } else {
        sql += ` AND t.assigneeUserId = ?`;
        args.push(q.assignee);
      }
    }
    sql += orderSql;

    const r = await dbClient.execute({ sql, args });
    const rows = r.rows as Array<Record<string, unknown>>;

    const entries: FirmTicketRow[] = [];
    for (const row of rows) {
      const ticket: Ticket = {
        id: row.id as string,
        engagementId: row.engagementId as string,
        firmId: row.firmId as string,
        title: row.title as string,
        description: (row.description as string | null) ?? null,
        severity: row.severity as TicketSeverity,
        status: row.status as TicketStatus,
        openedByUserId: (row.openedByUserId as string | null) ?? null,
        openedByMemberId: (row.openedByMemberId as string | null) ?? null,
        assigneeUserId: (row.assigneeUserId as string | null) ?? null,
        firstResolvedAt: (row.firstResolvedAt as string | null) ?? null,
        closedAt: (row.closedAt as string | null) ?? null,
        createdAt: row.createdAt as string,
        updatedAt: row.updatedAt as string,
      };
      const firstSupportReplyAt = await findFirstSupportReplyAt(ticket.id);
      const sla = computeTicketSla({
        severity: ticket.severity,
        status: ticket.status,
        createdAt: ticket.createdAt,
        firstSupportReplyAt,
        firstResolvedAt: ticket.firstResolvedAt,
      });
      entries.push({
        ...ticket,
        clientName: row.clientName as string,
        sla,
      });
    }

    return reply.send({ data: entries });
  });
}
