/**
 * Phase 43.2 — RBAC enforcement middleware.
 *
 * Two pieces:
 *   1. `loadPermissionContext` — preHandler that resolves the user's
 *      firm-level + engagement-level roles, normalises the engagement
 *      stage, and attaches everything to `request.permissionContext`.
 *      Cached per-request via a WeakMap on the request object so a
 *      sequence of `requirePermission(...)` calls in the same handler
 *      doesn't re-hit the DB.
 *   2. `requirePermission(action, resource)` — preHandler factory that
 *      reads the cached context and 403s the request when the user
 *      lacks the required action.
 *
 * Activity log: 403 responses fire a ROLE_DENIED entry, rate-limited
 * to 1 per minute per (userId, route, resource) triple so a stuck
 * client polling a forbidden endpoint can't flood the activity log.
 *
 * APP_ADMIN backstop: the matrix already grants APP_ADMIN WRITE on
 * everything, so existing flows keep working — every signup gets
 * APP_ADMIN auto-granted in 43.1.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as db from '../db/index.js';
import {
  can,
  type Action,
  type Resource,
  type Stage,
  type Role,
} from '../services/permissions.js';
import { normaliseStage } from '../types/roles.js';

// ─── Request augmentation ────────────────────────────────────────────────────

export interface PermissionContext {
  userId: string;
  firmId: string;
  /** The engagement id from the route params, when present. */
  engagementId: string | null;
  /** The engagement's current stage (normalised). Falls back to
   *  DISCOVERY when no engagement is attached — the matrix lookup
   *  needs a stage and DISCOVERY is the most common one. */
  stage: Stage;
  /** All firm-level role rows for the user. */
  firmRoles: ReadonlyArray<Role>;
  /** All engagement-level role rows for the user on the active
   *  engagement. Empty when no engagement is attached. */
  engagementRoles: ReadonlyArray<Role>;
  /** Module assignments per engagement role for the active engagement.
   *  Same length + index as `engagementRoles`. NULL means unrestricted. */
  engagementModules: ReadonlyArray<string[] | null>;
}

declare module 'fastify' {
  interface FastifyRequest {
    permissionContext?: PermissionContext;
  }
}

// ─── Context loader ──────────────────────────────────────────────────────────

/**
 * Pulls the engagement id from the most common param shapes used in
 * the route tree. The wizard uses `:id`, a few legacy routes use
 * `:engagementId`, and portal routes use `:token` (no engagement
 * lookup needed at this layer).
 */
function extractEngagementId(request: FastifyRequest): string | null {
  const params = (request.params ?? {}) as Record<string, string>;
  return params.id ?? params.engagementId ?? null;
}

export async function loadPermissionContext(
  request: FastifyRequest,
): Promise<PermissionContext | null> {
  // Already loaded for this request — return the cached value.
  if (request.permissionContext) return request.permissionContext;
  if (!request.jwtUser) return null;
  const userId = request.jwtUser.userId;
  const firmId = request.jwtUser.firmId;
  const engagementId = extractEngagementId(request);

  // Firm-level roles for this user.
  const firmRoles = await db.listFirmRolesForUser(userId);

  // Engagement-level roles + stage (only when an engagement is in scope).
  let engagementRoles: Role[] = [];
  let engagementModules: (string[] | null)[] = [];
  let stage: Stage = 'DISCOVERY';
  if (engagementId) {
    const assignments = await db.listEngagementRolesForUser(userId, engagementId);
    engagementRoles = assignments.map((a) => a.role as Role);
    engagementModules = assignments.map((a) => a.assignedModules);

    // Stage lookup. We avoid pulling the full enriched engagement —
    // just the status column.
    const engagement = await db.findEngagementByIdAndFirmId(engagementId, firmId);
    if (engagement) {
      const status = ((engagement as Record<string, unknown>).status as string | undefined) ?? 'DISCOVERY';
      stage = normaliseStage(status);
    }
  }

  const ctx: PermissionContext = {
    userId,
    firmId,
    engagementId,
    stage,
    firmRoles,
    engagementRoles,
    engagementModules,
  };
  request.permissionContext = ctx;
  return ctx;
}

// ─── Denial audit (rate-limited) ─────────────────────────────────────────────

