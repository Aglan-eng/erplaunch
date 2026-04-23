import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { authRoutes } from '../../src/routes/auth.js';
import {
  getDb,
  createPasswordResetToken,
  findActivePasswordResetTokenByHash,
  findUserByEmail,
} from '../../src/db/index.js';

const JWT_SECRET = 'test-password-reset-secret';

let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });
  await f.register(authRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

/** Seed a firm + user with a known password; returns { email, password, userId }. */
async function seedUser(email?: string): Promise<{ email: string; password: string; userId: string }> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const slug = `firm-${createId().slice(0, 8)}`;
  const now = new Date().toISOString();
  const password = `pw-${createId()}`;
  const finalEmail = email ?? `user-${createId().slice(0, 8)}@example.com`;
  const passwordHash = await bcrypt.hash(password, 10);
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Test Firm', slug, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, finalEmail, 'Tester', passwordHash, 'CONSULTANT', now],
  });
  return { email: finalEmail, password, userId };
}

function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

beforeEach(() => {
  // Silence the Resend fallback console.log for neat test output. Our fake
  // email transport only logs — no network calls — so suppression is safe.
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ─── POST /auth/request-reset ────────────────────────────────────────────────

describe('POST /auth/request-reset', () => {
  it('returns 202 and creates a token row for a known email', async () => {
    const { email, userId } = await seedUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/request-reset',
      payload: { email },
    });
    expect(res.statusCode).toBe(202);

    // Token row should be live for this user.
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT * FROM PasswordResetToken WHERE userId = ? AND consumedAt IS NULL`,
      args: [userId],
    });
    expect(r.rows).toHaveLength(1);
  });

  it('returns 202 for an unknown email and does NOT leak that it was unknown', async () => {
    // Enumeration-safe: body and status code must match a real-user request.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/request-reset',
      payload: { email: 'nobody-known@example.com' },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { data: { ok: boolean } };
    expect(body.data.ok).toBe(true);
  });

  it('invalidates prior active tokens for the same user when a new request arrives', async () => {
    const { email, userId } = await seedUser();

    // Pre-seed an active token directly in the DB.
    const oldHash = `hash-${createId()}`;
    await createPasswordResetToken({
      userId,
      tokenHash: oldHash,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(await findActivePasswordResetTokenByHash(oldHash)).not.toBeNull();

    // New request should invalidate the old one.
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/request-reset',
      payload: { email },
    });

    expect(await findActivePasswordResetTokenByHash(oldHash)).toBeNull();
  });

  it('rejects malformed email (VALIDATION_ERROR)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/request-reset',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── POST /auth/reset-password ───────────────────────────────────────────────

describe('POST /auth/reset-password', () => {
  it('rotates the password on a valid token and consumes it', async () => {
    const { email, userId } = await seedUser();

    // Issue a real-shaped raw+hash token directly through the DB layer.
    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(raw);
    await createPasswordResetToken({
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const newPassword = 'my-new-strong-password';
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: raw, password: newPassword },
    });
    expect(res.statusCode).toBe(200);

    // Token is now consumed (lookup returns null).
    expect(await findActivePasswordResetTokenByHash(tokenHash)).toBeNull();

    // User can log in with the new password.
    const loggedIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: newPassword },
    });
    expect(loggedIn.statusCode).toBe(200);
  });

  it('refuses a replay of a consumed token (INVALID_OR_EXPIRED)', async () => {
    const { userId } = await seedUser();

    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(raw);
    await createPasswordResetToken({
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    // First redemption succeeds.
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: raw, password: 'brand-new-password' },
    });
    expect(first.statusCode).toBe(200);

    // Second redemption with the same raw token must fail.
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: raw, password: 'another-password' },
    });
    expect(second.statusCode).toBe(400);
    const body = second.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_OR_EXPIRED');
  });

  it('rejects an unknown token (INVALID_OR_EXPIRED)', async () => {
    const raw = crypto.randomBytes(32).toString('hex'); // never persisted
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: raw, password: 'strong-enough-pw' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_OR_EXPIRED');
  });

  it('rejects an expired token (INVALID_OR_EXPIRED)', async () => {
    const { userId } = await seedUser();
    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(raw);
    await createPasswordResetToken({
      userId,
      tokenHash,
      // Expired a minute ago
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: raw, password: 'another-strong-pw' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_OR_EXPIRED');
  });

  it('rejects a too-short password (VALIDATION_ERROR)', async () => {
    const { userId } = await seedUser();
    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(raw);
    await createPasswordResetToken({
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: raw, password: 'short' }, // min is 8
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('invalidates sibling tokens so a second link cannot undo the new password', async () => {
    const { email, userId } = await seedUser();

    // Two concurrent reset tokens issued for the same user (e.g. user clicked
    // Request twice before reading their inbox).
    const rawA = crypto.randomBytes(32).toString('hex');
    const rawB = crypto.randomBytes(32).toString('hex');
    const hashA = sha256Hex(rawA);
    const hashB = sha256Hex(rawB);
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    await createPasswordResetToken({ userId, tokenHash: hashA, expiresAt });
    await createPasswordResetToken({ userId, tokenHash: hashB, expiresAt });

    // Redeem A.
    const redeemed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: rawA, password: 'chosen-password-from-A' },
    });
    expect(redeemed.statusCode).toBe(200);

    // B must now be dead (sibling invalidation).
    expect(await findActivePasswordResetTokenByHash(hashB)).toBeNull();
    const laterRedeem = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: rawB, password: 'attackers-password' },
    });
    expect(laterRedeem.statusCode).toBe(400);

    // And the user's password is the one set via A.
    const loggedIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'chosen-password-from-A' },
    });
    expect(loggedIn.statusCode).toBe(200);
    // Lookup also still works (just a sanity check that the user row persists).
    expect(await findUserByEmail(email)).not.toBeNull();
  });
});
