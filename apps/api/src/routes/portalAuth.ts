import crypto from 'crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as db from '../db/index.js';
import { issuePortalOtp, verifyPortalOtp } from '../services/portalOtp.js';
import { sendEmailForFirm } from '../services/emailTransport.js';
import { authenticatePortalSession, hashJti } from '../middleware/portalAuth.js';
import {
  checkRequestCodeLimit,
  recordRequestCode,
  checkVerifyLimit,
  recordVerifyFailure,
  RedisUnavailableError,
  type RedisLike,
} from '../services/portalRateLimit.js';

const RequestAccessSchema = z.object({
  email: z.string().email(),
  engagementToken: z.string().min(1),
});

const VerifyCodeSchema = z.object({
  email: z.string().email(),
  engagementToken: z.string().min(1),
  code: z.string().regex(/^\d{4,10}$/),
});

function cookieOpts() {
  const isProd = process.env.NODE_ENV === 'production';
  const ttlDays = Number(process.env.PORTAL_SESSION_TTL_DAYS ?? 7);
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
    maxAge: ttlDays * 86400,
  };
}

function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
}

function getRedis(request: FastifyRequest): RedisLike | null {
  // fastify.redis is decorated by plugins/redis.ts. In tests the plugin isn't
  // registered. Accept either shape and return null when unavailable so the
  // caller can degrade gracefully.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (request.server as any).redis as RedisLike | undefined;
  return r ?? null;
}

/**
 * Best-effort rate-limit check. Returns `{ ok: true }` if Redis is unavailable
 * so pilot deploys with transient Redis blips don't lock out real users.
 * Prod deploys with a healthy Redis get real rate limits; the warn log line
 * in the catch is the ops signal that something is wrong.
 */
async function tryRateLimit<T extends { ok: boolean; retryAfterSeconds?: number }>(
  request: FastifyRequest,
  fn: (redis: RedisLike) => Promise<T>,
  label: string,
): Promise<T> {
  const redis = getRedis(request);
  if (!redis) return { ok: true } as T;
  try {
    return await fn(redis);
  } catch (err) {
    if (err instanceof RedisUnavailableError) {
      request.log.warn({ label }, 'portal rate-limit: redis unavailable — proceeding without limits');
      return { ok: true } as T;
    }
    throw err;
  }
}

