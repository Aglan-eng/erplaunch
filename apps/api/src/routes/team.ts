/**
 * Phase 43.4 — Team management API.
 *
 * Backs the Settings → Team page. Endpoints are gated to APP_ADMIN
 * via requirePermission('WRITE', 'ROLES') for mutations and
 * requirePermission('READ', 'ROLES') for reads. The matrix only
 * grants ROLES WRITE to APP_ADMIN, so the wider catalog of read-
 * only roles can't browse the team list either — that's deliberate
 * (team membership is sensitive HR-shaped data).
 *
 * Surfaces:
 *   GET    /firm/team              — list users in the firm + their
 *                                    firm-level roles
 *   POST   /firm/roles             — grant a firm-level role
 *   DELETE /firm/roles             — revoke a firm-level role (body
 *                                    carries userId + role to keep
 *                                    the URL pattern simple)
 *   GET    /engagements/:id/roles  — list per-engagement role assignments
 *   POST   /engagements/:id/roles  — grant a per-engagement role
 *                                    (with optional assignedModules)
 *   DELETE /engagements/:id/roles  — revoke a per-engagement role
 *   GET    /firm/role-audit-log    — recent role grant/revoke entries
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';
import {
  isFirmLevelRole,
  isEngagementLevelRole,
  type FirmRole,
  type EngagementRole,
} from '../types/roles.js';

export async function teamRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /firm/team — list firm users + their firm-level role badges.
  fastify.get('/firm/team', { preHandler: requirePermission('READ', 'ROLES') }, async (request, reply) => {
    const firmId = request.jwtUser.firmId;
    // Pull every user in the firm + all firm-role rows; merge in JS.
    // Could be a single SQL with LEFT JOIN + array_agg but we don't
    // have those primitives in libSQL the same way Postgres does.
    const usersResult = await db.getDb().execute({
      sql: `SELECT id, email, name FROM User WHERE firmId = ? ORDER BY name ASC`,
      args: [firmId],
    });
    const users = usersResult.rows as unknown as Array<{ id: string; email: string; name: string }>;
    const rolesByUser = new Map<string, FirmRole[]>();
    for (const u of users) rolesByUser.set(u.id, []);

    const rolesResult = await db.listFirmUsersWithRoles(firmId);
    for (const row of rolesResult) rolesByUser.set(row.userId, row.roles);

    const team = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      firmRoles: rolesByUser.get(u.id) ?? [],
    }));
    return reply.send({ data: team });
  });

  // POST /firm/roles — grant a firm-level role. Body: { userId, role }.
  fastify.post('/firm/roles', { preHandler: requirePermission('WRITE', 'ROLES') }, async (request, reply) => {
    const body = (request.body ?? {}) as { userId?: string; role?: string };
    if (!body.userId || !body.role) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'userId and role are required' },
      });
    }
    if (!isFirmLevelRole(body.role)) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_ROLE',
          message: `${body.role} is not a firm-level role (allowed: APP_ADMIN, SALES_MANAGER, SUPPORT_LEAD, INTERNAL_ACCOUNTANT)`,
        },
      });
    }
    await db.grantFirmRole({
      firmId: request.jwtUser.firmId,
      userId: body.userId,
      role: body.role as FirmRole,
      actorUserId: request.jwtUser.userId,
    });
    return reply.code(201).send({ data: { ok: true } });
  });

  // DELETE /firm/roles — revoke a firm-level role. Body: { userId, role }.
  fastify.delete('/firm/roles', { preHandler: requirePermission('WRITE', 'ROLES') }, async (request, reply) => {
    const body = (request.body ?? {}) as { userId?: string; role?: string };
    if (!body.userId || !body.role) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'userId and role are required' },
      });
    }
    if (!isFirmLevelRole(body.role)) {
      return reply.code(400).send({
        error: { code: 'INVALID_ROLE', message: `${body.role} is not a firm-level role` },
      });
    }
    await db.revokeFirmRole({
      firmId: request.jwtUser.firmId,
      userId: body.userId,
      role: body.role as FirmRole,
      actorUserId: request.jwtUser.userId,
    });
    return reply.send({ data: { ok: true } });
  });

  // GET /engagements/:id/roles — engagement-level role assignments.
  fastify.get('/engagements/:id/roles', { preHandler: requirePermission('READ', 'ROLES') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const rows = await db.listEngagementRolesForEngagement(id);
    return reply.send({ data: rows });
  });

  // POST /engagements/:id/roles — grant a per-engagement role.
  // Body: { userId, role, assignedModules? }
  fastify.post('/engagements/:id/roles', { preHandler: requirePermission('WRITE', 'ROLES') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = (request.body ?? {}) as { userId?: string; role?: string; assignedModules?: string[] | null };
    if (!body.userId || !body.role) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'userId and role are required' },
      });
    }
    if (!isEngagementLevelRole(body.role)) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_ROLE',
          message: `${body.role} is not an engagement-level role`,
        },
      });
    }
    await db.grantEngagementRole({
      engagementId: id,
      userId: body.userId,
      role: body.role as EngagementRole,
      assignedModules: Array.isArray(body.assignedModules) ? body.assignedModules : null,
      actorUserId: request.jwtUser.userId,
    });
    return reply.code(201).send({ data: { ok: true } });
  });

  // DELETE /engagements/:id/roles — revoke a per-engagement role.
  fastify.delete('/engagements/:id/roles', { preHandler: requirePermission('WRITE', 'ROLES') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = (request.body ?? {}) as { userId?: string; role?: string };
    if (!body.userId || !body.role) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'userId and role are required' },
      });
    }
    if (!isEngagementLevelRole(body.role)) {
      return reply.code(400).send({
        error: { code: 'INVALID_ROLE', message: `${body.role} is not an engagement-level role` },
      });
    }
    await db.revokeEngagementRole({
      engagementId: id,
      userId: body.userId,
      role: body.role as EngagementRole,
      actorUserId: request.jwtUser.userId,
    });
    return reply.send({ data: { ok: true } });
  });

  // GET /firm/role-audit-log — recent grant/revoke history.
  fastify.get('/firm/role-audit-log', { preHandler: requirePermission('READ', 'ROLES') }, async (request, reply) => {
    const firmId = request.jwtUser.firmId;
    const log = await db.listRoleAuditLog(firmId, 200);
    return reply.send({ data: log });
  });

  // ─── Phase 43.5 — frontend permission lookup ──────────────────────────────
  //
  // GET /me/permissions(?engagementId=X) returns the current user's
  // firm + engagement roles plus an effective permissions map keyed
  // by resource. The SPA's usePermissions() hook calls this on every
  // engagement-context page so sidebar items + action buttons can
  // disable themselves without a 403 round-trip.
  //
  // No requirePermission gate here — every authenticated user has
  // the right to read their OWN permissions.
  fastify.get('/me/permissions', async (request, reply) => {
    const userId = request.jwtUser.userId;
    const firmId = request.jwtUser.firmId;
    const query = (request.query ?? {}) as { engagementId?: string };

    const firmRoles = await db.listFirmRolesForUser(userId);
    let engagementRoles: string[] = [];
    let assignedModulesByRole: Record<string, string[] | null> = {};
    let stage = 'DISCOVERY';

    if (query.engagementId) {
      const eng = await db.findEngagementByIdAndFirmId(query.engagementId, firmId);
      if (eng) {
        const status = ((eng as Record<string, unknown>).status as string | undefined) ?? 'DISCOVERY';
        const { normaliseStage } = await import('../types/roles.js');
        stage = normaliseStage(status);
        const assignments = await db.listEngagementRolesForUser(userId, query.engagementId);
        engagementRoles = assignments.map((a) => a.role);
        assignedModulesByRole = assignments.reduce((acc, a) => {
          acc[a.role] = a.assignedModules;
          return acc;
        }, {} as Record<string, string[] | null>);
      }
    }

    const { evaluateEffectiveAction } = await import('../services/permissions.js');
    const { RESOURCES } = await import('../types/roles.js');
    type R = (typeof RESOURCES)[number];
    const effective: Record<string, 'NONE' | 'READ' | 'WRITE'> = {};
    const allRoles = [...firmRoles, ...engagementRoles] as Array<R extends never ? never : string>;
    for (const resource of RESOURCES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      effective[resource] = evaluateEffectiveAction(allRoles as any, stage as any, resource);
    }

    return reply.send({
      data: {
        userId,
        firmId,
        engagementId: query.engagementId ?? null,
        stage,
        firmRoles,
        engagementRoles,
        assignedModulesByRole,
        effective,
      },
    });
  });
}
