/**
 * Phase 43.6 — RBAC smoke seed.
 *
 * Adds four fake users to whatever firm has the slug "xelerate" (or
 * the first firm if that one doesn't exist) plus role assignments
 * that exercise the four canonical role shapes:
 *
 *   sales.rep@xelerate.example       — SALES_REP on the first non-archived
 *                                       engagement (sales scope)
 *   pm@xelerate.example              — PROJECT_MANAGER on the first engagement
 *                                       whose name contains "Acme" (impl scope)
 *   functional.finance@xelerate.example — FUNCTIONAL_CONSULTANT on the same
 *                                       Acme engagement, modules = [r2r]
 *                                       (impl + module scope)
 *   accountant@xelerate.example      — INTERNAL_ACCOUNTANT firm-wide
 *                                       (firm scope, billing-only)
 *
 * Idempotent: re-running upserts the users (last-write-wins on name)
 * and re-grants the roles (the underlying helpers are idempotent).
 *
 * All four users get the same easy-to-type password ("rbac-demo")
 * since they're demo-only fixtures — never deploy this seed to prod.
 *
 * Run via:
 *   pnpm --filter @ofoq/api exec tsx src/seed-rbac.ts
 */

import bcrypt from 'bcryptjs';
import { initDb, getDb, grantFirmRole, grantEngagementRole, type GrantEngagementRoleArgs } from './db/index.js';
import { createId } from '@paralleldrive/cuid2';
import type { FirmRole, EngagementRole } from './types/roles.js';

const DEMO_PASSWORD = 'rbac-demo';

interface SeedUser {
  email: string;
  name: string;
  firmRole?: FirmRole;
  engagementRole?: { role: EngagementRole; modules?: string[] | null; engagementMatch: string | null };
}

const SEED_USERS: SeedUser[] = [
  {
    email: 'sales.rep@xelerate.example',
    name: 'Sales Rep (demo)',
    engagementRole: { role: 'SALES_REP', engagementMatch: null },
  },
  {
    email: 'pm@xelerate.example',
    name: 'Project Manager (demo)',
    engagementRole: { role: 'PROJECT_MANAGER', engagementMatch: 'acme' },
  },
  {
    email: 'functional.finance@xelerate.example',
    name: 'Functional Consultant — Finance (demo)',
    engagementRole: { role: 'FUNCTIONAL_CONSULTANT', modules: ['r2r'], engagementMatch: 'acme' },
  },
  {
    email: 'accountant@xelerate.example',
    name: 'Internal Accountant (demo)',
    firmRole: 'INTERNAL_ACCOUNTANT',
  },
];

async function findFirmId(): Promise<string> {
  const db = getDb();
  const xelerate = await db.execute({ sql: `SELECT id FROM Firm WHERE slug = ? LIMIT 1`, args: ['xelerate'] });
  if (xelerate.rows[0]) return (xelerate.rows[0] as Record<string, unknown>).id as string;
  // Fallback to the first firm.
  const any = await db.execute({ sql: `SELECT id FROM Firm ORDER BY createdAt ASC LIMIT 1`, args: [] });
  if (!any.rows[0]) throw new Error('No firms found — run the main seed first.');
  return (any.rows[0] as Record<string, unknown>).id as string;
}

async function findOrCreateUser(args: { firmId: string; email: string; name: string }): Promise<string> {
  const db = getDb();
  const found = await db.execute({ sql: `SELECT id FROM User WHERE email = ? LIMIT 1`, args: [args.email] });
  if (found.rows[0]) return (found.rows[0] as Record<string, unknown>).id as string;
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const id = createId();
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
    args: [id, args.firmId, args.email, args.name, passwordHash, 'CONSULTANT'],
  });
  return id;
}

async function pickEngagement(firmId: string, match: string | null): Promise<string | null> {
  const db = getDb();
  if (match) {
    const r = await db.execute({
      sql: `SELECT id FROM Engagement WHERE firmId = ? AND lower(clientName) LIKE ? AND status != 'ARCHIVED' LIMIT 1`,
      args: [firmId, `%${match.toLowerCase()}%`],
    });
    if (r.rows[0]) return (r.rows[0] as Record<string, unknown>).id as string;
  }
  const r = await db.execute({
    sql: `SELECT id FROM Engagement WHERE firmId = ? AND status != 'ARCHIVED' ORDER BY createdAt ASC LIMIT 1`,
    args: [firmId],
  });
  return r.rows[0] ? ((r.rows[0] as Record<string, unknown>).id as string) : null;
}

async function main() {
  await initDb();
  const firmId = await findFirmId();
  console.log(`[seed-rbac] firm: ${firmId}`);

  for (const u of SEED_USERS) {
    const userId = await findOrCreateUser({ firmId, email: u.email, name: u.name });
    console.log(`[seed-rbac] user: ${u.email} (${userId})`);

    if (u.firmRole) {
      await grantFirmRole({ firmId, userId, role: u.firmRole, actorUserId: userId });
      console.log(`  → firm role: ${u.firmRole}`);
    }

    if (u.engagementRole) {
      const engagementId = await pickEngagement(firmId, u.engagementRole.engagementMatch);
      if (!engagementId) {
        console.log(`  ⚠ no engagement to assign ${u.engagementRole.role} to — skipping`);
        continue;
      }
      const grant: GrantEngagementRoleArgs = {
        engagementId,
        userId,
        role: u.engagementRole.role,
        assignedModules: u.engagementRole.modules ?? null,
        actorUserId: userId,
      };
      await grantEngagementRole(grant);
      console.log(`  → engagement role: ${u.engagementRole.role} on ${engagementId}`);
    }
  }

  console.log('\n[seed-rbac] done. Demo password for all four users: rbac-demo');
  console.log('[seed-rbac] Logins:');
  for (const u of SEED_USERS) console.log(`  ${u.email}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[seed-rbac] failed:', err);
    process.exit(1);
  },
);
