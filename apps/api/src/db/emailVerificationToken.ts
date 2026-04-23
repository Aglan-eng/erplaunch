import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

/**
 * Email verification tokens for consultant-side User accounts (Phase 19).
 *
 * Same security model as PasswordResetToken: raw value is emailed, only
 * the SHA-256 hash is persisted, lookups go through the hash. Consumed
 * once per redeem; issuing a new token invalidates prior active ones so
 * stale links stop working.
 *
 * Verifying flips User.emailVerifiedAt to the current timestamp. Pilot
 * scope does NOT block unverified users from anything — verification is
 * offered, not enforced. Future phases can gate behind it.
 */
export interface EmailVerificationToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;

function toToken(row: Row): EmailVerificationToken {
  return {
    id: row.id as string,
    userId: row.userId as string,
    tokenHash: row.tokenHash as string,
    expiresAt: row.expiresAt as string,
    consumedAt: (row.consumedAt as string | null) ?? null,
    createdAt: row.createdAt as string,
  };
}

export async function createEmailVerificationToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: string;
}): Promise<EmailVerificationToken> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO EmailVerificationToken (id, userId, tokenHash, expiresAt, createdAt)
          VALUES (?,?,?,?,?)`,
    args: [id, input.userId, input.tokenHash, input.expiresAt, now],
  });
  const r = await db.execute({ sql: `SELECT * FROM EmailVerificationToken WHERE id = ?`, args: [id] });
  return toToken(r.rows[0] as Row);
}

export async function findActiveEmailVerificationTokenByHash(tokenHash: string): Promise<EmailVerificationToken | null> {
  const db = getDb();
  const now = new Date().toISOString();
  const r = await db.execute({
    sql: `SELECT * FROM EmailVerificationToken
          WHERE tokenHash = ? AND consumedAt IS NULL AND expiresAt > ?
          LIMIT 1`,
    args: [tokenHash, now],
  });
  if (!r.rows[0]) return null;
  return toToken(r.rows[0] as Row);
}

export async function consumeEmailVerificationToken(id: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE EmailVerificationToken SET consumedAt = ? WHERE id = ? AND consumedAt IS NULL`,
    args: [new Date().toISOString(), id],
  });
}

export async function invalidateActiveEmailVerificationsForUser(userId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE EmailVerificationToken SET consumedAt = ? WHERE userId = ? AND consumedAt IS NULL`,
    args: [new Date().toISOString(), userId],
  });
}

/** Mark the user's email as verified — idempotent if already set. */
export async function markUserEmailVerified(userId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE User SET emailVerifiedAt = ? WHERE id = ? AND emailVerifiedAt IS NULL`,
    args: [new Date().toISOString(), userId],
  });
}
