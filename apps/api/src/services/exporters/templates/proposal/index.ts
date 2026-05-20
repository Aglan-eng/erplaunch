/**
 * Phase 51.4 — Xelerate landscape slide deck (proposal) renderer.
 *
 * Pipeline:
 *   1. Resolve brand-pack tokens (Phase 51.3 helper) + load Firm
 *      identity.
 *   2. Build the slide list — content paginates across multiple
 *      navy content slides when a section's items don't fit on one
 *      720px slide. Per-slide caps live in CHUNK_LIMITS below.
 *   3. Pre-format pricing line items into currency strings.
 *   4. Compile the Handlebars template with the assembled context.
 *   5. Drive the puppeteer singleton directly so we can render at
 *      1280×720 with `printBackground: true` and zero margin, and
 *      `await document.fonts.ready` before `page.pdf()` so the
 *      Playfair / Lora TTFs land in the output instead of falling
 *      back to Times/Georgia.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import Handlebars from 'handlebars';

import { withPage } from '../../puppeteerBrowser.js';
import {
  buildBrandTokens,
  formatDate,
  loadFirmIdentity,
  renderMarkdown,
} from '../_shared/brandPackCss.js';
import { ASSETS, fontFaceCss } from '../_assets/index.js';
import type {
  ProposalDeliverable,
  ProposalInput,
  ProposalPricing,
  ProposalTimelinePhase,
} from './types.js';

// ─── Handlebars registration ────────────────────────────────────────────────

// `eq` helper for the slide-type discriminator switch in template.html.
// Registered once at module init — Handlebars helpers are global.
if (!Handlebars.helpers.eq) {
  Handlebars.registerHelper('eq', function eq(a: unknown, b: unknown): boolean {
    return a === b;
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATE_HTML = readFileSync(join(__dirname, 'template.html'), 'utf8');
const TEMPLATE_CSS = readFileSync(join(__dirname, 'template.css'), 'utf8');
const compiledTemplate = Handlebars.compile(TEMPLATE_HTML, { noEscape: false });

// ─── Per-slide content caps ────────────────────────────────────────────────

/**
 * Maximum items that fit comfortably on one 720px navy slide given
 * the Phase 51.4 type-size + padding choices. Tuned to leave the
 * footer + corner-mark room. Slides past these caps split into
 * "(cont.)" follow-ups.
 */
const CHUNK_LIMITS = {
  scopePills: 8, // 2-column pill grid
  deliverables: 4, // 2-column cards
  timeline: 4, // 2-column cards (phase + weeks)
  markdownChars: 1100, // approx; paragraphs are kept whole
} as const;

function chunk<T>(items: ReadonlyArray<T>, perChunk: number): T[][] {
  if (perChunk <= 0) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perChunk) {
    out.push(items.slice(i, i + perChunk));
  }
  return out.length > 0 ? out : [[]];
}

/**
 * Split a markdown blob into N HTML chunks that each fit within the
 * `markdownChars` budget. Splits on blank-line paragraph boundaries
 * so a chunk never breaks mid-sentence. A single oversized paragraph
 * still becomes one chunk (we accept overflow risk over breaking a
 * thought) — callers are expected to keep prose tight.
 */
