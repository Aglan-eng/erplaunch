import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { setupTestDb } from '../_helpers/testDb.js';
import { authRoutes } from '../../src/routes/auth.js';

let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: 'test-register-suite-secret', cookie: { cookieName: 'token', signed: false } });
  await f.register(authRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
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

// Reset any in-memory rate-limit state in between — the route uses Redis, not
// registered in this harness, so it's fail-open. This just keeps each test
// independent if we ever add a memory fallback.
beforeEach(() => {});

const BASE = {
  firmName: 'Acme Advisory',
  firmSlug: 'acme-advisory',
  adminName: 'Jordan Chen',
  adminEmail: 'jordan@acme.example',
  password: 'correct-horse-battery',
};

function payloadWith(overrides: Partial<typeof BASE> = {}) {
  return { ...BASE, ...overrides };
}

describe('POST /api/v1/auth/register — happy path', () => {
  it('creates firm + admin user, sets token cookie, returns user shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: payloadWith({ firmSlug: 'happy-firm', adminEmail: 'happy@example.com' }),
    });
    expect(res.statusCode).toBe(201);

    const body = res.json() as { data: { user: { id: string; email: string; role: string; firmId: string; firm: { id: string; name: string; slug: string } } } };
    expect(body.data.user.email).toBe('happy@example.com');
    expect(body.data.user.role).toBe('CONSULTANT');
    expect(body.data.user.firm.name).toBe('Acme Advisory');
    expect(body.data.user.firm.slug).toBe('happy-firm');
    expect(body.data.user.firmId).toBe(body.data.user.firm.id);

    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie ?? '');
    expect(cookieStr).toMatch(/token=/);
    expect(cookieStr).toMatch(/HttpOnly/i);
  });

  it('subsequent login with the same credentials works', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: payloadWith({ firmSlug: 'loginable-firm', adminEmail: 'loginable@example.com' }),
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'loginable@example.com', password: BASE.password },
    });
    expect(loginRes.statusCode).toBe(200);
  });
});

describe('POST /api/v1/auth/register — uniqueness', () => {
  it('rejects duplicate firm slug with 409', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: payloadWith({ firmSlug: 'dup-slug', adminEmail: 'first@example.com' }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: payloadWith({ firmSlug: 'dup-slug', adminEmail: 'second@example.com' }),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('SLUG_TAKEN');
  });

  it('rejects duplicate admin email with 409', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: payloadWith({ firmSlug: 'unique-slug-a', adminEmail: 'dup@example.com' }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: payloadWith({ firmSlug: 'unique-slug-b', adminEmail: 'dup@example.com' }),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('EMAIL_TAKEN');
  });
});

describe('POST /api/v1/auth/register — validation', () => {
  it('normalises slug uppercase to lowercase and accepts (UX nicety)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: payloadWith({ firmSlug: 'MixedCaseSlug', adminEmail: 'mixed@example.com' }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { user: { firm: { slug: string } } } };
    expect(body.data.user.firm.slug).toBe('mixedcaseslug');
  });

  it.each([
    { case: 'slug too short', payload: payloadWith({ firmSlug: 'ab' }) },
    { case: 'slug leading dash', payload: payloadWith({ firmSlug: '-bad' }) },
    { case: 'slug trailing dash', payload: payloadWith({ firmSlug: 'bad-' }) },
    { case: 'slug double dash', payload: payloadWith({ firmSlug: 'bad--slug' }) },
    { case: 'slug with space', payload: payloadWith({ firmSlug: 'bad slug' }) },
    { case: 'password too short', payload: payloadWith({ password: 'abc123' }) },
    { case: 'invalid email', payload: payloadWith({ adminEmail: 'not-an-email' }) },
    { case: 'empty firm name', payload: payloadWith({ firmName: '' }) },
    { case: 'empty admin name', payload: payloadWith({ adminName: '' }) },
  ])('rejects: $case', async ({ payload }) => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
    expect(res.statusCode).toBe(400);
  });

  it('rejects reserved slugs (admin/api/www/...)', async () => {
    for (const reserved of ['admin', 'api', 'www', 'app', 'root']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: payloadWith({ firmSlug: reserved, adminEmail: `x+${reserved}@example.com` }),
      });
      expect(res.statusCode, `slug "${reserved}" should be rejected`).toBe(400);
    }
  });

  it('normalises email case for uniqueness check', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: payloadWith({ firmSlug: 'caseless-a', adminEmail: 'Case@Example.com' }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: payloadWith({ firmSlug: 'caseless-b', adminEmail: 'case@example.com' }),
    });
    expect(res.statusCode).toBe(409);
  });
});
