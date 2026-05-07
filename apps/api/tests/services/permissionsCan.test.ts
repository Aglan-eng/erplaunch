/**
 * Phase 43.1 — integration coverage for the `can()` runtime entry
 * point. Walks through a few realistic scenarios stitching together
 * DB-backed role lookups + the matrix evaluation:
 *
 *   - User with no roles is locked out everywhere
 *   - APP_ADMIN can do everything regardless of stage
 *   - SALES_REP on engagement A can write at PROSPECT but is read-only
 *     after CONTRACTED, and has no access to engagement B
 *   - PROJECT_LEAD on A + FUNCTIONAL_CONSULTANT on B (multi-engagement
 *     stacking) — different access on each
 *   - INTERNAL_ACCOUNTANT (firm-level) sees BILLING on every
 *     engagement
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  createFirm,
  createUser,
  createEngagement,
  grantFirmRole,
  grantEngagementRole,
  listFirmRolesForUser,
  listEngagementRolesForUser,
} from '../../src/db/index.js';
import { can } from '../../src/services/permissions.js';
import type { Role } from '../../src/types/roles.js';

let cleanup: () => void;

beforeEach(async () => {
  ({ cleanup } = await setupTestDb());
});
afterEach(() => cleanup());

async function makeFirmAndUser(emailSuffix = 'a') {
  const firm = await createFirm({
    name: 'Acme',
    slug: `acme-${emailSuffix}-${Math.random().toString(36).slice(2, 8)}`,
    plan: 'STARTER',
  });
  if (!firm) throw new Error('createFirm failed');
  const user = await createUser({
    firmId: firm.id,
    email: `u-${emailSuffix}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    name: 'User',
    passwordHash: 'x',
    role: 'CONSULTANT',
  });
  if (!user) throw new Error('createUser failed');
  return { firm, user };
}

async function rolesForUserOnEngagement(userId: string, engagementId: string): Promise<Role[]> {
  const firm = await listFirmRolesForUser(userId);
  const eng = (await listEngagementRolesForUser(userId, engagementId)).map((r) => r.role);
  return [...firm, ...eng];
}

// ─── No roles: locked out ────────────────────────────────────────────────────

describe('can() — user with no roles', () => {
  it('returns false for every resource at every stage', async () => {
    const { firm, user } = await makeFirmAndUser();
    const eng = await createEngagement({ firmId: firm.id, clientName: 'X', adaptorId: 'netsuite' });
    if (!eng) throw new Error('createEngagement failed');
    const roles = await rolesForUserOnEngagement(user.id, eng.id as string);
    expect(roles).toEqual([]);
    expect(
      can({ firmRoles: [], engagementRoles: [], stage: 'BUILD' }, 'READ', 'WIZARD_ANSWERS'),
    ).toBe(false);
    expect(
      can({ firmRoles: [], engagementRoles: [], stage: 'PROSPECT' }, 'WRITE', 'BILLING'),
    ).toBe(false);
  });
});

// ─── APP_ADMIN ───────────────────────────────────────────────────────────────

describe('can() — APP_ADMIN', () => {
  it('grants WRITE on everything regardless of stage', async () => {
    const { firm, user } = await makeFirmAndUser();
    await grantFirmRole({
      firmId: firm.id,
      userId: user.id,
      role: 'APP_ADMIN',
      actorUserId: user.id,
    });
    const roles = await listFirmRolesForUser(user.id);
    expect(roles).toEqual(['APP_ADMIN']);
    expect(
      can({ firmRoles: roles, engagementRoles: [], stage: 'PROSPECT' }, 'WRITE', 'BILLING'),
    ).toBe(true);
    expect(
      can({ firmRoles: roles, engagementRoles: [], stage: 'ARCHIVED' }, 'WRITE', 'GENERATORS'),
    ).toBe(true);
  });
});

// ─── SALES_REP on one engagement only ────────────────────────────────────────

describe('can() — SALES_REP scope isolation', () => {
  it('writes on assigned engagement at PROSPECT but is read-only post-CONTRACTED', async () => {
    const { firm, user } = await makeFirmAndUser();
    const engA = await createEngagement({ firmId: firm.id, clientName: 'A', adaptorId: 'netsuite' });
    if (!engA) throw new Error('createEngagement failed');
    await grantEngagementRole({
      engagementId: engA.id as string,
      userId: user.id,
      role: 'SALES_REP',
      assignedModules: null,
      actorUserId: user.id,
    });
    const rolesA = await rolesForUserOnEngagement(user.id, engA.id as string);
    expect(rolesA).toEqual(['SALES_REP']);

    expect(
      can({ firmRoles: [], engagementRoles: ['SALES_REP'], stage: 'PROSPECT' }, 'WRITE', 'ENGAGEMENT_META'),
    ).toBe(true);
    expect(
      can({ firmRoles: [], engagementRoles: ['SALES_REP'], stage: 'BUILD' }, 'WRITE', 'ENGAGEMENT_META'),
    ).toBe(false);
    expect(
      can({ firmRoles: [], engagementRoles: ['SALES_REP'], stage: 'BUILD' }, 'READ', 'ENGAGEMENT_META'),
    ).toBe(true);
  });

  it('has zero access to a different engagement (no role row)', async () => {
    const { firm, user } = await makeFirmAndUser();
    const engA = await createEngagement({ firmId: firm.id, clientName: 'A', adaptorId: 'netsuite' });
    const engB = await createEngagement({ firmId: firm.id, clientName: 'B', adaptorId: 'netsuite' });
    if (!engA || !engB) throw new Error('createEngagement failed');
    await grantEngagementRole({
      engagementId: engA.id as string,
      userId: user.id,
      role: 'SALES_REP',
      assignedModules: null,
      actorUserId: user.id,
    });
    const rolesOnB = await rolesForUserOnEngagement(user.id, engB.id as string);
    expect(rolesOnB).toEqual([]);
    expect(
      can({ firmRoles: [], engagementRoles: rolesOnB, stage: 'PROSPECT' }, 'READ', 'ENGAGEMENT_META'),
    ).toBe(false);
  });
});

// ─── Multi-engagement stacking ───────────────────────────────────────────────

describe('can() — multi-engagement role stacking', () => {
  it('PROJECT_LEAD on A + FUNCTIONAL_CONSULTANT on B → different access on each', async () => {
    const { firm, user } = await makeFirmAndUser();
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

    const rolesOnA = (await listEngagementRolesForUser(user.id, engA.id as string)).map((r) => r.role);
    const rolesOnB = (await listEngagementRolesForUser(user.id, engB.id as string)).map((r) => r.role);
    expect(rolesOnA).toEqual(['PROJECT_LEAD']);
    expect(rolesOnB).toEqual(['FUNCTIONAL_CONSULTANT']);

    // PROJECT_LEAD on A → WRITE on RISKS at BUILD.
    expect(
      can({ firmRoles: [], engagementRoles: rolesOnA, stage: 'BUILD' }, 'WRITE', 'RISKS'),
    ).toBe(true);
    // FUNCTIONAL_CONSULTANT on B → READ-only on RISKS at PROSPECT.
    expect(
      can({ firmRoles: [], engagementRoles: rolesOnB, stage: 'PROSPECT' }, 'WRITE', 'RISKS'),
    ).toBe(false);
    // FUNCTIONAL_CONSULTANT on B → WRITE on WIZARD_ANSWERS at DISCOVERY.
    expect(
      can({ firmRoles: [], engagementRoles: rolesOnB, stage: 'DISCOVERY' }, 'WRITE', 'WIZARD_ANSWERS'),
    ).toBe(true);
  });
});

// ─── INTERNAL_ACCOUNTANT firm-wide ───────────────────────────────────────────

describe('can() — INTERNAL_ACCOUNTANT', () => {
  it('grants WRITE on BILLING on every engagement (firm-level role)', async () => {
    const { firm, user } = await makeFirmAndUser();
    await grantFirmRole({
      firmId: firm.id,
      userId: user.id,
      role: 'INTERNAL_ACCOUNTANT',
      actorUserId: user.id,
    });
    const firmRoles = await listFirmRolesForUser(user.id);
    expect(firmRoles).toEqual(['INTERNAL_ACCOUNTANT']);
    // Across multiple stages — BILLING write everywhere.
    for (const stage of ['PROSPECT', 'BUILD', 'GOLIVE', 'SLA_ACTIVE'] as const) {
      expect(
        can({ firmRoles, engagementRoles: [], stage }, 'WRITE', 'BILLING'),
      ).toBe(true);
    }
    // But NONE on DECISIONS / RISKS — field-level filter on top.
    expect(
      can({ firmRoles, engagementRoles: [], stage: 'BUILD' }, 'READ', 'DECISIONS'),
    ).toBe(false);
  });
});

// ─── Stacked firm + engagement roles ─────────────────────────────────────────

describe('can() — stacked firm + engagement roles', () => {
  it('takes the union — firm SALES_MANAGER + engagement PROJECT_LEAD = strongest of each per resource', async () => {
    const { firm, user } = await makeFirmAndUser();
    const eng = await createEngagement({ firmId: firm.id, clientName: 'X', adaptorId: 'netsuite' });
    if (!eng) throw new Error('createEngagement failed');
    await grantFirmRole({
      firmId: firm.id,
      userId: user.id,
      role: 'SALES_MANAGER',
      actorUserId: user.id,
    });
    await grantEngagementRole({
      engagementId: eng.id as string,
      userId: user.id,
      role: 'PROJECT_LEAD',
      assignedModules: null,
      actorUserId: user.id,
    });
    const firmRoles = await listFirmRolesForUser(user.id);
    const engRoles = (await listEngagementRolesForUser(user.id, eng.id as string)).map((r) => r.role);

    // PROJECT_LEAD has WRITE on RISKS at BUILD; SALES_MANAGER is READ;
    // stacked → WRITE.
    expect(
      can({ firmRoles, engagementRoles: engRoles, stage: 'BUILD' }, 'WRITE', 'RISKS'),
    ).toBe(true);
    // Neither role grants BILLING WRITE → false.
    expect(
      can({ firmRoles, engagementRoles: engRoles, stage: 'BUILD' }, 'WRITE', 'BILLING'),
    ).toBe(false);
  });
});
