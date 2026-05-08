/**
 * Phase 45.8 — Renewal + expansion tracker routes.
 *
 *   GET   /engagements/:id/renewal-state — current state + computed urgency
 *   PATCH /engagements/:id/renewal-state — upsert one or more fields
 *
 * The path uses `renewal-state` to match the underlying table name
 * (EngagementRenewalState) and the Phase 45.8 spec — keeps routes,
 * tables, and DB helpers visually aligned. Phase 45.9 fixed an earlier
 * typo where the routes shipped at the shorter `/renewal` path,
 * causing prod to 404.
 *
 * Gated on the BILLING resource — the renewal/expansion record is
 * commercial-side data the matrix already restricts to APP_ADMIN,
 * SALES_MANAGER, ACCOUNT_MANAGER, and INTERNAL_ACCOUNTANT.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';
import {
  computeRenewalWindow,
  isRenewalStatus,
  type ExpansionOpportunity,
  type RenewalStatus,
} from '../services/renewalTracker.js';

interface PatchBody {
  contractStartAt?: string | null;
  contractEndAt?: string | null;
  renewalStatus?: string;
  expansionOpportunities?: unknown;
  notes?: string | null;
}

function sanitizeExpansion(input: unknown): ExpansionOpportunity[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) return [];
  return input
    .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
    .map((o) => ({
      title: typeof o.title === 'string' ? o.title : '',
      size: typeof o.size === 'string' ? o.size : undefined,
      notes: typeof o.notes === 'string' ? o.notes : undefined,
    }))
    .filter((o) => o.title.length > 0);
}

export async function renewalRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get(
    '/engagements/:id/renewal-state',
    { preHandler: requirePermission('READ', 'BILLING') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const state = await db.findRenewalState(id);
      // When no state row exists yet, return a default so the UI can
      // render the empty form without an extra null check.
      const effectiveState = state ?? {
        engagementId: id,
        contractStartAt: null,
        contractEndAt: null,
        renewalStatus: 'NOT_STARTED' as RenewalStatus,
        expansionOpportunities: [] as ExpansionOpportunity[],
        notes: null,
        updatedAt: new Date().toISOString(),
      };
      const window = computeRenewalWindow({
        contractEndAt: effectiveState.contractEndAt,
        renewalStatus: effectiveState.renewalStatus,
      });
      return reply.send({ data: { ...effectiveState, ...window } });
    },
  );

  fastify.patch(
    '/engagements/:id/renewal-state',
    { preHandler: requirePermission('WRITE', 'BILLING') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

      const body = (request.body ?? {}) as PatchBody;

      let renewalStatus: RenewalStatus | undefined;
      if (body.renewalStatus !== undefined) {
        if (typeof body.renewalStatus !== 'string' || !isRenewalStatus(body.renewalStatus)) {
          return reply.code(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'renewalStatus must be NOT_STARTED, DISCUSSING, PROPOSAL_OUT, SIGNED, LOST, or NA',
            },
          });
        }
        renewalStatus = body.renewalStatus;
      }

      const expansionOpportunities = sanitizeExpansion(body.expansionOpportunities);

      const updated = await db.upsertRenewalState({
        engagementId: id,
        contractStartAt: body.contractStartAt,
        contractEndAt: body.contractEndAt,
        renewalStatus,
        expansionOpportunities,
        notes: body.notes,
      });

      const window = computeRenewalWindow({
        contractEndAt: updated.contractEndAt,
        renewalStatus: updated.renewalStatus,
      });

      await db.logActivity(
        id,
        request.jwtUser.firmId,
        'RENEWAL_UPDATED',
        renewalStatus
          ? `Renewal status → ${renewalStatus}`
          : 'Renewal record updated',
      );

      return reply.send({ data: { ...updated, ...window } });
    },
  );
}
