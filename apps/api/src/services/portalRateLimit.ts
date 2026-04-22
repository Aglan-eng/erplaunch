import crypto from 'crypto';

/**
 * Redis-backed rate limiter for portal auth. Redis is REQUIRED — if Redis is
 * down, calls throw RedisUnavailableError and routes fail closed with 503.
 * This is intentional: portal auth is an external-facing attack surface and we
 * do not want silent fallback to in-memory limits (they don't work on
 * multi-instance deploys).
 */

export class RedisUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('redis unavailable');
    this.name = 'RedisUnavailableError';
    if (cause) (this as { cause?: unknown }).cause = cause;
  }
}

export interface RedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

function requestCap(): number {
  return Number(process.env.PORTAL_AUTH_RATELIMIT_REQUEST_PER_MIN ?? 3);
}
function verifyCap(): number {
  return Number(process.env.PORTAL_AUTH_RATELIMIT_VERIFY_PER_MIN ?? 5);
}

function hashEmail(email: string): string {
  return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

async function safeIncr(redis: RedisLike, key: string, ttlSec: number): Promise<number> {
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, ttlSec);
    return count;
  } catch (err) {
    throw new RedisUnavailableError(err);
  }
}

async function safeGet(redis: RedisLike, key: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch (err) {
    throw new RedisUnavailableError(err);
  }
}

export interface LimitCheck {
  ok: boolean;
  retryAfterSeconds?: number;
}

export async function checkRequestCodeLimit(redis: RedisLike, ip: string, email: string): Promise<LimitCheck> {
  const cap = requestCap();
  const emailKey = `portal:ratelimit:req:email:${hashEmail(email)}`;
  const ipKey = `portal:ratelimit:req:ip:${ip}`;
  const [byEmail, byIp] = await Promise.all([safeGet(redis, emailKey), safeGet(redis, ipKey)]);
  const emailCount = byEmail ? parseInt(byEmail, 10) : 0;
  const ipCount = byIp ? parseInt(byIp, 10) : 0;
  if (emailCount >= cap || ipCount >= cap) {
    return { ok: false, retryAfterSeconds: 60 };
  }
  return { ok: true };
}

export async function recordRequestCode(redis: RedisLike, ip: string, email: string): Promise<void> {
  const emailKey = `portal:ratelimit:req:email:${hashEmail(email)}`;
  const ipKey = `portal:ratelimit:req:ip:${ip}`;
  await Promise.all([safeIncr(redis, emailKey, 60), safeIncr(redis, ipKey, 60)]);
}

export async function checkVerifyLimit(redis: RedisLike, ip: string, verificationId: string): Promise<LimitCheck> {
  const cap = verifyCap();
  const key = `portal:ratelimit:verify:${verificationId}`;
  const ipKey = `portal:ratelimit:verify:ip:${ip}`;
  const [byId, byIp] = await Promise.all([safeGet(redis, key), safeGet(redis, ipKey)]);
  if ((byId ? parseInt(byId, 10) : 0) >= cap) return { ok: false, retryAfterSeconds: 60 };
  if ((byIp ? parseInt(byIp, 10) : 0) >= cap * 4) return { ok: false, retryAfterSeconds: 60 };
  return { ok: true };
}

export async function recordVerifyFailure(redis: RedisLike, ip: string, verificationId: string): Promise<number> {
  const key = `portal:ratelimit:verify:${verificationId}`;
  const ipKey = `portal:ratelimit:verify:ip:${ip}`;
  const [count] = await Promise.all([safeIncr(redis, key, 60), safeIncr(redis, ipKey, 60)]);
  return count;
}
