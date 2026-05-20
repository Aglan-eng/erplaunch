/**
 * Phase 43.1 — RBAC CRUD helpers.
 *
 * Lives in its own file so `db/index.ts` doesn't grow further.
 * Re-exported through `db/index.ts` so call sites can keep importing
 * `from '../db/index.js'` regardless of where the symbol lives.
 *
 * Behaviours:
 *   - grantFirmRole / grantEngagementRole are idempotent (UNIQUE
 *     constraint on the role triple). Re-granting an existing role
 *     either no-ops (firm) or replaces the assignedModules (engagement).
 *   - Every grant / revoke writes a RoleAuditLog row for forensics.
 *   - Type guards reject mismatched scope (firm-level role on the
 *     engagement table or vice versa) BEFORE hitting SQLite, so the
 *     error message mentions the role catalog rather than a generic
 *     constraint violation.
 */

import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';
import {
  isFirmLevelRole,
  isEngagementLevelRole,
  type FirmRole,
  type EngagementRole,
  type Role,
} from '../types/roles.js';

// ─── Audit log ───────────────────────────────────────────────────────────────

export interface RoleAuditEntry {
  id: string;
  firmId: string;
  actorUserId: string;
  targetUserId: string;
  /**
   * ROLE_GRANTED + ROLE_REVOKED come from grantFirmRole / grantEngagementRole.
   * ADMIN_BACKFILL_GRANTED is the Phase 43.7 marker for the boot-time
   * migration that promoted the oldest user of a firm-without-admin
   * to APP_ADMIN — distinct from a normal grant so the audit trail
   * stays clean.
   */
  action: 'ROLE_GRANTED' | 'ROLE_REVOKED' | 'ADMIN_BACKFILL_GRANTED';
  role: Role;
  scope: string; // 'FIRM' | 'ENGAGEMENT:<id>'
  createdAt: string;
}

async function appendAudit(entry: Omit<RoleAuditEntry, 'id' | 'createdAt'>): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO RoleAuditLog (id, firmId, actorUserId, targetUserId, action, role, scope) VALUES (?,?,?,?,?,?,?)`,
    args: [createId(), entry.firmId, entry.actorUserId, entry.targetUserId, entry.action, entry.role, entry.scope],
  });
}

export async function listRoleAuditLog(firmId: string, limit = 100): Promise<RoleAuditEntry[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, firmId, actorUserId, targetUserId, action, role, scope, createdAt
          FROM RoleAuditLog
          WHERE firmId = ?
          ORDER BY createdAt DESC
          LIMIT ?`,
    args: [firmId, limit],
  });
  return r.rows.map((row) => row as unknown as RoleAuditEntry);
}

// ─── FirmRole ────────────────────────────────────────────────────────────────

export interface GrantFirmRoleArgs {
  firmId: string;
  userId: string;
  role: FirmRole;
  /** Who performed the grant (for audit). */
  actorUserId: string;
}

export async function grantFirmRole(args: GrantFirmRoleArgs): Promise<void> {
  if (!isFirmLevelRole(args.role)) {
    throw new Error(
      `grantFirmRole: '${args.role}' is not a firm-level role (allowed: APP_ADMIN, CEO, SALES_MANAGER, SUPPORT_LEAD, INTERNAL_ACCOUNTANT)`,
    );
  }
  const db = getDb();
  // Check for existing first — keeps the audit log from accumulating
  // duplicate ROLE_GRANTED entries when the UI sends an idempotent
  // re-grant. INSERT OR IGNORE alone would still record audit churn.
  const existing = await db.execute({
    sql: `SELECT id FROM FirmRole WHERE firmId = ? AND userId = ? AND role = ? LIMIT 1`,
    args: [args.firmId, args.userId, args.role],
  });
  if (existing.rows.length > 0) return;

  await db.execute({
    sql: `INSERT INTO FirmRole (id, firmId, userId, role) VALUES (?,?,?,?)`,
    args: [createId(), args.firmId, args.userId, args.role],
  });
  await appendAudit({
    firmId: args.firmId,
    actorUserId: args.actorUserId,
    targetUserId: args.userId,
    action: 'ROLE_GRANTED',
    role: args.role,
    scope: 'FIRM',
  });
}

