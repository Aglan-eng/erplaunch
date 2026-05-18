/**
 * Phase 51.2 — Branded proposal PDF renderer.
 *
 * Pipeline:
 *   1. Resolve brand-pack tokens (colors / fonts / logo) via the
 *      shared `_shared/brandPackCss` helper (extracted in 51.3 so
 *      proposal + SOW + future templates agree on the contract).
 *   2. Render the input's markdown fields (summary, approach,
 *      terms) to HTML via the shared `renderMarkdown`.
 *   3. Pre-format pricing line items + totals into locale-aware
 *      currency strings so the Handlebars template stays dumb.
 *   4. Load + compile the template (cached at module load) and
 *      apply the assembled context.
 *   5. Drive the Phase 51.1 puppeteer singleton to convert the HTML
 *      to a PDF Buffer.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import Handlebars from 'handlebars';

import { htmlToPdf } from '../../htmlToPdf.js';
import {
  buildBrandTokens,
  formatDate,
  loadFirmIdentity,
  renderMarkdown,
} from '../_shared/brandPackCss.js';
import type { ProposalInput, ProposalPricing } from './types.js';

// ─── Template asset loading (cached at module init) ─────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Compiled Handlebars template — cached at module load so renders don't pay
 *  the parse cost. The .html + .css files are read synchronously once;
 *  changes during a running process require a redeploy. */
const TEMPLATE_HTML = readFileSync(join(__dirname, 'template.html'), 'utf8');
const TEMPLATE_CSS = readFileSync(join(__dirname, 'template.css'), 'utf8');
const compiledTemplate = Handlebars.compile(TEMPLATE_HTML, { noEscape: false });

// ─── Pricing formatting (proposal-specific) ─────────────────────────────────

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

// ─── Public entrypoint ─────────────────────────────────────────────────────

export async function renderProposalPdf(input: ProposalInput): Promise<Buffer> {
  const [brand, firm] = await Promise.all([
    buildBrandTokens(input.firmId),
    loadFirmIdentity(input.firmId),
  ]);

  const context = {
    customer: input.customer,
    proposal: input.proposal,
    firm,
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
