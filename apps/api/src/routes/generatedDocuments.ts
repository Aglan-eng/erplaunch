/**
 * Phase 50.4 — GeneratedDocument routes.
 *
 *   POST   /engagements/:engagementId/documents/from-template/:templateId
 *          → render CustomTemplate against engagement, persist, return
 *
 *   GET    /engagements/:engagementId/documents
 *   GET    /engagements/:engagementId/documents/:docId
 *   PATCH  /engagements/:engagementId/documents/:docId
 *   DELETE /engagements/:engagementId/documents/:docId
 *
 *   GET    /engagements/:engagementId/documents/:docId/export?format=pdf|docx|pptx
 *
 * Every route validates firm-scope on the engagement before touching
 * the document row. PATCH and DELETE additionally enforce the row
 * owner OR APP_ADMIN via the matrix's ROLES resource — same gate
 * the Phase 49 firmTemplate routes use for firm-wide content.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';
import { renderTemplate } from '../services/templateRenderer.js';
import { getFirmTemplate } from '../db/firmTemplate.js';
import { getFirmBranding } from '../db/firmBranding.js';
import { markdownToPdf } from '../services/exporters/markdownToPdf.js';
import { markdownToDocx } from '../services/exporters/markdownToDocx.js';
import { markdownToPptx } from '../services/exporters/markdownToPptx.js';

const CreateFromTemplateBody = z.object({
  name: z.string().min(1).max(200).optional(),
});

const UpdateDocumentBody = z.object({
  name: z.string().min(1).max(200).optional(),
  body: z.string().min(0).max(500_000).optional(),
});

const ExportQuery = z.object({
  format: z.enum(['pdf', 'docx', 'pptx']),
});

const FORMAT_META: Record<
  'pdf' | 'docx' | 'pptx',
  { mime: string; ext: string }
> = {
  pdf: { mime: 'application/pdf', ext: 'pdf' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: 'pptx',
  },
};

/**
 * RFC 5987-compatible Content-Disposition filename. ASCII-clean
 * fallback + UTF-8 percent-encoded original lets browsers render
 * Arabic / Cyrillic / etc filenames correctly while old clients
 * still receive a sane fallback.
 */
function contentDispositionFilename(name: string, ext: string): string {
  const fallback = name.replace(/[^A-Za-z0-9._\- ]+/g, '_').trim() || 'document';
  const encoded = encodeURIComponent(`${name}.${ext}`);
  return `attachment; filename="${fallback}.${ext}"; filename*=UTF-8''${encoded}`;
}