export async function revokeFirmRole(args: GrantFirmRoleArgs): Promise<void> {
  const db = getDb();
  const r = await db.execute({
    sql: `DELETE FROM FirmRole WHERE firmId = ? AND userId = ? AND role = ?`,
    args: [args.firmId, args.userId, args.role],
  });
  // Only write the audit entry if a row actually went away — revoking
  // a role the user didn't have shouldn't pollute the log.
  if ((r.rowsAffected ?? 0) > 0) {
    await appendAudit({
      firmId: args.firmId,
      actorUserId: args.actorUserId,
      targetUserId: args.userId,
      action: 'ROLE_REVOKED',
      role: args.role,
      scope: 'FIRM',
    });
  }
}

export async function listFirmRolesForUser(userId: string): Promise<FirmRole[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT role FROM FirmRole WHERE userId = ? ORDER BY role ASC`,
    args: [userId],
  });
  return r.rows.map((row) => (row as unknown as { role: string }).role as FirmRole);
}

export interface FirmUserWithRoles {
  userId: string;
  roles: FirmRole[];
}

/**
 * Phase 45.3 — return id/name/email for every user in a firm holding
 * a particular firm-level role. Used by the GOLIVE → CLOSEOUT handoff
 * flow to find the SUPPORT_LEAD users who should receive the
 * "engagement entered Closeout" email.
 *
 * Joins through User to surface name + email so the caller can format
 * a friendly notification body without a second round-trip.
 */
export interface FirmRoleUserContact {
  userId: string;
  email: string;
  name: string;
}

export async function listFirmUsersByRole(
  firmId: string,
  role: FirmRole,
): Promise<FirmRoleUserContact[]> {
  if (!isFirmLevelRole(role)) {
    throw new Error(
      `listFirmUsersByRole: '${role}' is not a firm-level role`,
    );
  }
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT u.id AS userId, u.email AS email, u.name AS name
          FROM FirmRole fr
          JOIN User u ON u.id = fr.userId
          WHERE fr.firmId = ? AND fr.role = ?
          ORDER BY u.name ASC, u.id ASC`,
    args: [firmId, role],
  });
  return r.rows.map((row) => row as unknown as FirmRoleUserContact);
}

