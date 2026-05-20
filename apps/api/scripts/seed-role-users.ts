/**
 * Phase 53.3 — Role demo users seeded per ERP-implementation
 * methodology.
 *
 * Idempotent by email. Sets `mustResetPassword=1` so a seeded
 * user's first login forces a reset (the shared `12345678`
 * password is a demo convenience, not a production secret).
 *
 * Engagement-role grants are distributed across the `[DEMO]`
 * lifecycle customers (from `seed-lifecycle.ts`) so staffing
 * looks realistic — functional consultants on
 * Discovery/Scoping/Build/UAT customers, support on
 * Hypercare/Live-SLA, etc.
 *
 * CLI:    `pnpm -F @ofoq/api seed:role-users` (reads SEED_FIRM_ID)
 * Route:  `POST /api/v1/admin/seed-role-users` (APP_ADMIN-gated)
 */
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { initDb, getDb } from '../src/db/index.js';
import {
  grantFirmRole,
  grantEngagementRole,
} from '../src/db/rbac.js';
import type { CustomerStage } from '../src/db/customer.js';
import type {
  FirmRole,
  EngagementRole,
} from '../src/types/roles.js';

const DEMO_PASSWORD = '12345678';

interface FirmUserSpec {
  email: string;
  name: string;
  role: FirmRole;
}

interface EngagementUserSpec {
  email: string;
  name: string;
  role: EngagementRole;
  /** When set, the seeder grants this role on every `[DEMO]` customer
   *  at one of these stages. `null` means "grant on all demos". */
  onStages?: ReadonlyArray<CustomerStage>;
  /** assignedModules JSON for module/track-scoped roles. */
  assignedModules?: ReadonlyArray<string>;
}

const FIRM_USERS: ReadonlyArray<FirmUserSpec> = [
  { email: 'essam@unitedofoq.com', name: 'Essam (CEO)', role: 'CEO' },
  { email: 'demo-admin@unitedofoq.com', name: 'Demo Admin', role: 'APP_ADMIN' },
  { email: 'demo-salesmgr@unitedofoq.com', name: 'Demo Sales Manager', role: 'SALES_MANAGER' },
  { email: 'demo-supportlead@unitedofoq.com', name: 'Demo Support Lead', role: 'SUPPORT_LEAD' },
  { email: 'demo-accountant@unitedofoq.com', name: 'Demo Accountant', role: 'INTERNAL_ACCOUNTANT' },
];

const ENGAGEMENT_USERS: ReadonlyArray<EngagementUserSpec> = [
  // Sales / delivery management
  {
    email: 'demo-salesrep@unitedofoq.com',
    name: 'Demo Sales Rep',
    role: 'SALES_REP',
    onStages: ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'],
  },
  {
    email: 'demo-pm@unitedofoq.com',
    name: 'Demo Project Manager',
    role: 'PROJECT_MANAGER',
    onStages: ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GOLIVE'],
  },
  {
    email: 'demo-projectlead@unitedofoq.com',
    name: 'Demo Project Lead',
    role: 'PROJECT_LEAD',
    onStages: ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GOLIVE'],
  },
  {
    email: 'demo-am@unitedofoq.com',
    name: 'Demo Account Manager',
    role: 'ACCOUNT_MANAGER',
    onStages: ['LIVE_SLA', 'RENEWAL_DUE'],
  },
  // Functional consultants — one per NetSuite functional track.
  {
    email: 'demo-fc-finance@unitedofoq.com',
    name: 'Demo FC — Finance',
    role: 'FUNCTIONAL_CONSULTANT',
    onStages: ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT'],
    assignedModules: ['gl-ar-ap', 'fixed-assets', 'advanced-revenue', 'budgeting-fp-and-a'],
  },
  {
    email: 'demo-fc-scm@unitedofoq.com',
    name: 'Demo FC — Supply Chain',
    role: 'FUNCTIONAL_CONSULTANT',
    onStages: ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT'],
    assignedModules: ['inventory', 'order-management', 'procurement'],
  },
  {
    email: 'demo-fc-manufacturing@unitedofoq.com',
    name: 'Demo FC — Manufacturing',
    role: 'FUNCTIONAL_CONSULTANT',
    onStages: ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT'],
    assignedModules: ['manufacturing'],
  },
  {
    email: 'demo-fc-crm@unitedofoq.com',
    name: 'Demo FC — CRM',
    role: 'FUNCTIONAL_CONSULTANT',
    onStages: ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT'],
    assignedModules: ['crm'],
  },
  {
    email: 'demo-fc-projects@unitedofoq.com',
    name: 'Demo FC — Projects/PSA',
    role: 'FUNCTIONAL_CONSULTANT',
    onStages: ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT'],
    assignedModules: ['projects'],
  },
  // Technical consultants — one per discipline.
  {
    email: 'demo-tc-integration@unitedofoq.com',
    name: 'Demo TC — Integrations',
    role: 'TECHNICAL_CONSULTANT',
    onStages: ['BUILD', 'UAT', 'GOLIVE'],
    assignedModules: ['integration'],
  },
  {
    email: 'demo-tc-data@unitedofoq.com',
    name: 'Demo TC — Data Migration',
    role: 'TECHNICAL_CONSULTANT',
    onStages: ['DISCOVERY', 'BUILD', 'UAT', 'GOLIVE'],
    assignedModules: ['data-migration'],
  },
  {
    email: 'demo-tc-dev@unitedofoq.com',
    name: 'Demo TC — Customization',
    role: 'TECHNICAL_CONSULTANT',
    onStages: ['BUILD', 'UAT'],
    assignedModules: ['customization'],
  },
  // Support engineer — Hypercare / Live SLA.
  {
    email: 'demo-support@unitedofoq.com',
    name: 'Demo Support Engineer',
    role: 'SUPPORT_ENGINEER',
    onStages: ['HYPERCARE', 'LIVE_SLA'],
  },
];

