import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export interface PortalSession {
  id: string;
  engagementId: string;
  memberId: string;
  jtiHash: string;
  issuedAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  userAgent: string | null;
  ipHash: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;

function toSession(row: Row): PortalSession {
  return {
    id: row.id as string,
    engagementId: row.engagementId as string,
    memberId: row.memberId as string,
    jtiHash: row.jtiHash as string,
    issuedAt: row.issuedAt as string,
    lastUsedAt: row.lastUsedAt as string,
    expiresAt: row.expiresAt as string,
    revokedAt: (row.revokedAt as string | null) ?? null,
    userAgent: (row.userAgent as string | null) ?? null,
    ipHash: (row.ipHash as string | null) ?? null,
    createdAt: row.createdAt as string,
  };
}

export async function createPortalSession(input: {
  engagementId: string;
  memberId: string;
  jtiHash: string;
  expiresAt: string;
  userAgent?: string | null;
  ipHash?: string | null;
}): Promise<PortalSession> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO PortalSession
          (id, engagementId, memberId, jtiHash, issuedAt, lastUsedAt, expiresAt, userAgent, ipHash, createdAt)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.engagementId,
      input.memberId,
      input.jtiHash,
      now,
      now,
      input.expiresAt,
      input.userAgent ?? null,
      input.ipHash ?? null,
      now,
    ],
  });

  const r = await db.execute({ sql: `SELECT * FROM PortalSession WHERE id = ?`, args: [id] });
  return toSession(r.rows[0] as Row);
}

export async function findPortalSessionByJtiHash(jtiHash: string): Promise<PortalSession | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM PortalSession WHERE jtiHash = ?`, args: [jtiHash] });
  if (!r.rows[0]) return null;
  return toSession(r.rows[0] as Row);
}

export async function touchPortalSession(sessionId: string, newExpiresAt: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE PortalSession SET expiresAt = ?, lastUsedAt = ? WHERE id = ?`,
    args: [newExpiresAt, now, sessionId],
  });
}

export async function revokePortalSession(sessionId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE PortalSession SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL`,
    args: [now, sessionId],
  });
}

export async function revokeAllSessionsForMember(memberId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE PortalSession SET revokedAt = ? WHERE memberId = ? AND revokedAt IS NULL`,
    args: [now, memberId],
  });
}

export async function purgeExpiredPortalSessions(graceSeconds = 7 * 86400): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - graceSeconds * 1000).toISOString();
  const r = await db.execute({
    sql: `DELETE FROM PortalSession WHERE expiresAt < ?`,
    args: [cutoff],
  });
  return Number((r as { rowsAffected?: number | bigint }).rowsAffected ?? 0);
}