export async function listFirmUsersWithRoles(firmId: string): Promise<FirmUserWithRoles[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT userId, role FROM FirmRole WHERE firmId = ? ORDER BY userId ASC, role ASC`,
    args: [firmId],
  });
  const map = new Map<string, FirmRole[]>();
  for (const row of r.rows) {
    const u = (row as unknown as { userId: string; role: string }).userId;
    const ro = (row as unknown as { userId: string; role: string }).role as FirmRole;
    const list = map.get(u) ?? [];
    list.push(ro);
    map.set(u, list);
  }
  return Array.from(map, ([userId, roles]) => ({ userId, roles }));
}

// ─── EngagementRole ──────────────────────────────────────────────────────────

export interface GrantEngagementRoleArgs {
  engagementId: string;
  userId: string;
  role: EngagementRole;
  /** JSON array of module ids (e.g. ['r2r', 'p2p']). NULL means
   *  "all modules" or "not module-scoped" depending on the role. */
  assignedModules: string[] | null;
  /** Who performed the grant (for audit). */
  actorUserId: string;
}

export async function grantEngagementRole(args: GrantEngagementRoleArgs): Promise<void> {
  if (!isEngagementLevelRole(args.role)) {
    throw new Error(
      `grantEngagementRole: '${args.role}' is not an engagement-level role`,
    );
  }
  const db = getDb();

  // Resolve the firm via the engagement (audit log is firm-scoped).
  const e = await db.execute({
    sql: `SELECT firmId FROM Engagement WHERE id = ? LIMIT 1`,
    args: [args.engagementId],
  });
  if (e.rows.length === 0) {
    throw new Error(`grantEngagementRole: engagement ${args.engagementId} not found`);
  }
  const firmId = (e.rows[0] as unknown as { firmId: string }).firmId;

  const modulesJson = args.assignedModules == null ? null : JSON.stringify(args.assignedModules);

  // If a row already exists, replace its assignedModules instead of
  // creating a duplicate. The unique constraint would catch it
  // anyway, but explicit handling here lets the modules update.
  const existing = await db.execute({
    sql: `SELECT id FROM EngagementRole WHERE engagementId = ? AND userId = ? AND role = ? LIMIT 1`,
    args: [args.engagementId, args.userId, args.role],
  });
  if (existing.rows.length > 0) {
    await db.execute({
      sql: `UPDATE EngagementRole SET assignedModules = ? WHERE engagementId = ? AND userId = ? AND role = ?`,
      args: [modulesJson, args.engagementId, args.userId, args.role],
    });
    return;
  }

  await db.execute({
    sql: `INSERT INTO EngagementRole (id, engagementId, userId, role, assignedModules) VALUES (?,?,?,?,?)`,
    args: [createId(), args.engagementId, args.userId, args.role, modulesJson],
  });
  await appendAudit({
    firmId,
    actorUserId: args.actorUserId,
    targetUserId: args.userId,
    action: 'ROLE_GRANTED',
    role: args.role,
    scope: `ENGAGEMENT:${args.engagementId}`,
  });
}

export interface RevokeEngagementRoleArgs {
  engagementId: string;
  userId: string;
  role: EngagementRole;
  actorUserId: string;
}

export async function revokeEngagementRole(args: RevokeEngagementRoleArgs): Promise<void> {
  const db = getDb();
  const e = await db.execute({
    sql: `SELECT firmId FROM Engagement WHERE id = ? LIMIT 1`,
    args: [args.engagementId],
  });
  if (e.rows.length === 0) return;
  const firmId = (e.rows[0] as unknown as { firmId: string }).firmId;

  const r = await db.execute({
    sql: `DELETE FROM EngagementRole WHERE engagementId = ? AND userId = ? AND role = ?`,
    args: [args.engagementId, args.userId, args.role],
  });
  if ((r.rowsAffected ?? 0) > 0) {
    await appendAudit({
      firmId,
      actorUserId: args.actorUserId,
      targetUserId: args.userId,
      action: 'ROLE_REVOKED',
      role: args.role,
      scope: `ENGAGEMENT:${args.engagementId}`,
    });
  }
}

export interface EngagementRoleAssignment {
  role: EngagementRole;
  assignedModules: string[] | null;
}

function parseModules(v: unknown): string[] | null {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : null;
  } catch {
    return null;
  }
}

export async function listEngagementRolesForUser(
  userId: string,
  engagementId: string,
): Promise<EngagementRoleAssignment[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT role, assignedModules FROM EngagementRole WHERE userId = ? AND engagementId = ? ORDER BY role ASC`,
    args: [userId, engagementId],
  });
  return r.rows.map((row) => {
    const r2 = row as unknown as { role: string; assignedModules: string | null };
    return { role: r2.role as EngagementRole, assignedModules: parseModules(r2.assignedModules) };
  });
}

export interface EngagementRoleRow extends EngagementRoleAssignment {
  userId: string;
}

/**
 * Phase 45.3 — return id/name/email for every user holding a particular
 * engagement-level role on this engagement. Used by the GOLIVE → CLOSEOUT
 * handoff flow to find the ACCOUNT_MANAGER who should receive the
 * "engagement entered Closeout" email + be added to the HANDOFF thread
 * participants list.
 */
export async function listEngagementUsersByRole(
  engagementId: string,
  role: EngagementRole,
): Promise<FirmRoleUserContact[]> {
  if (!isEngagementLevelRole(role)) {
    throw new Error(
      `listEngagementUsersByRole: '${role}' is not an engagement-level role`,
    );
  }
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT u.id AS userId, u.email AS email, u.name AS name
          FROM EngagementRole er
          JOIN User u ON u.id = er.userId
          WHERE er.engagementId = ? AND er.role = ?
          ORDER BY u.name ASC, u.id ASC`,
    args: [engagementId, role],
  });
  return r.rows.map((row) => row as unknown as FirmRoleUserContact);
}

export async function listEngagementRolesForEngagement(
  engagementId: string,
): Promise<EngagementRoleRow[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT userId, role, assignedModules FROM EngagementRole WHERE engagementId = ? ORDER BY userId ASC, role ASC`,
    args: [engagementId],
  });
  return r.rows.map((row) => {
    const r2 = row as unknown as { userId: string; role: string; assignedModules: string | null };
    return {
      userId: r2.userId,
      role: r2.role as EngagementRole,
      assignedModules: parseModules(r2.assignedModules),
    };
  });
}

// ─── Bootstrap auto-grant ────────────────────────────────────────────────────

/**
 * Auto-grant APP_ADMIN to the user who created a firm. Called from the
 * /auth/register route immediately after createFirm + createUser succeed.
 * Idempotent — if the user already has APP_ADMIN, this is a no-op.
 *
 * The actor and target are the same user — the audit entry exists so
 * that "first APP_ADMIN was self-granted at firm creation" is provable.
 */
