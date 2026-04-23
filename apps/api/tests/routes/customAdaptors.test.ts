import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { customAdaptorRoutes } from '../../src/routes/customAdaptors.js';
import {
  getDb,
  savePlatformAdaptorDraft,
  publishCustomAdaptor,
  findCustomAdaptorById,
} from '../../src/db/index.js';

const JWT_SECRET = 'test-custom-adaptors-suite-secret';

let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });
  await f.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  await f.register(customAdaptorRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

/** Seed a firm + user + return a signed consultant JWT for that user. */
async function seedFirmAndToken(firmName = 'Test Firm'): Promise<{ firmId: string; userId: string; token: string }> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const slug = `firm-${createId().slice(0, 8)}`;
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, firmName, slug, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Tester', 'not-used', 'CONSULTANT', now],
  });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Tester', email: `${userId}@example.com` });
  return { firmId, userId, token };
}

function authHeaders(token: string): Record<string, string> {
  return { cookie: `token=${token}` };
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

// Don't need to purge between tests — each call uses a fresh firmId to keep
// state isolated.
beforeEach(() => {});

// ─── Auth ────────────────────────────────────────────────────────────────────

describe('GET /custom-adaptors — auth', () => {
  it('returns 401 without a JWT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/custom-adaptors' });
    expect(res.statusCode).toBe(401);
  });
});

// ─── Create + list + get ─────────────────────────────────────────────────────

describe('POST /custom-adaptors', () => {
  it('creates a DRAFT adaptor with the firm id scoped from the JWT', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-adaptors',
      headers: authHeaders(token),
      payload: { name: 'MyFactoryERP', slug: 'myfactory' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string; firmId: string; status: string; name: string; slug: string } };
    expect(body.data.firmId).toBe(firmId);
    expect(body.data.status).toBe('DRAFT');
    expect(body.data.name).toBe('MyFactoryERP');
    expect(body.data.slug).toBe('myfactory');
  });

  it('rejects reserved slugs that would collide with built-in adaptors (SLUG_RESERVED)', async () => {
    const { token } = await seedFirmAndToken();
    for (const blocked of ['netsuite', 'odoo', 'sap', 'oracle-fusion']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/custom-adaptors',
        headers: authHeaders(token),
        payload: { name: `Reserved ${blocked}`, slug: blocked },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('SLUG_RESERVED');
    }
  });

  it('rejects duplicate slug within the same firm (SLUG_TAKEN, 409)', async () => {
    const { token } = await seedFirmAndToken();
    await app.inject({
      method: 'POST',
      url: '/api/v1/custom-adaptors',
      headers: authHeaders(token),
      payload: { name: 'First', slug: 'dup-slug' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-adaptors',
      headers: authHeaders(token),
      payload: { name: 'Second', slug: 'dup-slug' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SLUG_TAKEN');
  });

  it('allows the same slug across different firms (multi-tenant isolation)', async () => {
    const a = await seedFirmAndToken('Firm A');
    const b = await seedFirmAndToken('Firm B');
    const ra = await app.inject({
      method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(a.token), payload: { name: 'Shared', slug: 'shared' },
    });
    const rb = await app.inject({
      method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(b.token), payload: { name: 'Shared', slug: 'shared' },
    });
    expect(ra.statusCode).toBe(201);
    expect(rb.statusCode).toBe(201);
  });

  it('rejects malformed payloads (VALIDATION_ERROR)', async () => {
    const { token } = await seedFirmAndToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-adaptors',
      headers: authHeaders(token),
      payload: { name: 'X', slug: 'has CAPITALS' }, // bad slug
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /custom-adaptors', () => {
  it('lists only the caller firm\'s adaptors, excluding ARCHIVED rows', async () => {
    const { token } = await seedFirmAndToken();
    await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors', headers: authHeaders(token),
      payload: { name: 'Alpha', slug: 'alpha' } });
    await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors', headers: authHeaders(token),
      payload: { name: 'Bravo', slug: 'bravo' } });

    const res = await app.inject({ method: 'GET', url: '/api/v1/custom-adaptors', headers: authHeaders(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ slug: string }> };
    const slugs = body.data.map((r) => r.slug).sort();
    expect(slugs).toEqual(['alpha', 'bravo']);
  });

  it('never returns adaptors belonging to another firm', async () => {
    const a = await seedFirmAndToken('Firm A');
    const b = await seedFirmAndToken('Firm B');
    await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(a.token), payload: { name: 'OnlyA', slug: 'only-a' } });

    const res = await app.inject({ method: 'GET', url: '/api/v1/custom-adaptors', headers: authHeaders(b.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ slug: string }> };
    expect(body.data.some((r) => r.slug === 'only-a')).toBe(false);
  });
});

