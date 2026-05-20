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
import { renderSowPdf } from '../services/exporters/templates/sow/index.js';
import { RenderQueueFullError } from '../services/exporters/puppeteerBrowser.js';

/**
 * Phase-52.9.2 hotfix — hard timeout for any PDF render.
 *
 * Without this, a stuck Chromium launch / `page.pdf()` call hangs the
 * HTTP connection forever (the production symptom that produced the
 * "spinning generate button" bug report). Configurable via
 * PDF_RENDER_TIMEOUT_MS for local debugging; defaults to 30 seconds
 * which is comfortably above the ~1.5s cold-start + ~500ms warm
 * render observed in the Phase 51 bench.
 */
const PDF_RENDER_TIMEOUT_MS = (() => {
  const raw = process.env.PDF_RENDER_TIMEOUT_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30_000;
})();

export class PdfRenderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`PDF render exceeded ${timeoutMs}ms timeout`);
    this.name = 'PdfRenderTimeoutError';
  }
}

/**
 * Race `fn()` against a timeout. Used by the route layer to enforce a
 * hard upper bound on PDF rendering — see PDF_RENDER_TIMEOUT_MS above.
 * Exported for tests; route handlers use the no-arg `withRenderTimeout`
 * shorthand.
 */
export async function withRenderTimeoutMs<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new PdfRenderTimeoutError(timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withRenderTimeout<T>(fn: () => Promise<T>): Promise<T> {
  return withRenderTimeoutMs(fn, PDF_RENDER_TIMEOUT_MS);
}

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

  registerSowRoute(fastify);

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
      const pdf = await withRenderTimeout(() =>
        renderProposalPdf({
          firmId,
          customer: parsed.data.customer,
          proposal: parsed.data.proposal,
        }),
      );
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
      if (err instanceof PdfRenderTimeoutError) {
        request.log.error(`[exports.proposal] timeout: ${err.message}`);
        return reply
          .code(504)
          .send({ error: { code: 'RENDER_TIMEOUT', message: err.message } });
      }
      request.log.error(
        `[exports.proposal] render failed: ${err instanceof Error ? err.stack : String(err)}`,
      );
      return reply.code(500).send({
        error: {
          code: 'RENDER_FAILED',
          message: err instanceof Error ? err.message : 'Unknown render error',
        },
      });
    }
  });
}

function buildFilename(customerName: string, proposalTitle: string): string {
  const safe = (s: string): string =>
    s.replace(/[^A-Za-z0-9._\- ]+/g, '_').trim() || 'document';
  return `${safe(customerName)} — ${safe(proposalTitle)}.pdf`;
}

// ─── Phase 51.3 — SOW endpoint ─────────────────────────────────────────────

const SowDeliverableSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  acceptanceCriteria: z.string().min(1).max(5000),
});

const SowMilestoneSchema = z.object({
  name: z.string().min(1).max(200),
  targetDate: z.string().min(1),
  paymentPercent: z.number().min(0).max(100),
});

const SowFeesSchema = z.object({
  fixedFee: z.number().nonnegative().optional(),
  tAndM: z
    .object({
      rate: z.number().nonnegative(),
      estimatedHours: z.number().nonnegative(),
      cap: z.number().nonnegative().optional(),
    })
    .optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  paymentTerms: z.string().min(1).max(2000),
});

const SowSignaturesSchema = z.object({
  firmSignatoryName: z.string().min(1).max(200),
  firmSignatoryTitle: z.string().min(1).max(200),
  customerSignatoryName: z.string().min(1).max(200),
  customerSignatoryTitle: z.string().min(1).max(200),
});

const SowContentSchema = z.object({
  title: z.string().min(1).max(500),
  effectiveDate: z.string().min(1),
  referenceProposalNumber: z.string().max(100).optional(),
  projectOverview: z.string().max(50_000),
  inScope: z.array(z.string().min(1).max(500)).max(200),
  outOfScope: z.array(z.string().min(1).max(500)).max(200),
  deliverables: z.array(SowDeliverableSchema).max(100),
  milestones: z.array(SowMilestoneSchema).max(100),
  assumptions: z.array(z.string().min(1).max(500)).max(200),
  changeOrderProcess: z.string().max(50_000),
  fees: SowFeesSchema,
  termAndTermination: z.string().max(50_000),
  signatures: SowSignaturesSchema,
});

const SowInputBodySchema = z.object({
  // firmId in the body is ignored — sourced from jwtUser for tenant
  // isolation. See note on the proposal route above.
  firmId: z.string().optional(),
  customer: z.object({
    name: z.string().min(1).max(200),
    address: z.string().max(1000).optional(),
    contactName: z.string().max(200).optional(),
  }),
  sow: SowContentSchema,
});

function registerSowRoute(fastify: FastifyInstance): void {
  fastify.post('/exports/sow', async (request, reply) => {
    const parsed = SowInputBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const firmId = request.jwtUser.firmId;
    try {
      const pdf = await withRenderTimeout(() =>
        renderSowPdf({
          firmId,
          customer: parsed.data.customer,
          sow: parsed.data.sow,
        }),
      );
      const filename = buildFilename(parsed.data.customer.name, `${parsed.data.sow.title} (SOW)`);
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
      if (err instanceof PdfRenderTimeoutError) {
        request.log.error(`[exports.sow] timeout: ${err.message}`);
        return reply
          .code(504)
          .send({ error: { code: 'RENDER_TIMEOUT', message: err.message } });
      }
      request.log.error(
        `[exports.sow] render failed: ${err instanceof Error ? err.stack : String(err)}`,
      );
      return reply.code(500).send({
        error: {
          code: 'RENDER_FAILED',
          message: err instanceof Error ? err.message : 'Unknown render error',
        },
      });
    }
  });
}