export async function bootstrapFirmAdmin(args: { firmId: string; userId: string }): Promise<void> {
  await grantFirmRole({
    firmId: args.firmId,
    userId: args.userId,
    role: 'APP_ADMIN',
    actorUserId: args.userId,
  });
}

// ─── Phase 43.7 — backfill APP_ADMIN on existing firms ───────────────────────

export interface BackfillResult {
  /** One entry per firm that received an APP_ADMIN row this run. */
  granted: Array<{ firmId: string; userId: string; email: string }>;
  /** Count of firms skipped because they already had an APP_ADMIN. */
  skippedHasAdmin: number;
  /** Count of firms skipped because they had no users at all. */
  skippedNoUsers: number;
}

/**
 * Backfill APP_ADMIN for every firm that lacks one. Phase 43.1 only
 * fires bootstrapFirmAdmin on `/auth/register` and createGoogleUserAndFirm,
 * so any firm that existed before 43.1 deployed will have zero
 * FirmRole rows — and Phase 43.2's gates lock them out of every
 * resource the matrix requires WRITE on.
 *
 * Behaviour:
 *   - For every Firm row, check for an existing FirmRole(APP_ADMIN);
 *     skip when one exists (the migration must not displace the
 *     current admin or grant a second one).
 *   - When none exists, find the oldest User in the firm by createdAt
 *     ASC and INSERT a FirmRole(APP_ADMIN) row for them.
 *   - Write a single ADMIN_BACKFILL_GRANTED entry to RoleAuditLog so
 *     the firm-level audit trail clearly distinguishes a backfill
 *     grant from a normal /auth/register-time bootstrap or an admin
 *     grant.
 *   - Firms with zero users are skipped (logged in the result so the
 *     boot log can flag them).
 *
 * Idempotent. Safe to call from initDb on every boot.
 */
export async function backfillAppAdmins(): Promise<BackfillResult> {
  const db = getDb();
  const firms = await db.execute({ sql: `SELECT id FROM Firm`, args: [] });
  const firmIds = firms.rows.map((row) => (row as unknown as { id: string }).id);

  const result: BackfillResult = { granted: [], skippedHasAdmin: 0, skippedNoUsers: 0 };

  for (const firmId of firmIds) {
    // Has anyone in this firm got APP_ADMIN already?
    const existing = await db.execute({
      sql: `SELECT 1 FROM FirmRole WHERE firmId = ? AND role = 'APP_ADMIN' LIMIT 1`,
      args: [firmId],
    });
    if (existing.rows.length > 0) {
      result.skippedHasAdmin++;
      continue;
    }

    // Oldest user wins. ORDER BY createdAt ASC, then id ASC as a
    // deterministic tiebreaker (createdAt has 1s resolution in
    // SQLite, so two users created in the same second would tie).
    const oldest = await db.execute({
      sql: `SELECT id, email FROM User WHERE firmId = ? ORDER BY createdAt ASC, id ASC LIMIT 1`,
      args: [firmId],
    });
    if (oldest.rows.length === 0) {
      result.skippedNoUsers++;
      continue;
    }
    const { id: userId, email } = oldest.rows[0] as unknown as { id: string; email: string };

    // INSERT the FirmRole row directly (skip grantFirmRole so we
    // don't write a generic ROLE_GRANTED entry — the
    // ADMIN_BACKFILL_GRANTED entry below is what the audit trail
    // wants instead).
    await db.execute({
      sql: `INSERT INTO FirmRole (id, firmId, userId, role) VALUES (?,?,?,?)`,
      args: [createId(), firmId, userId, 'APP_ADMIN'],
    });

    // Audit entry. actorUserId=SYSTEM is a sentinel — we don't write
    // it to a real User row, but the column has no FK so this is
    // valid. Future code that joins User on actorUserId must handle
    // the SYSTEM literal (currently no such code exists).
    await db.execute({
      sql: `INSERT INTO RoleAuditLog (id, firmId, actorUserId, targetUserId, action, role, scope) VALUES (?,?,?,?,?,?,?)`,
      args: [createId(), firmId, 'SYSTEM', userId, 'ADMIN_BACKFILL_GRANTED', 'APP_ADMIN', 'FIRM'],
    });

    result.granted.push({ firmId, userId, email });
  }

  return result;
}