function chunkMarkdown(md: string): string[] {
  const trimmed = md.trim();
  if (trimmed.length === 0) return [];
  const paragraphs = trimmed.split(/\n{2,}/g);
  const chunks: string[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  for (const p of paragraphs) {
    if (bufLen + p.length > CHUNK_LIMITS.markdownChars && buf.length > 0) {
      chunks.push(buf.join('\n\n'));
      buf = [];
      bufLen = 0;
    }
    buf.push(p);
    bufLen += p.length + 2;
  }
  if (buf.length > 0) chunks.push(buf.join('\n\n'));
  return chunks.map((c) => renderMarkdown(c));
}

// ─── Pricing formatting ────────────────────────────────────────────────────

interface FormattedPricing {
  lineItems: Array<{
    description: string;
    qty: string;
    unitPrice: string;
    total: string;
  }>;
  subtotal: string;
  tax: string | null;
  total: string;
  currency: string;
}

function formatPricing(pricing: ProposalPricing): FormattedPricing {
  const fmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: pricing.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return {
    lineItems: pricing.lineItems.map((item) => ({
      description: item.description,
      qty: String(item.qty),
      unitPrice: fmt.format(item.unitPrice),
      total: fmt.format(item.total),
    })),
    subtotal: fmt.format(pricing.subtotal),
    tax: pricing.tax != null && pricing.tax > 0 ? fmt.format(pricing.tax) : null,
    total: fmt.format(pricing.total),
    currency: pricing.currency,
  };
}

// ─── Slide model ───────────────────────────────────────────────────────────

interface BaseSlide {
  kind:
    | 'cover'
    | 'divider'
    | 'content-markdown'
    | 'content-pills'
    | 'content-cards'
    | 'pricing'
    | 'signature';
  firmName: string;
  proposalTitle: string;
  pageNumber: number;
  pageTotal: number;
}

interface CoverSlide extends BaseSlide {
  kind: 'cover';
  customerName: string;
  formattedDate: string;
  preparedBy: string;
}

interface DividerSlide extends BaseSlide {
  kind: 'divider';
  sectionIndex: number;
  title: string;
}

interface MarkdownContentSlide extends BaseSlide {
  kind: 'content-markdown';
  heading: string;
  html: string;
}

interface PillsContentSlide extends BaseSlide {
  kind: 'content-pills';
  heading: string;
  pills: string[];
}

interface CardsContentSlide extends BaseSlide {
  kind: 'content-cards';
  heading: string;
  cards: Array<{ meta?: string; title: string; body: string }>;
  singleColumn?: boolean;
}

interface PricingSlide extends BaseSlide {
  kind: 'pricing';
  heading: string;
  lineItems: FormattedPricing['lineItems'];
  subtotal: string;
  tax: string | null;
  total: string;
  currency: string;
}

interface SignatureSlide extends BaseSlide {
  kind: 'signature';
  customerName: string;
  customerContact: string;
  preparedBy: string;
}

type Slide =
  | CoverSlide
  | DividerSlide
  | MarkdownContentSlide
  | PillsContentSlide
  | CardsContentSlide
  | PricingSlide
  | SignatureSlide;

interface BuildContext {
  firmName: string;
  proposalTitle: string;
  preparedBy: string;
  customerName: string;
  customerContact: string;
}

function buildContentSection(
  heading: string,
  bodyChunks: string[],
): MarkdownContentSlide[] {
  if (bodyChunks.length === 0) {
    return [
      {
        kind: 'content-markdown',
        firmName: '',
        proposalTitle: '',
        pageNumber: 0,
        pageTotal: 0,
        heading,
        html: '<p style="opacity:0.7">(no content provided)</p>',
      },
    ];
  }
  return bodyChunks.map((html, i) => ({
    kind: 'content-markdown' as const,
    firmName: '',
    proposalTitle: '',
    pageNumber: 0,
    pageTotal: 0,
    heading: i === 0 ? heading : `${heading} (cont.)`,
    html,
  }));
}

function buildScopeSection(scope: ReadonlyArray<string>): PillsContentSlide[] {
  if (scope.length === 0) {
    return [
      {
        kind: 'content-pills',
        firmName: '',
        proposalTitle: '',
        pageNumber: 0,
        pageTotal: 0,
        heading: 'In scope',
        pills: ['(no items provided)'],
      },
    ];
  }
  const chunks = chunk(scope, CHUNK_LIMITS.scopePills);
  return chunks.map((items, i) => ({
    kind: 'content-pills' as const,
    firmName: '',
    proposalTitle: '',
    pageNumber: 0,
    pageTotal: 0,
    heading: i === 0 ? 'In scope' : 'In scope (cont.)',
    pills: items.slice(),
  }));
}

function buildDeliverablesSection(
  deliverables: ReadonlyArray<ProposalDeliverable>,
): CardsContentSlide[] {
  if (deliverables.length === 0) {
    return [
      {
        kind: 'content-cards',
        firmName: '',
        proposalTitle: '',
        pageNumber: 0,
        pageTotal: 0,
        heading: 'Deliverables',
        cards: [{ title: 'No deliverables listed', body: '' }],
      },
    ];
  }
  const chunks = chunk(deliverables, CHUNK_LIMITS.deliverables);
  return chunks.map((items, i) => ({
    kind: 'content-cards' as const,
    firmName: '',
    proposalTitle: '',
    pageNumber: 0,
    pageTotal: 0,
    heading: i === 0 ? 'Deliverables' : 'Deliverables (cont.)',
    cards: items.map((d) => ({ title: d.name, body: d.description })),
  }));
}

function buildTimelineSection(
  timeline: ReadonlyArray<ProposalTimelinePhase>,
): CardsContentSlide[] {
  if (timeline.length === 0) {
    return [
      {
        kind: 'content-cards',
        firmName: '',
        proposalTitle: '',
        pageNumber: 0,
        pageTotal: 0,
        heading: 'Timeline',
        cards: [{ title: 'Timeline pending', body: '' }],
      },
    ];
  }
  const chunks = chunk(timeline, CHUNK_LIMITS.timeline);
  return chunks.map((items, i) => ({
    kind: 'content-cards' as const,
    firmName: '',
    proposalTitle: '',
    pageNumber: 0,
    pageTotal: 0,
    heading: i === 0 ? 'Timeline' : 'Timeline (cont.)',
    cards: items.map((t) => ({
      meta: `${t.weeks} ${t.weeks === 1 ? 'week' : 'weeks'}`,
      title: t.phase,
      body: t.description,
    })),
  }));
}

function buildSlides(ctx: BuildContext, input: ProposalInput): Slide[] {
  const slides: Slide[] = [];

  // Cover.
  slides.push({
    kind: 'cover',
    firmName: ctx.firmName,
    proposalTitle: ctx.proposalTitle,
    pageNumber: 0,
    pageTotal: 0,
    customerName: ctx.customerName,
    formattedDate: formatDate(input.proposal.date),
    preparedBy: ctx.preparedBy,
  });

  const summarySlides = buildContentSection(
    'Executive Summary',
    chunkMarkdown(input.proposal.summary),
  );
  const scopeSlides = buildScopeSection(input.proposal.scope);
  const approachSlides = buildContentSection(
    'Approach',
    chunkMarkdown(input.proposal.approach),
  );
  const deliverableSlides = buildDeliverablesSection(input.proposal.deliverables);
  const timelineSlides = buildTimelineSection(input.proposal.timeline);
  const pricingSlide: PricingSlide = {
    kind: 'pricing',
    firmName: ctx.firmName,
    proposalTitle: ctx.proposalTitle,
    pageNumber: 0,
    pageTotal: 0,
    heading: 'Commercials',
    ...formatPricing(input.proposal.pricing),
  };
  const termsSlides = buildContentSection('Terms', chunkMarkdown(input.proposal.terms));

  const sections: Array<{ title: string; slides: Slide[] }> = [
    { title: 'Executive Summary', slides: summarySlides },
    { title: 'Scope', slides: scopeSlides },
    { title: 'Approach', slides: approachSlides },
    { title: 'Deliverables', slides: deliverableSlides },
    { title: 'Timeline', slides: timelineSlides },
    { title: 'Commercials', slides: [pricingSlide] },
    { title: 'Terms', slides: termsSlides },
  ];

  let sectionIdx = 1;
  for (const section of sections) {
    slides.push({
      kind: 'divider',
      firmName: ctx.firmName,
      proposalTitle: ctx.proposalTitle,
      pageNumber: 0,
      pageTotal: 0,
      sectionIndex: sectionIdx++,
      title: section.title,
    });
    slides.push(...section.slides);
  }

  // Signature close.
  slides.push({
    kind: 'signature',
    firmName: ctx.firmName,
    proposalTitle: ctx.proposalTitle,
    pageNumber: 0,
    pageTotal: 0,
    customerName: ctx.customerName,
    customerContact: ctx.customerContact,
    preparedBy: ctx.preparedBy,
  });

  // Stamp firmName / title / page numbers on every slide.
  const total = slides.length;
  for (let i = 0; i < slides.length; i++) {
    slides[i] = {
      ...slides[i],
      firmName: ctx.firmName,
      proposalTitle: ctx.proposalTitle,
      pageNumber: i + 1,
      pageTotal: total,
    };
  }
  return slides;
}

// ─── Public entrypoint ─────────────────────────────────────────────────────

/**
 * Brand palette specific to the Xelerate landscape deck. Falls back
 * to the firm's brand-pack tokens where they're more specific (e.g.
 * a non-Xelerate firm with a custom accent). For v1 we hardcode the
 * green/navy/gold combination Hesham's deck uses — overriding per
 * firm comes when we support custom backgrounds.
 */
function deckPalette(): { gold: string; green: string; navy: string } {
  return {
    gold: '#C9A84C',
    green: '#2E5E3E',
    navy: '#3D4566',
  };
}

export async function renderProposalPdf(input: ProposalInput): Promise<Buffer> {
  const [brand, firm] = await Promise.all([
    buildBrandTokens(input.firmId),
    loadFirmIdentity(input.firmId),
  ]);
  void brand; // reserved for per-firm overrides in a follow-up

  const palette = deckPalette();
  const firmName = firm.displayName || 'Xelerate';
  const ctx: BuildContext = {
    firmName,
    proposalTitle: input.proposal.title,
    preparedBy: input.proposal.preparedBy,
    customerName: input.customer.name,
    customerContact: input.customer.contactName ?? input.customer.name,
  };
  const slides = buildSlides(ctx, input);

  const html = compiledTemplate({
    fontFaceCss: fontFaceCss(),
    bgGreen: ASSETS.bgGreen,
    bgNavy: ASSETS.bgNavy,
    brand: palette,
    firm: { displayName: firmName },
    proposal: { title: input.proposal.title },
    baseStyles: TEMPLATE_CSS,
    slides,
  });

  return withPage(async (page) => {
    // `load` (vs `domcontentloaded`) waits until every <img>, font,
    // and CSS-referenced resource finishes — including the data:
    // URI backgrounds we embed. Without `load` Chromium may fire
    // pdf() before the background-image is painted and the result
    // is a blank deck (Phase 51.4 prod regression).
    await page.setContent(html, { waitUntil: 'load' });
    // Belt + braces: explicitly await fonts.ready AND force a paint
    // tick so the data-URI backgrounds are fully decoded into the
    // composited frame the PDF stream captures.
    await page.evaluate(async () => {
      await (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
    const pdf = await page.pdf({
      width: '1280px',
      height: '720px',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  });
}
