/**
 * Phase 45.6 — Ticket DB layer.
 *
 * CRUD on Ticket, TicketMessage, and TicketStatusChange. Pure SQL with
 * libSQL — no business rules here (those live in services/ticketSla.ts).
 *
 * Status transitions are written through `updateTicketStatus` which
 * also logs a TicketStatusChange row. firstResolvedAt is stamped the
 * first time status flips to RESOLVED (preserved on re-open). closedAt
 * is stamped on the CLOSED transition.
 */
import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';
import type { TicketSeverity, TicketStatus } from '../services/ticketSla.js';

export interface Ticket {
  id: string;
  engagementId: string;
  firmId: string;
  title: string;
  description: string | null;
  severity: TicketSeverity;
  status: TicketStatus;
  openedByUserId: string | null;
  openedByMemberId: string | null;
  assigneeUserId: string | null;
  firstResolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  senderType: 'CLIENT' | 'SUPPORT';
  senderUserId: string | null;
  senderMemberId: string | null;
  body: string;
  createdAt: string;
}

export interface TicketStatusChange {
  id: string;
  ticketId: string;
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
  byUserId: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;

function toTicket(row: Row): Ticket {
  return {
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
}

function toTicketMessage(row: Row): TicketMessage {
  return {
    id: row.id as string,
    ticketId: row.ticketId as string,
    senderType: row.senderType as 'CLIENT' | 'SUPPORT',
    senderUserId: (row.senderUserId as string | null) ?? null,
    senderMemberId: (row.senderMemberId as string | null) ?? null,
    body: row.body as string,
    createdAt: row.createdAt as string,
  };
}

export async function createTicket(input: {
  engagementId: string;
  firmId: string;
  title: string;
  description?: string | null;
  severity: TicketSeverity;
  openedByUserId?: string | null;
  openedByMemberId?: string | null;
}): Promise<Ticket> {
  const db = getDb();
  const id = createId();
  // Pass ISO timestamps explicitly so the row's createdAt parses
  // correctly via `new Date(row.createdAt)` regardless of the host
  // timezone. SQLite's `datetime('now')` default returns a TZ-less
  // 'YYYY-MM-DD HH:MM:SS' string that JS interprets as local time —
  // for SLA breach math we need real UTC.
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Ticket (id, engagementId, firmId, title, description, severity, openedByUserId, openedByMemberId, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.engagementId,
      input.firmId,
      input.title,
      input.description ?? null,
      input.severity,
      input.openedByUserId ?? null,
      input.openedByMemberId ?? null,
      now,
      now,
    ],
  });
  const r = await db.execute({ sql: `SELECT * FROM Ticket WHERE id = ?`, args: [id] });
  return toTicket(r.rows[0] as Row);
}

export async function findTicketById(id: string): Promise<Ticket | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM Ticket WHERE id = ?`, args: [id] });
  return r.rows[0] ? toTicket(r.rows[0] as Row) : null;
}

export async function listTicketsByEngagement(
  engagementId: string,
  opts?: { status?: TicketStatus | 'ALL' },
): Promise<Ticket[]> {
  const db = getDb();
  if (!opts?.status || opts.status === 'ALL') {
    const r = await db.execute({
      sql: `SELECT * FROM Ticket WHERE engagementId = ? ORDER BY createdAt DESC`,
      args: [engagementId],
    });
    return (r.rows as Row[]).map(toTicket);
  }
  const r = await db.execute({
    sql: `SELECT * FROM Ticket WHERE engagementId = ? AND status = ? ORDER BY createdAt DESC`,
    args: [engagementId, opts.status],
  });
  return (r.rows as Row[]).map(toTicket);
}

/**
 * Firm-wide ticket queue — used by the future SLA dashboard "open
 * tickets" widget. Filters out CLOSED so the queue stays focused on
 * active workload.
 */
export async function listOpenTicketsByFirm(firmId: string): Promise<Ticket[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM Ticket WHERE firmId = ? AND status != 'CLOSED' ORDER BY createdAt DESC`,
    args: [firmId],
  });
  return (r.rows as Row[]).map(toTicket);
}

