import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { LoginSchema, RegisterSchema, RequestPasswordResetSchema, ResetPasswordSchema, ChangePasswordSchema, VerifyEmailSchema } from '@ofoq/shared';
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
  createEmailVerificationToken,
  findActiveEmailVerificationTokenByHash,
  consumeEmailVerificationToken,
  invalidateActiveEmailVerificationsForUser,
  markUserEmailVerified,
} from '../db/index.js';
import {
  checkRequestCodeLimit,
  recordRequestCode,
  RedisUnavailableError,
  type RedisLike,
} from '../services/portalRateLimit.js';
import { sendPasswordResetEmail, sendEmailVerificationEmail, APP_URL, EmailSendError } from '../services/email.js';
import { incrementCounter } from '../services/metrics.js';

/** How long a password reset link stays valid, in minutes. Overridable via env. */
const RESET_TOKEN_TTL_MIN = Math.max(5, parseInt(process.env.PASSWORD_RESET_TTL_MIN ?? '60', 10));

/** How long an email verification link stays valid, in hours. Defaults to 24h. */
const VERIFY_TOKEN_TTL_HOURS = Math.max(1, parseInt(process.env.EMAIL_VERIFY_TTL_HOURS ?? '24', 10));

/**
 * Issue a fresh email verification token for the user and send the email.
 *
 * Phase 41.4 — returns a structured result instead of swallowing the
 * error and returning null. Callers can branch on `result.ok`:
 *   - { ok: true }                       email sent
 *   - { ok: false, code: 'SEND_FAILED', sendCode? }  delivery failed,
 *     `sendCode` is the typed Resend failure (DOMAIN_NOT_VERIFIED,
 *     INVALID_RECIPIENT, etc.) when classifyResendFailure produced one
 *
 * Prior active tokens for the same user are invalidated regardless of
 * the send result, so only the latest link ever works.
 */
type IssueEmailVerificationResult =
  | { ok: true; verifyUrl: string }
  | { ok: false; code: 'SEND_FAILED'; sendCode?: string; message: string };