describe('GET /custom-adaptors/:id', () => {
  it('returns the full row to its owning firm', async () => {
    const { token } = await seedFirmAndToken();
    const create = await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(token), payload: { name: 'Detailed', slug: 'detailed' } });
    const { data: { id } } = create.json() as { data: { id: string } };

    const res = await app.inject({ method: 'GET', url: `/api/v1/custom-adaptors/${id}`, headers: authHeaders(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { id: string; slug: string } };
    expect(body.data.id).toBe(id);
    expect(body.data.slug).toBe('detailed');
  });

  it('returns 403 when another firm tries to read the row', async () => {
    const a = await seedFirmAndToken('Firm A');
    const b = await seedFirmAndToken('Firm B');
    const create = await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(a.token), payload: { name: 'A-only', slug: 'a-only' } });
    const { data: { id } } = create.json() as { data: { id: string } };

    const res = await app.inject({ method: 'GET', url: `/api/v1/custom-adaptors/${id}`, headers: authHeaders(b.token) });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for unknown ids', async () => {
    const { token } = await seedFirmAndToken();
    const res = await app.inject({ method: 'GET', url: `/api/v1/custom-adaptors/${createId()}`, headers: authHeaders(token) });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Document upload ─────────────────────────────────────────────────────────

async function postMultipart(
  url: string,
  token: string,
  file: { filename: string; contentType: string; content: Buffer },
): Promise<{ statusCode: number; body: unknown }> {
  const boundary = `----${createId()}`;
  const bodyParts: Buffer[] = [
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n`),
    Buffer.from(`Content-Type: ${file.contentType}\r\n\r\n`),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  const body = Buffer.concat(bodyParts);
  const res = await app.inject({
    method: 'POST',
    url,
    headers: {
      cookie: `token=${token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    payload: body,
  });
  return { statusCode: res.statusCode, body: res.json() };
}

describe('POST /custom-adaptors/:id/documents', () => {
  it('accepts a PDF upload and appends it to sourceDocuments', async () => {
    const { token } = await seedFirmAndToken();
    const create = await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(token), payload: { name: 'Docable', slug: 'docable' } });
    const { data: { id } } = create.json() as { data: { id: string } };

    const { statusCode, body } = await postMultipart(
      `/api/v1/custom-adaptors/${id}/documents`,
      token,
      { filename: 'manual.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 fake') },
    );
    expect(statusCode).toBe(201);
    const parsed = body as { data: { sourceDocuments: Array<{ originalName: string; mimeType: string; size: number }> } };
    expect(parsed.data.sourceDocuments).toHaveLength(1);
    expect(parsed.data.sourceDocuments[0].originalName).toBe('manual.pdf');
    expect(parsed.data.sourceDocuments[0].mimeType).toBe('application/pdf');
    expect(parsed.data.sourceDocuments[0].size).toBeGreaterThan(0);
  });

  it('rejects unsupported mime types (UNSUPPORTED_MIME)', async () => {
    const { token } = await seedFirmAndToken();
    const create = await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(token), payload: { name: 'Filtered', slug: 'filtered' } });
    const { data: { id } } = create.json() as { data: { id: string } };

    const { statusCode, body } = await postMultipart(
      `/api/v1/custom-adaptors/${id}/documents`,
      token,
      { filename: 'image.png', contentType: 'image/png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    );
    expect(statusCode).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe('UNSUPPORTED_MIME');
  });

  it('returns 403 when another firm tries to upload', async () => {
    const a = await seedFirmAndToken('Firm A');
    const b = await seedFirmAndToken('Firm B');
    const create = await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(a.token), payload: { name: 'GuardedDocs', slug: 'guarded-docs' } });
    const { data: { id } } = create.json() as { data: { id: string } };

    const { statusCode } = await postMultipart(
      `/api/v1/custom-adaptors/${id}/documents`,
      b.token,
      { filename: 'sneaky.txt', contentType: 'text/plain', content: Buffer.from('owned') },
    );
    expect(statusCode).toBe(403);
  });
});

