/**
 * Phase 45.1 — Closeout checklist routes.
 *
 *   GET  /engagements/:id/closeout-checklist   — list all 9 items
 *   PATCH /engagements/:id/closeout-checklist/:key — update status + notes
 *
 * Both gated on ENGAGEMENT_META — the matrix already grants this to
 * APP_ADMIN, PROJECT_MANAGER, PROJECT_LEAD, SALES_MANAGER (read-only
 * post-CONTRACTED). Writing the SLA_TEAM_ACCEPT row will require
 * SUPPORT_LEAD when Phase 45.4 lands; for now the matrix gate is
 * intentionally permissive so the workflow page renders during
 * development.
 *
 * Activity hook: a CLOSEOUT_CHECKLIST_UPDATED entry fires per PATCH,
 * rate-limited to 1 per minute per (engagementId, key) — keeps a
 * misbehaving client from flooding the activity log.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';
import {
  isChecklistKey,
  isChecklistStatus,
  KEY_LABELS,
  type ChecklistKey,
  type ChecklistStatus,
} from '../services/closeoutChecklist.js';
import { listFirmRolesForUser } from '../db/index.js';

// Rate-limit cache for the activity-log entry. In-memory; multi-replica
// dedup not required — same compromise as middleware/rbac.ts.
const RATE_LIMIT_MS = 60_000;
const lastFireAt = new Map<string, number>();

function shouldLogChecklistChange(engagementId: string, key: ChecklistKey): boolean {
  const k = `${engagementId}|${key}`;
  const now = Date.now();
  const last = lastFireAt.get(k) ?? 0;
  if (now - last < RATE_LIMIT_MS) return false;
  lastFireAt.set(k, now);
  // Bound the map size — drop entries older than 5 windows.
  if (lastFireAt.size > 5000) {
    const cutoff = now - RATE_LIMIT_MS * 5;
    for (const [k2, ts] of lastFireAt.entries()) {
      if (ts < cutoff) lastFireAt.delete(k2);
    }
  }
  return true;
}

export async function closeoutRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements/:id/closeout-checklist
  fastify.get(
    '/engagements/:id/closeout-checklist',
    { preHandler: requirePermission('READ', 'ENGAGEMENT_META') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const items = await db.listCloseoutChecklist(id);
      return reply.send({ data: items });
    },
  );

  // PATCH /engagements/:id/closeout-checklist/:key
  fastify.patch(
    '/engagements/:id/closeout-checklist/:key',
    { preHandler: requirePermission('WRITE', 'ENGAGEMENT_META') },
    async (request, reply) => {
      const { id, key } = request.params as { id: string; key: string };
      const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

      if (!isChecklistKey(key)) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: `Unknown checklist key '${key}'.` },
        });
      }

      // Phase 45.4 — the two transition-blocking keys have stricter
      // ownership rules:
      //   - SLA_TEAM_ACCEPT may only be flipped by an APP_ADMIN or
      //     SUPPORT_LEAD (the SLA team lead is the human who formally
      //     accepts the engagement on behalf of the SLA team).
      //   - CLIENT_SIGNOFF must come from the portal (a client-member
      //     signs off via POST /portal/:token/closeout-signoff). The
      //     consultant-side PATCH refuses to set it so the audit trail
      //     reflects who actually performed the sign-off.
      // APP_ADMIN bypasses both gates so a stuck engagement can be
      // unblocked manually if needed.
      if (key === 'SLA_TEAM_ACCEPT' || key === 'CLIENT_SIGNOFF') {
        const firmRoles = await listFirmRolesForUser(request.jwtUser.userId);
        const isAdmin = firmRoles.includes('APP_ADMIN');
        const isSupportLead = firmRoles.includes('SUPPORT_LEAD');
        if (key === 'CLIENT_SIGNOFF' && !isAdmin) {
          return reply.code(403).send({
            error: {
              code: 'CLIENT_SIGNOFF_VIA_PORTAL',
              message:
                'Client sign-off must come through the client portal. Only APP_ADMIN can override.',
            },
          });
        }
        if (key === 'SLA_TEAM_ACCEPT' && !isAdmin && !isSupportLead) {
          return reply.code(403).send({
            error: {
              code: 'SUPPORT_LEAD_REQUIRED',
              message:
                'Only the SLA team lead (SUPPORT_LEAD) can accept the handover. Ask your firm admin to grant the role.',
            },
          });
        }
      }

      const body = (request.body ?? {}) as { status?: unknown; notes?: unknown };
      let nextStatus: ChecklistStatus | undefined;
      if (body.status !== undefined) {
        if (typeof body.status !== 'string' || !isChecklistStatus(body.status)) {
          return reply.code(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'status must be one of NOT_STARTED, IN_PROGRESS, DONE, NA.' },
          });
        }
        nextStatus = body.status;
      }
      const nextNotes =
        body.notes === undefined
          ? undefined
          : body.notes === null
            ? null
            : typeof body.notes === 'string'
              ? body.notes
              : undefined;

      const updated = await db.updateCloseoutChecklistItem({
        engagementId: id,
        key: key as ChecklistKey,
        status: nextStatus,
        notes: nextNotes,
        byUserId: request.jwtUser.userId,
      });
      if (!updated) {
        return reply.code(404).send({
          error: {
            code: 'CHECKLIST_NOT_INITIALISED',
            message: 'Checklist row does not exist — the engagement may not have entered CLOSEOUT yet.',
          },
        });
      }

      // Activity hook (rate-limited).
      if (shouldLogChecklistChange(id, key as ChecklistKey)) {
        await db.logActivity(
          id,
          request.jwtUser.firmId,
          'CLOSEOUT_CHECKLIST_UPDATED',
          `${KEY_LABELS[key as ChecklistKey]} → ${updated.status}`,
        );
      }

      return reply.send({ data: updated });
    },
  );
}

// Test hook — clears the rate-limit cache between tests so per-key
// rate limiting doesn't suppress activity assertions in beforeEach.
export function __resetCloseoutChecklistRateLimit(): void {
  lastFireAt.clear();
}