interface DenialKey {
  userId: string;
  routeUrl: string;
  resource: Resource;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const denialCache = new Map<string, number>();

function shouldLogDenial(k: DenialKey): boolean {
  const key = `${k.userId}|${k.routeUrl}|${k.resource}`;
  const now = Date.now();
  const last = denialCache.get(key) ?? 0;
  if (now - last < RATE_LIMIT_WINDOW_MS) return false;
  denialCache.set(key, now);
  // Best-effort housekeeping — drop entries older than 5 windows so
  // the map doesn't grow unbounded over a long process lifetime.
  if (denialCache.size > 5000) {
    const stale = now - RATE_LIMIT_WINDOW_MS * 5;
    for (const [k2, ts] of denialCache.entries()) {
      if (ts < stale) denialCache.delete(k2);
    }
  }
  return true;
}

async function recordDenial(args: {
  ctx: PermissionContext;
  routeUrl: string;
  action: Action;
  resource: Resource;
}): Promise<void> {
  if (!shouldLogDenial({ userId: args.ctx.userId, routeUrl: args.routeUrl, resource: args.resource })) {
    return;
  }
  if (!args.ctx.engagementId) return; // logActivity is per-engagement.
  try {
    await db.logActivity(
      args.ctx.engagementId,
      args.ctx.firmId,
      'ROLE_DENIED',
      `${args.ctx.userId} denied ${args.action} on ${args.resource} at ${args.routeUrl}`,
    );
  } catch {
    // Audit failure is never fatal — the request should still 403.
  }
}

// ─── requirePermission factory ───────────────────────────────────────────────

/**
 * Returns a Fastify preHandler that 403s when the current user lacks
 * `action` on `resource`. Apply via `fastify.addHook('preHandler', ...)`
 * scoped to the route or call directly inside a handler.
 */
export function requirePermission(action: Action, resource: Resource) {
  return async function permissionGate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const ctx = await loadPermissionContext(request);
    if (!ctx) {
      reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const allowed = can(
      { firmRoles: ctx.firmRoles, engagementRoles: ctx.engagementRoles, stage: ctx.stage },
      action,
      resource,
    );

    if (!allowed) {
      const verb = action === 'WRITE' ? 'modify' : action === 'READ' ? 'view' : 'access';
      const onTarget = ctx.engagementId ? 'this engagement' : 'this resource';
      const message = `You don't have permission to ${verb} ${humanResource(resource)} on ${onTarget}.`;
      const requiredRole = suggestRequiredRole(resource, action);
      // Audit + 403. routeOptions.url is the parameterised pattern
      // (e.g. /engagements/:id/decisions); falling back to request.url
      // keeps logging meaningful when the route hasn't matched (rare).
      const routeUrl = request.routeOptions?.url ?? request.url;
      await recordDenial({ ctx, routeUrl, action, resource });
      reply.code(403).send({ error: { code: 'FORBIDDEN', message, requiredRole } });
      return;
    }
  };
}

/** Friendly label for the resource — used in the 403 message. */
function humanResource(resource: Resource): string {
  switch (resource) {
    case 'ENGAGEMENT_META': return 'engagement details';
    case 'WIZARD_ANSWERS': return 'wizard answers';
    case 'DECISIONS': return 'decisions';
    case 'RISKS': return 'the risk register';
    case 'ISSUES': return 'the issue tracker';
    case 'MEETINGS': return 'meetings';
    case 'MEMBERS': return 'team members';
    case 'DATA_COLLECTION': return 'data collection';
    case 'ACTION_ITEMS': return 'action items';
    case 'COMMENTS': return 'comments';
    case 'IMAGES': return 'attachments';
    case 'GENERATORS': return 'deliverables';
    case 'BILLING': return 'billing';
    case 'ACTIVITY_LOG': return 'the activity log';
    case 'INTEGRATIONS': return 'integrations';
    case 'ROLES': return 'roles';
  }
}

/** Best-guess "this is the role you need" hint for the 403 payload.
 *  Maps to the role most likely to grant WRITE on the resource. */
function suggestRequiredRole(resource: Resource, action: Action): Role {
  if (resource === 'BILLING') return 'INTERNAL_ACCOUNTANT';
  if (resource === 'ROLES') return 'APP_ADMIN';
  if (resource === 'DECISIONS' && action === 'WRITE') return 'PROJECT_LEAD';
  if (resource === 'GENERATORS') return 'PROJECT_MANAGER';
  return 'APP_ADMIN';
}

// ─── Convenience helper for handler-internal checks ──────────────────────────

/**
 * Same as requirePermission but invokable inline inside a handler
 * (returns true/false rather than mutating the reply). Useful for
 * conditional rendering — e.g. an INTERNAL_ACCOUNTANT can READ
 * engagement metadata so the route returns 200, but the handler then
 * strips non-billing fields before serialising. The handler asks
 * `if (!await may('READ', 'DECISIONS')) hideDecisions()`.
 */
export async function may(
  request: FastifyRequest,
  action: Action,
  resource: Resource,
): Promise<boolean> {
  const ctx = await loadPermissionContext(request);
  if (!ctx) return false;
  return can(
    { firmRoles: ctx.firmRoles, engagementRoles: ctx.engagementRoles, stage: ctx.stage },
    action,
    resource,
  );
}

// ─── Plugin to attach `loadPermissionContext` globally ───────────────────────

/**
 * Registers loadPermissionContext as a global preHandler so every
 * authenticated request has the context populated before route
 * handlers run. Routes that don't use the context pay only the lookup
 * cost (1-2 small queries per request) on first read; subsequent
 * checks within the handler are cached.
 *
 * NOTE: this hook only runs after `authenticate` has populated
 * request.jwtUser, so we no-op for unauthenticated traffic.
 */
export async function rbacPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', async (request) => {
    if (!request.jwtUser) return;
    await loadPermissionContext(request);
  });
}
