import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

/**
 * Password-reset tokens for consultant-side User accounts (Phase 16).
 *
 * Shape mirrors PortalMagicLink but scoped to User instead of
 * ProjectMember, and with a longer TTL since users typically click
 * a link from their inbox rather than retype a code.
 *
 * Security model:
 *   - Server generates a 32-byte random token, emails the raw value to
 *     the user, stores only its SHA-256 hash in tokenHash.
 *   - Lookup by hash on redeem — the raw token never hits the DB.
 *   - Consumed once (consumedAt) + expires on expiresAt.
 *   - Issuing a new token invalidates all prior active tokens for the
 *     same user to prevent stockpiling.
 *   - Every row records the requestor's IP hash for audit.
 */
export interface PasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  consumedAt: string | null;
  ipHash: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;

function toToken(row: Row): PasswordResetToken {
  return {
    id: row.id as string,
    userId: row.userId as string,
    tokenHash: row.tokenHash as string,
    expiresAt: row.expiresAt as string,
    consumedAt: (row.consumedAt as string | null) ?? null,
    ipHash: (row.ipHash as string | null) ?? null,
    createdAt: row.createdAt as string,
  };
}

export async function createPasswordResetToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: string;
  ipHash?: string | null;
}): Promise<PasswordResetToken> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO PasswordResetToken (id, userId, tokenHash, expiresAt, ipHash, createdAt)
          VALUES (?,?,?,?,?,?)`,
    args: [id, input.userId, input.tokenHash, input.expiresAt, input.ipHash ?? null, now],
  });
  const r = await db.execute({ sql: `SELECT * FROM PasswordResetToken WHERE id = ?`, args: [id] });
  return toToken(r.rows[0] as Row);
}

/** Look up the active (unconsumed + unexpired) token with the given hash. */
export async function findActivePasswordResetTokenByHash(tokenHash: string): Promise<PasswordResetToken | null> {
  const db = getDb();
  const now = new Date().toISOString();
  const r = await db.execute({
    sql: `SELECT * FROM PasswordResetToken
          WHERE tokenHash = ? AND consumedAt IS NULL AND expiresAt > ?
          LIMIT 1`,
    args: [tokenHash, now],
  });
  if (!r.rows[0]) return null;
  return toToken(r.rows[0] as Row);
}

export async function consumePasswordResetToken(id: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE PasswordResetToken SET consumedAt = ? WHERE id = ? AND consumedAt IS NULL`,
    args: [new Date().toISOString(), id],
  });
}

/** Invalidate every active reset token for a user — called when a new one
 *  is issued so stale tokens in the user's inbox stop working. */
export async function invalidateActivePasswordResetsForUser(userId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE PasswordResetToken SET consumedAt = ? WHERE userId = ? AND consumedAt IS NULL`,
    args: [new Date().toISOString(), userId],
  });
}

/** Housekeeping: sweep expired rows. Safe to call from a cron or opportunistically. */
export async function purgeExpiredPasswordResetTokens(graceSeconds = 86400): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - graceSeconds * 1000).toISOString();
  const r = await db.execute({
    sql: `DELETE FROM PasswordResetToken WHERE expiresAt < ?`,
    args: [cutoff],
  });
  return Number((r as { rowsAffected?: number | bigint }).rowsAffected ?? 0);
}
