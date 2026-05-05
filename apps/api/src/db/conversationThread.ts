/**
 * ConversationThread — DB layer (Phase 31).
 *
 * One thread per topic between client members and consultant users.
 * Created either by:
 *   - A client via QA_MESSAGE submission with threadId=null + subject
 *     (post-accept; the QA_MESSAGE acceptor inserts both thread + first
 *     message)
 *   - A consultant via POST /engagements/:id/threads (immediate; bypasses
 *     pending-review per §5.1)
 *
 * lastMessageAt is touched on every message insert so the thread list
 * orders by most-recent activity.
 */

import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export type ThreadStatus = 'OPEN' | 'RESOLVED';

export interface ConversationThread {
  id: string;
  engagementId: string;
  subject: string;
  status: ThreadStatus;
  createdByMemberId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  lastMessageAt: string;
}

type Row = Record<string, unknown>;

function toThread(row: Row): ConversationThread {
  return {
    id: row.id as string,
    engagementId: row.engagementId as string,
    subject: row.subject as string,
    status: row.status as ThreadStatus,
    createdByMemberId: (row.createdByMemberId as string | null) ?? null,
    createdByUserId: (row.createdByUserId as string | null) ?? null,
    createdAt: row.createdAt as string,
    lastMessageAt: row.lastMessageAt as string,
  };
}

export async function createConversationThread(input: {
  engagementId: string;
  subject: string;
  createdByMemberId?: string | null;
  createdByUserId?: string | null;
}): Promise<ConversationThread> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO ConversationThread
            (id, engagementId, subject, status, createdByMemberId,
             createdByUserId, createdAt, lastMessageAt)
            VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.engagementId,
      input.subject,
      'OPEN',
      input.createdByMemberId ?? null,
      input.createdByUserId ?? null,
      now,
      now,
    ],
  });
  const r = await db.execute({ sql: `SELECT * FROM ConversationThread WHERE id = ?`, args: [id] });
  return toThread(r.rows[0] as Row);
}

export async function findConversationThreadById(id: string): Promise<ConversationThread | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM ConversationThread WHERE id = ?`, args: [id] });
  return r.rows[0] ? toThread(r.rows[0] as Row) : null;
}

export async function listConversationThreadsByEngagement(
  engagementId: string,
): Promise<ConversationThread[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM ConversationThread WHERE engagementId = ? ORDER BY lastMessageAt DESC`,
    args: [engagementId],
  });
  return (r.rows as Row[]).map(toThread);
}

export async function touchConversationThreadLastMessage(threadId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE ConversationThread SET lastMessageAt = ? WHERE id = ?`,
    args: [new Date().toISOString(), threadId],
  });
}

export async function updateConversationThreadStatus(
  threadId: string,
  status: ThreadStatus,
): Promise<ConversationThread | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `UPDATE ConversationThread SET status = ? WHERE id = ?`,
    args: [status, threadId],
  });
  const affected = Number((r as { rowsAffected?: number | bigint }).rowsAffected ?? 0);
  if (affected === 0) return null;
  const fetched = await db.execute({
    sql: `SELECT * FROM ConversationThread WHERE id = ?`,
    args: [threadId],
  });
  return fetched.rows[0] ? toThread(fetched.rows[0] as Row) : null;
}