export interface SeedRoleUsersResult {
  firmId: string;
  firmUsersCreated: number;
  firmUsersExisting: number;
  engagementUsersCreated: number;
  engagementUsersExisting: number;
  engagementGrants: number;
  totalUsers: number;
}

interface ExistingUserRow {
  id: unknown;
}

async function upsertUser(
  firmId: string,
  spec: FirmUserSpec | EngagementUserSpec,
  hashedPassword: string,
): Promise<{ userId: string; created: boolean }> {
  const db = getDb();
  const existing = await db.execute({
    sql: `SELECT id FROM User WHERE email = ? AND firmId = ? LIMIT 1`,
    args: [spec.email, firmId],
  });
  const row = existing.rows[0] as unknown as ExistingUserRow | undefined;
  if (row?.id) {
    // Existing row — refresh password + mustResetPassword so re-running
    // the seed leaves every demo account ready for first-login reset.
    const id = String(row.id);
    await db.execute({
      sql: `UPDATE User SET passwordHash = ?, mustResetPassword = 1 WHERE id = ?`,
      args: [hashedPassword, id],
    });
    return { userId: id, created: false };
  }
  const userId = createId();
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, mustResetPassword, createdAt)
          VALUES (?, ?, ?, ?, ?, 'CONSULTANT', 1, ?)`,
    args: [userId, firmId, spec.email, spec.name, hashedPassword, new Date().toISOString()],
  });
  return { userId, created: true };
}

async function findDemoCustomersAtStages(
  firmId: string,
  stages: ReadonlyArray<CustomerStage>,
): Promise<string[]> {
  const db = getDb();
  const placeholders = stages.map(() => '?').join(',');
  const r = await db.execute({
    sql: `SELECT id FROM Customer
          WHERE firmId = ? AND name LIKE '[DEMO]%'
            AND currentStage IN (${placeholders})`,
    args: [firmId, ...stages],
  });
  return r.rows.map((row) => String((row as unknown as { id: unknown }).id));
}

export async function seedRoleUsersForFirm(firmId: string): Promise<SeedRoleUsersResult> {
  const hashed = await bcrypt.hash(DEMO_PASSWORD, 10);
  let firmCreated = 0;
  let firmExisting = 0;
  let engagementCreated = 0;
  let engagementExisting = 0;
  let engagementGrants = 0;

  // ─── Firm-level users + role grants ────────────────────────────────
  for (const spec of FIRM_USERS) {
    const { userId, created } = await upsertUser(firmId, spec, hashed);
    if (created) firmCreated++;
    else firmExisting++;
    try {
      await grantFirmRole({
        firmId,
        userId,
        role: spec.role,
        actorUserId: userId, // self-grant for the demo seed
      });
    } catch {
      // grantFirmRole is idempotent on the UNIQUE(firmId, userId, role)
      // index — swallow re-grant errors.
    }
  }

  // ─── Engagement-level users ───────────────────────────────────────
  for (const spec of ENGAGEMENT_USERS) {
    const { userId, created } = await upsertUser(firmId, spec, hashed);
    if (created) engagementCreated++;
    else engagementExisting++;

    // Find demo customers matching this spec's stages.
    const stages = spec.onStages ?? [];
    if (stages.length === 0) continue;
    const customerIds = await findDemoCustomersAtStages(firmId, stages);
    for (const cid of customerIds) {
      try {
        await grantEngagementRole({
          engagementId: cid,
          userId,
          role: spec.role,
          assignedModules: spec.assignedModules ? [...spec.assignedModules] : null,
          actorUserId: userId,
        });
        engagementGrants++;
      } catch {
        // Idempotent — re-grants throw on UNIQUE constraint.
      }
    }
  }

  return {
    firmId,
    firmUsersCreated: firmCreated,
    firmUsersExisting: firmExisting,
    engagementUsersCreated: engagementCreated,
    engagementUsersExisting: engagementExisting,
    engagementGrants,
    totalUsers: firmCreated + firmExisting + engagementCreated + engagementExisting,
  };
}

async function pickDefaultFirm(): Promise<string> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT id FROM Firm ORDER BY createdAt ASC LIMIT 1` });
  const row = r.rows[0] as unknown as { id?: string } | undefined;
  if (!row?.id) throw new Error('No firms in DB — create one before seeding role users.');
  return row.id;
}

async function runCli(): Promise<void> {
  await initDb();
  const firmId = process.env.SEED_FIRM_ID ?? (await pickDefaultFirm());
  const result = await seedRoleUsersForFirm(firmId);
  // eslint-disable-next-line no-console
  console.log(
    `[seed:role-users] firm=${firmId} firm-users=${result.firmUsersCreated}/${result.firmUsersExisting + result.firmUsersCreated} ` +
      `eng-users=${result.engagementUsersCreated}/${result.engagementUsersExisting + result.engagementUsersCreated} ` +
      `eng-grants=${result.engagementGrants}`,
  );
  // eslint-disable-next-line no-console
  console.log(`[seed:role-users] demo password='${DEMO_PASSWORD}' — users must reset on first login`);
}

const isDirectInvocation = (() => {
  try {
    return (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('scripts/seed-role-users.ts');
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  runCli().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[seed:role-users] failed:', e);
    process.exit(1);
  });
}