export async function generatedDocumentsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // ── POST /from-template/:templateId ───────────────────────────────────
  fastify.post(
    '/engagements/:engagementId/documents/from-template/:templateId',
    async (request, reply) => {
      const { engagementId, templateId } = request.params as {
        engagementId: string;
        templateId: string;
      };
      const firmId = request.jwtUser.firmId;
      const userId = request.jwtUser.userId;

      const eng = await db.findEngagementByIdAndFirmId(engagementId, firmId);
      if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

      const template = await db.findCustomTemplateById(templateId);
      if (!template || template.firmId !== firmId) {
        return reply.code(404).send({ error: { code: 'TEMPLATE_NOT_FOUND' } });
      }

      const parsed = CreateFromTemplateBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const { rendered, missingTokens } = await renderTemplate(template.body, {
        firmId,
        engagementId,
        now: new Date(),
      });

      const doc = await db.createGeneratedDocument({
        firmId,
        engagementId,
        sourceTemplateId: template.id,
        name: parsed.data.name?.trim() || `${template.name} — ${new Date().toISOString().slice(0, 10)}`,
        body: rendered,
        generatedBy: userId,
      });

      try {
        await db.logActivity(
          engagementId,
          firmId,
          'DOCUMENT_GENERATED',
          `Generated "${doc.name}" from template "${template.name}"`,
        );
      } catch {
        // Non-fatal — the document landed.
      }

      return reply.code(201).send({
        data: { document: doc, missingTokens },
      });
    },
  );

  // ── GET list ──────────────────────────────────────────────────────────
  fastify.get('/engagements/:engagementId/documents', async (request, reply) => {
    const { engagementId } = request.params as { engagementId: string };
    const firmId = request.jwtUser.firmId;
    const eng = await db.findEngagementByIdAndFirmId(engagementId, firmId);
    if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const docs = await db.listGeneratedDocumentsByEngagement(engagementId, firmId);
    return reply.send({ data: docs });
  });

  // ── GET one ───────────────────────────────────────────────────────────
  fastify.get(
    '/engagements/:engagementId/documents/:docId',
    async (request, reply) => {
      const { engagementId, docId } = request.params as {
        engagementId: string;
        docId: string;
      };
      const firmId = request.jwtUser.firmId;
      const doc = await db.getGeneratedDocument(docId, firmId);
      if (!doc || doc.engagementId !== engagementId) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      return reply.send({ data: doc });
    },
  );

  // ── PATCH rename + body edit ──────────────────────────────────────────
  fastify.patch(
    '/engagements/:engagementId/documents/:docId',
    async (request, reply) => {
      const { engagementId, docId } = request.params as {
        engagementId: string;
        docId: string;
      };
      const firmId = request.jwtUser.firmId;
      const existing = await db.getGeneratedDocument(docId, firmId);
      if (!existing || existing.engagementId !== engagementId) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      const parsed = UpdateDocumentBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }
      const updated = await db.updateGeneratedDocument(docId, firmId, parsed.data);
      return reply.send({ data: updated });
    },
  );

  // ── DELETE ────────────────────────────────────────────────────────────
  fastify.delete(
    '/engagements/:engagementId/documents/:docId',
    async (request, reply) => {
      const { engagementId, docId } = request.params as {
        engagementId: string;
        docId: string;
      };
      const firmId = request.jwtUser.firmId;
      const existing = await db.getGeneratedDocument(docId, firmId);
      if (!existing || existing.engagementId !== engagementId) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      const ok = await db.deleteGeneratedDocument(docId, firmId);
      if (!ok) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      try {
        await db.logActivity(
          engagementId,
          firmId,
          'DOCUMENT_DELETED',
          `Deleted "${existing.name}"`,
        );
      } catch {
        // Non-fatal.
      }
      return reply.send({ data: { ok: true } });
    },
  );

  // ── GET export?format=pdf|docx|pptx ───────────────────────────────────
  fastify.get(
    '/engagements/:engagementId/documents/:docId/export',
    async (request, reply) => {
      const { engagementId, docId } = request.params as {
        engagementId: string;
        docId: string;
      };
      const firmId = request.jwtUser.firmId;
      const parsedQuery = ExportQuery.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'format must be one of pdf | docx | pptx',
          },
        });
      }
      const format = parsedQuery.data.format;

      const doc = await db.getGeneratedDocument(docId, firmId);
      if (!doc || doc.engagementId !== engagementId) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      // Build the firm meta — firm branding + template fields with
      // platform fallbacks when null.
      const branding = await getFirmBranding(firmId);
      const template = (await getFirmTemplate(firmId)) ?? null;
      const eng = (await db.findEngagementByIdAndFirmId(engagementId, firmId)) as
        | { clientName?: string; code?: string | null }
        | null;

      const meta = {
        title: doc.name,
        firm: {
          ...branding,
          ...(template ?? {
            tagline: null,
            subtitle: null,
            companyDescription: null,
            whyUs: null,
            methodology: [],
            roadmap: [],
            proposalStructure: [],
            pricingTemplate: [],
            industryVerticals: [],
            voiceGuide: null,
            ctaOptions: [],
            themeFontFamily: null,
            themeHeadlineCase: null,
            themeAccentColor: null,
            templateVersion: 1,
          }),
        },
        engagement: eng
          ? { client: eng.clientName ?? '', code: eng.code ?? null }
          : undefined,
      };

      const buf =
        format === 'pdf'
          ? await markdownToPdf(doc.body, meta)
          : format === 'docx'
            ? await markdownToDocx(doc.body, meta)
            : await markdownToPptx(doc.body, meta);

      const { mime, ext } = FORMAT_META[format];
      return streamBuffer(reply, buf, mime, contentDispositionFilename(doc.name, ext));
    },
  );
}

function streamBuffer(
  reply: FastifyReply,
  buf: Buffer,
  mime: string,
  disposition: string,
): FastifyReply {
  return reply
    .type(mime)
    .header('Content-Disposition', disposition)
    .header('Content-Length', String(buf.byteLength))
    .send(buf);
}