export async function addTicketMessage(input: {
  ticketId: string;
  senderType: 'CLIENT' | 'SUPPORT';
  senderUserId?: string | null;
  senderMemberId?: string | null;
  body: string;
}): Promise<TicketMessage> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO TicketMessage (id, ticketId, senderType, senderUserId, senderMemberId, body, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [
      id,
      input.ticketId,
      input.senderType,
      input.senderUserId ?? null,
      input.senderMemberId ?? null,
      input.body,
      now,
    ],
  });
  // Bump the ticket's updatedAt so the queue list reflects activity.
  await db.execute({
    sql: `UPDATE Ticket SET updatedAt = ? WHERE id = ?`,
    args: [new Date().toISOString(), input.ticketId],
  });
  const r = await db.execute({ sql: `SELECT * FROM TicketMessage WHERE id = ?`, args: [id] });
  return toTicketMessage(r.rows[0] as Row);
}

export async function listTicketMessages(ticketId: string): Promise<TicketMessage[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM TicketMessage WHERE ticketId = ? ORDER BY createdAt ASC`,
    args: [ticketId],
  });
  return (r.rows as Row[]).map(toTicketMessage);
}

/**
 * Find the timestamp of the first SUPPORT-side message on this ticket.
 * Used by the SLA breach computation — first-response clock stops on
 * the first SUPPORT reply.
 */
export async function findFirstSupportReplyAt(ticketId: string): Promise<string | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT createdAt FROM TicketMessage
          WHERE ticketId = ? AND senderType = 'SUPPORT'
          ORDER BY createdAt ASC LIMIT 1`,
    args: [ticketId],
  });
  return r.rows[0] ? ((r.rows[0] as Row).createdAt as string) : null;
}

export async function updateTicketStatus(input: {
  ticketId: string;
  toStatus: TicketStatus;
  byUserId: string | null;
}): Promise<Ticket | null> {
  const db = getDb();
  const current = await findTicketById(input.ticketId);
  if (!current) return null;
  if (current.status === input.toStatus) return current;

  const now = new Date().toISOString();
  // Stamp firstResolvedAt only on the first transition into RESOLVED.
  // closedAt always reflects the most recent CLOSED transition (re-open
  // clears it via the OPEN branch below).
  const sets: string[] = ['status = ?', 'updatedAt = ?'];
  const args: (string | null)[] = [input.toStatus, now];
  if (input.toStatus === 'RESOLVED' && !current.firstResolvedAt) {
    sets.push('firstResolvedAt = ?');
    args.push(now);
  }
  if (input.toStatus === 'CLOSED') {
    sets.push('closedAt = ?');
    args.push(now);
  }
  if (input.toStatus === 'OPEN' && current.status === 'CLOSED') {
    // Re-open: clear closedAt so the queue picks it up again.
    sets.push('closedAt = ?');
    args.push(null);
  }
  args.push(input.ticketId);
  await db.execute({
    sql: `UPDATE Ticket SET ${sets.join(', ')} WHERE id = ?`,
    args,
  });

  await db.execute({
    sql: `INSERT INTO TicketStatusChange (id, ticketId, fromStatus, toStatus, byUserId, createdAt)
          VALUES (?,?,?,?,?,?)`,
    args: [
      createId(),
      input.ticketId,
      current.status,
      input.toStatus,
      input.byUserId,
      new Date().toISOString(),
    ],
  });

  const r = await db.execute({ sql: `SELECT * FROM Ticket WHERE id = ?`, args: [input.ticketId] });
  return toTicket(r.rows[0] as Row);
}

export async function assignTicket(input: {
  ticketId: string;
  assigneeUserId: string | null;
}): Promise<Ticket | null> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE Ticket SET assigneeUserId = ?, updatedAt = ? WHERE id = ?`,
    args: [input.assigneeUserId, new Date().toISOString(), input.ticketId],
  });
  return findTicketById(input.ticketId);
}
