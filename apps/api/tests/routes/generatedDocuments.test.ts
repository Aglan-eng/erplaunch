/**
 * Phase 50.4 — generatedDocuments routes integration tests.
 *
 * Covers:
 *   - auth (401 without cookie)
 *   - from-template happy path → rendered body + missing-tokens echo
 *   - cross-engagement / cross-firm 404s
 *   - list / get / patch / delete CRUD
 *   - export to each format with correct mime + Content-Disposition
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { generatedDocumentsRoutes } from '../../src/routes/generatedDocuments.js';
import {
  getDb,
  bootstrapFirmAdmin,
  createCustomTemplate,
} from '../../src/db/index.js';

const JWT_SECRET = 'gendocs-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(generatedDocumentsRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  userId: string;
  engagementId: string;
  token: string;
}

async function seedFirm(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const engagementId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, displayName, primaryColor, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [firmId, 'Doc Firm', `doc-${createId()}`, 'STARTER', 'Xelerate', '#0A1A2F', now],
  });
  const hash = await bcrypt.hash('x', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Author', hash, 'CONSULTANT', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Acme Industries', 'DISCOVERY', now, now],
  });
  await bootstrapFirmAdmin({ firmId, userId });
  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'CONSULTANT',
    name: 'Author',
    email: `${userId}@example.com`,
  });
  return { firmId, userId, engagementId, token };
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.execute('DELETE FROM GeneratedDocument');
  await db.execute('DELETE FROM CustomTemplate');
  await db.execute('DELETE FROM Engagement');
  await db.execute('DELETE FROM FirmRole');
  await db.execute('DELETE FROM EngagementRole');
  await db.execute('DELETE FROM User');
  await db.execute('DELETE FROM Firm');
});

describe('POST /from-template/:templateId', () => {
  it('requires auth', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/engagements/x/documents/from-template/y',
      payload: {},
    });
    expect(r.statusCode).toBe(401);
  });

  it('renders the template against the engagement and persists', async () => {
    const f = await seedFirm();
    const tpl = await createCustomTemplate({
      firmId: f.firmId,
      name: 'Cutover Runbook',
      type: 'CUSTOM',
      body: '# Cutover for {{engagement.client}}\n\nPrepared by {{firm.name}}.',
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/documents/from-template/${tpl.id}`,
      cookies: { token: f.token },
      payload: {},
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as {
      data: { document: { name: string; body: string; sourceTemplateId: string }; missingTokens: string[] };
    };
    expect(body.data.document.body).toContain('Acme Industries');
    expect(body.data.document.body).toContain('Xelerate');
    expect(body.data.document.sourceTemplateId).toBe(tpl.id);
    expect(body.data.missingTokens).toEqual([]);
  });

  it('echoes missing tokens in the response so authors see them', async () => {
    const f = await seedFirm();
    const tpl = await createCustomTemplate({
      firmId: f.firmId,
      name: 'Broken',
      type: 'CUSTOM',
      body: 'Hi {{firm.name}} — {{not.a.real.token}} ends here.',
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/documents/from-template/${tpl.id}`,
      cookies: { token: f.token },
      payload: {},
    });
    const body = r.json() as {
      data: { document: { body: string }; missingTokens: string[] };
    };
    expect(body.data.document.body).toContain('[missing: not.a.real.token]');
    expect(body.data.missingTokens).toEqual(['not.a.real.token']);
  });

  it('honours an explicit name override', async () => {
    const f = await seedFirm();
    const tpl = await createCustomTemplate({
      firmId: f.firmId,
      name: 'Default Name',
      type: 'CUSTOM',
      body: 'x',
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/documents/from-template/${tpl.id}`,
      cookies: { token: f.token },
      payload: { name: 'Custom Name v1' },
    });
    const body = r.json() as { data: { document: { name: string } } };
    expect(body.data.document.name).toBe('Custom Name v1');
  });

  it('404s on cross-firm template', async () => {
    const a = await seedFirm();
    const b = await seedFirm();
    const tpl = await createCustomTemplate({
      firmId: a.firmId,
      name: 'A only',
      type: 'CUSTOM',
      body: 'x',
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${b.engagementId}/documents/from-template/${tpl.id}`,
      cookies: { token: b.token },
      payload: {},
    });
    expect(r.statusCode).toBe(404);
  });

  it('404s on cross-firm engagement', async () => {
    const a = await seedFirm();
    const b = await seedFirm();
    const tpl = await createCustomTemplate({
      firmId: a.firmId,
      name: 'A only',
      type: 'CUSTOM',
      body: 'x',
    });
    // Use firm B's token but firm A's engagement.
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${a.engagementId}/documents/from-template/${tpl.id}`,
      cookies: { token: b.token },
      payload: {},
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('GET list + get + PATCH + DELETE', () => {
  it('lists docs newest-first for the engagement', async () => {
    const f = await seedFirm();
    const tpl = await createCustomTemplate({
      firmId: f.firmId,
      name: 'T',
      type: 'CUSTOM',
      body: '# x',
    });
    // Create 3 docs.
    for (const name of ['A', 'B', 'C']) {
      await app.inject({
        method: 'POST',
        url: `/api/v1/engagements/${f.engagementId}/documents/from-template/${tpl.id}`,
        cookies: { token: f.token },
        payload: { name },
      });
      await new Promise((r) => setTimeout(r, 10));
    }
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/documents`,
      cookies: { token: f.token },
    });
    const body = r.json() as { data: Array<{ name: string }> };
    expect(body.data.map((d) => d.name)).toEqual(['C', 'B', 'A']);
  });

  it('GET single + PATCH name + body, then verify on re-read', async () => {
    const f = await seedFirm();
    const tpl = await createCustomTemplate({
      firmId: f.firmId,
      name: 'T',
      type: 'CUSTOM',
      body: '# x',
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/documents/from-template/${tpl.id}`,
      cookies: { token: f.token },
      payload: { name: 'Original' },
    });
    const docId = (created.json() as { data: { document: { id: string } } }).data.document.id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/documents/${docId}`,
      cookies: { token: f.token },
      payload: { name: 'Renamed', body: 'edited body' },
    });
    expect(patched.statusCode).toBe(200);
    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/documents/${docId}`,
      cookies: { token: f.token },
    });
    const body = got.json() as { data: { name: string; body: string } };
    expect(body.data.name).toBe('Renamed');
    expect(body.data.body).toBe('edited body');
  });

  it('DELETE removes the doc and subsequent reads 404', async () => {
    const f = await seedFirm();
    const tpl = await createCustomTemplate({
      firmId: f.firmId,
      name: 'T',
      type: 'CUSTOM',
      body: 'x',
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/documents/from-template/${tpl.id}`,
      cookies: { token: f.token },
      payload: {},
    });
    const docId = (created.json() as { data: { document: { id: string } } }).data.document.id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/engagements/${f.engagementId}/documents/${docId}`,
      cookies: { token: f.token },
    });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/documents/${docId}`,
      cookies: { token: f.token },
    });
    expect(after.statusCode).toBe(404);
  });

  it('cross-firm GET / PATCH / DELETE all 404', async () => {
    const a = await seedFirm();
    const b = await seedFirm();
    const tpl = await createCustomTemplate({
      firmId: a.firmId,
      name: 'T',
      type: 'CUSTOM',
      body: 'x',
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${a.engagementId}/documents/from-template/${tpl.id}`,
      cookies: { token: a.token },
      payload: {},
    });
    const docId = (created.json() as { data: { document: { id: string } } }).data.document.id;
    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const r = await app.inject({
        method,
        url: `/api/v1/engagements/${a.engagementId}/documents/${docId}`,
        cookies: { token: b.token },
        ...(method === 'PATCH' ? { payload: { name: 'h' } } : {}),
      });
      expect(r.statusCode).toBe(404);
    }
  });
});

describe('GET export?format=pdf|docx|pptx', () => {
  async function setupDocForExport(): Promise<{ f: Fixture; docId: string }> {
    const f = await seedFirm();
    const tpl = await createCustomTemplate({
      firmId: f.firmId,
      name: 'Solution Overview',
      type: 'CUSTOM',
      body: '# Header\n\n## A section\n\nBody bullet.\n\n- one\n- two',
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/documents/from-template/${tpl.id}`,
      cookies: { token: f.token },
      payload: { name: 'Test Doc' },
    });
    const docId = (created.json() as { data: { document: { id: string } } }).data.document.id;
    return { f, docId };
  }

  it('exports a PDF with the right mime + Content-Disposition + magic bytes', async () => {
    const { f, docId } = await setupDocForExport();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/documents/${docId}/export?format=pdf`,
      cookies: { token: f.token },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(String(r.headers['content-disposition'])).toContain('Test Doc.pdf');
    const buf = r.rawPayload as Buffer;
    expect(buf.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('exports a DOCX with the right mime + PK magic', async () => {
    const { f, docId } = await setupDocForExport();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/documents/${docId}/export?format=docx`,
      cookies: { token: f.token },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('wordprocessingml');
    expect(String(r.headers['content-disposition'])).toContain('Test Doc.docx');
    const buf = r.rawPayload as Buffer;
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it('exports a PPTX with the right mime + PK magic', async () => {
    const { f, docId } = await setupDocForExport();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/documents/${docId}/export?format=pptx`,
      cookies: { token: f.token },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('presentationml');
    expect(String(r.headers['content-disposition'])).toContain('Test Doc.pptx');
    const buf = r.rawPayload as Buffer;
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it('rejects an unknown format with 400', async () => {
    const { f, docId } = await setupDocForExport();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/documents/${docId}/export?format=epub`,
      cookies: { token: f.token },
    });
    expect(r.statusCode).toBe(400);
  });

  it('escapes non-ASCII names in Content-Disposition (RFC 5987)', async () => {
    const f = await seedFirm();
    const tpl = await createCustomTemplate({
      firmId: f.firmId,
      name: 'T',
      type: 'CUSTOM',
      body: 'x',
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/documents/from-template/${tpl.id}`,
      cookies: { token: f.token },
      payload: { name: 'تقرير' /* Arabic for "report" */ },
    });
    const docId = (created.json() as { data: { document: { id: string } } }).data.document.id;
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/documents/${docId}/export?format=pdf`,
      cookies: { token: f.token },
    });
    expect(r.statusCode).toBe(200);
    const disp = String(r.headers['content-disposition']);
    // RFC 5987 filename* token must be present with UTF-8 prefix.
    expect(disp).toContain("filename*=UTF-8''");
    // ASCII fallback must replace non-ASCII bytes with `_`.
    expect(disp).toMatch(/filename="[A-Za-z0-9._\- ]+\.pdf"/);
  });
});
