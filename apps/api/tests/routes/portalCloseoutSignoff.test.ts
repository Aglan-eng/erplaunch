/**
 * Phase 45.4 — integration tests for the portal-side closeout sign-off
 * endpoint.
 *
 *   GET  /engagements/portal/:token/closeout-signoff — read state
 *   POST /engagements/portal/:token/closeout-signoff — flip CLIENT_SIGNOFF DONE
 *
 * Both gated on the standard portal session middleware. The portal
 * session is manufactured directly via the DB layer + `portal_token`
 * cookie sign so the test doesn't need to walk the full magic-link
 * OTP flow.
 *
 * Coverage:
 *   - GET returns ready=false when engagement is not in CLOSEOUT.
 *   - GET returns ready=true with the current sign-off status when
 *     the engagement is in CLOSEOUT.
 *   - POST flips CLIENT_SIGNOFF to DONE, stamps the member name in
 *     notes, and writes a CLOSEOUT_CLIENT_SIGNOFF activity entry.
 *   - POST 409s when the engagement is not in CLOSEOUT.
 *   - Unauth (no cookie) is 401.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { createId } from '@paralleldrive/cuid2';
import crypto from 'crypto';
import { setupTestDb } from '../_helpers/testDb.js';
import { portalRoutes } from '../../src/routes/portal.js';
import {
  getDb,
  createCloseoutChecklist,
  upsertPortalToken,
} from '../../src/db/index.js';
import { createPortalSession } from '../../src/db/portalSession.js';

const PORTAL_SECRET = 'portal-closeout-signoff-test';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: 'irrelevant', cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: PORTAL_SECRET,
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(portalRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  engagementId: string;
  memberId: string;
  memberName: string;
  portalToken: string;
  cookieToken: string;
}

async function seed(stage = 'CLOSEOUT', memberName = 'Sara Sponsor'): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const memberId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Portal Signoff Firm', `portal-signoff-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Acme Corp', stage, now, now],
  });
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [memberId, engagementId, memberName, 'Project Sponsor', 'CLIENT', 'sara@acme.example', now],
  });
  if (stage === 'CLOSEOUT') {
    await createCloseoutChecklist(engagementId);
  }
  const portalToken = await upsertPortalToken(engagementId);

  // Manufacture a portal session + matching JWT cookie value. The
  // middleware reads the JWT from the `portal_token` cookie, hashes the
  // jti claim, and looks up the session row — so we insert the session
  // ourselves and sign a JWT with the matching jti.
  const jti = createId();
  const jtiHash = crypto.createHash('sha256').update(jti).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  const session = await createPortalSession({ engagementId, memberId, jtiHash, expiresAt });
  const cookieToken = (app.jwt as unknown as { portal: { sign: (p: object) => string } }).portal.sign({
    type: 'portal',
    memberId,
    engagementId,
    jti,
    sid: session.id,
  });

  return { firmId, engagementId, memberId, memberName, portalToken, cookieToken };
}

beforeAll(async () => {
  process.env.PORTAL_SESSION_COOKIE_SECRET = PORTAL_SECRET;
  ({ cleanup } = await setupTestDb());
  app = await buildTestApp();
});
afterAll(async () => {
  await app.close();
  cleanup();
});
beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM CloseoutChecklistItem`);
  await db.execute(`DELETE FROM PortalSession`);
  await db.execute(`DELETE FROM ClientPortalToken`);
  await db.execute(`DELETE FROM ProjectMember`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /portal/:token/closeout-signoff', () => {
  it('returns ready=false when engagement is not in CLOSEOUT', async () => {
    const f = await seed('GOLIVE');
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${f.portalToken}/closeout-signoff`,
      cookies: { portal_token: f.cookieToken },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { ready: boolean; stage: string; reason?: string } };
    expect(body.data.ready).toBe(false);
    expect(body.data.stage).toBe('GOLIVE');
    expect(body.data.reason).toBeTruthy();
  });

  it('returns ready=true + NOT_STARTED when engagement is in CLOSEOUT', async () => {
    const f = await seed('CLOSEOUT');
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${f.portalToken}/closeout-signoff`,
      cookies: { portal_token: f.cookieToken },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { ready: boolean; status: string; signedBy: string | null } };
    expect(body.data.ready).toBe(true);
    expect(body.data.status).toBe('NOT_STARTED');
    expect(body.data.signedBy).toBeNull();
  });

  it('401s when no portal cookie is provided', async () => {
    const f = await seed('CLOSEOUT');
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/portal/${f.portalToken}/closeout-signoff`,
    });
    expect(r.statusCode).toBe(401);
  });
});

// ─── POST ────────────────────────────────────────────────────────────────────

describe('POST /portal/:token/closeout-signoff', () => {
  it('flips CLIENT_SIGNOFF to DONE and stamps the member name in notes', async () => {
    const f = await seed('CLOSEOUT', 'Mona Manager');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/portal/${f.portalToken}/closeout-signoff`,
      cookies: { portal_token: f.cookieToken },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { status: string; signedBy: string; signedAt: string } };
    expect(body.data.status).toBe('DONE');
    expect(body.data.signedBy).toBe('Mona Manager');
    expect(body.data.signedAt).toBeTruthy();

    // Direct DB check — the row should have notes mentioning the
    // signing client.
    const rows = await getDb().execute({
      sql: `SELECT status, notes, completedBy FROM CloseoutChecklistItem WHERE engagementId = ? AND key = 'CLIENT_SIGNOFF'`,
      args: [f.engagementId],
    });
    const row = rows.rows[0] as unknown as { status: string; notes: string; completedBy: string };
    expect(row.status).toBe('DONE');
    expect(row.notes).toContain('Mona Manager');
    expect(row.completedBy).toBe(`portal:${f.memberId}`);
  });

  it('writes a CLOSEOUT_CLIENT_SIGNOFF activity entry', async () => {
    const f = await seed('CLOSEOUT', 'Sara Sponsor');
    await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/portal/${f.portalToken}/closeout-signoff`,
      cookies: { portal_token: f.cookieToken },
    });
    const log = await getDb().execute({
      sql: `SELECT action, details FROM ActivityLog WHERE engagementId = ? AND action = 'CLOSEOUT_CLIENT_SIGNOFF'`,
      args: [f.engagementId],
    });
    expect(log.rows).toHaveLength(1);
    const row = log.rows[0] as unknown as { details: string };
    expect(row.details).toContain('Sara Sponsor');
  });

  it('409s when engagement is not in CLOSEOUT', async () => {
    const f = await seed('GOLIVE');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/portal/${f.portalToken}/closeout-signoff`,
      cookies: { portal_token: f.cookieToken },
    });
    expect(r.statusCode).toBe(409);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_IN_CLOSEOUT');
  });

  it('401s without a portal cookie', async () => {
    const f = await seed('CLOSEOUT');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/portal/${f.portalToken}/closeout-signoff`,
    });
    expect(r.statusCode).toBe(401);
  });
});
