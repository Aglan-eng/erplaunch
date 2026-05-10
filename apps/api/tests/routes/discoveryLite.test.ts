/**
 * Phase 46.2 — integration tests for the Discovery Lite routes.
 *
 * Covers:
 *   - GET returns the question catalog + a default record when no
 *     answers exist yet
 *   - PUT validates + persists; bad values 400
 *   - POST /complete refuses when required answers are missing
 *   - POST /share-token mints a token; GET via that token returns the
 *     same catalog without exposing the token itself; PUT via token
 *     persists answers; refuses after the questionnaire is completed
 *   - DELETE /share-token revokes the link
 *   - Pipeline column derivation: PROSPECT becomes QUALIFIED when
 *     answers exist, DISCOVERY_LITE when complete
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { discoveryLiteRoutes } from '../../src/routes/discoveryLite.js';
import { salesPipelineRoutes } from '../../src/routes/salesPipeline.js';
import { getDb, bootstrapFirmAdmin } from '../../src/db/index.js';
import { REQUIRED_QUESTION_IDS, DISCOVERY_LITE_QUESTIONS } from '../../src/services/discoveryLiteCatalog.js';

const JWT_SECRET = 'discovery-lite-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'portal-discovery-lite-test',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(discoveryLiteRoutes, { prefix: '/api/v1' });
  await f.register(salesPipelineRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  engagementId: string;
  adminToken: string;
}

async function seed(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'DL Firm', `dl-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Acme Co', 'PROSPECT', now, now],
  });
  const passwordHash = await bcrypt.hash('x', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, userId, passwordHash, 'CONSULTANT'],
  });
  await bootstrapFirmAdmin({ firmId, userId });
  const adminToken = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: userId, email: `${userId}@example.com` });
  return { firmId, engagementId, adminToken };
}

/** Helper — produce a "fully filled" answers blob using the catalog. */
function fullAnswers(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of REQUIRED_QUESTION_IDS) {
    const q = DISCOVERY_LITE_QUESTIONS.find((x) => x.id === id);
    if (q?.type === 'multi_select') {
      const opts = q.options ?? [{ value: 'placeholder', label: 'placeholder' }];
      out[id] = [opts[0].value];
    } else if (q?.type === 'single_select') {
      const opts = q.options ?? [{ value: 'placeholder', label: 'placeholder' }];
      out[id] = opts[0].value;
    } else if (q?.type === 'number') {
      out[id] = q.min ?? 1;
    } else {
      out[id] = 'filled';
    }
  }
  return out;
}

beforeAll(async () => {
  ({ cleanup } = await setupTestDb());
  app = await buildTestApp();
});
afterAll(async () => {
  await app.close();
  cleanup();
});
beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM EngagementDiscoveryLite`);
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM RoleAuditLog`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM FirmRole`);
  await db.execute(`DELETE FROM LicenseProfile`);
  await db.execute(`DELETE FROM BusinessProfile`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /engagements/:id/discovery-lite', () => {
  it('returns the catalog + an empty default record', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      data: {
        questions: Array<{ id: string }>;
        record: { answers: Record<string, unknown>; completedAt: null };
      };
    };
    expect(body.data.questions.length).toBeGreaterThan(0);
    expect(body.data.record.answers).toEqual({});
    expect(body.data.record.completedAt).toBeNull();
  });
});

// ─── PUT ─────────────────────────────────────────────────────────────────────

describe('PUT /engagements/:id/discovery-lite', () => {
  it('persists a partial answer set', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: {
        answers: {
          'companySize.employees': '26-100',
          'company.industry': 'saas',
        },
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { answers: Record<string, unknown> } };
    expect(body.data.answers['companySize.employees']).toBe('26-100');
    expect(body.data.answers['company.industry']).toBe('saas');
  });

  it('rejects an invalid select value with 400', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { answers: { 'companySize.employees': 'a-trillion' } },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { field: string } }).error.field).toBe('companySize.employees');
  });

  it('drops unknown question ids silently', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: {
        answers: {
          'companySize.employees': '26-100',
          'does.not.exist': 'whatever',
        },
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { answers: Record<string, unknown> } };
    expect(body.data.answers['does.not.exist']).toBeUndefined();
    expect(body.data.answers['companySize.employees']).toBe('26-100');
  });
});

// ─── POST /complete ──────────────────────────────────────────────────────────

describe('POST /engagements/:id/discovery-lite/complete', () => {
  it('refuses when required answers are missing', async () => {
    const f = await seed();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { answers: { 'companySize.employees': '26-100' } },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite/complete`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(409);
    const body = r.json() as { error: { code: string; missingFields: string[] } };
    expect(body.error.code).toBe('INCOMPLETE');
    expect(body.error.missingFields.length).toBeGreaterThan(0);
  });

  it('marks complete + writes activity entry when every required answer is set', async () => {
    const f = await seed();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { answers: fullAnswers() },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite/complete`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { completedAt: string } };
    expect(body.data.completedAt).toBeTruthy();
    const log = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    expect(log.rows.map((r2) => (r2 as unknown as { action: string }).action)).toContain('DISCOVERY_LITE_COMPLETED');
  });

  it('refuses when no Discovery Lite row exists yet', async () => {
    const f = await seed();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite/complete`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('NOT_STARTED');
  });
});

// ─── Self-serve token flow ──────────────────────────────────────────────────

