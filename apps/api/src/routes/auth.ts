import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { LoginSchema, RegisterSchema, RequestPasswordResetSchema, ResetPasswordSchema } from '@ofoq/shared';
import { authenticate } from '../middleware/auth.js';
import {
  findUserByEmail,
  findUserById,
  findFirmBySlug,
  createFirm,
  createUser,
  resetUserPassword,
  createPasswordResetToken,
  findActivePasswordResetTokenByHash,
  consumePasswordResetToken,
  invalidateActivePasswordResetsForUser,
} from '../db/index.js';
import {
  checkRequestCodeLimit,
  recordRequestCode,
  RedisUnavailableError,
  type RedisLike,
} from '../services/portalRateLimit.js';
import { sendPasswordResetEmail, APP_URL } from '../services/email.js';

/** How long a password reset link stays valid, in minutes. Overridable via env. */
const RESET_TOKEN_TTL_MIN = Math.max(5, parseInt(process.env.PASSWORD_RESET_TTL_MIN ?? '60', 10));

function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

async function tryLoginRateLimit(
  request: FastifyRequest,
  fn: (redis: RedisLike) => Promise<{ ok: boolean }>,
): Promise<{ ok: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const redis = (request.server as any).redis as RedisLike | undefined;
  if (!redis) return { ok: true };
  try {
    return await fn(redis);
  } catch (err) {
    if (err instanceof RedisUnavailableError) {
      request.log.warn('auth/login rate-limit: redis unavailable — proceeding');
      return { ok: true };
    }
    throw err;
  }
}

