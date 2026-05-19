/**
 * Phase 52.3.1 — admin endpoints surface.
 *
 * Currently exposes the manual customer-reconcile lever so an op can
 * re-run the three-pass backfill (reconcile / owners / health)
 * without redeploying. Gated to APP_ADMIN via the matrix's WRITE on
 * ROLES — same convention every Phase 49+ admin endpoint uses.
 *
 * Endpoints:
 *   POST /api/v1/admin/customer/reconcile
 *     body: { firmId?: string }
 *     - With firmId: scope the three passes to that firm.
 *     - Without:     run for every firm in the database.
 *     Returns { results: ReconcileResult[] }.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import {
  reconcileAllFirms,
  reconcileFirmCustomers,
} from '../services/customer/reconcile.js';
import { seedLifecycleForFirm } from '../../scripts/seed-lifecycle.js';
import { cleanLifecycleDemoCustomers } from '../../scripts/clean-lifecycle.js';

const ReconcileBody = z.object({
  firmId: z.string().optional(),
});

const SeedLifecycleBody = z.object({
  firmId: z.string().optional(),
  includeDeadEnds: z.boolean().optional(),
});

const CleanLifecycleBody = z.object({
  // Required — destructive operation, no default-to-caller's-firm.
  firmId: z.string().min(1, 'firmId is required'),
});

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post(
    '/admin/customer/reconcile',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request, reply) => {
      const parsed = ReconcileBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      // Defence-in-depth: if a firmId is supplied, it must match the
      // caller's JWT firm. APP_ADMIN is already firm-scoped at the
      // matrix layer; rejecting cross-firm reconcile here closes any
      // future regression where the permission widens.
      if (parsed.data.firmId && parsed.data.firmId !== request.jwtUser.firmId) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
      }

      try {
        const results = parsed.data.firmId
          ? [await reconcileFirmCustomers(parsed.data.firmId)]
          : await reconcileAllFirms();
        return reply.send({ results });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({
          error: { code: 'RECONCILE_FAILED', message },
        });
      }
    },
  );

  // Phase 52.9 — Lifecycle demo seed. Idempotent; safe to re-run.
  fastify.post(
    '/admin/seed-lifecycle',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request, reply) => {
      const parsed = SeedLifecycleBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }
      const firmId = parsed.data.firmId ?? request.jwtUser.firmId;
      if (firmId !== request.jwtUser.firmId) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
      }
      try {
        const result = await seedLifecycleForFirm(firmId, {
          includeDeadEnds: parsed.data.includeDeadEnds,
        });
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({
          error: { code: 'SEED_FAILED', message },
        });
      }
    },
  );

  // Phase 52.9.1 — Demo cleanup. firmId is REQUIRED (no default).
  // Caller's APP_ADMIN scope must already cover the target firm.
  fastify.post(
    '/admin/clean-lifecycle',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request, reply) => {
      const parsed = CleanLifecycleBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }
      if (parsed.data.firmId !== request.jwtUser.firmId) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
      }
      try {
        const result = await cleanLifecycleDemoCustomers(parsed.data.firmId);
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({
          error: { code: 'CLEAN_FAILED', message },
        });
      }
    },
  );
}
