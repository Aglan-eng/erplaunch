import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { engagementRoutes } from '../../src/routes/engagements.js';
import {
  getDb,
  createEngagement,
  upsertProfile,
  upsertLicense,
  replacePhases,
  addMember,
  createRisk,
  createIssue,
  createDecision,
  createMeeting,
  createMigrationItem,
  upsertSectionComment,
  logActivity,
  upsertPortalToken,
  createPortalTodo,
  createDataCollectionItem,
  findEngagementById,
  bootstrapFirmAdmin,
} from '../../src/db/index.js';

const JWT_SECRET = 'test-archive-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'test-portal-archive-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface SeedFixture {
  firmId: string;
  userId: string;
  engagementId: string;
  token: string;
}

async function seedConsultant(): Promise<SeedFixture> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Archive Firm', `archive-${createId()}`, 'STARTER', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Test', passwordHash, 'CONSULTANT', now],
  });
  const eng = await createEngagement({ firmId, clientName: 'Acme Manufacturing Ltd' });
  const engagementId = (eng as { id: string }).id;
  // Phase 44.1 — visibility filter requires a role to see the list.
  // Mimic /auth/register's bootstrap so the user has APP_ADMIN.
  await bootstrapFirmAdmin({ firmId, userId });
  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'CONSULTANT',
    name: 'Test',
    email: `${userId}@example.com`,
  });
  return { firmId, userId, engagementId, token };
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

beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM ActivityLog`);
});

describe('POST /api/v1/engagements/:id/archive', () => {
  it('requires authentication', async () => {
    const { engagementId } = await seedConsultant();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/archive`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('flips status from DISCOVERY to ARCHIVED and stashes previousStatus', async () => {
    const { engagementId, token } = await seedConsultant();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/archive`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string; previousStatus?: string } };
    expect(body.data.status).toBe('ARCHIVED');
    expect(body.data.previousStatus).toBe('DISCOVERY');
  });

  it('preserves the most recent non-ARCHIVED status when archiving from BUILD', async () => {
    const { engagementId, token } = await seedConsultant();
    // Update engagement to BUILD before archive so previousStatus captures it.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engagementId}`,
      cookies: { token },
      payload: { status: 'BUILD' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/archive`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string; previousStatus?: string } };
    expect(body.data.status).toBe('ARCHIVED');
    expect(body.data.previousStatus).toBe('BUILD');
  });

  it('is idempotent — re-archiving an already-ARCHIVED engagement returns 200', async () => {
    const { engagementId, token } = await seedConsultant();
    await app.inject({ method: 'POST', url: `/api/v1/engagements/${engagementId}/archive`, cookies: { token } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/archive`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string } };
    expect(body.data.status).toBe('ARCHIVED');
  });

  it('returns 404 for an engagement owned by another firm', async () => {
    const a = await seedConsultant();
    const b = await seedConsultant();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${a.engagementId}/archive`,
      cookies: { token: b.token },
    });
    expect(res.statusCode).toBe(404);
  });

  it('handles two parallel archives idempotently — both succeed with status=ARCHIVED', async () => {
    const { engagementId, token } = await seedConsultant();
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/engagements/${engagementId}/archive`, cookies: { token } }),
      app.inject({ method: 'POST', url: `/api/v1/engagements/${engagementId}/archive`, cookies: { token } }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const finalRow = await findEngagementById(engagementId);
    expect((finalRow as { status: string }).status).toBe('ARCHIVED');
  });
});

