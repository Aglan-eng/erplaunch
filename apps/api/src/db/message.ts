/**
 * Message — DB layer (Phase 31).
 *
 * One row per message inside a ConversationThread. §5.1 asymmetry:
 *   - CLIENT messages: senderType='CLIENT', senderMemberId set,
 *     senderUserId NULL, acknowledgedAt set on consultant accept
 *     (the QA_MESSAGE acceptor stamps it).
 *   - CONSULTANT messages: senderType='CONSULTANT', senderUserId set,
 *     senderMemberId NULL, acknowledgedAt = createdAt (auto — no
 *     review gate; consultant is source of truth).
 *
 * sourceSubmissionId is set ONLY on CLIENT messages (links back to the
 * PendingSubmission row that landed this message). Used by the
 * QA_MESSAGE acceptor's idempotent re-accept guard.
 */

import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export type MessageSenderType = 'CLIENT' | 'CONSULTANT';

export interface Message {
  id: string;
  threadId: string;
  senderType: MessageSenderType;
  senderMemberId: string | null;
  senderUserId: string | null;
  body: string;
  acknowledgedAt: string | null;
  sourceSubmissionId: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;

function toMessage(row: Row): Message {
  return {
    id: row.id as string,
    threadId: row.threadId as string,
    senderType: row.senderType as MessageSenderType,
    senderMemberId: (row.senderMemberId as string | null) ?? null,
    senderUserId: (row.senderUserId as string | null) ?? null,
    body: row.body as string,
    acknowledgedAt: (row.acknowledgedAt as string | null) ?? null,
    sourceSubmissionId: (row.sourceSubmissionId as string | null) ?? null,
    createdAt: row.createdAt as string,
  };
}

export async function createMessage(input: {
  threadId: string;
  senderType: MessageSenderType;
  senderMemberId?: string | null;
  senderUserId?: string | null;
  body: string;
  acknowledgedAt?: string | null;
  sourceSubmissionId?: string | null;
}): Promise<Message> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  // CONSULTANT messages auto-acknowledge at insert time per §5.1; CLIENT
  // messages stay null until the QA_MESSAGE acceptor stamps them.
  const ack =
    input.acknowledgedAt !== undefined
      ? input.acknowledgedAt
      : input.senderType === 'CONSULTANT'
      ? now
      : null;

  await db.execute({
    sql: `INSERT INTO Message
            (id, threadId, senderType, senderMemberId, senderUserId, body,
             acknowledgedAt, sourceSubmissionId, createdAt)
            VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.threadId,
      input.senderType,
      input.senderMemberId ?? null,
      input.senderUserId ?? null,
      input.body,
      ack,
      input.sourceSubmissionId ?? null,
      now,
    ],
  });
  const r = await db.execute({ sql: `SELECT * FROM Message WHERE id = ?`, args: [id] });
  return toMessage(r.rows[0] as Row);
}

export async function listMessagesByThread(threadId: string): Promise<Message[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM Message WHERE threadId = ? ORDER BY createdAt ASC`,
    args: [threadId],
  });
  return (r.rows as Row[]).map(toMessage);
}

export async function findMessageBySourceSubmissionId(
  submissionId: string,
): Promise<Message | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM Message WHERE sourceSubmissionId = ? LIMIT 1`,
    args: [submissionId],
  });
  return r.rows[0] ? toMessage(r.rows[0] as Row) : null;
}
