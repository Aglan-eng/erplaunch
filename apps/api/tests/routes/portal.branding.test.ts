import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import { portalRoutes } from '../../src/routes/portal.js';
import { DEFAULT_BRANDING } from '../../src/db/firmBranding.js';
import { getDb } from '../../src/db/index.js';

let cleanup: () => void;
let app: FastifyInstance;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;

  app = Fastify({ logger: false });
  // Portal routes mix consultant-auth-required and public endpoints. We only
  // need to exercise the public GET /engagements/portal/:token in this suite.
  // The authenticate middleware is imported from ../middleware/auth inside the
  // route module; it is never invoked for the public route we are testing.
  await app.register(portalRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

describe('GET /engagements/portal/:token — branding block', () => {
  it('includes a branding block in the response', async () => {
    const { token } = await seedEngagementWithToken({ firmName: 'Shell Co' });

    const res = await app.inject({ method: 'GET', url: `/engagements/portal/${token}` });
    expect(res.statusCode).toBe(200);

    const body = res.json() as { data: { branding: Record<string, unknown> } };
    expect(body.data.branding).toBeDefined();
    expect(body.data.branding.displayName).toBe('Shell Co');
  });

  it('displayName falls back to Firm.name when displayName is null', async () => {
    const { token } = await seedEngagementWithToken({ firmName: 'Fallback Firm' });

    const res = await app.inject({ method: 'GET', url: `/engagements/portal/${token}` });
    const body = res.json() as { data: { branding: { displayName: string } } };
    expect(body.data.branding.displayName).toBe('Fallback Firm');
  });

  it('primaryColor falls back to platform default when null', async () => {
    const { token } = await seedEngagementWithToken();

    const res = await app.inject({ method: 'GET', url: `/engagements/portal/${token}` });
    const body = res.json() as { data: { branding: { primaryColor: string; secondaryColor: string } } };
    expect(body.data.branding.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
    expect(body.data.branding.secondaryColor).toBe(DEFAULT_BRANDING.secondaryColor);
  });

  it('returns stored branding values when the firm has configured them', async () => {
    const { token, firmId } = await seedEngagementWithToken({ firmName: 'Styled Firm' });

    const db = getDb();
    await db.execute({
      sql: `UPDATE Firm SET displayName = ?, logoUrl = ?, primaryColor = ?, secondaryColor = ?, supportEmail = ? WHERE id = ?`,
      args: ['Styled Portal', '/u/logo.png', '#112233', '#445566', 'help@styled.example', firmId],
    });

    const res = await app.inject({ method: 'GET', url: `/engagements/portal/${token}` });
    const body = res.json() as { data: { branding: Record<string, unknown> } };
    expect(body.data.branding.displayName).toBe('Styled Portal');
    expect(body.data.branding.logoUrl).toBe('/u/logo.png');
    expect(body.data.branding.primaryColor).toBe('#112233');
    expect(body.data.branding.secondaryColor).toBe('#445566');
    expect(body.data.branding.supportEmail).toBe('help@styled.example');
  });

  it('returns 404 for unknown tokens (branding block has no bearing on miss)', async () => {
    const res = await app.inject({ method: 'GET', url: '/engagements/portal/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Phase 27 — lightweight pre-auth branding endpoint ─────────────────────

describe('GET /engagements/portal/:token/branding (Phase 27)', () => {
  it('returns 200 with branding + clientName for a valid token', async () => {
    const { token } = await seedEngagementWithToken({ firmName: 'Acme Consulting' });

    const res = await app.inject({
      method: 'GET',
      url: `/engagements/portal/${token}/branding`,
    });
    expect(res.statusCode).toBe(200);

    const body = res.json() as {
      data: { branding: Record<string, unknown>; clientName: string };
    };
    expect(body.data.branding).toBeDefined();
    expect(body.data.branding.displayName).toBe('Acme Consulting');
    expect(body.data.clientName).toBeDefined();
    expect(typeof body.data.clientName).toBe('string');
  });

  it('returns 404 for unknown tokens', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/engagements/portal/does-not-exist/branding',
    });
    expect(res.statusCode).toBe(404);
  });

  it('branding shape matches the post-auth endpoint contract', async () => {
    const { token } = await seedEngagementWithToken({ firmName: 'Shape Test' });

    const res = await app.inject({
      method: 'GET',
      url: `/engagements/portal/${token}/branding`,
    });
    const body = res.json() as {
      data: {
        branding: {
          displayName: string;
          logoUrl: string | null;
          primaryColor: string;
          secondaryColor: string;
          supportEmail: string | null;
        };
      };
    };
    // Contract: displayName / primaryColor / secondaryColor always populated;
    // logoUrl + supportEmail may be null.
    expect(typeof body.data.branding.displayName).toBe('string');
    expect(typeof body.data.branding.primaryColor).toBe('string');
    expect(typeof body.data.branding.secondaryColor).toBe('string');
    expect(['string', 'object']).toContain(typeof body.data.branding.logoUrl); // null is 'object'
    expect(['string', 'object']).toContain(typeof body.data.branding.supportEmail);
  });

  it('returns custom branding when the firm has configured it', async () => {
    const { token, firmId } = await seedEngagementWithToken({ firmName: 'Pre-auth Test' });

    const db = getDb();
    await db.execute({
      sql: `UPDATE Firm SET displayName = ?, logoUrl = ?, primaryColor = ?, secondaryColor = ?, supportEmail = ? WHERE id = ?`,
      args: [
        'Pre-auth Display',
        '/u/preauth.png',
        '#aabbcc',
        '#ddeeff',
        'preauth@example.test',
        firmId,
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/engagements/portal/${token}/branding`,
    });
    const body = res.json() as { data: { branding: Record<string, unknown> } };
    expect(body.data.branding.displayName).toBe('Pre-auth Display');
    expect(body.data.branding.logoUrl).toBe('/u/preauth.png');
    expect(body.data.branding.primaryColor).toBe('#aabbcc');
    expect(body.data.branding.secondaryColor).toBe('#ddeeff');
    expect(body.data.branding.supportEmail).toBe('preauth@example.test');
  });

  it('does not require auth (pre-auth surface — magic-link request page hits it)', async () => {
    const { token } = await seedEngagementWithToken({ firmName: 'No-Auth Test' });

    // No Authorization header, no portal_token cookie — must still 200.
    const res = await app.inject({
      method: 'GET',
      url: `/engagements/portal/${token}/branding`,
    });
    expect(res.statusCode).toBe(200);
  });
});
