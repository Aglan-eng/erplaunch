import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';

/**
 * Consultant-facing firm branding surface (Phase 5A / Day 3).
 * Scope is intentionally minimal for pilot: displayName, two colors,
 * supportEmail. Logo upload is a separate follow-up to keep this PR small.
 */

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const UpdateBrandingSchema = z.object({
  displayName: z.string().trim().min(1).max(100).nullable().optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  primaryColor: HexColor.nullable().optional(),
  secondaryColor: HexColor.nullable().optional(),
  supportEmail: z.string().email().max(200).nullable().optional(),
});

export async function firmBrandingRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/firm/branding',
    { preHandler: authenticate },
    async (request) => {
      const { firmId } = request.jwtUser;
      const branding = await db.getFirmBranding(firmId);
      return { data: branding };
    },
  );

  fastify.patch(
    '/firm/branding',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = UpdateBrandingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
      }
      const { firmId } = request.jwtUser;
      const branding = await db.updateFirmBranding(firmId, parsed.data);
      return { data: branding };
    },
  );
}
