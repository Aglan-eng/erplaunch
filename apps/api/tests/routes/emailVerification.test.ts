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
  createEmailVerificationToken,
  findActiveEmailVerificationTokenByHash,
  findUserById,
} from '../../src/db/index.js';

const JWT_SECRET = 'test-email-verify-secret';

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

async function seedUser(): Promise<{ email: string; userId: string; token: string }> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const slug = `firm-${createId().slice(0, 8)}`;
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  const email = `user-${createId().slice(0, 8)}@example.com`;
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Test Firm', slug, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, email, 'Tester', passwordHash, 'CONSULTANT', now],
  });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Tester', email });
  return { email, userId, token };
}

function authHeaders(token: string): Record<string, string> {
  return { cookie: `token=${token}`, 'content-type': 'application/json' };
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
  // Silence the Resend dev fallback logs for neat test output.
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('POST /auth/verify-email', () => {
  it('marks the user as verified on a valid token and consumes it', async () => {
    const { userId } = await seedUser();
    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(raw);
    await createEmailVerificationToken({
      userId, tokenHash,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/verify-email',
      headers: { 'content-type': 'application/json' },
      payload: { token: raw },
    });
    expect(res.statusCode).toBe(200);

    // Token row no longer active
    expect(await findActiveEmailVerificationTokenByHash(tokenHash)).toBeNull();

    // User row now has emailVerifiedAt set
    const row = await findUserById(userId) as (Record<string, unknown> & { emailVerifiedAt?: string | null }) | null;
    expect(row?.emailVerifiedAt).toBeTruthy();
  });

  it('rejects a replay of a consumed token', async () => {
    const { userId } = await seedUser();
    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(raw);
    await createEmailVerificationToken({
      userId, tokenHash,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const first = await app.inject({
      method: 'POST', url: '/api/v1/auth/verify-email',
      headers: { 'content-type': 'application/json' },
      payload: { token: raw },
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST', url: '/api/v1/auth/verify-email',
      headers: { 'content-type': 'application/json' },
      payload: { token: raw },
    });
    expect(replay.statusCode).toBe(400);
    expect((replay.json() as { error: { code: string } }).error.code).toBe('INVALID_OR_EXPIRED');
  });

  it('rejects an unknown token', async () => {
    const raw = crypto.randomBytes(32).toString('hex'); // never persisted
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/verify-email',
      headers: { 'content-type': 'application/json' },
      payload: { token: raw },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_OR_EXPIRED');
  });

  it('rejects an expired token', async () => {
    const { userId } = await seedUser();
    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(raw);
    await createEmailVerificationToken({
      userId, tokenHash,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/verify-email',
      headers: { 'content-type': 'application/json' },
      payload: { token: raw },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed payload', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/verify-email',
      headers: { 'content-type': 'application/json' },
      payload: { token: 'too-short' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /auth/request-email-verification', () => {
  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/request-email-verification',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('issues a fresh token for an unverified user', async () => {
    const { userId, token } = await seedUser();
    const db = getDb();

    const before = await db.execute({
      sql: `SELECT COUNT(*) as c FROM EmailVerificationToken WHERE userId = ? AND consumedAt IS NULL`,
      args: [userId],
    });
    expect(Number((before.rows[0] as Record<string, unknown>).c)).toBe(0);

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/request-email-verification',
      headers: authHeaders(token),
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const after = await db.execute({
      sql: `SELECT COUNT(*) as c FROM EmailVerificationToken WHERE userId = ? AND consumedAt IS NULL`,
      args: [userId],
    });
    expect(Number((after.rows[0] as Record<string, unknown>).c)).toBe(1);
  });

  it('invalidates prior active tokens when re-requesting', async () => {
    const { userId, token } = await seedUser();

    const oldHash = `hash-${createId()}`;
    await createEmailVerificationToken({
      userId, tokenHash: oldHash,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(await findActiveEmailVerificationTokenByHash(oldHash)).not.toBeNull();

    await app.inject({
      method: 'POST', url: '/api/v1/auth/request-email-verification',
      headers: authHeaders(token),
      payload: {},
    });

    // Old token is consumed; active count should be 1 (the new one).
    expect(await findActiveEmailVerificationTokenByHash(oldHash)).toBeNull();
  });

  it('returns ok + alreadyVerified for a user whose email is already verified', async () => {
    const { userId, token } = await seedUser();
    const db = getDb();
    await db.execute({
      sql: `UPDATE User SET emailVerifiedAt = ? WHERE id = ?`,
      args: [new Date().toISOString(), userId],
    });

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/request-email-verification',
      headers: authHeaders(token),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { ok: boolean; alreadyVerified?: boolean } };
    expect(body.data.ok).toBe(true);
    expect(body.data.alreadyVerified).toBe(true);

    // No new token was issued for an already-verified user.
    const count = await db.execute({
      sql: `SELECT COUNT(*) as c FROM EmailVerificationToken WHERE userId = ?`,
      args: [userId],
    });
    expect(Number((count.rows[0] as Record<string, unknown>).c)).toBe(0);
  });
});

describe('GET /auth/me', () => {
  it('returns emailVerifiedAt (null for unverified)', async () => {
    const { token } = await seedUser();
    const res = await app.inject({
      method: 'GET', url: '/api/v1/auth/me',
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { emailVerifiedAt: string | null } };
    expect(body.data.emailVerifiedAt).toBeNull();
  });
});
