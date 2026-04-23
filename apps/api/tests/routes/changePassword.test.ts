import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
} from '../../src/db/index.js';

const JWT_SECRET = 'test-change-password-secret';

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

interface SeededUser { email: string; password: string; userId: string; firmId: string; token: string }

async function seedAuthedUser(): Promise<SeededUser> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const slug = `firm-${createId().slice(0, 8)}`;
  const now = new Date().toISOString();
  const password = `pw-${createId()}`;
  const email = `user-${createId().slice(0, 8)}@example.com`;
  const passwordHash = await bcrypt.hash(password, 10);
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Test Firm', slug, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, email, 'Tester', passwordHash, 'CONSULTANT', now],
  });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Tester', email });
  return { email, password, userId, firmId, token };
}

function authHeaders(token: string): Record<string, string> {
  return { cookie: `token=${token}`, 'content-type': 'application/json' };
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

describe('POST /auth/change-password — auth gate', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { 'content-type': 'application/json' },
      payload: { currentPassword: 'old', newPassword: 'newstrongpw' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /auth/change-password — happy path', () => {
  it('rotates the password and allows login with the new one', async () => {
    const { email, password, token } = await seedAuthedUser();
    const newPassword = 'my-fresh-strong-password';

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authHeaders(token),
      payload: { currentPassword: password, newPassword },
    });
    expect(res.statusCode).toBe(200);

    // Old password no longer works
    const old = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(old.statusCode).toBe(401);

    // New password works
    const fresh = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email, password: newPassword },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('invalidates any outstanding password-reset tokens for the user', async () => {
    const { password, userId, token } = await seedAuthedUser();

    // Seed an active reset token that should NOT survive the change.
    const rawTokenHash = `hash-${createId()}`;
    await createPasswordResetToken({
      userId, tokenHash: rawTokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(await findActivePasswordResetTokenByHash(rawTokenHash)).not.toBeNull();

    // Change password.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authHeaders(token),
      payload: { currentPassword: password, newPassword: 'shiny-new-password' },
    });
    expect(res.statusCode).toBe(200);

    // Reset token is now invalidated.
    expect(await findActivePasswordResetTokenByHash(rawTokenHash)).toBeNull();
  });
});

describe('POST /auth/change-password — re-auth + validation', () => {
  it('rejects WRONG_PASSWORD when currentPassword is wrong', async () => {
    const { token } = await seedAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authHeaders(token),
      payload: { currentPassword: 'definitely-not-the-real-one', newPassword: 'something-fresh-and-new' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('WRONG_PASSWORD');
  });

  it('rejects SAME_PASSWORD when new matches current', async () => {
    const { password, token } = await seedAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authHeaders(token),
      payload: { currentPassword: password, newPassword: password },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SAME_PASSWORD');
  });

  it('rejects a too-short new password (VALIDATION_ERROR)', async () => {
    const { password, token } = await seedAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authHeaders(token),
      payload: { currentPassword: password, newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404s when the JWT points at a user that no longer exists', async () => {
    // Mint a token for a userId never inserted into the DB.
    const ghostUserId = createId();
    const ghostFirmId = createId();
    const ghostToken = app.jwt.sign({
      userId: ghostUserId, firmId: ghostFirmId, role: 'CONSULTANT',
      name: 'Ghost', email: 'ghost@example.com',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: authHeaders(ghostToken),
      payload: { currentPassword: 'anything', newPassword: 'long-enough-now' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// Lint-avoidance: `crypto` isn't used directly here, but keeping the import
// consistent with sibling test files where tokens are constructed.
void crypto;
