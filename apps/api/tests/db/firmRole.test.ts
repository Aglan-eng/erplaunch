/**
 * Phase 43.1 — DB CRUD coverage for FirmRole, EngagementRole,
 * RoleAuditLog, plus the auto-grant on firm creation.
 *
 * Each test stands up a fresh ephemeral SQLite via setupTestDb so
 * unique-constraint behaviour can be verified deterministically.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  createFirm,
  createEngagement,
  createUser,
  // RBAC additions:
  grantFirmRole,
  revokeFirmRole,
  listFirmRolesForUser,
  listFirmUsersWithRoles,
  grantEngagementRole,
  revokeEngagementRole,
  listEngagementRolesForUser,
  listEngagementRolesForEngagement,
  listRoleAuditLog,
  bootstrapFirmAdmin,
  backfillAppAdmins,
  getDb,
} from '../../src/db/index.js';

let cleanup: () => void;

beforeEach(async () => {
  ({ cleanup } = await setupTestDb());
});
afterEach(() => cleanup());

async function makeFirmWithUser(opts?: { firmName?: string; firmSlug?: string }) {
  const firm = await createFirm({
    name: opts?.firmName ?? 'Acme Advisory',
    slug: opts?.firmSlug ?? `acme-${Math.random().toString(36).slice(2, 8)}`,
    plan: 'STARTER',
  });
  if (!firm) throw new Error('createFirm returned null');
  const user = await createUser({
    firmId: firm.id,
    email: `u-${Math.random().toString(36).slice(2, 8)}@example.com`,
    name: 'Test User',
    passwordHash: 'x',
    role: 'CONSULTANT',
  });
  if (!user) throw new Error('createUser returned null');
  return { firm, user };
}

// ─── FirmRole ────────────────────────────────────────────────────────────────

describe('FirmRole CRUD', () => {
  it('grants a firm-level role and surfaces it in listFirmRolesForUser', async () => {
    const { firm, user } = await makeFirmWithUser();
    await grantFirmRole({
      firmId: firm.id,
      userId: user.id,
      role: 'SALES_MANAGER',
      actorUserId: user.id,
    });
    const roles = await listFirmRolesForUser(user.id);
    expect(roles).toEqual(['SALES_MANAGER']);
  });

  it('rejects a per-engagement role being inserted as a firm role', async () => {
    const { firm, user } = await makeFirmWithUser();
    await expect(
      grantFirmRole({
        firmId: firm.id,
        userId: user.id,
        // PROJECT_MANAGER is engagement-level — cannot live on FirmRole.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        role: 'PROJECT_MANAGER' as any,
        actorUserId: user.id,
      }),
    ).rejects.toThrow();
  });

  it('is idempotent on repeat grants (same role twice = single row)', async () => {
    const { firm, user } = await makeFirmWithUser();
    await grantFirmRole({ firmId: firm.id, userId: user.id, role: 'APP_ADMIN', actorUserId: user.id });
    await grantFirmRole({ firmId: firm.id, userId: user.id, role: 'APP_ADMIN', actorUserId: user.id });
    const roles = await listFirmRolesForUser(user.id);
    expect(roles).toEqual(['APP_ADMIN']);
  });

  it('revokes a firm-level role and removes it from the lookup', async () => {
    const { firm, user } = await makeFirmWithUser();
    await grantFirmRole({ firmId: firm.id, userId: user.id, role: 'SUPPORT_LEAD', actorUserId: user.id });
    await revokeFirmRole({ firmId: firm.id, userId: user.id, role: 'SUPPORT_LEAD', actorUserId: user.id });
    const roles = await listFirmRolesForUser(user.id);
    expect(roles).toEqual([]);
  });

  it('listFirmUsersWithRoles aggregates one row per user with their role list', async () => {
    const { firm, user } = await makeFirmWithUser();
    await grantFirmRole({ firmId: firm.id, userId: user.id, role: 'APP_ADMIN', actorUserId: user.id });
    await grantFirmRole({ firmId: firm.id, userId: user.id, role: 'INTERNAL_ACCOUNTANT', actorUserId: user.id });
    const rows = await listFirmUsersWithRoles(firm.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(user.id);
    expect([...rows[0].roles].sort()).toEqual(['APP_ADMIN', 'INTERNAL_ACCOUNTANT']);
  });
});

// ─── EngagementRole ──────────────────────────────────────────────────────────

describe('EngagementRole CRUD', () => {
  it('grants an engagement-level role on a specific engagement', async () => {
    const { firm, user } = await makeFirmWithUser();
    const eng = await createEngagement({ firmId: firm.id, clientName: 'X', adaptorId: 'netsuite' });
    if (!eng) throw new Error('createEngagement failed');
    await grantEngagementRole({
      engagementId: eng.id as string,
      userId: user.id,
      role: 'PROJECT_LEAD',
      assignedModules: null,
      actorUserId: user.id,
    });
    const r = await listEngagementRolesForUser(user.id, eng.id as string);
    expect(r).toEqual([{ role: 'PROJECT_LEAD', assignedModules: null }]);
  });

  it('persists assignedModules JSON for module-scoped roles', async () => {
    const { firm, user } = await makeFirmWithUser();
    const eng = await createEngagement({ firmId: firm.id, clientName: 'X', adaptorId: 'netsuite' });
    if (!eng) throw new Error('createEngagement failed');
    await grantEngagementRole({
      engagementId: eng.id as string,
      userId: user.id,
      role: 'FUNCTIONAL_CONSULTANT',
      assignedModules: ['r2r', 'p2p'],
      actorUserId: user.id,
    });
    const r = await listEngagementRolesForUser(user.id, eng.id as string);
    expect(r).toEqual([{ role: 'FUNCTIONAL_CONSULTANT', assignedModules: ['r2r', 'p2p'] }]);
  });

  it('rejects a firm-only role (e.g. APP_ADMIN) on the engagement table', async () => {
    const { firm, user } = await makeFirmWithUser();
    const eng = await createEngagement({ firmId: firm.id, clientName: 'X', adaptorId: 'netsuite' });
    if (!eng) throw new Error('createEngagement failed');
    await expect(
      grantEngagementRole({
        engagementId: eng.id as string,
        userId: user.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        role: 'APP_ADMIN' as any,
        assignedModules: null,
        actorUserId: user.id,
      }),
    ).rejects.toThrow();
  });

  it('is idempotent on repeat grants of the same engagement role (replaces modules)', async () => {
    const { firm, user } = await makeFirmWithUser();
    const eng = await createEngagement({ firmId: firm.id, clientName: 'X', adaptorId: 'netsuite' });
    if (!eng) throw new Error('createEngagement failed');
    await grantEngagementRole({
      engagementId: eng.id as string,
      userId: user.id,
      role: 'FUNCTIONAL_CONSULTANT',
      assignedModules: ['r2r'],
      actorUserId: user.id,
    });
    // Re-grant with different modules — the second grant wins.
    await grantEngagementRole({
      engagementId: eng.id as string,
      userId: user.id,
      role: 'FUNCTIONAL_CONSULTANT',
      assignedModules: ['o2c'],
      actorUserId: user.id,
    });
    const r = await listEngagementRolesForUser(user.id, eng.id as string);
    expect(r).toHaveLength(1);
    expect(r[0].assignedModules).toEqual(['o2c']);
  });

  it('revoke removes the row', async () => {
    const { firm, user } = await makeFirmWithUser();
    const eng = await createEngagement({ firmId: firm.id, clientName: 'X', adaptorId: 'netsuite' });
    if (!eng) throw new Error('createEngagement failed');
    await grantEngagementRole({
      engagementId: eng.id as string,
      userId: user.id,
      role: 'PROJECT_MANAGER',
      assignedModules: null,
      actorUserId: user.id,
    });
    await revokeEngagementRole({
      engagementId: eng.id as string,
      userId: user.id,
      role: 'PROJECT_MANAGER',
      actorUserId: user.id,
    });
    expect(await listEngagementRolesForUser(user.id, eng.id as string)).toEqual([]);
  });

  it('listEngagementRolesForEngagement returns one entry per (user, role) tuple', async () => {
    const { firm, user } = await makeFirmWithUser();
    const eng = await createEngagement({ firmId: firm.id, clientName: 'X', adaptorId: 'netsuite' });
    if (!eng) throw new Error('createEngagement failed');
    await grantEngagementRole({
      engagementId: eng.id as string,
      userId: user.id,
      role: 'PROJECT_MANAGER',
      assignedModules: null,
      actorUserId: user.id,
    });
    await grantEngagementRole({
      engagementId: eng.id as string,
      userId: user.id,
      role: 'CLIENT_SPONSOR',
      assignedModules: null,
      actorUserId: user.id,
    });
    const rows = await listEngagementRolesForEngagement(eng.id as string);
    expect(rows).toHaveLength(2);
    expect([...rows.map((r) => r.role)].sort()).toEqual(['CLIENT_SPONSOR', 'PROJECT_MANAGER']);
  });

  it('multi-engagement stacking: same user can hold different roles on different engagements', async () => {
    const { firm, user } = await makeFirmWithUser();
    const engA = await createEngagement({ firmId: firm.id, clientName: 'A', adaptorId: 'netsuite' });
    const engB = await createEngagement({ firmId: firm.id, clientName: 'B', adaptorId: 'netsuite' });
    if (!engA || !engB) throw new Error('createEngagement failed');
    await grantEngagementRole({
      engagementId: engA.id as string,
      userId: user.id,
      role: 'PROJECT_LEAD',
      assignedModules: null,
      actorUserId: user.id,
    });
    await grantEngagementRole({
      engagementId: engB.id as string,
      userId: user.id,
      role: 'FUNCTIONAL_CONSULTANT',
      assignedModules: ['r2r'],
      actorUserId: user.id,
    });
    expect(await listEngagementRolesForUser(user.id, engA.id as string)).toEqual([
      { role: 'PROJECT_LEAD', assignedModules: null },
    ]);
    expect(await listEngagementRolesForUser(user.id, engB.id as string)).toEqual([
      { role: 'FUNCTIONAL_CONSULTANT', assignedModules: ['r2r'] },
    ]);
  });
});

// ─── RoleAuditLog ────────────────────────────────────────────────────────────

describe('RoleAuditLog', () => {
  it('records a ROLE_GRANTED entry on every successful grant', async () => {
    const { firm, user } = await makeFirmWithUser();
    await grantFirmRole({
      firmId: firm.id,
      userId: user.id,
      role: 'APP_ADMIN',
      actorUserId: user.id,
    });
    const log = await listRoleAuditLog(firm.id);
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe('ROLE_GRANTED');
    expect(log[0].role).toBe('APP_ADMIN');
    expect(log[0].scope).toBe('FIRM');
  });

  it('records a ROLE_REVOKED entry on revoke', async () => {
    const { firm, user } = await makeFirmWithUser();
    await grantFirmRole({ firmId: firm.id, userId: user.id, role: 'APP_ADMIN', actorUserId: user.id });
    await revokeFirmRole({ firmId: firm.id, userId: user.id, role: 'APP_ADMIN', actorUserId: user.id });
    const log = await listRoleAuditLog(firm.id);
    const actions = log.map((l) => l.action);
    expect(actions).toContain('ROLE_GRANTED');
    expect(actions).toContain('ROLE_REVOKED');
  });

  it('engagement scope is recorded as ENGAGEMENT:<id>', async () => {
    const { firm, user } = await makeFirmWithUser();
    const eng = await createEngagement({ firmId: firm.id, clientName: 'X', adaptorId: 'netsuite' });
    if (!eng) throw new Error('createEngagement failed');
    await grantEngagementRole({
      engagementId: eng.id as string,
      userId: user.id,
      role: 'PROJECT_MANAGER',
      assignedModules: null,
      actorUserId: user.id,
    });
    const log = await listRoleAuditLog(firm.id);
    expect(log.some((l) => l.scope === `ENGAGEMENT:${eng.id}`)).toBe(true);
  });
});

// ─── Auto-grant APP_ADMIN on firm creation ──────────────────────────────────

describe('bootstrapFirmAdmin (auto-grant on firm creation)', () => {
  it('grants APP_ADMIN to the creating user', async () => {
    const { firm, user } = await makeFirmWithUser();
    await bootstrapFirmAdmin({ firmId: firm.id, userId: user.id });
    const roles = await listFirmRolesForUser(user.id);
    expect(roles).toContain('APP_ADMIN');
  });

  it('records the bootstrap as a ROLE_GRANTED audit entry', async () => {
    const { firm, user } = await makeFirmWithUser();
    await bootstrapFirmAdmin({ firmId: firm.id, userId: user.id });
    const log = await listRoleAuditLog(firm.id);
    expect(log.some((l) => l.action === 'ROLE_GRANTED' && l.role === 'APP_ADMIN')).toBe(true);
  });

  it('is idempotent — calling twice still yields a single APP_ADMIN row', async () => {
    const { firm, user } = await makeFirmWithUser();
    await bootstrapFirmAdmin({ firmId: firm.id, userId: user.id });
    await bootstrapFirmAdmin({ firmId: firm.id, userId: user.id });
    const roles = await listFirmRolesForUser(user.id);
    expect(roles.filter((r) => r === 'APP_ADMIN')).toHaveLength(1);
  });
});

// ─── Phase 43.7 — backfill APP_ADMIN for existing firms ──────────────────────

describe('backfillAppAdmins', () => {
  /**
   * Create a firm with `userCount` users inserted via direct SQL with
   * staggered createdAt so the "oldest" check is deterministic. The
   * users array is ordered by createdAt ASC — index 0 is the oldest.
   */
  async function makeFirmWithUsers(userCount: number, firmSlug: string): Promise<{
    firmId: string;
    users: Array<{ id: string; email: string }>;
  }> {
    const db = getDb();
    const firmId = `firm-${firmSlug}`;
    const baseTime = Date.parse('2026-01-01T00:00:00.000Z');
    await db.execute({
      sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
      args: [firmId, `Firm ${firmSlug}`, firmSlug, 'STARTER', new Date(baseTime).toISOString()],
    });
    const users: Array<{ id: string; email: string }> = [];
    for (let i = 0; i < userCount; i++) {
      const id = `${firmSlug}-user-${i}`;
      const email = `${firmSlug}-${i}@example.com`;
      // Stagger createdAt by 1s per user so ORDER BY createdAt ASC
      // returns them in insertion order regardless of clock skew.
      const createdAt = new Date(baseTime + i * 1000).toISOString();
      await db.execute({
        sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
        args: [id, firmId, email, `User ${i}`, 'x', 'CONSULTANT', createdAt],
      });
      users.push({ id, email });
    }
    return { firmId, users };
  }

  it('grants APP_ADMIN to the oldest user in each firm that lacks one', async () => {
    const a = await makeFirmWithUsers(3, 'alpha');
    const b = await makeFirmWithUsers(2, 'bravo');

    const result = await backfillAppAdmins();
    expect(result.granted).toHaveLength(2);
    expect(result.granted.map((g) => g.firmId).sort()).toEqual([a.firmId, b.firmId].sort());

    // The oldest user (index 0) should be the recipient in each firm.
    const aRoles = await listFirmRolesForUser(a.users[0].id);
    expect(aRoles).toContain('APP_ADMIN');
    const bRoles = await listFirmRolesForUser(b.users[0].id);
    expect(bRoles).toContain('APP_ADMIN');

    // No grant on the other users in firm A.
    expect(await listFirmRolesForUser(a.users[1].id)).toEqual([]);
    expect(await listFirmRolesForUser(a.users[2].id)).toEqual([]);
  });

  it('skips firms that already have an APP_ADMIN', async () => {
    const a = await makeFirmWithUsers(2, 'has-admin');
    // Pre-grant to the second user (NOT the oldest) so we can prove
    // the backfill respects the existing row.
    await grantFirmRole({
      firmId: a.firmId,
      userId: a.users[1].id,
      role: 'APP_ADMIN',
      actorUserId: a.users[1].id,
    });

    const b = await makeFirmWithUsers(2, 'no-admin');

    const result = await backfillAppAdmins();
    // Only firm B got a grant.
    expect(result.granted).toHaveLength(1);
    expect(result.granted[0].firmId).toBe(b.firmId);

    // Firm A still has the original (non-oldest) admin and nothing
    // else — the backfill didn't add a second one.
    const usersWithAdminInA = await listFirmUsersWithRoles(a.firmId);
    const adminsInA = usersWithAdminInA.filter((u) => u.roles.includes('APP_ADMIN'));
    expect(adminsInA).toHaveLength(1);
    expect(adminsInA[0].userId).toBe(a.users[1].id); // unchanged
  });

  it('is idempotent — re-running produces no new rows', async () => {
    await makeFirmWithUsers(2, 'rerun');

    const first = await backfillAppAdmins();
    expect(first.granted).toHaveLength(1);

    const second = await backfillAppAdmins();
    expect(second.granted).toHaveLength(0);
  });

  it('writes an ADMIN_BACKFILL_GRANTED audit entry per granted firm', async () => {
    const a = await makeFirmWithUsers(2, 'audit-test');
    await backfillAppAdmins();

    const log = await listRoleAuditLog(a.firmId);
    const backfillEntries = log.filter((l) => l.action === 'ADMIN_BACKFILL_GRANTED');
    expect(backfillEntries).toHaveLength(1);
    expect(backfillEntries[0].role).toBe('APP_ADMIN');
    expect(backfillEntries[0].targetUserId).toBe(a.users[0].id);
    expect(backfillEntries[0].scope).toBe('FIRM');
  });

  it('skips firms with zero users (no candidate to grant to)', async () => {
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
      args: ['empty-firm', 'Empty Firm', 'empty-firm-slug', 'STARTER', new Date().toISOString()],
    });

    const result = await backfillAppAdmins();
    expect(result.granted).toHaveLength(0);
    expect(result.skippedNoUsers).toBe(1);
  });
});