// ─── Publish / archive lifecycle ─────────────────────────────────────────────

describe('POST /custom-adaptors/:id/publish', () => {
  it('refuses to publish a DRAFT adaptor (NOT_READY)', async () => {
    const { token } = await seedFirmAndToken();
    const create = await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(token), payload: { name: 'DraftOnly', slug: 'draft-only' } });
    const { data: { id } } = create.json() as { data: { id: string } };

    const res = await app.inject({ method: 'POST', url: `/api/v1/custom-adaptors/${id}/publish`, headers: authHeaders(token) });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_READY');
  });

  it('publishes a READY adaptor and stamps publishedAt', async () => {
    const { token } = await seedFirmAndToken();
    const create = await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(token), payload: { name: 'Publishable', slug: 'publishable' } });
    const { data: { id } } = create.json() as { data: { id: string } };

    // Drive the status → READY directly via the DB helper (the parse service's
    // happy path would call this). Keeps this test off Anthropic.
    await savePlatformAdaptorDraft(id, {
      manifest: { id: 'custom:publishable', name: 'Publishable', version: '1.0.0', vendor: 'Acme', capabilities: [], minSdk: '0.1.0', sourceKind: 'custom' },
      schema: { version: '1.0.0', flows: [] },
      license: { editions: [{ id: 'BASIC', label: 'Basic', includesModules: [] }], modules: [], defaultEditionId: 'BASIC' },
      phases: { defaultPhases: [] },
      generators: [],
    });

    const res = await app.inject({ method: 'POST', url: `/api/v1/custom-adaptors/${id}/publish`, headers: authHeaders(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string; publishedAt: string | null } };
    expect(body.data.status).toBe('PUBLISHED');
    expect(body.data.publishedAt).toBeTruthy();
  });

  it('returns 403 when a different firm tries to publish', async () => {
    const a = await seedFirmAndToken('Firm A');
    const b = await seedFirmAndToken('Firm B');
    const create = await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(a.token), payload: { name: 'Fortified', slug: 'fortified' } });
    const { data: { id } } = create.json() as { data: { id: string } };
    await savePlatformAdaptorDraft(id, {
      manifest: { id: 'custom:fortified', name: 'Fortified', version: '1.0.0', vendor: 'A', capabilities: [], minSdk: '0.1.0', sourceKind: 'custom' },
      schema: { version: '1.0.0', flows: [] },
      license: { editions: [{ id: 'BASIC', label: 'Basic', includesModules: [] }], modules: [], defaultEditionId: 'BASIC' },
      phases: { defaultPhases: [] },
      generators: [],
    });

    const res = await app.inject({ method: 'POST', url: `/api/v1/custom-adaptors/${id}/publish`, headers: authHeaders(b.token) });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /custom-adaptors/:id/archive', () => {
  it('archives a row and hides it from the list endpoint', async () => {
    const { token } = await seedFirmAndToken();
    const create = await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(token), payload: { name: 'Archivable', slug: 'archivable-api' } });
    const { data: { id } } = create.json() as { data: { id: string } };

    const arch = await app.inject({ method: 'POST', url: `/api/v1/custom-adaptors/${id}/archive`, headers: authHeaders(token) });
    expect(arch.statusCode).toBe(204);

    // Row still exists on the DB (soft-delete) but the list endpoint hides it
    const row = await findCustomAdaptorById(id);
    expect(row?.status).toBe('ARCHIVED');

    const list = await app.inject({ method: 'GET', url: '/api/v1/custom-adaptors', headers: authHeaders(token) });
    const body = list.json() as { data: Array<{ slug: string }> };
    expect(body.data.some((r) => r.slug === 'archivable-api')).toBe(false);
  });
});

