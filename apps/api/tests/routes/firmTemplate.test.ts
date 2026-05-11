/**
 * Phase 49.3 — firmTemplate route tests.
 *
 * Covers auth, role-gating, validation, and the Brand Pack ingest
 * happy + error paths. CustomTemplate CRUD smoke-tested for the
 * Phase 49.4 editor.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { firmTemplateRoutes } from '../../src/routes/firmTemplate.js';
import { getDb, bootstrapFirmAdmin } from '../../src/db/index.js';

const JWT_SECRET = 'firm-template-test-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(firmTemplateRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  userId: string;
  token: string;
}

async function seedFirmAdmin(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Pack Firm', `pack-${createId()}`, 'STARTER', now],
  });
  const hash = await bcrypt.hash('x', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Admin', hash, 'APP_ADMIN', now],
  });
  await bootstrapFirmAdmin({ firmId, userId });
  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'APP_ADMIN',
    name: 'Admin',
    email: `${userId}@example.com`,
  });
  return { firmId, userId, token };
}

const VALID_PACK = `# Test Pack

## 1. Tagline

Outcome-first ERP delivery.

## 2. Subtitle

Sub.

## 3. Company Description

Description body.

## 4. Why Us

Why us body.

## 5. Methodology

### 5.1 Frame

Frame body.

### 5.2 Build

Build body.

## 6. Roadmap

### 6.1 Quick wins

QW body.

## 7. Proposal Structure

### 7.1 Intro

- Anchor pain

## 8. Pricing Template

### 8.1 Discovery

**SKU:** PKG-D-001
**Description:** d
**Annual:** $25,000

## 9. Industry Verticals

### 9.1 Retail

**Outcome:** o
**Strategic context:** s
**Approach:** a

## 10. Voice Guide

Sentence case.

## 11. CTA Options

### 11.1 Lock in your kickoff

cta body

## 12. Theme

**Font family:** Inter, sans-serif
**Headline case:** sentence
**Accent color:** #1a8754
`;

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
  // Delete in dependency order — User and FirmRole (and others) FK
  // to Firm without ON DELETE CASCADE, so we must clear referencing
  // rows before the Firm rows themselves.
  const db = getDb();
  await db.execute('DELETE FROM CustomTemplate');
  await db.execute('DELETE FROM FirmRole');
  await db.execute('DELETE FROM EngagementRole');
  await db.execute('DELETE FROM User');
  await db.execute('DELETE FROM Firm');
});

describe('GET /api/v1/firm/template', () => {
  it('requires authentication', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/firm/template' });
    expect(r.statusCode).toBe(401);
  });

  it('returns the firm template (empty shape for fresh firms)', async () => {
    const f = await seedFirmAdmin();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/template',
      cookies: { token: f.token },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { templateVersion: number; tagline: string | null } };
    expect(body.data.templateVersion).toBe(1);
    expect(body.data.tagline).toBeNull();
  });
});

describe('PATCH /api/v1/firm/template', () => {
  it('writes scalar fields and bumps version', async () => {
    const f = await seedFirmAdmin();
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/template',
      cookies: { token: f.token },
      payload: { tagline: 'New tagline' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { tagline: string; templateVersion: number } };
    expect(body.data.tagline).toBe('New tagline');
    expect(body.data.templateVersion).toBe(2);
  });

  it('validates themeAccentColor as 6-digit hex', async () => {
    const f = await seedFirmAdmin();
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/template',
      cookies: { token: f.token },
      payload: { themeAccentColor: 'green' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('validates themeHeadlineCase enum', async () => {
    const f = await seedFirmAdmin();
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/v1/firm/template',
      cookies: { token: f.token },
      payload: { themeHeadlineCase: 'BANANA' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('POST /api/v1/firm/template-pack', () => {
  it('ingests a valid pack and bumps templateVersion', async () => {
    const f = await seedFirmAdmin();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/firm/template-pack',
      cookies: { token: f.token },
      payload: { markdownPack: VALID_PACK },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      data: {
        tagline: string;
        templateVersion: number;
        methodology: Array<{ title: string }>;
        themeAccentColor: string;
      };
    };
    expect(body.data.tagline).toContain('Outcome-first ERP delivery');
    expect(body.data.methodology.map((m) => m.title)).toEqual(['Frame', 'Build']);
    expect(body.data.themeAccentColor).toBe('#1a8754');
    expect(body.data.templateVersion).toBe(2);
  });

  it('returns 400 with missingSections list when pack is incomplete', async () => {
    const f = await seedFirmAdmin();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/firm/template-pack',
      cookies: { token: f.token },
      payload: { markdownPack: '# Pack\n\n## 1. Tagline\n\nx\n' },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as {
      error: { code: string; missingSections: number[] };
    };
    expect(body.error.code).toBe('MISSING_SECTIONS');
    expect(body.error.missingSections).toContain(2);
    expect(body.error.missingSections).toContain(12);
  });

  it('returns 400 INVALID_THEME for bad accent color in pack', async () => {
    const f = await seedFirmAdmin();
    const broken = VALID_PACK.replace('#1a8754', 'green');
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/firm/template-pack',
      cookies: { token: f.token },
      payload: { markdownPack: broken },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string; malformedSection: number } };
    expect(body.error.code).toBe('INVALID_THEME');
    expect(body.error.malformedSection).toBe(12);
  });

  it('rejects unauthenticated requests', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/firm/template-pack',
      payload: { markdownPack: VALID_PACK },
    });
    expect(r.statusCode).toBe(401);
  });

  it('rejects body without markdownPack field', async () => {
    const f = await seedFirmAdmin();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/firm/template-pack',
      cookies: { token: f.token },
      payload: { other: 'field' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('CustomTemplate CRUD', () => {
  it('creates + lists + reads + updates + deletes a custom template', async () => {
    const f = await seedFirmAdmin();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/firm/custom-templates',
      cookies: { token: f.token },
      payload: { name: 'Migration Memo', type: 'CUSTOM', body: '# memo' },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/custom-templates',
      cookies: { token: f.token },
    });
    expect((list.json() as { data: unknown[] }).data).toHaveLength(1);

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/firm/custom-templates/${id}`,
      cookies: { token: f.token },
    });
    expect((read.json() as { data: { name: string } }).data.name).toBe('Migration Memo');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/firm/custom-templates/${id}`,
      cookies: { token: f.token },
      payload: { body: 'updated' },
    });
    expect((patched.json() as { data: { body: string } }).data.body).toBe('updated');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/firm/custom-templates/${id}`,
      cookies: { token: f.token },
    });
    expect(del.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/firm/custom-templates',
      cookies: { token: f.token },
    });
    expect((after.json() as { data: unknown[] }).data).toHaveLength(0);
  });

  it('isolates custom templates across firms (404 on cross-firm read)', async () => {
    const a = await seedFirmAdmin();
    const b = await seedFirmAdmin();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/firm/custom-templates',
      cookies: { token: a.token },
      payload: { name: 'A only', type: 'CUSTOM', body: 'a' },
    });
    const id = (created.json() as { data: { id: string } }).data.id;
    const cross = await app.inject({
      method: 'GET',
      url: `/api/v1/firm/custom-templates/${id}`,
      cookies: { token: b.token },
    });
    expect(cross.statusCode).toBe(404);
  });
});

/**
 * Phase 50.9.3 — admin reseed-brand-pack endpoint.
 *
 * Surface contract:
 *   POST /api/v1/admin/firm/:firmId/reseed-brand-pack
 *     - APP_ADMIN only (gated via the matrix's WRITE on ROLES)
 *     - URL firmId must match the caller's JWT firmId (defence-in-depth
 *       against future permission widening)
 *     - clears Firm.brandPackContentHash, then runs the seed
 *     - returns the seed's structured result
 *
 * The seed itself is exercised in tests/db/seeds/049-xelerate-brand-pack.test.ts;
 * here we cover only the route wiring + scoping.
 */
