import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRequestCodeLimit,
  recordRequestCode,
  checkVerifyLimit,
  recordVerifyFailure,
  RedisUnavailableError,
  type RedisLike,
} from '../../src/services/portalRateLimit.js';

/** Tiny in-memory Redis fake that supports the subset we use. */
class FakeRedis implements RedisLike {
  private store = new Map<string, { value: string; expiresAt?: number }>();
  public fail = false;

  async incr(key: string): Promise<number> {
    if (this.fail) throw new Error('redis down');
    const row = this.store.get(key);
    const current = row && (!row.expiresAt || row.expiresAt >= Date.now()) ? row.value : null;
    const next = (current ? parseInt(current, 10) : 0) + 1;
    this.store.set(key, { value: String(next), expiresAt: row?.expiresAt });
    return next;
  }
  async expire(key: string, seconds: number): Promise<number> {
    if (this.fail) throw new Error('redis down');
    const row = this.store.get(key);
    if (!row) return 0;
    row.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }
  async get(key: string): Promise<string | null> {
    if (this.fail) throw new Error('redis down');
    const row = this.store.get(key);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return row.value;
  }
  async del(key: string): Promise<number> {
    if (this.fail) throw new Error('redis down');
    return this.store.delete(key) ? 1 : 0;
  }
}

let redis: FakeRedis;

beforeEach(() => {
  redis = new FakeRedis();
  delete process.env.PORTAL_AUTH_RATELIMIT_REQUEST_PER_MIN;
  delete process.env.PORTAL_AUTH_RATELIMIT_VERIFY_PER_MIN;
});

describe('portalRateLimit: checkRequestCodeLimit', () => {
  it('permits first N requests within window, blocks N+1 by IP', async () => {
    process.env.PORTAL_AUTH_RATELIMIT_REQUEST_PER_MIN = '3';
    for (let i = 0; i < 3; i++) {
      const r = await checkRequestCodeLimit(redis, '1.2.3.4', 'a@b.com');
      expect(r.ok).toBe(true);
      await recordRequestCode(redis, '1.2.3.4', 'a@b.com');
    }
    const fourth = await checkRequestCodeLimit(redis, '1.2.3.4', 'a@b.com');
    expect(fourth.ok).toBe(false);
  });

  it('blocks by email across different IPs', async () => {
    process.env.PORTAL_AUTH_RATELIMIT_REQUEST_PER_MIN = '2';
    await recordRequestCode(redis, '1.1.1.1', 'shared@b.com');
    await recordRequestCode(redis, '2.2.2.2', 'shared@b.com');
    const blocked = await checkRequestCodeLimit(redis, '3.3.3.3', 'shared@b.com');
    expect(blocked.ok).toBe(false);
  });

  it('normalises email for the counter key (case-insensitive)', async () => {
    process.env.PORTAL_AUTH_RATELIMIT_REQUEST_PER_MIN = '2';
    await recordRequestCode(redis, '1.1.1.1', 'Mixed@B.COM');
    await recordRequestCode(redis, '1.1.1.1', 'mixed@b.com');
    const blocked = await checkRequestCodeLimit(redis, '9.9.9.9', 'MIXED@b.com');
    expect(blocked.ok).toBe(false);
  });

  it('throws RedisUnavailableError when redis rejects', async () => {
    redis.fail = true;
    await expect(checkRequestCodeLimit(redis, '1.1.1.1', 'r@b.com')).rejects.toBeInstanceOf(RedisUnavailableError);
  });
});

describe('portalRateLimit: verify counter', () => {
  it('recordVerifyFailure increments and returns count', async () => {
    const a = await recordVerifyFailure(redis, '1.1.1.1', 'sid-1');
    const b = await recordVerifyFailure(redis, '1.1.1.1', 'sid-1');
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('checkVerifyLimit blocks once count hits configured max', async () => {
    process.env.PORTAL_AUTH_RATELIMIT_VERIFY_PER_MIN = '2';
    await recordVerifyFailure(redis, '1.1.1.1', 'sid-2');
    await recordVerifyFailure(redis, '1.1.1.1', 'sid-2');
    const r = await checkVerifyLimit(redis, '1.1.1.1', 'sid-2');
    expect(r.ok).toBe(false);
  });
});
