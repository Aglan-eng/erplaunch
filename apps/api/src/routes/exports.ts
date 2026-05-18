/**
 * Phase 51.2 — exports routes (HTML/CSS-rendered PDFs).
 *
 * Currently surfaces a single endpoint:
 *
 *   POST /api/exports/proposal — render a ProposalInput body into a
 *                                Canva-grade firm-branded PDF.
 *
 * Lives at /api/exports/* (plural) — distinct from the existing
 * `/api/v1/export/*` (singular) surface used by the older
 * single-engagement export jobs. The new pipeline is template-
 * driven and serves any caller that can construct a ProposalInput
 * payload (Phase 52.4's Documents tab will be the first SPA-side
 * consumer).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { renderProposalPdf } from '../services/exporters/templates/proposal/index.js';
import { RenderQueueFullError } from '../services/exporters/puppeteerBrowser.js';

const ProposalLineItemSchema = z.object({
  description: z.string().min(1).max(500),
  qty: z.number().int().nonnegative(),
  unitPrice: z.number().nonnegative(),
  total: z.number().nonnegative(),
});

const ProposalPricingSchema = z.object({
  lineItems: z.array(ProposalLineItemSchema).max(200),
  subtotal: z.number().nonnegative(),
  tax: z.number().nonnegative().optional(),
  total: z.number().nonnegative(),
  // ISO 4217 alpha-3 — match the renderer's expectation. Letting any
  // string through risks an Intl.NumberFormat throw on invalid input.
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const ProposalContentSchema = z.object({
  title: z.string().min(1).max(500),
  date: z.string().min(1),
  preparedBy: z.string().min(1).max(200),
  summary: z.string().max(50_000),
  scope: z.array(z.string().min(1).max(500)).max(200),
  approach: z.string().max(50_000),
  deliverables: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().min(1).max(2000),
      }),
    )
    .max(100),
  timeline: z
    .array(
      z.object({
        phase: z.string().min(1).max(200),
        weeks: z.number().int().nonnegative(),
        description: z.string().min(1).max(2000),
      }),
    )
    .max(100),
  pricing: ProposalPricingSchema,
  terms: z.string().max(50_000),
});

const ProposalInputBodySchema = z.object({
  // firmId in the body is ignored — the renderer always uses
  // request.jwtUser.firmId for tenant isolation. The field is left
  // optional on the schema so we don't reject legitimate clients
  // that include it by habit.
  firmId: z.string().optional(),
  customer: z.object({
    name: z.string().min(1).max(200),
    address: z.string().max(1000).optional(),
    contactName: z.string().max(200).optional(),
  }),
  proposal: ProposalContentSchema,
});

export async function exportsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/exports/proposal', async (request, reply) => {
    const parsed = ProposalInputBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    // Always source firmId from the authenticated session — the
    // request body's firmId is informational only.
    const firmId = request.jwtUser.firmId;

    try {
      const pdf = await renderProposalPdf({
        firmId,
        customer: parsed.data.customer,
        proposal: parsed.data.proposal,
      });
      const filename = buildFilename(parsed.data.customer.name, parsed.data.proposal.title);
      return reply
        .type('application/pdf')
        .header('Content-Length', String(pdf.byteLength))
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(pdf);
    } catch (err) {
      if (err instanceof RenderQueueFullError) {
        return reply
          .code(503)
          .header('Retry-After', '5')
          .send({ error: { code: 'QUEUE_FULL', message: err.message } });
      }
      throw err;
    }
  });
}

function buildFilename(customerName: string, proposalTitle: string): string {
  const safe = (s: string): string =>
    s.replace(/[^A-Za-z0-9._\- ]+/g, '_').trim() || 'document';
  return `${safe(customerName)} — ${safe(proposalTitle)}.pdf`;
}
