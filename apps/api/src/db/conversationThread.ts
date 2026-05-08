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
 *   - The system, when an engagement enters CLOSEOUT, to spawn the
 *     cross-team HANDOFF thread between the implementation team and the
 *     SLA team (Phase 45.3 — kind='HANDOFF', pinned=true).
 *
 * lastMessageAt is touched on every message insert so the thread list
 * orders by most-recent activity. Pinned threads always sort first.
 */

import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export type ThreadStatus = 'OPEN' | 'RESOLVED';

/**
 * Phase 45.3 — `kind` lets the UI distinguish ordinary Q&A threads from
 * system-created handoff threads (special icon + "Handoff" label) and
 * lets future kinds (incident, escalation, etc.) be added without
 * needing another schema migration.
 */
export type ThreadKind = 'STANDARD' | 'HANDOFF';

export interface ConversationThread {
  id: string;
  engagementId: string;
  subject: string;
  status: ThreadStatus;
  kind: ThreadKind;
  pinned: boolean;
  createdByMemberId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  lastMessageAt: string;
}

type Row = Record<string, unknown>;

function toThread(row: Row): ConversationThread {
  // `kind` and `pinned` defaulted via ALTER — read with fallbacks so
  // pre-Phase-45.3 rows (if any) still parse cleanly.
  const kindRaw = (row.kind as string | null | undefined) ?? 'STANDARD';
  const pinnedRaw = row.pinned;
  return {
    id: row.id as string,
    engagementId: row.engagementId as string,
    subject: row.subject as string,
    status: row.status as ThreadStatus,
    kind: (kindRaw === 'HANDOFF' ? 'HANDOFF' : 'STANDARD') as ThreadKind,
    pinned: pinnedRaw === 1 || pinnedRaw === true || pinnedRaw === '1',
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
  /** Phase 45.3 — defaults to 'STANDARD' for backwards-compat with the
   *  consultant-side POST /engagements/:id/threads handler and the
   *  QA_MESSAGE acceptor. */
  kind?: ThreadKind;
  /** Phase 45.3 — defaults to false. HANDOFF threads pass true so they
   *  sort to the top of the engagement's Threads UI. */
  pinned?: boolean;
}): Promise<ConversationThread> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  const kind: ThreadKind = input.kind ?? 'STANDARD';
  const pinnedFlag = input.pinned ? 1 : 0;
  await db.execute({
    sql: `INSERT INTO ConversationThread
            (id, engagementId, subject, status, kind, pinned,
             createdByMemberId, createdByUserId, createdAt, lastMessageAt)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.engagementId,
      input.subject,
      'OPEN',
      kind,
      pinnedFlag,
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
  // Phase 45.3 — pinned threads always sort first, then by recency.
  const r = await db.execute({
    sql: `SELECT * FROM ConversationThread
          WHERE engagementId = ?
          ORDER BY pinned DESC, lastMessageAt DESC`,
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
