/**
 * Phase 46.8.6 — Firm sales template + pricing routes.
 *
 *   GET   /firm/sales-templates  — read current templates + pricing
 *   PATCH /firm/sales-templates  — update one or more fields
 *
 * Both gated to APP_ADMIN — sales templates affect every prospect's
 * proposal/SOW so non-admins shouldn't be editing the firm-wide
 * defaults. The matrix's ROLES resource is the canonical APP_ADMIN
 * gate (Phase 43.2 — only APP_ADMIN can WRITE roles), so we re-use
 * it here as a proxy for "must be a firm admin".
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';

const PerModulePricingSchema = z.record(z.string().min(1), z.number().finite().min(0));
const GeographyMultipliersSchema = z.record(z.string().min(1), z.number().finite().min(0));

const UpdateSalesTemplatesSchema = z.object({
  perModulePricing: PerModulePricingSchema.optional(),
  defaultPerUserPrice: z.number().finite().min(0).nullable().optional(),
  geographyMultipliers: GeographyMultipliersSchema.optional(),
  whyUsTemplate: z.string().max(20_000).nullable().optional(),
  coverLetterTemplate: z.string().max(20_000).nullable().optional(),
  sowTermsTemplate: z.string().max(20_000).nullable().optional(),
});

export async function firmSalesTemplatesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get(
    '/firm/sales-templates',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request) => {
      const templates = await db.getFirmSalesTemplates(request.jwtUser.firmId);
      return { data: templates };
    },
  );

  fastify.patch(
    '/firm/sales-templates',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request, reply) => {
      const parsed = UpdateSalesTemplatesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }
      const updated = await db.updateFirmSalesTemplates(request.jwtUser.firmId, parsed.data);
      return { data: updated };
    },
  );
}