export async function authRoutes(fastify: FastifyInstance) {
  // POST /auth/login
  fastify.post('/auth/login', async (request, reply) => {
    const result = LoginSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: result.error.message } });
    }

    const { email, password } = result.data;

    // Rate-limit on (IP, email). Reuses the portal limiter's primitives — same
    // shape, same per-minute 3/3 caps via env (overridable). Fail-open if
    // Redis is unavailable (see tryLoginRateLimit above for rationale).
    const ip = request.ip || '0.0.0.0';
    const limit = await tryLoginRateLimit(request, (r) => checkRequestCodeLimit(r, ip, email));
    if (!limit.ok) {
      request.log.warn({ ip }, 'auth/login rate-limit hit');
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Wait a moment and try again.' } });
    }
    await tryLoginRateLimit(request, async (r) => { await recordRequestCode(r, ip, email); return { ok: true }; });

    const user = await findUserByEmail(email) as Record<string, unknown> & { passwordHash: string; id: string; firmId: string; role: string; email: string; name: string; firm: Record<string, unknown> } | null;

    if (!user || !(await bcrypt.compare(password, user.passwordHash as string))) {
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    }

    const token = fastify.jwt.sign(
      {
        userId: user.id,
        firmId: user.firmId,
        role: user.role,
        name: user.name,
        email: user.email,
      },
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Cross-origin cookie: web on vercel.app + api on onrender.com are
    // cross-site. Browsers require SameSite=None + Secure to share the cookie.
    // Fall back to Lax for local dev (http://localhost).
    const isProd = process.env.NODE_ENV === 'production';
    reply
      .setCookie('token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      })
      .send({
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            firmId: user.firmId,
            firm: user.firm,
          },
        },
      });
  });

  // POST /auth/register — self-serve firm signup. Creates a Firm + admin User
  // (role=CONSULTANT) and signs in the admin in the same request.
  //
  // Scope (pilot): email is NOT verified. A malicious user could register with
  // an email they don't control; they'd still have to sign in, which requires
  // the password they set. Post-pilot: gate signup behind email verification.
  fastify.post('/auth/register', async (request, reply) => {
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }
    const { firmName, firmSlug, adminName, adminEmail, password } = parsed.data;

    // Reserved slugs — keep path-level routes (/admin, /api) and common
    // subdomains available for platform use. Case-insensitive via schema.
    const RESERVED = new Set([
      'admin', 'api', 'www', 'app', 'root', 'system', 'mail', 'email',
      'portal', 'dashboard', 'auth', 'login', 'signup', 'settings',
      'static', 'assets', 'public', 'docs', 'help', 'support',
      'erplaunch', 'ofoq',
    ]);
    if (RESERVED.has(firmSlug)) {
      return reply.code(400).send({ error: { code: 'SLUG_RESERVED', message: 'That slug is reserved. Please pick another.' } });
    }

    // Rate-limit by IP (reuse the login limiter primitives — same shape).
    const ip = request.ip || '0.0.0.0';
    const limit = await tryLoginRateLimit(request, (r) => checkRequestCodeLimit(r, ip, adminEmail));
    if (!limit.ok) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many signups. Wait a moment and try again.' } });
    }
    await tryLoginRateLimit(request, async (r) => { await recordRequestCode(r, ip, adminEmail); return { ok: true }; });

    // Uniqueness: slug (case-insensitive by virtue of schema lowercasing) and
    // email (case-insensitive: we normalise below). Both checks before any
    // writes so we never create a firm without a user.
    const normalizedEmail = adminEmail.trim().toLowerCase();
    if (await findFirmBySlug(firmSlug)) {
      return reply.code(409).send({ error: { code: 'SLUG_TAKEN', message: 'A firm with that slug already exists.' } });
    }
    if (await findUserByEmail(normalizedEmail)) {
      return reply.code(409).send({ error: { code: 'EMAIL_TAKEN', message: 'An account with that email already exists.' } });
    }

    // Create firm + admin user. If the user insert fails (e.g. race on the
    // email unique constraint), the firm was already persisted — pilot-safe
    // since orphan firms don't impact anything and we return 500 here.
    const firm = await createFirm({ name: firmName.trim(), slug: firmSlug, plan: 'STARTER' }) as
      | (Record<string, unknown> & { id: string; name: string; slug: string })
      | null;
    if (!firm) {
      return reply.code(500).send({ error: { code: 'FIRM_CREATE_FAILED' } });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let user: Record<string, unknown> | null = null;
    try {
      user = await createUser({
        firmId: firm.id,
        email: normalizedEmail,
        name: adminName.trim(),
        passwordHash,
        role: 'CONSULTANT',
      });
    } catch (err) {
      // Race with another registration that took the email between our
      // uniqueness check and this insert. Surface as 409 rather than 500.
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed.*email/i.test(msg)) {
        return reply.code(409).send({ error: { code: 'EMAIL_TAKEN', message: 'An account with that email already exists.' } });
      }
      throw err;
    }
    if (!user) {
      return reply.code(500).send({ error: { code: 'USER_CREATE_FAILED' } });
    }
    const u = user as { id: string; email: string; name: string; role: string; firmId: string };

    // Sign the admin in immediately — same token shape as /auth/login.
    const token = fastify.jwt.sign(
      { userId: u.id, firmId: u.firmId, role: u.role, name: u.name, email: u.email },
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' },
    );
    const isProd = process.env.NODE_ENV === 'production';
    reply
      .setCookie('token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      })
      .code(201)
      .send({
        data: {
          user: {
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            firmId: u.firmId,
            firm: { id: firm.id, name: firm.name, slug: firm.slug },
          },
        },
      });
  });

  // POST /auth/logout
  fastify.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie('token', { path: '/' }).send({ data: { ok: true } });
  });

  // POST /auth/request-reset — start a password reset flow (Phase 16).
  //
  // Intentionally enumeration-safe: always returns 202 with the same body
  // whether the email maps to a real user or not. The real work happens
  // out-of-band (row insert + email send). Rate-limited on (ip, email) via
  // the same primitives used by /login and /register — fail-open when Redis
  // is unavailable.
  fastify.post('/auth/request-reset', async (request, reply) => {
    const parsed = RequestPasswordResetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }
    const { email } = parsed.data;

    const ip = request.ip || '0.0.0.0';
    const limit = await tryLoginRateLimit(request, (r) => checkRequestCodeLimit(r, ip, email));
    if (!limit.ok) {
      request.log.warn({ ip }, 'auth/request-reset rate-limit hit');
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many reset requests. Wait a moment and try again.' } });
    }
    await tryLoginRateLimit(request, async (r) => { await recordRequestCode(r, ip, email); return { ok: true }; });

    const user = await findUserByEmail(email) as (Record<string, unknown> & { id: string; name: string }) | null;
    if (user) {
      try {
        // Invalidate any stockpiled prior tokens so only the newest link works.
        await invalidateActivePasswordResetsForUser(user.id);

        // 32 random bytes → 64 hex chars. Raw value is emailed; only the
        // SHA-256 digest lands in the DB.
        const raw = crypto.randomBytes(32).toString('hex');
        const tokenHash = sha256Hex(raw);
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000).toISOString();
        await createPasswordResetToken({
          userId: user.id,
          tokenHash,
          expiresAt,
          ipHash: hashIp(ip),
        });

        const resetUrl = `${APP_URL}/reset-password?token=${raw}`;
        await sendPasswordResetEmail(email, {
          userName: user.name,
          resetUrl,
          expiresInMinutes: RESET_TOKEN_TTL_MIN,
        });
      } catch (err) {
        // Swallow mail/DB errors at the response boundary so the enumeration
        // guarantee holds. Log loudly for operators.
        request.log.error({ err, userId: user.id }, 'auth/request-reset: token create or email send failed');
      }
    }

    return reply.code(202).send({ data: { ok: true } });
  });

  // POST /auth/reset-password — redeem a reset token.
  //
  // Looks the token up by its SHA-256 hash, confirms it's unconsumed and
  // unexpired, rotates the password, marks the row consumed. Returns 200
  // + a neutral body on success (no session cookie — the user is redirected
  // to /login). On any failure returns 400 with INVALID_OR_EXPIRED so an
  // attacker can't tell "bad token" apart from "expired" apart from
  // "already used."
  fastify.post('/auth/reset-password', async (request, reply) => {
    const parsed = ResetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }
    const { token, password } = parsed.data;

    // Rate-limit redemption attempts too — a stolen token with a narrow TTL
    // is still worth slowing down, and this blunts naive brute force on the
    // hash lookup.
    const ip = request.ip || '0.0.0.0';
    const limit = await tryLoginRateLimit(request, (r) => checkRequestCodeLimit(r, ip, 'reset'));
    if (!limit.ok) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many reset attempts. Wait a moment and try again.' } });
    }
    await tryLoginRateLimit(request, async (r) => { await recordRequestCode(r, ip, 'reset'); return { ok: true }; });

    const tokenHash = sha256Hex(token);
    const row = await findActivePasswordResetTokenByHash(tokenHash);
    if (!row) {
      return reply.code(400).send({ error: { code: 'INVALID_OR_EXPIRED', message: 'This reset link is invalid or has expired.' } });
    }

    const user = await findUserById(row.userId) as (Record<string, unknown> & { email: string }) | null;
    if (!user) {
      // User vanished between token issue and redemption — treat as invalid.
      return reply.code(400).send({ error: { code: 'INVALID_OR_EXPIRED', message: 'This reset link is invalid or has expired.' } });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await resetUserPassword(user.email, passwordHash);
    await consumePasswordResetToken(row.id);
    // Invalidate any sibling tokens too, so a second link in the user's
    // inbox can't undo the password they just set.
    await invalidateActivePasswordResetsForUser(row.userId);

    return reply.send({ data: { ok: true } });
  });

  // GET /auth/me
  fastify.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    const user = await findUserById(request.jwtUser.userId) as Record<string, unknown> & { id: string; email: string; name: string; role: string; firmId: string; firm: Record<string, unknown> } | null;

    if (!user) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    return reply.send({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        firmId: user.firmId,
        firm: user.firm,
      },
    });
  });
}
