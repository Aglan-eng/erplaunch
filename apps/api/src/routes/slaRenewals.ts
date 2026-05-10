/**
 * Phase 48.2 — Firm-wide renewal pipeline route.
 *
 *   GET /sla/renewals[?windowDays=90]
 *
 * Powers the Renewal Pipeline widget on the SLA dashboard. Returns
 * every SLA_ACTIVE engagement in the firm, joined with its
 * EngagementRenewalState (creating a default in-memory shape when no
 * row exists yet) and the computed urgency window (GREEN / AMBER / RED
 * based on days-to-expiry + the explicit renewalStatus).
 *
 * Default windowDays=90 matches the spec's "expiring in next 90 days"
 * filter, but rows with contractEndAt = null OR expired contracts are
 * always included so the AM doesn't lose visibility on edge cases.
 *
 * RBAC: gated on BILLING:READ — the renewal record is commercial data,
 * not engagement detail. Account managers / sales managers / app admins
 * have access via the matrix.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { getDb, findRenewalState } from '../db/index.js';
import {
  computeRenewalWindow,
  type RenewalStatus,
  type RenewalUrgency,
  type ExpansionOpportunity,
} from '../services/renewalTracker.js';

interface RenewalRow {
  engagementId: string;
  clientName: string;
  contractStartAt: string | null;
  contractEndAt: string | null;
  renewalStatus: RenewalStatus;
  expansionOpportunities: ExpansionOpportunity[];
  notes: string | null;
  updatedAt: string;
  urgency: RenewalUrgency;
  daysToExpiry: number | null;
  expired: boolean;
}

const URGENCY_ORDER: Record<RenewalUrgency, number> = {
  RED: 0,
  AMBER: 1,
  GREEN: 2,
};

export async function slaRenewalsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get(
    '/sla/renewals',
    { preHandler: requirePermission('READ', 'BILLING') },
    async (request, reply) => {
      const firmId = request.jwtUser.firmId;
      const dbClient = getDb();

      // Pull every SLA_ACTIVE engagement for the firm. Engagements that
      // never reached SLA aren't surfaced — the pipeline is a post-go-
      // live concern. (A future phase may surface implementation-stage
      // SOWs nearing expiry too, but Phase 45.8 explicitly scopes this
      // to active customers.)
      const r = await dbClient.execute({
        sql: `SELECT id, clientName FROM Engagement
              WHERE firmId = ? AND status = 'SLA_ACTIVE'
              ORDER BY clientName ASC`,
        args: [firmId],
      });
      const rows = r.rows as unknown as Array<{ id: string; clientName: string }>;
      if (rows.length === 0) return reply.send({ data: [] });

      const out: RenewalRow[] = [];
      for (const eng of rows) {
        const state = await findRenewalState(eng.id);
        const effective = state ?? {
          engagementId: eng.id,
          contractStartAt: null,
          contractEndAt: null,
          renewalStatus: 'NOT_STARTED' as RenewalStatus,
          expansionOpportunities: [] as ExpansionOpportunity[],
          notes: null,
          updatedAt: new Date().toISOString(),
        };
        const window = computeRenewalWindow({
          contractEndAt: effective.contractEndAt,
          renewalStatus: effective.renewalStatus,
        });
        out.push({
          ...effective,
          engagementId: eng.id,
          clientName: eng.clientName,
          ...window,
        });
      }

      // Sort: RED → AMBER → GREEN, then by daysToExpiry ascending so
      // the closest-to-expiry rows surface first.
      out.sort((a, b) => {
        const u = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
        if (u !== 0) return u;
        const ad = a.daysToExpiry ?? Number.POSITIVE_INFINITY;
        const bd = b.daysToExpiry ?? Number.POSITIVE_INFINITY;
        return ad - bd;
      });

      return reply.send({ data: out });
    },
  );
}
