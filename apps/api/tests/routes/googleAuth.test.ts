import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { setupTestDb } from '../_helpers/testDb.js';
import { googleAuthRoutes, isGoogleAuthConfigured } from '../../src/routes/googleAuth.js';

/**
 * Phase 2 — Google OAuth route tests.
 *
 * Two layers:
 *
 * 1. Unconfigured behaviour. When GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL
 *    are missing, the module must register only the /available probe and
 *    NOT crash on boot. This test runs without those env vars set.
 *
 * 2. Configured probe. When the env is present, /available returns
 *    {available: true}.
 *
 * The actual OAuth handshake is not exercised here — the token exchange
 * requires a real authorization code from Google. Branch coverage of the
 * sign-in resolution lives in `tests/services/googleAuthService.test.ts`,
 * which we already have. The full happy path is verified manually
 * against prod after the Render env vars are saved (Phase 4).
 */

describe('googleAuthRoutes — unconfigured (no env)', () => {
  const original = {
    id: process.env.GOOGLE_CLIENT_ID,
    secret: process.env.GOOGLE_CLIENT_SECRET,
    callback: process.env.GOOGLE_CALLBACK_URL,
  };
  let app: FastifyInstance;
  let cleanup: () => void;

  beforeAll(async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CALLBACK_URL;
    process.env.ERPLAUNCH_MASTER_KEY = 'a'.repeat(64);

    const setup = await setupTestDb();
    cleanup = setup.cleanup;

    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(jwt, { secret: 'test', cookie: { cookieName: 'token', signed: false } });
    await app.register(googleAuthRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    cleanup();
    if (original.id !== undefined) process.env.GOOGLE_CLIENT_ID = original.id; else delete process.env.GOOGLE_CLIENT_ID;
    if (original.secret !== undefined) process.env.GOOGLE_CLIENT_SECRET = original.secret; else delete process.env.GOOGLE_CLIENT_SECRET;
    if (original.callback !== undefined) process.env.GOOGLE_CALLBACK_URL = original.callback; else delete process.env.GOOGLE_CALLBACK_URL;
  });

  it('isGoogleAuthConfigured() returns false', () => {
    expect(isGoogleAuthConfigured()).toBe(false);
  });

  it('does not register /auth/google/start when env is missing', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' });
    expect(r.statusCode).toBe(404);
  });

  it('does not register /auth/google/callback when env is missing', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/auth/google/callback' });
    expect(r.statusCode).toBe(404);
  });

  it('exposes /auth/google/available with available=false so the UI can hide the button', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/auth/google/available' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ data: { available: false } });
  });
});

describe('googleAuthRoutes — configured (env present)', () => {
  const original = {
    id: process.env.GOOGLE_CLIENT_ID,
    secret: process.env.GOOGLE_CLIENT_SECRET,
    callback: process.env.GOOGLE_CALLBACK_URL,
  };
  let app: FastifyInstance;
  let cleanup: () => void;

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret-not-real';
    process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/v1/auth/google/callback';
    process.env.ERPLAUNCH_MASTER_KEY = 'a'.repeat(64);

    const setup = await setupTestDb();
    cleanup = setup.cleanup;

    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(jwt, { secret: 'test', cookie: { cookieName: 'token', signed: false } });
    await app.register(googleAuthRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    cleanup();
    if (original.id !== undefined) process.env.GOOGLE_CLIENT_ID = original.id; else delete process.env.GOOGLE_CLIENT_ID;
    if (original.secret !== undefined) process.env.GOOGLE_CLIENT_SECRET = original.secret; else delete process.env.GOOGLE_CLIENT_SECRET;
    if (original.callback !== undefined) process.env.GOOGLE_CALLBACK_URL = original.callback; else delete process.env.GOOGLE_CALLBACK_URL;
  });

  it('isGoogleAuthConfigured() returns true', () => {
    expect(isGoogleAuthConfigured()).toBe(true);
  });

  it('exposes /auth/google/available with available=true', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/auth/google/available' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ data: { available: true } });
  });

  it('/auth/google/start redirects (302) towards Google when env is configured', async () => {
    // We don't assert the full URL — @fastify/oauth2 generates a state
    // token that varies per request. Asserting the host + redirect
    // status is enough proof the plugin registered correctly.
    const r = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' });
    expect([302, 303]).toContain(r.statusCode);
    expect(r.headers.location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  });
});