describe('Self-serve magic-link flow', () => {
  it('mint token + GET via token + PUT via token + complete', async () => {
    const f = await seed();
    // Mint
    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite/share-token`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const token = (tokenRes.json() as { data: { token: string } }).data.token;
    expect(token).toBeTruthy();

    // GET via token (no auth)
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/discovery-lite/${token}`,
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json() as {
      data: { questions: Array<{ id: string }>; clientName: string; answers: Record<string, unknown> };
    };
    expect(getBody.data.questions.length).toBeGreaterThan(0);
    expect(getBody.data.clientName).toBe('Acme Co');

    // PUT via token
    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/discovery-lite/${token}`,
      payload: { answers: fullAnswers() },
    });
    expect(putRes.statusCode).toBe(200);

    // Complete via token
    const compRes = await app.inject({
      method: 'POST',
      url: `/api/v1/discovery-lite/${token}/complete`,
    });
    expect(compRes.statusCode).toBe(200);

    // PUT after complete should refuse
    const putAfter = await app.inject({
      method: 'PUT',
      url: `/api/v1/discovery-lite/${token}`,
      payload: { answers: { 'companySize.employees': '26-100' } },
    });
    expect(putAfter.statusCode).toBe(409);
    expect((putAfter.json() as { error: { code: string } }).error.code).toBe('ALREADY_COMPLETED');
  });

  it('GET on an unknown token returns 404', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/discovery-lite/never-issued-token`,
    });
    expect(r.statusCode).toBe(404);
  });

  // Phase 48.4 — branding + sales-rep name on the token GET response.
  // Ensures the portal page can render the firm's logo / colours and
  // name the assigned rep on the confirmation screen.
  it('returns branding + salesRepName on the token GET response (Phase 48.4)', async () => {
    const f = await seed();
    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite/share-token`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const token = (tokenRes.json() as { data: { token: string } }).data.token;
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/discovery-lite/${token}`,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      data: {
        branding: { displayName: string; primaryColor: string } | null;
        salesRepName: string | null;
      };
    };
    expect(body.data.branding).not.toBeNull();
    expect(body.data.branding?.displayName).toBeTruthy();
    expect(body.data.branding?.primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    // No sales rep was assigned in the seed fixture, so this is null —
    // confirms the field is present in the response shape regardless.
    expect(body.data.salesRepName).toBeNull();
  });

  it('DELETE share-token revokes the link', async () => {
    const f = await seed();
    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite/share-token`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const token = (tokenRes.json() as { data: { token: string } }).data.token;
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite/share-token`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/discovery-lite/${token}`,
    });
    expect(r.statusCode).toBe(404);
  });
});

// ─── Phase 46.8.2 — sales-rep notification on portal complete ──────────────

describe('Self-serve completion notifies the assigned sales rep', () => {
  it('GETs OK, completes via the same token, and writes the activity entry', async () => {
    // We verify the notification is dispatched without coupling to
    // an SMTP transport — the test environment uses the dev console
    // fallback. The key behaviour the test pins is that the route
    // doesn't reject submission when the rep lookup fails (best-
    // effort guarantee) and that the activity entry still lands.
    const f = await seed();
    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite/share-token`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const token = (tokenRes.json() as { data: { token: string } }).data.token;

    // No assigned rep on this engagement — the notification path
    // falls back to firm-level SALES_MANAGERs (none seeded). The
    // route should succeed silently.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/discovery-lite/${token}`,
      payload: { answers: fullAnswers() },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/discovery-lite/${token}/complete`,
    });
    expect(r.statusCode).toBe(200);

    const log = await getDb().execute({
      sql: `SELECT action, details FROM ActivityLog WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    const row = log.rows.find(
      (r2) => (r2 as unknown as { action: string }).action === 'DISCOVERY_LITE_COMPLETED',
    );
    expect(row).toBeTruthy();
    expect((row as unknown as { details: string }).details).toContain('Self-serve');
  });

  it('still completes when no recipient + no rep is configured', async () => {
    const f = await seed();
    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite/share-token`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    const token = (tokenRes.json() as { data: { token: string } }).data.token;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/discovery-lite/${token}`,
      payload: { answers: fullAnswers() },
    });
    // Even with no rep + no SALES_MANAGER, complete returns 200.
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/discovery-lite/${token}/complete`,
    });
    expect(r.statusCode).toBe(200);
  });
});

// ─── Pipeline column derivation ─────────────────────────────────────────────

describe('Pipeline column derivation reflects DiscoveryLite state', () => {
  it('PROSPECT with no answers → NEW; with answers → QUALIFIED; complete → DISCOVERY_LITE', async () => {
    const f = await seed();
    // No answers — should be NEW.
    let pipeline = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/pipeline',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    let body = pipeline.json() as { data: Array<{ id: string; column: string }> };
    expect(body.data.find((d) => d.id === f.engagementId)?.column).toBe('NEW');

    // Add some answers — moves to QUALIFIED.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { answers: { 'companySize.employees': '26-100' } },
    });
    pipeline = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/pipeline',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    body = pipeline.json() as { data: Array<{ id: string; column: string }> };
    expect(body.data.find((d) => d.id === f.engagementId)?.column).toBe('QUALIFIED');

    // Complete the questionnaire — moves to DISCOVERY_LITE column.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite`,
      headers: { authorization: `Bearer ${f.adminToken}` },
      payload: { answers: fullAnswers() },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/discovery-lite/complete`,
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    pipeline = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/pipeline',
      headers: { authorization: `Bearer ${f.adminToken}` },
    });
    body = pipeline.json() as { data: Array<{ id: string; column: string }> };
    expect(body.data.find((d) => d.id === f.engagementId)?.column).toBe('DISCOVERY_LITE');
  });
});
