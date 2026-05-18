/**
 * Phase 52.3 — Customers route surface.
 *
 *   GET   /api/customers
 *       Returns { customers: CustomerSummary[] } scoped to the
 *       caller's firm. Supports query params:
 *         - stage   (CSV of CustomerStage values)
 *         - owner   (userId — match across any owner column)
 *         - health  (CSV of red|yellow|green)
 *         - search  (case-insensitive name substring)
 *         - sort    (name|stage|health|lastActivity)
 *         - order   (asc|desc)
 *         - limit, offset
 *         - archived (true|false — default false)
 *
 *   PATCH /api/customers/:id/stage
 *       Body: { toStage: CustomerStage, reason?: string }
 *       Drives the canonical `advanceStage` helper which writes
 *       STAGE_TRANSITION (+ optional OWNER_HANDOFF) to ActivityLog
 *       and bumps renewalCount on RENEWAL_DUE → LIVE_SLA/RENEWED.
 *       Returns the updated CustomerSummary.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../middleware/auth.js';
import {
  advanceStage,
  CUSTOMER_STAGES,
  type CustomerStage,
  getCustomer,
  isCustomerStage,
} from '../db/customer.js';
import {
  buildCustomerSummary,
  listCustomerSummaries,
  type CustomerSortField,
  type SortOrder,
} from '../db/customerSummary.js';

// ─── Query / body schemas ──────────────────────────────────────────────────

const StageSchema = z.string().refine(isCustomerStage, {
  message: `stage must be one of ${CUSTOMER_STAGES.join('|')}`,
});

const HealthBandSchema = z.enum(['red', 'yellow', 'green']);

const ListQuerySchema = z.object({
  stage: z.string().optional(),
  owner: z.string().optional(),
  health: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['name', 'stage', 'health', 'lastActivity']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  archived: z.enum(['true', 'false']).optional(),
});

const StageTransitionBodySchema = z.object({
  toStage: StageSchema,
  reason: z.string().max(2000).optional(),
});

function csvTokens(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseStages(value: string | undefined): CustomerStage[] {
  return csvTokens(value).filter(isCustomerStage);
}

function isHealthBand(v: string): v is 'red' | 'yellow' | 'green' {
  return HealthBandSchema.safeParse(v).success;
}

function parseHealthBands(value: string | undefined): Array<'red' | 'yellow' | 'green'> {
  return csvTokens(value).filter(isHealthBand);
}

// ─── Route registration ────────────────────────────────────────────────────

export async function customersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // ── GET /api/customers ─────────────────────────────────────────────────
  fastify.get('/customers', async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }
    const firmId = request.jwtUser.firmId;
    const q = parsed.data;

    const stages = parseStages(q.stage);
    const healthBands = parseHealthBands(q.health);

    const summaries = await listCustomerSummaries(firmId, {
      stages: stages.length > 0 ? stages : undefined,
      ownerUserId: q.owner,
      search: q.search,
      includeArchived: q.archived === 'true',
      healthBands: healthBands.length > 0 ? healthBands : undefined,
      sortField: q.sort as CustomerSortField | undefined,
      sortOrder: q.order as SortOrder | undefined,
      limit: q.limit,
      offset: q.offset,
    });

    return reply.send({ customers: summaries });
  });

  // ── PATCH /api/customers/:id/stage ─────────────────────────────────────
  fastify.patch('/customers/:id/stage', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = StageTransitionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }
    const firmId = request.jwtUser.firmId;
    const userId = request.jwtUser.userId;

    // Tenant guard — getCustomer is firm-scoped, so a cross-firm
    // call lands here as a 404 rather than leaking existence.
    const existing = await getCustomer(id, firmId);
    if (!existing) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }

    // No-op transitions just return the current summary.
    if (existing.currentStage === parsed.data.toStage) {
      const summary = await buildCustomerSummary(existing);
      return reply.send({ customer: summary });
    }

    const updated = await advanceStage(id, firmId, parsed.data.toStage, {
      actorUserId: userId,
      reason: parsed.data.reason,
    });

    const summary = await buildCustomerSummary(updated);
    return reply.send({ customer: summary });
  });
}