async function seedXelerateFirmAdmin(): Promise<Fixture> {
  // Same shape as seedFirmAdmin but pins the slug to 'xelerate' so
  // the Phase 50.8 seed actually engages — the slug is the lookup
  // key.
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Xelerate', 'xelerate', 'STARTER', now],
  });
  const hash = await bcrypt.hash('x', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Admin', hash, 'APP_ADMIN', now],
  });
  await bootstrapFirmAdmin({ firmId, userId });
  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'APP_ADMIN',
    name: 'Admin',
    email: `${userId}@example.com`,
  });
  return { firmId, userId, token };
}

describe('POST /api/v1/admin/firm/:firmId/reseed-brand-pack', () => {
  it('reseeds when called as the firm admin (clears hash, runs seed)', async () => {
    const f = await seedXelerateFirmAdmin();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/firm/${f.firmId}/reseed-brand-pack`,
      cookies: { token: f.token },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      data: { status: string; templateVersion?: number; contentHash?: string };
    };
    expect(body.data.status).toBe('SEEDED');
    expect(body.data.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.templateVersion).toBeGreaterThanOrEqual(2);
  });

  it('reseeds twice in a row — second call also returns SEEDED because we clear the hash', async () => {
    const f = await seedXelerateFirmAdmin();
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/firm/${f.firmId}/reseed-brand-pack`,
      cookies: { token: f.token },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/firm/${f.firmId}/reseed-brand-pack`,
      cookies: { token: f.token },
    });
    expect(second.statusCode).toBe(200);
    const body = second.json() as { data: { status: string } };
    // Endpoint always clears the hash first, so the seed never hits
    // SKIPPED_HASH_MATCH from this call path.
    expect(body.data.status).toBe('SEEDED');
  });

  it('rejects unauthenticated callers (401)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/firm/${createId()}/reseed-brand-pack`,
    });
    expect(r.statusCode).toBe(401);
  });

  it('rejects callers targeting a different firm (403)', async () => {
    const a = await seedXelerateFirmAdmin();
    // Caller is a; URL says target firmId from a different admin's
    // firm. Should 403 — the route confirms URL firmId === jwt firmId.
    const otherFirmId = createId();
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/firm/${otherFirmId}/reseed-brand-pack`,
      cookies: { token: a.token },
    });
    expect(r.statusCode).toBe(403);
  });
});