async function issueEmailVerification(
  userId: string,
  email: string,
  name: string,
  log: (level: 'info' | 'error', msg: string, obj?: Record<string, unknown>) => void,
): Promise<IssueEmailVerificationResult> {
  try {
    await invalidateActiveEmailVerificationsForUser(userId);
    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(raw);
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
    await createEmailVerificationToken({ userId, tokenHash, expiresAt });
    const verifyUrl = `${APP_URL}/verify-email?token=${raw}`;
    try {
      const parsedUrl = new URL(verifyUrl);
      log('info', 'auth/email-verify: link prepared', { userId, host: parsedUrl.host });
    } catch { /* URL parse only fails if APP_URL is malformed */ }
    await sendEmailVerificationEmail(email, {
      userName: name,
      verifyUrl,
      expiresInHours: VERIFY_TOKEN_TTL_HOURS,
    });
    return { ok: true, verifyUrl };
  } catch (err) {
    log('error', 'auth/email-verify: issue failed', { userId, err: String(err) });
    if (err instanceof EmailSendError) {
      return { ok: false, code: 'SEND_FAILED', sendCode: err.code, message: err.message };
    }
    return { ok: false, code: 'SEND_FAILED', message: String(err) };
  }
}

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
      incrementCounter('auth_login_total', { outcome: 'rate_limited' });
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Wait a moment and try again.' } });
    }
    await tryLoginRateLimit(request, async (r) => { await recordRequestCode(r, ip, email); return { ok: true }; });

    const user = await findUserByEmail(email) as Record<string, unknown> & { passwordHash: string; id: string; firmId: string; role: string; email: string; name: string; firm: Record<string, unknown> } | null;

    if (!user || !(await bcrypt.compare(password, user.passwordHash as string))) {
      incrementCounter('auth_login_total', { outcome: 'invalid' });
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    }

    incrementCounter('auth_login_total', { outcome: 'ok' });

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
      incrementCounter('auth_register_total', { outcome: 'rate_limited' });
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many signups. Wait a moment and try again.' } });
    }
    await tryLoginRateLimit(request, async (r) => { await recordRequestCode(r, ip, adminEmail); return { ok: true }; });

    // Uniqueness: slug (case-insensitive by virtue of schema lowercasing) and
    // email (case-insensitive: we normalise below). Both checks before any
    // writes so we never create a firm without a user.
    const normalizedEmail = adminEmail.trim().toLowerCase();
    if (await findFirmBySlug(firmSlug)) {
      incrementCounter('auth_register_total', { outcome: 'conflict' });
      return reply.code(409).send({ error: { code: 'SLUG_TAKEN', message: 'A firm with that slug already exists.' } });
    }
    if (await findUserByEmail(normalizedEmail)) {
      incrementCounter('auth_register_total', { outcome: 'conflict' });
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
    let user: Awaited<ReturnType<typeof createUser>> = null;
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

    // Kick off email verification (Phase 19). Fire-and-forget — the user is
    // signed in either way; verification is offered, not enforced.
    void issueEmailVerification(u.id, u.email, u.name, (level, msg, obj) => {
      if (level === 'error') request.log.error(obj, msg);
      else request.log.info(obj, msg);
    });

    incrementCounter('auth_register_total', { outcome: 'ok' });

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
    let devResetUrl: string | null = null;
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

        // Operator-visible breadcrumb: log the destination origin + path so we
        // can verify APP_URL is wired correctly in the environment. We NEVER
        // log the raw token — grepping this in Render doesn't give you a
        // working reset link.
        try {
          const parsedUrl = new URL(resetUrl);
          request.log.info(
            { userId: user.id, host: parsedUrl.host, path: parsedUrl.pathname },
            'auth/request-reset: reset link prepared',
          );
        } catch {
          request.log.warn({ userId: user.id, APP_URL }, 'auth/request-reset: APP_URL does not parse as a URL');
        }

        // Dev-only: surface the raw reset URL in the response body so local
        // testing doesn't need a real email provider. NEVER enable in
        // production — would turn an enumeration oracle into a free
        // password-reset oracle.
        if (process.env.NODE_ENV !== 'production') {
          devResetUrl = resetUrl;
        }

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

    incrementCounter('auth_password_reset_requested_total');
    return reply.code(202).send({
      data: {
        ok: true,
        // Only present in non-production runs (local dev). Production
        // responses include nothing extra — see enumeration guarantee above.
        ...(devResetUrl ? { devResetUrl } : {}),
      },
    });
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

    incrementCounter('auth_password_reset_completed_total');
    return reply.send({ data: { ok: true } });
  });

  // POST /auth/change-password — authenticated password rotation.
  //
  // Requires the current password as a re-auth check; a stolen session
  // cookie is not enough to change the password on its own. On success we
  // also invalidate any outstanding reset tokens for this user, since the
  // user has effectively acknowledged their password is fresh + correct
  // and any lingering reset links from previous forgot-flows should stop
  // working.
  fastify.post('/auth/change-password', { preHandler: authenticate }, async (request, reply) => {
    const parsed = ChangePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }
    const { currentPassword, newPassword } = parsed.data;

    if (currentPassword === newPassword) {
      return reply.code(400).send({
        error: { code: 'SAME_PASSWORD', message: 'New password must differ from the current one.' },
      });
    }

    // Load the user row fresh — do NOT trust anything from the JWT beyond
    // the user id. Verifies the session is still attached to a real row.
    const user = await findUserById(request.jwtUser.userId) as
      | (Record<string, unknown> & { id: string; email: string; passwordHash: string })
      | null;
    if (!user) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      // Uniform-ish error — don't leak whether the user exists vs wrong
      // password (though this endpoint is authenticated so the user
      // definitely exists; we still keep the copy neutral).
      return reply.code(400).send({
        error: { code: 'WRONG_PASSWORD', message: 'Current password is incorrect.' },
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await resetUserPassword(user.email, passwordHash);
    await invalidateActivePasswordResetsForUser(user.id);

    incrementCounter('auth_password_changed_total');
    return reply.send({ data: { ok: true } });
  });

  // GET /auth/me
  fastify.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    const user = await findUserById(request.jwtUser.userId) as Record<string, unknown> & { id: string; email: string; name: string; role: string; firmId: string; firm: Record<string, unknown>; emailVerifiedAt?: string | null } | null;

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
        // Phase 19: surface verification status so the SPA can offer
        // a "verify your email" banner / resend action when null.
        emailVerifiedAt: user.emailVerifiedAt ?? null,
      },
    });
  });

  // POST /auth/verify-email — redeem an email verification token (Phase 19).
  //
  // Public endpoint (the user may not yet have a session). Hashes the
  // incoming token, looks up by hash, flips User.emailVerifiedAt,
  // consumes the row, invalidates siblings. Uniform INVALID_OR_EXPIRED on
  // unknown/expired/consumed tokens — same contract as /reset-password.
  fastify.post('/auth/verify-email', async (request, reply) => {
    const parsed = VerifyEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }
    const { token } = parsed.data;

    const tokenHash = sha256Hex(token);
    const row = await findActiveEmailVerificationTokenByHash(tokenHash);
    if (!row) {
      return reply.code(400).send({
        error: { code: 'INVALID_OR_EXPIRED', message: 'This verification link is invalid or has expired.' },
      });
    }

    await markUserEmailVerified(row.userId);
    await consumeEmailVerificationToken(row.id);
    await invalidateActiveEmailVerificationsForUser(row.userId);

    incrementCounter('auth_email_verification_completed_total');
    return reply.send({ data: { ok: true } });
  });

  // POST /auth/request-email-verification — authenticated, body-less.
  //
  // User-initiated re-send of the verification email. Skipped (still 200)
  // when the user is already verified so the client can always "just try"
  // the button. Rate-limited on the authenticated user's id so even a
  // stolen session can't spam-send.
  fastify.post('/auth/request-email-verification', { preHandler: authenticate }, async (request, reply) => {
    const user = await findUserById(request.jwtUser.userId) as
      | (Record<string, unknown> & { id: string; email: string; name: string; emailVerifiedAt?: string | null })
      | null;
    if (!user) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    if (user.emailVerifiedAt) {
      // Already verified; idempotent success so the SPA can blindly call
      // this without first checking status.
      incrementCounter('auth_email_verification_requested_total', { outcome: 'already_verified' });
      return reply.send({ data: { ok: true, alreadyVerified: true } });
    }

    const ip = request.ip || '0.0.0.0';
    const limit = await tryLoginRateLimit(request, (r) => checkRequestCodeLimit(r, ip, `verify:${user.id}`));
    if (!limit.ok) {
      incrementCounter('auth_email_verification_requested_total', { outcome: 'rate_limited' });
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many verification requests. Wait a moment and try again.' } });
    }
    await tryLoginRateLimit(request, async (r) => { await recordRequestCode(r, ip, `verify:${user.id}`); return { ok: true }; });

    // Phase 41.4 — await the result so we can surface delivery failures
    // (especially Resend's free-tier "domain not verified" 403) to the
    // caller. Without this the SPA showed a green tick even when the
    // email never left Resend's outbox, which made signups for new
    // firms look healthy when they weren't.
    const issueResult = await issueEmailVerification(user.id, user.email, user.name, (level, msg, obj) => {
      if (level === 'error') request.log.error(obj, msg);
      else request.log.info(obj, msg);
    });

    if (!issueResult.ok) {
      incrementCounter('auth_email_verification_requested_total', {
        outcome: issueResult.sendCode === 'DOMAIN_NOT_VERIFIED' ? 'domain_not_verified' : 'send_failed',
      });
      // 502 (Bad Gateway) so it's distinct from rate-limit (429) and
      // input-validation (400). The message is what the SPA renders
      // verbatim; the structured `code` is what triggers the
      // Settings → Email Domain CTA in EmailVerificationBanner.
      const isDomainIssue = issueResult.sendCode === 'DOMAIN_NOT_VERIFIED';
      return reply.code(502).send({
        error: {
          code: isDomainIssue ? 'EMAIL_DOMAIN_NOT_VERIFIED' : 'EMAIL_SEND_FAILED',
          message: isDomainIssue
            ? `We couldn't send to ${user.email}. Your firm's email domain isn't verified yet. Visit Settings → Email Domain to fix this.`
            : `We couldn't send the verification email to ${user.email}. Try again in a moment, or check Settings → Email Domain.`,
          recipient: user.email,
        },
      });
    }

    incrementCounter('auth_email_verification_requested_total', { outcome: 'ok' });
    return reply.send({ data: { ok: true } });
  });
}