// ─── Draft editing ───────────────────────────────────────────────────────────

describe('PATCH /custom-adaptors/:id/draft — rules field (Phase 14)', () => {
  it('persists a firm-authored rules pack on the custom adaptor row', async () => {
    const { token } = await seedFirmAndToken();
    const create = await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(token), payload: { name: 'RulesAuth', slug: 'rules-auth' } });
    const { data: { id } } = create.json() as { data: { id: string } };

    // Seed an initial READY state so PATCH /draft has something to merge onto.
    await savePlatformAdaptorDraft(id, {
      manifest: { id: 'custom:rules-auth', name: 'RulesAuth', version: '1.0.0', vendor: 'V', capabilities: [], minSdk: '0.1.0', sourceKind: 'custom' },
      schema: { version: '1.0.0', flows: [] },
      license: { editions: [{ id: 'BASIC', label: 'Basic', includesModules: [] }], modules: [], defaultEditionId: 'BASIC' },
      phases: { defaultPhases: [] },
      generators: [],
    });

    const authored = {
      id: 'rules-auth-rules',
      version: '1.0.0',
      rules: [
        {
          id: 'rules-auth.demo',
          type: 'DATA_WARNING',
          severity: 'INFO',
          questionIds: ['x.y'],
          message: 'demo rule',
          resolution: 'take action',
          when: { answerTruthy: { questionId: 'x.y' } },
        },
      ],
    };
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/custom-adaptors/${id}/draft`,
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      payload: { rules: authored },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { parsedRules: unknown } };
    expect(body.data.parsedRules).toMatchObject({ id: 'rules-auth-rules', rules: [{ id: 'rules-auth.demo' }] });
  });
});

describe('PATCH /custom-adaptors/:id/draft', () => {
  it('merges partial updates onto the stored draft', async () => {
    const { token } = await seedFirmAndToken();
    const create = await app.inject({ method: 'POST', url: '/api/v1/custom-adaptors',
      headers: authHeaders(token), payload: { name: 'Editable', slug: 'editable' } });
    const { data: { id } } = create.json() as { data: { id: string } };

    // Seed an initial parsed draft directly
    const originalManifest = {
      id: 'custom:editable', name: 'Editable', version: '1.0.0', vendor: 'V',
      capabilities: [], minSdk: '0.1.0', sourceKind: 'custom' as const,
    };
    const originalPhases = { defaultPhases: [] };
    await savePlatformAdaptorDraft(id, {
      manifest: originalManifest,
      schema: { version: '1.0.0', flows: [] },
      license: { editions: [{ id: 'BASIC', label: 'Basic', includesModules: [] }], modules: [], defaultEditionId: 'BASIC' },
      phases: originalPhases,
      generators: [],
    });

    // Patch only the schema — manifest/phases should remain untouched.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/custom-adaptors/${id}/draft`,
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      payload: {
        schema: { version: '1.1.0', flows: [{ id: 'R2R', label: 'Ledger', sections: [] }] },
      },
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json() as { data: { parsedSchema: unknown; parsedManifest: unknown; parsedPhases: unknown } };
    expect((body.data.parsedSchema as { version: string }).version).toBe('1.1.0');
    expect(body.data.parsedManifest).toMatchObject({ id: 'custom:editable' });
    expect(body.data.parsedPhases).toEqual(originalPhases);
  });
});