describe('POST /api/v1/engagements/:id/unarchive', () => {
  it('restores status to the previous value', async () => {
    const { engagementId, token } = await seedConsultant();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engagementId}`,
      cookies: { token },
      payload: { status: 'SCOPING' },
    });
    await app.inject({ method: 'POST', url: `/api/v1/engagements/${engagementId}/archive`, cookies: { token } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/unarchive`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string } };
    expect(body.data.status).toBe('SCOPING');
  });

  it('falls back to DISCOVERY when no previousStatus is recorded', async () => {
    const { engagementId, token } = await seedConsultant();
    // Manually flip to ARCHIVED without going through archive endpoint, simulating a row from before previousStatus existed.
    const db = getDb();
    await db.execute({
      sql: `UPDATE Engagement SET status = 'ARCHIVED', previousStatus = NULL WHERE id = ?`,
      args: [engagementId],
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${engagementId}/unarchive`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string } };
    expect(body.data.status).toBe('DISCOVERY');
  });

  it('returns 404 when the engagement belongs to a different firm', async () => {
    const a = await seedConsultant();
    const b = await seedConsultant();
    await app.inject({ method: 'POST', url: `/api/v1/engagements/${a.engagementId}/archive`, cookies: { token: a.token } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${a.engagementId}/unarchive`,
      cookies: { token: b.token },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/v1/engagements (with archive filter)', () => {
  it('excludes ARCHIVED engagements by default', async () => {
    const { engagementId, token } = await seedConsultant();
    await app.inject({ method: 'POST', url: `/api/v1/engagements/${engagementId}/archive`, cookies: { token } });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string }> };
    expect(body.data.find((e) => e.id === engagementId)).toBeUndefined();
  });

  it('includes ARCHIVED when ?includeArchived=true', async () => {
    const { engagementId, token } = await seedConsultant();
    await app.inject({ method: 'POST', url: `/api/v1/engagements/${engagementId}/archive`, cookies: { token } });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements?includeArchived=true`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; status: string }> };
    const found = body.data.find((e) => e.id === engagementId);
    expect(found).toBeDefined();
    expect(found?.status).toBe('ARCHIVED');
  });
});

describe('DELETE /api/v1/engagements/:id (cascade)', () => {
  async function seedHeavyEngagement(firmId: string): Promise<string> {
    const eng = await createEngagement({ firmId, clientName: 'Heavy Engagement' });
    const engagementId = (eng as { id: string }).id;
    // Sprinkle child rows across every table the cascade should clean.
    await upsertProfile(engagementId, { 'r2r.entities.multiEntity': true });
    await upsertLicense(engagementId, { edition: 'MID_MARKET', modules: ['CORE'] });
    await replacePhases(engagementId, [
      { name: 'Phase 1', order: 1, flows: ['R2R'], trigger: 'REQUIREMENT', status: 'PLANNED' },
    ]);
    await addMember(engagementId, { name: 'Test Member', role: 'PM', team: 'CLIENT', email: 't@example.com' });
    await createRisk(engagementId, { title: 'Risk 1' });
    await createIssue(engagementId, { title: 'Issue 1' });
    await createDecision(engagementId, { title: 'Decision 1' });
    await createMeeting(engagementId, { title: 'Meeting 1', meetingDate: '2026-05-05' });
    await createMigrationItem(engagementId, { objectName: 'Mig 1' });
    await upsertSectionComment(engagementId, 'r2r.entities', 'a comment');
    await logActivity(engagementId, firmId, 'TEST_EVENT', 'a test activity');
    await upsertPortalToken(engagementId);
    await createPortalTodo(engagementId, { title: 'Todo 1', priority: 'HIGH' });
    await createDataCollectionItem(engagementId, { templateId: 'tpl', name: 'DC 1', category: 'GL' });
    return engagementId;
  }

  it('cascades through every child table — counts go to 0 after delete', async () => {
    const { firmId, token } = await seedConsultant();
    const heavyId = await seedHeavyEngagement(firmId);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/engagements/${heavyId}`,
      cookies: { token },
    });
    expect(res.statusCode).toBe(204);

    const db = getDb();
    const tables = [
      'BusinessProfile', 'LicenseProfile', 'Phase', 'ProjectMember',
      'RiskItem', 'IssueItem', 'DecisionItem', 'MeetingNote',
      'MigrationItem', 'SectionComment', 'ActivityLog',
      'ClientPortalToken', 'PortalTodo', 'DataCollectionItem',
    ];
    for (const t of tables) {
      const r = await db.execute({
        sql: `SELECT COUNT(*) AS n FROM ${t} WHERE engagementId = ?`,
        args: [heavyId],
      });
      const n = (r.rows[0] as Record<string, unknown>).n as number;
      expect(n, `${t} should be empty for the deleted engagement`).toBe(0);
    }

    const stillThere = await findEngagementById(heavyId);
    expect(stillThere).toBeNull();
  });

  it('returns 404 on a second DELETE of the same engagement', async () => {
    const { firmId, token } = await seedConsultant();
    const heavyId = await seedHeavyEngagement(firmId);
    const first = await app.inject({
      method: 'DELETE',
      url: `/api/v1/engagements/${heavyId}`,
      cookies: { token },
    });
    expect(first.statusCode).toBe(204);
    const second = await app.inject({
      method: 'DELETE',
      url: `/api/v1/engagements/${heavyId}`,
      cookies: { token },
    });
    expect(second.statusCode).toBe(404);
  });

  it('returns 404 when the engagement belongs to another firm', async () => {
    const a = await seedConsultant();
    const b = await seedConsultant();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/engagements/${a.engagementId}`,
      cookies: { token: b.token },
    });
    expect(res.statusCode).toBe(404);
  });
});
