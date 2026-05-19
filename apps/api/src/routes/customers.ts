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
import { createId } from '@paralleldrive/cuid2';

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
import {
  getCustomerDetail,
  updateCustomerEditableFields,
} from '../db/customerDetail.js';
import { getDb } from '../db/index.js';

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

  // ── GET /api/v1/customers/:id ──────────────────────────────────────────
  fastify.get('/customers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const firmId = request.jwtUser.firmId;
    const detail = await getCustomerDetail(id, firmId);
    if (!detail) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.send({ customer: detail });
  });

  // ── GET /api/v1/customers/:id/activity ─────────────────────────────────
  fastify.get('/customers/:id/activity', async (request, reply) => {
    const { id } = request.params as { id: string };
    const firmId = request.jwtUser.firmId;
    // Tenant guard.
    const exists = await getCustomer(id, firmId);
    if (!exists) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const querySchema = z.object({
      limit: z.coerce.number().int().positive().max(500).optional(),
      offset: z.coerce.number().int().nonnegative().optional(),
      types: z.string().optional(),
    });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }
    const limit = parsed.data.limit ?? 50;
    const offset = parsed.data.offset ?? 0;
    const typeList = parsed.data.types
      ? parsed.data.types
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const db = getDb();
    const filters: string[] = [
      `(a.customerId = ? OR (a.customerId IS NULL AND a.engagementId = ?))`,
    ];
    const args: Array<string | number> = [id, exists.sourceEngagementId ?? ''];
    if (typeList.length > 0) {
      filters.push(`a.action IN (${typeList.map(() => '?').join(',')})`);
      args.push(...typeList);
    }
    args.push(limit, offset);

    const rows = await db.execute({
      sql: `SELECT a.id, a.action, a.details, a.fromStage, a.toStage, a.isRollback,
                   a.createdAt, a.actorUserId, u.name AS actorName
            FROM ActivityLog a
            LEFT JOIN User u ON u.id = a.actorUserId
            WHERE ${filters.join(' AND ')}
            ORDER BY a.createdAt DESC
            LIMIT ? OFFSET ?`,
      args,
    });

    const activities = rows.rows.map((raw) => {
      const r = raw as unknown as {
        id: unknown;
        action: unknown;
        details: unknown;
        fromStage: unknown;
        toStage: unknown;
        isRollback: unknown;
        createdAt: unknown;
        actorUserId: unknown;
        actorName: unknown;
      };
      let summary = String(r.action);
      const action = String(r.action);
      if (action === 'STAGE_TRANSITION') {
        summary = `${r.actorName ?? 'system'} moved from ${String(r.fromStage)} to ${String(r.toStage)}`;
        if (Number(r.isRollback ?? 0) === 1) {
          summary = `Rolled back from ${String(r.fromStage)} to ${String(r.toStage)}`;
        }
      } else if (action === 'OWNER_HANDOFF') {
        summary = `Handoff: ${String(r.fromStage)} → ${String(r.toStage)}`;
      } else if (action === 'CUSTOMER_EDITED') {
        summary = `${r.actorName ?? 'system'} edited customer details`;
      }
      return {
        id: String(r.id),
        action,
        actorUserId: r.actorUserId == null ? null : String(r.actorUserId),
        actorName: r.actorName == null ? 'system' : String(r.actorName),
        fromStage: r.fromStage == null ? null : String(r.fromStage),
        toStage: r.toStage == null ? null : String(r.toStage),
        isRollback: Number(r.isRollback ?? 0) === 1,
        details: r.details == null ? null : String(r.details),
        summary,
        createdAt: String(r.createdAt),
      };
    });
    return reply.send({ activities, limit, offset });
  });

  // ── PATCH /api/v1/customers/:id ────────────────────────────────────────
  const PatchBody = z.object({
    customerName: z.string().min(1).max(200).optional(),
    customerAddress: z.string().max(1000).nullable().optional(),
    primaryContactName: z.string().max(200).nullable().optional(),
    primaryContactEmail: z.string().email().nullable().optional(),
    primaryContactPhone: z.string().max(50).nullable().optional(),
    arr: z.number().nonnegative().nullable().optional(),
    salesOwnerUserId: z.string().nullable().optional(),
    projectLeadUserId: z.string().nullable().optional(),
    csmUserId: z.string().nullable().optional(),
    arOwnerUserId: z.string().nullable().optional(),
  });

  fastify.patch('/customers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const firmId = request.jwtUser.firmId;
    const actorUserId = request.jwtUser.userId;
    const parsed = PatchBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const existing = await getCustomer(id, firmId);
    if (!existing) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    // Defence: any owner userId in the patch must belong to the
    // caller's firm. Empty string / null clear the column; only
    // present non-null strings need validation.
    const db = getDb();
    const ownerFields: Array<
      'salesOwnerUserId' | 'projectLeadUserId' | 'csmUserId' | 'arOwnerUserId'
    > = ['salesOwnerUserId', 'projectLeadUserId', 'csmUserId', 'arOwnerUserId'];
    for (const f of ownerFields) {
      const next = parsed.data[f];
      if (next && typeof next === 'string') {
        const r = await db.execute({
          sql: `SELECT 1 AS ok FROM User WHERE id = ? AND firmId = ? LIMIT 1`,
          args: [next, firmId],
        });
        if (r.rows.length === 0) {
          return reply.code(400).send({
            error: {
              code: 'CROSS_FIRM_OWNER',
              message: `User ${next} is not a member of this firm.`,
            },
          });
        }
      }
    }

    try {
      const { detail, changes } = await updateCustomerEditableFields(
        id,
        firmId,
        parsed.data,
      );

      // Activity row — best-effort, requires sourceEngagementId due
      // to the legacy NOT NULL engagementId FK on ActivityLog.
      if (existing.sourceEngagementId && Object.keys(changes).length > 0) {
        try {
          await db.execute({
            sql: `INSERT INTO ActivityLog
                    (id, engagementId, customerId, firmId, action, details, actorUserId, createdAt)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              `act_${id}_${Date.now()}_${createId().slice(0, 8)}`,
              existing.sourceEngagementId,
              id,
              firmId,
              'CUSTOMER_EDITED',
              JSON.stringify({ changes }),
              actorUserId,
              new Date().toISOString(),
            ],
          });
        } catch {
          // Audit-log gap is OK — the write landed.
        }
      }

      return reply.send({ customer: detail });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({
        error: { code: 'UPDATE_FAILED', message },
      });
    }
  });
}
