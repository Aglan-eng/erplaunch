import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import { portalRoutes } from '../../src/routes/portal.js';
import { firmBrandingRoutes } from '../../src/routes/firmBranding.js';
import { getDb, DEFAULT_BRANDING } from '../../src/db/index.js';

const JWT_SECRET = 'test-firm-branding-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  // Portal jwt namespace is a prereq for portalRoutes to load without error.
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'test-portal-secret-for-branding-suite',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(firmBrandingRoutes, { prefix: '/api/v1' });
  await f.register(portalRoutes, { prefix: '/api/v1' });
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

async function seedFirmAndUser() {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Unbranded Firm', `unbranded-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Test User', passwordHash, 'CONSULTANT', now],
  });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Test User', email: `${userId}@example.com` });
  return { firmId, userId, token };
}

describe('GET /api/v1/firm/branding', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/firm/branding' });
    expect(res.statusCode).toBe(401);
  });

  it('returns defaults for a firm that has never been branded', async () => {
    const { token } = await seedFirmAndUser();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/branding',
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: typeof DEFAULT_BRANDING };
    // displayName falls back to Firm.name which was "Unbranded Firm" at seed
    expect(body.data.displayName).toBe('Unbranded Firm');
    expect(body.data.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
  });
});

describe('PATCH /api/v1/firm/branding', () => {
  it('updates displayName + colors + supportEmail and returns the new branding', async () => {
    const { token } = await seedFirmAndUser();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/branding',
      cookies: { token },
      payload: {
        displayName: 'Acme Advisory',
        primaryColor: '#0ea5e9',
        secondaryColor: '#38bdf8',
        supportEmail: 'hello@acme.example',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { displayName: string; primaryColor: string; secondaryColor: string; supportEmail: string } };
    expect(body.data.displayName).toBe('Acme Advisory');
    expect(body.data.primaryColor).toBe('#0ea5e9');
    expect(body.data.secondaryColor).toBe('#38bdf8');
    expect(body.data.supportEmail).toBe('hello@acme.example');
  });

  it('rejects invalid color hex format', async () => {
    const { token } = await seedFirmAndUser();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/branding',
      cookies: { token },
      payload: { primaryColor: 'rebeccapurple' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid support email', async () => {
    const { token } = await seedFirmAndUser();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/branding',
      cookies: { token },
      payload: { supportEmail: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/branding',
      payload: { displayName: 'No Auth' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('public portal endpoint picks up the new branding', async () => {
    const { firmId, token: consultantToken } = await seedFirmAndUser();
    // Create an engagement on this firm so the portal endpoint has something
    // to return.
    const db = getDb();
    const engagementId = createId();
    const tokenId = createId();
    const portalToken = `branding-portal-${createId()}`;
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
            VALUES (?,?,?,?,?,?)`,
      args: [engagementId, firmId, 'Branding Client', 'DISCOVERY', now, now],
    });
    await db.execute({
      sql: `INSERT INTO ClientPortalToken (id, engagementId, token, createdAt) VALUES (?,?,?,?)`,
      args: [tokenId, engagementId, portalToken, now],
    });

    await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/branding',
      cookies: { token: consultantToken },
      payload: {
        displayName: 'Branded Advisory',
        primaryColor: '#111111',
      },
    });

    const portalRes = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${portalToken}`,
    });
    expect(portalRes.statusCode).toBe(200);
    const body = portalRes.json() as { data: { branding: { displayName: string; primaryColor: string } } };
    expect(body.data.branding.displayName).toBe('Branded Advisory');
    expect(body.data.branding.primaryColor).toBe('#111111');
  });
});
