import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export interface PortalMagicLink {
  id: string;
  engagementId: string;
  memberId: string;
  codeHash: string;
  expiresAt: string;
  attemptCount: number;
  maxAttempts: number;
  consumedAt: string | null;
  ipHash: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;

function toLink(row: Row): PortalMagicLink {
  return {
    id: row.id as string,
    engagementId: row.engagementId as string,
    memberId: row.memberId as string,
    codeHash: row.codeHash as string,
    expiresAt: row.expiresAt as string,
    attemptCount: Number(row.attemptCount),
    maxAttempts: Number(row.maxAttempts),
    consumedAt: (row.consumedAt as string | null) ?? null,
    ipHash: (row.ipHash as string | null) ?? null,
    createdAt: row.createdAt as string,
  };
}

export async function createPortalMagicLink(input: {
  engagementId: string;
  memberId: string;
  codeHash: string;
  expiresAt: string;
  maxAttempts: number;
  ipHash?: string | null;
}): Promise<PortalMagicLink> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO PortalMagicLink
          (id, engagementId, memberId, codeHash, expiresAt, attemptCount, maxAttempts, ipHash, createdAt)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [id, input.engagementId, input.memberId, input.codeHash, input.expiresAt, 0, input.maxAttempts, input.ipHash ?? null, now],
  });
  const r = await db.execute({ sql: `SELECT * FROM PortalMagicLink WHERE id = ?`, args: [id] });
  return toLink(r.rows[0] as Row);
}

export async function findActivePortalMagicLink(memberId: string): Promise<PortalMagicLink | null> {
  const db = getDb();
  const now = new Date().toISOString();
  const r = await db.execute({
    sql: `SELECT * FROM PortalMagicLink
          WHERE memberId = ? AND consumedAt IS NULL AND expiresAt > ?
          ORDER BY createdAt DESC LIMIT 1`,
    args: [memberId, now],
  });
  if (!r.rows[0]) return null;
  return toLink(r.rows[0] as Row);
}

export async function recordPortalMagicLinkAttempt(linkId: string): Promise<number> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE PortalMagicLink SET attemptCount = attemptCount + 1 WHERE id = ?`,
    args: [linkId],
  });
  const r = await db.execute({ sql: `SELECT attemptCount FROM PortalMagicLink WHERE id = ?`, args: [linkId] });
  return Number((r.rows[0] as Row).attemptCount);
}

export async function consumePortalMagicLink(linkId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE PortalMagicLink SET consumedAt = ? WHERE id = ? AND consumedAt IS NULL`,
    args: [new Date().toISOString(), linkId],
  });
}

/**
 * Mark all currently-active links for a member as consumed. Used when issuing a
 * fresh OTP to invalidate older codes.
 */
export async function invalidateActiveLinksForMember(memberId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE PortalMagicLink SET consumedAt = ? WHERE memberId = ? AND consumedAt IS NULL`,
    args: [new Date().toISOString(), memberId],
  });
}

export async function purgeExpiredPortalMagicLinks(graceSeconds = 86400): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - graceSeconds * 1000).toISOString();
  const r = await db.execute({
    sql: `DELETE FROM PortalMagicLink WHERE expiresAt < ?`,
    args: [cutoff],
  });
  return Number((r as { rowsAffected?: number | bigint }).rowsAffected ?? 0);
}