export async function portalAuthRoutes(fastify: FastifyInstance) {
  /**
   * POST /engagements/portal/request-access
   * Body: { email, engagementToken }
   *
   * Always responds 202 regardless of whether the email is a known client
   * member, to avoid user enumeration. If the member exists we issue a
   * PortalMagicLink OTP and email it.
   *
   * 404 is reserved for a truly unknown portal token (since that token is
   * already public — the inviter knew it to share the portal URL).
   */
  fastify.post('/engagements/portal/request-access', async (request, reply) => {
    const parsed = RequestAccessSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }
    const { email, engagementToken } = parsed.data;

    // Rate limit before any DB work — an attacker spraying this endpoint
    // should not get cheap engagement-existence probes. We check both
    // per-IP and per-email counters.
    const ip = request.ip || '0.0.0.0';
    const limit = await tryRateLimit(
      request,
      (r) => checkRequestCodeLimit(r, ip, email),
      'request-access',
    );
    if (!limit.ok) {
      request.log.warn({ ip, label: 'request-access' }, 'portal rate-limit hit');
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a moment and try again.' } });
    }

    const engagement = await db.findEngagementByPortalToken(engagementToken);
    if (!engagement) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown portal' } });
    }
    const engagementId = (engagement as { id: string }).id;
    const firmId = (engagement as { firmId?: string }).firmId;

    // Record the request counter even if the member isn't found — prevents
    // enumeration-by-timing.
    await tryRateLimit(
      request,
      async (r) => { await recordRequestCode(r, ip, email); return { ok: true }; },
      'request-access',
    );

    // Constant-ish latency regardless of membership: always do the member
    // lookup and only branch on actions after. Respond 202 in both paths.
    const member = await db.findClientMemberByEngagementAndEmail(engagementId, email);

    if (member && firmId) {
      const { code } = await issuePortalOtp({ engagementId, memberId: member.id });
      const verifyUrl = `${appUrl()}/portal/${engagementToken}/verify?email=${encodeURIComponent(email)}&code=${code}`;
      const firmBranding = await db.getFirmBrandingByEngagementId(engagementId);
      const brand = firmBranding.displayName || 'ERPLaunch';
      const clientName = (engagement as { clientName?: string }).clientName ?? 'your project';

      try {
        await sendEmailForFirm(firmId, {
          to: email,
          subject: `Your sign-in link for ${clientName}`,
          text: [
            `Hi ${member.name},`,
            ``,
            `Use this link to sign in to the ${brand} client portal for ${clientName}:`,
            verifyUrl,
            ``,
            `Or enter this code in the portal: ${code}`,
            ``,
            `This code expires in ${process.env.PORTAL_OTP_TTL_MINUTES ?? 10} minutes. If you didn't request it, you can ignore this email.`,
          ].join('\n'),
          html: [
            `<p>Hi ${escapeHtml(member.name)},</p>`,
            `<p>Use this link to sign in to the <strong>${escapeHtml(brand)}</strong> client portal for <strong>${escapeHtml(clientName)}</strong>:</p>`,
            `<p><a href="${verifyUrl}">Sign in to the portal</a></p>`,
            `<p>Or enter this code: <strong style="font-size:18px;letter-spacing:2px">${code}</strong></p>`,
            `<p style="color:#64748b;font-size:13px">This code expires in ${process.env.PORTAL_OTP_TTL_MINUTES ?? 10} minutes. If you didn't request it, you can ignore this email.</p>`,
          ].join('\n'),
        });
      } catch (err) {
        fastify.log.error({ err, engagementId, memberId: member.id }, 'portal request-access: email send failed');
        // Fall through — we still 202 so the client can't distinguish "known email
        // with broken SMTP" from "unknown email".
      }
    }

    return reply.code(202).send();
  });

  /**
   * POST /engagements/portal/verify
   * Body: { email, engagementToken, code }
   *
   * On success: creates a PortalSession, signs a portal-scoped JWT whose
   * payload carries { type: 'portal', memberId, engagementId, jti, sid },
   * sets an httpOnly `portal_token` cookie, returns the member profile.
   */
  fastify.post('/engagements/portal/verify', async (request, reply) => {
    const parsed = VerifyCodeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }
    const { email, engagementToken, code } = parsed.data;

    // Rate-limit verify attempts on a (engagementToken, IP) dimension. The
    // token stands in as the "verification id" — an attacker can only brute
    // N attempts per token per window before getting blocked. Per-member OTP
    // attempt burn (5 wrong codes → CODE_EXPIRED) is already enforced inside
    // verifyPortalOtp, so this is a second layer.
    const ip = request.ip || '0.0.0.0';
    const limit = await tryRateLimit(
      request,
      (r) => checkVerifyLimit(r, ip, engagementToken),
      'verify',
    );
    if (!limit.ok) {
      request.log.warn({ ip, label: 'verify' }, 'portal rate-limit hit');
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a moment and request a new link.' } });
    }

    const engagement = await db.findEngagementByPortalToken(engagementToken);
    if (!engagement) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown portal' } });
    }
    const engagementId = (engagement as { id: string }).id;

    const member = await db.findClientMemberByEngagementAndEmail(engagementId, email);
    if (!member) {
      await tryRateLimit(
        request,
        async (r) => { await recordVerifyFailure(r, ip, engagementToken); return { ok: true }; },
        'verify',
      );
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Verification failed' } });
    }

    const result = await verifyPortalOtp({ memberId: member.id, code });
    if (!result.ok) {
      await tryRateLimit(
        request,
        async (r) => { await recordVerifyFailure(r, ip, engagementToken); return { ok: true }; },
        'verify',
      );
      const statusCode = result.reason === 'RATE_LIMITED' ? 429 : 401;
      return reply.code(statusCode).send({ error: { code: result.reason, message: 'Verification failed' } });
    }

    // Create a session + signed JWT carrying its jti hash.
    const jti = crypto.randomBytes(32).toString('hex');
    const ttlDays = Number(process.env.PORTAL_SESSION_TTL_DAYS ?? 7);
    const expiresAt = new Date(Date.now() + ttlDays * 86400_000).toISOString();
    const ipHash = crypto
      .createHash('sha256')
      .update(String((request.headers['x-forwarded-for'] as string | undefined) || request.ip || ''))
      .digest('hex');

    const session = await db.createPortalSession({
      engagementId: member.engagementId,
      memberId: member.id,
      jtiHash: hashJti(jti),
      expiresAt,
      userAgent: (request.headers['user-agent'] as string | undefined) ?? null,
      ipHash,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = await (reply as any).portalJwtSign(
      {
        type: 'portal',
        memberId: member.id,
        engagementId: member.engagementId,
        jti,
        sid: session.id,
      },
      { expiresIn: `${ttlDays}d` },
    );

    return reply
      .setCookie('portal_token', token, cookieOpts())
      .send({
        data: {
          member: { id: member.id, name: member.name, role: member.role, email: member.email },
          engagementId: member.engagementId,
        },
      });
  });

  /**
   * POST /engagements/portal/logout
   * Revokes the current session (if any) and clears the cookie. Idempotent.
   */
  fastify.post(
    '/engagements/portal/logout',
    { preHandler: authenticatePortalSession },
    async (request, reply) => {
      await db.revokePortalSession(request.portalMember.sessionId);
      return reply
        .clearCookie('portal_token', { path: '/' })
        .send({ data: { ok: true } });
    },
  );

  /**
   * GET /engagements/portal/me
   * Returns the authenticated member or 401. Used by the SPA on boot to decide
   * whether to render the read-only view or the sign-in prompt.
   */
  fastify.get(
    '/engagements/portal/me',
    { preHandler: authenticatePortalSession },
    async (request) => {
      const member = await lookupMemberById(request.portalMember.memberId);
      return {
        data: {
          member: member ?? { id: request.portalMember.memberId },
          engagementId: request.portalMember.engagementId,
        },
      };
    },
  );
}

async function lookupMemberById(memberId: string) {
  const client = db.getDb();
  const r = await client.execute({
    sql: `SELECT id, name, role, email, engagementId FROM ProjectMember WHERE id = ?`,
    args: [memberId],
  });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    role: row.role as string,
    email: row.email as string,
    engagementId: row.engagementId as string,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
