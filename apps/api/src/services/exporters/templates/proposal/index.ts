/**
 * Phase 51.2 — Branded proposal PDF renderer.
 *
 * Pipeline:
 *   1. Resolve brand-pack tokens (colors / fonts / logo) for the
 *      firm by joining Phase 49 `Firm` columns + Phase 27 branding
 *      columns. Missing values fall back to neutral defaults.
 *   2. Render the input's markdown fields (summary, approach,
 *      terms) to HTML via `marked`, then sanitize via
 *      `sanitize-html`.
 *   3. Pre-format pricing line items + totals into locale-aware
 *      currency strings so the Handlebars template stays dumb.
 *   4. Load + compile the template (cached at module load) and
 *      apply the assembled context.
 *   5. Drive the Phase 51.1 puppeteer singleton to convert the HTML
 *      to a PDF Buffer.
 *
 * Brand-pack mapping (`buildBrandTokens`):
 *   --brand-primary       ← Firm.primaryColor
 *   --brand-secondary     ← Firm.secondaryColor
 *   --brand-accent        ← FirmTemplate.themeAccentColor
 *   --brand-text          ← derived (neutral dark, no per-firm
 *                            override yet)
 *   --brand-bg            ← derived (neutral light)
 *   --brand-font-heading  ← FirmTemplate.themeFontFamily
 *   --brand-font-body     ← FirmTemplate.themeFontFamily (same
 *                            value for v1; future phases may split)
 *   --brand-logo-url      ← Firm.logoUrl (rendered as
 *                            `url("…")` in the CSS variable)
 *
 * The spec's `--brand-text` / `--brand-bg` slots are reserved on
 * the contract surface even though the current schema doesn't
 * surface per-firm overrides — that way the renderer doesn't need
 * a breaking change when Phase 53 (or later) adds those columns.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import Handlebars from 'handlebars';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

import { getFirmBranding } from '../../../../db/firmBranding.js';
import { getFirmTemplate } from '../../../../db/firmTemplate.js';
import { htmlToPdf } from '../../htmlToPdf.js';
import type { ProposalInput, ProposalPricing } from './types.js';

// ─── Template asset loading (cached at module init) ─────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Compiled Handlebars template — cached at module load so renders don't pay
 *  the parse cost. The .html + .css files are read synchronously once;
 *  changes during a running process require a redeploy. */
const TEMPLATE_HTML = readFileSync(join(__dirname, 'template.html'), 'utf8');
const TEMPLATE_CSS = readFileSync(join(__dirname, 'template.css'), 'utf8');
const compiledTemplate = Handlebars.compile(TEMPLATE_HTML, { noEscape: false });

// ─── Brand-pack token resolution ────────────────────────────────────────────

interface BrandTokens {
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  bg: string;
  fontHeading: string;
  fontBody: string;
  logoUrl: string | null;
  /** CSS-value form of logoUrl, e.g. `url("https://…")` or `none`. */
  logoCss: string;
}

/** Neutral defaults — used when the firm has no brand-pack value for a
 *  given slot. Tuned for legible, vendor-neutral output. */
const DEFAULT_BRAND: BrandTokens = {
  primary: '#0F172A',
  secondary: '#475569',
  accent: '#1FAE5C',
  text: '#1E293B',
  bg: '#FFFFFF',
  fontHeading: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontBody: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  logoUrl: null,
  logoCss: 'none',
};

async function buildBrandTokens(firmId: string): Promise<BrandTokens> {
  const branding = await getFirmBranding(firmId);
  const template = await getFirmTemplate(firmId);
  const fontFamily = template?.themeFontFamily?.trim();
  return {
    primary: branding?.primaryColor ?? DEFAULT_BRAND.primary,
    secondary: branding?.secondaryColor ?? DEFAULT_BRAND.secondary,
    accent: template?.themeAccentColor ?? DEFAULT_BRAND.accent,
    text: DEFAULT_BRAND.text,
    bg: DEFAULT_BRAND.bg,
    fontHeading: fontFamily && fontFamily.length > 0 ? fontFamily : DEFAULT_BRAND.fontHeading,
    fontBody: fontFamily && fontFamily.length > 0 ? fontFamily : DEFAULT_BRAND.fontBody,
    logoUrl: branding?.logoUrl ?? null,
    logoCss: branding?.logoUrl ? `url("${escapeCssUrl(branding.logoUrl)}")` : 'none',
  };
}

/** Defence against CSS injection through a malformed logoUrl. We only
 *  allow ASCII URL-safe chars + the obvious URL punctuation; anything
 *  else strips. The DB-side validation already constrains the column
 *  but the URL may have come from a Phase 49 Brand Pack ingest, which
 *  is lighter-weight. */
function escapeCssUrl(url: string): string {
  return url.replace(/[^A-Za-z0-9:/_\-.?=&%#~]/g, '');
}

// ─── Markdown → safe HTML ───────────────────────────────────────────────────

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'ul', 'ol', 'li',
    'strong', 'em', 'b', 'i', 'u', 's',
    'blockquote', 'code', 'pre',
    'a', 'br', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    th: ['align'],
    td: ['align'],
  },
  // Strip any href that isn't http/https/mailto.
  allowedSchemes: ['http', 'https', 'mailto'],
  disallowedTagsMode: 'discard',
};

function renderMarkdown(md: string): string {
  if (!md || md.trim().length === 0) return '';
  // marked's typings allow async + sync; we drive it synchronously
  // because the renderer pipeline doesn't need streaming.
  const html = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

// ─── Pricing formatting ─────────────────────────────────────────────────────

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
  };
}

// ─── Misc presentation helpers ──────────────────────────────────────────────

function formatDate(iso: string): string {
  // Accept ISO date (YYYY-MM-DD) OR full datetime. Render in long form
  // suitable for the cover page.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function firmInitial(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return '·';
  return trimmed.charAt(0).toUpperCase();
}

// ─── Public entrypoint ─────────────────────────────────────────────────────

export async function renderProposalPdf(input: ProposalInput): Promise<Buffer> {
  const brand = await buildBrandTokens(input.firmId);
  const branding = await getFirmBranding(input.firmId);
  const template = await getFirmTemplate(input.firmId);

  const context = {
    customer: input.customer,
    proposal: input.proposal,
    firm: {
      displayName: branding?.displayName ?? 'ERPLaunch',
      initial: firmInitial(branding?.displayName ?? 'ERPLaunch'),
      tagline: template?.tagline ?? null,
      supportEmail: branding?.supportEmail ?? null,
    },
    brand,
    baseStyles: TEMPLATE_CSS,
    summaryHtml: renderMarkdown(input.proposal.summary),
    approachHtml: renderMarkdown(input.proposal.approach),
    termsHtml: renderMarkdown(input.proposal.terms),
    pricingFormatted: formatPricing(input.proposal.pricing),
    formattedDate: formatDate(input.proposal.date),
  };

  const html = compiledTemplate(context);

  // domcontentloaded is sufficient — all assets are inline (CSS in
  // <style> blocks) except the optional logo URL. If logo loading
  // ever blocks render quality we can switch to networkidle0.
  return htmlToPdf(html, { waitUntil: 'domcontentloaded' });
}
