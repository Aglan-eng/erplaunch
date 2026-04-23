import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  getDb,
  createPasswordResetToken,
  findActivePasswordResetTokenByHash,
  consumePasswordResetToken,
  invalidateActivePasswordResetsForUser,
  purgeExpiredPasswordResetTokens,
} from '../../src/db/index.js';

let cleanup: () => void;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
});

/** Seed a firm + user; returns the userId. */
async function seedUser(): Promise<string> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const slug = `firm-${createId().slice(0, 8)}`;
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Test Firm', slug, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Tester', 'hash', 'CONSULTANT', now],
  });
  return userId;
}

describe('passwordResetToken: create + lookup', () => {
  it('creates a row and retrieves it by hash while still active', async () => {
    const userId = await seedUser();
    const tokenHash = `hash-${createId()}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const row = await createPasswordResetToken({ userId, tokenHash, expiresAt, ipHash: 'ip-hash-abc' });
    expect(row.userId).toBe(userId);
    expect(row.tokenHash).toBe(tokenHash);
    expect(row.consumedAt).toBeNull();
    expect(row.ipHash).toBe('ip-hash-abc');

    const found = await findActivePasswordResetTokenByHash(tokenHash);
    expect(found?.id).toBe(row.id);
  });

  it('returns null when the hash does not exist', async () => {
    const found = await findActivePasswordResetTokenByHash('no-such-hash');
    expect(found).toBeNull();
  });

  it('returns null for a consumed token', async () => {
    const userId = await seedUser();
    const tokenHash = `hash-${createId()}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const row = await createPasswordResetToken({ userId, tokenHash, expiresAt });

    await consumePasswordResetToken(row.id);

    const found = await findActivePasswordResetTokenByHash(tokenHash);
    expect(found).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const userId = await seedUser();
    const tokenHash = `hash-${createId()}`;
    // Expires a minute ago
    const expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
    await createPasswordResetToken({ userId, tokenHash, expiresAt });

    const found = await findActivePasswordResetTokenByHash(tokenHash);
    expect(found).toBeNull();
  });
});

describe('passwordResetToken: invalidateActivePasswordResetsForUser', () => {
  it('marks every active row for a user as consumed in one call', async () => {
    const userId = await seedUser();
    const hashA = `hash-${createId()}`;
    const hashB = `hash-${createId()}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await createPasswordResetToken({ userId, tokenHash: hashA, expiresAt });
    await createPasswordResetToken({ userId, tokenHash: hashB, expiresAt });

    await invalidateActivePasswordResetsForUser(userId);

    expect(await findActivePasswordResetTokenByHash(hashA)).toBeNull();
    expect(await findActivePasswordResetTokenByHash(hashB)).toBeNull();
  });

  it('does not touch tokens belonging to other users', async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const hashA = `hash-${createId()}`;
    const hashB = `hash-${createId()}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await createPasswordResetToken({ userId: userA, tokenHash: hashA, expiresAt });
    await createPasswordResetToken({ userId: userB, tokenHash: hashB, expiresAt });

    await invalidateActivePasswordResetsForUser(userA);

    expect(await findActivePasswordResetTokenByHash(hashA)).toBeNull();
    const stillActive = await findActivePasswordResetTokenByHash(hashB);
    expect(stillActive?.userId).toBe(userB);
  });
});

describe('passwordResetToken: purgeExpiredPasswordResetTokens', () => {
  it('deletes only rows past the grace cutoff', async () => {
    const userId = await seedUser();
    const freshHash = `hash-${createId()}`;
    const oldHash = `hash-${createId()}`;
    // One future-dated row (should stay) + one row expired well past the
    // default 24h grace window (should be deleted).
    await createPasswordResetToken({
      userId, tokenHash: freshHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await createPasswordResetToken({
      userId, tokenHash: oldHash,
      expiresAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });

    const deleted = await purgeExpiredPasswordResetTokens(86400); // 24h grace
    expect(deleted).toBe(1);

    // Fresh one survives (still active); old one is gone.
    const fresh = await findActivePasswordResetTokenByHash(freshHash);
    expect(fresh).not.toBeNull();
  });
});
