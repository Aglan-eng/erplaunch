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

const ReconcileBody = z.object({
  firmId: z.string().optional(),
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
}
