/**
 * Phase 49.3 — Firm Brand Pack template routes.
 *
 *   GET   /firm/template          — current template fields + version
 *   PATCH /firm/template          — partial update to individual fields
 *   POST  /firm/template-pack     — ingest a Brand Pack markdown file
 *                                    (parses + writes all 12 sections)
 *
 * Plus routes for the Phase 49.4 CustomTemplate table:
 *
 *   GET   /firm/custom-templates           — list firm's custom templates
 *   POST  /firm/custom-templates           — create
 *   GET   /firm/custom-templates/:id       — read one
 *   PATCH /firm/custom-templates/:id       — update name/body
 *   DELETE /firm/custom-templates/:id      — remove
 *
 * All gated to APP_ADMIN via the matrix's ROLES resource (same gate
 * the Phase 46.8.6 firmSalesTemplates routes use). Brand Pack ingest
 * is firm-wide content and shouldn't be editable by anyone but a firm
 * admin.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';
import { parseBrandPack } from '../services/brandPackParser.js';
import { seedXelerateBrandPack } from '../db/seeds/049-xelerate-brand-pack.js';

const HEADLINE_CASE_SCHEMA = z.enum(['sentence', 'title', 'upper']);
const HEX_COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const PatchSchema = z.object({
  tagline: z.string().max(500).nullable().optional(),
  subtitle: z.string().max(500).nullable().optional(),
  companyDescription: z.string().max(20_000).nullable().optional(),
  whyUs: z.string().max(20_000).nullable().optional(),
  voiceGuide: z.string().max(20_000).nullable().optional(),
  themeFontFamily: z.string().max(200).nullable().optional(),
  themeHeadlineCase: HEADLINE_CASE_SCHEMA.nullable().optional(),
  themeAccentColor: HEX_COLOR.nullable().optional(),
  methodology: z
    .array(
      z.object({
        step: z.number().int().nonnegative(),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(5000),
      }),
    )
    .optional(),
  roadmap: z
    .array(
      z.object({
        phase: z.number().int().nonnegative(),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(5000),
      }),
    )
    .optional(),
  proposalStructure: z
    .array(
      z.object({
        section: z.number().int().nonnegative(),
        title: z.string().min(1).max(200),
        bullets: z.array(z.string().min(1).max(500)),
      }),
    )
    .optional(),
  pricingTemplate: z
    .array(
      z.object({
        sku: z.string().min(1).max(100),
        description: z.string().min(1).max(500),
        annual: z.number().finite().min(0),
      }),
    )
    .optional(),
  industryVerticals: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        outcome: z.string().min(1).max(2000),
        strategicContext: z.string().min(1).max(2000),
        approach: z.string().min(1).max(2000),
      }),
    )
    .optional(),
  ctaOptions: z
    .array(
      z.object({
        label: z.string().min(1).max(500),
        description: z.string().min(0).max(2000),
      }),
    )
    .optional(),
});

const PackBodySchema = z.object({
  markdownPack: z.string().min(1).max(100_000),
});

const CustomTemplateBodySchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(64),
  body: z.string().min(0).max(100_000),
  themeLocked: z.boolean().optional(),
});

const CustomTemplatePatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  body: z.string().min(0).max(100_000).optional(),
  themeLocked: z.boolean().optional(),
});

export async function firmTemplateRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // ── GET /firm/template ────────────────────────────────────────────────
  fastify.get(
    '/firm/template',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request, reply) => {
      const t = await db.getFirmTemplate(request.jwtUser.firmId);
      if (!t) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      return reply.send({ data: t });
    },
  );

  // ── PATCH /firm/template ──────────────────────────────────────────────
  fastify.patch(
    '/firm/template',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request, reply) => {
      const parsed = PatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }
      const updated = await db.updateFirmTemplate(request.jwtUser.firmId, parsed.data);
      if (!updated) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      return reply.send({ data: updated });
    },
  );

  // ── POST /firm/template-pack ──────────────────────────────────────────
  // Strict ingest of a 12-section Brand Pack. Reject any malformed
  // pack with the missing-section list so the firm admin can fix
  // their pack and retry.
  fastify.post(
    '/firm/template-pack',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request, reply) => {
      const parsed = PackBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }
      const result = parseBrandPack(parsed.data.markdownPack);
      if (!result.ok) {
        return reply.code(400).send({
          error: {
            code: result.errorCode,
            message: result.message,
            ...(result.missingSections ? { missingSections: result.missingSections } : {}),
            ...(result.malformedSection ? { malformedSection: result.malformedSection } : {}),
          },
        });
      }
      const updated = await db.updateFirmTemplate(request.jwtUser.firmId, result.patch);
      if (!updated) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      try {
        await db.logActivity(
          // No engagement scope — this is firm-wide content. The
          // helper accepts null engagementId for firm-level events.
          // Falls back to a synthetic engagementId of '' if the
          // logger insists; non-fatal either way.
          '',
          request.jwtUser.firmId,
          'BRAND_PACK_INGESTED',
          `Firm template version bumped to ${updated.templateVersion}`,
        );
      } catch {
        // Non-fatal — the pack landed on disk, audit log is best-effort.
      }
      return reply.send({ data: updated });
    },
  );

  // ── Custom templates (Phase 49.4) ─────────────────────────────────────
  fastify.get(
    '/firm/custom-templates',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request) => {
      const rows = await db.listCustomTemplatesByFirm(request.jwtUser.firmId);
      return { data: rows };
    },
  );

  fastify.post(
    '/firm/custom-templates',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request, reply) => {
      const parsed = CustomTemplateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }
      const created = await db.createCustomTemplate({
        firmId: request.jwtUser.firmId,
        ...parsed.data,
      });
      return reply.code(201).send({ data: created });
    },
  );

  fastify.get(
    '/firm/custom-templates/:id',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = await db.findCustomTemplateById(id);
      if (!row || row.firmId !== request.jwtUser.firmId) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      return reply.send({ data: row });
    },
  );

  fastify.patch(
    '/firm/custom-templates/:id',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await db.findCustomTemplateById(id);
      if (!existing || existing.firmId !== request.jwtUser.firmId) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      const parsed = CustomTemplatePatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }
      const updated = await db.updateCustomTemplate(id, parsed.data);
      return reply.send({ data: updated });
    },
  );

  fastify.delete(
    '/firm/custom-templates/:id',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await db.findCustomTemplateById(id);
      if (!existing || existing.firmId !== request.jwtUser.firmId) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      await db.deleteCustomTemplate(id);
      return reply.send({ data: { ok: true } });
    },
  );

  // ── POST /admin/firm/:firmId/reseed-brand-pack (Phase 50.9.3) ─────────
  // Manual force-reseed of the Brand Pack from the on-disk seed file.
  // Clears the firm's `brandPackContentHash` first so the seed's
  // idempotency gate sees a hash mismatch and re-parses + writes.
  //
  // Why this exists: even with the auto-run wiring in initDb (Phase
  // 50.9.3), if an ops engineer ALSO hand-edited firm content via the
  // UI between deploys, they may want to drop the hand-edit and
  // resync to the seed file without a redeploy. This endpoint is the
  // emergency lever. Gated to APP_ADMIN — `firmId` in the URL is the
  // target, but the caller must be APP_ADMIN on their OWN firm
  // (single-tenant safety: a malicious admin on firm A can't reseed
  // firm B's content because the seed only touches the `xelerate`
  // slug).
  fastify.post(
    '/admin/firm/:firmId/reseed-brand-pack',
    { preHandler: requirePermission('WRITE', 'ROLES') },
    async (request, reply) => {
      const { firmId } = request.params as { firmId: string };
      // Defence-in-depth: confirm the caller's firm matches the URL
      // firmId. The matrix already restricts WRITE on ROLES to
      // APP_ADMIN on that firm, but this catches future regressions
      // where someone widens the permission and forgets the scoping.
      if (request.jwtUser.firmId !== firmId) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
      }
      const client = db.getDb();
      await client.execute({
        sql: `UPDATE Firm SET brandPackContentHash = NULL WHERE id = ?`,
        args: [firmId],
      });
      const result = await seedXelerateBrandPack();
      if (result.status === 'PARSE_ERROR') {
        return reply.code(500).send({
          error: { code: 'PARSE_ERROR', message: result.message },
        });
      }
      try {
        await db.logActivity(
          '',
          firmId,
          'BRAND_PACK_RESEEDED',
          `Manual reseed: ${result.status} (${result.message})`,
        );
      } catch {
        // Non-fatal — audit log is best-effort.
      }
      return reply.send({
        data: {
          status: result.status,
          templateVersion: result.templateVersion,
          contentHash: result.contentHash,
          message: result.message,
        },
      });
    },
  );
}
