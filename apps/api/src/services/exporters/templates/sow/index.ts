/**
 * Phase 51.3 — Branded SOW PDF renderer.
 *
 * Mirrors the Phase 51.2 proposal renderer's pipeline, swapping the
 * proposal-specific pricing formatting for SOW-specific fees +
 * milestone formatting. Brand-pack tokens, markdown rendering, date
 * formatting, and firm-identity loading all come from the shared
 * `_shared/brandPackCss` helper so SOWs feel like the same product
 * as proposals.
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
import type { SowFees, SowInput, SowMilestone } from './types.js';

// ─── Template asset loading (cached at module init) ─────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATE_HTML = readFileSync(join(__dirname, 'template.html'), 'utf8');
const TEMPLATE_CSS = readFileSync(join(__dirname, 'template.css'), 'utf8');
const compiledTemplate = Handlebars.compile(TEMPLATE_HTML, { noEscape: false });

// ─── SOW-specific formatting ────────────────────────────────────────────────

interface FormattedMilestone {
  name: string;
  targetDate: string;
  paymentPercent: number;
}

function formatMilestones(milestones: ReadonlyArray<SowMilestone>): FormattedMilestone[] {
  return milestones.map((m) => ({
    name: m.name,
    targetDate: formatDate(m.targetDate),
    paymentPercent: m.paymentPercent,
  }));
}

function sumPaymentPercent(milestones: ReadonlyArray<SowMilestone>): number {
  // Defensive rounding — caller is responsible for the contract
  // shape (no enforcement that totals hit 100%), but stray floats
  // from JSON marshalling shouldn't surface in the rendered PDF.
  const total = milestones.reduce((acc, m) => acc + (m.paymentPercent || 0), 0);
  return Math.round(total * 100) / 100;
}

interface FormattedFees {
  fixedFee: string | null;
  tAndM: {
    rate: string;
    estimatedHours: number;
    cap: string | null;
  } | null;
}

function formatFees(fees: SowFees): FormattedFees {
  const fmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: fees.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return {
    fixedFee: fees.fixedFee != null ? fmt.format(fees.fixedFee) : null,
    tAndM: fees.tAndM
      ? {
          rate: fmt.format(fees.tAndM.rate),
          estimatedHours: fees.tAndM.estimatedHours,
          cap: fees.tAndM.cap != null ? fmt.format(fees.tAndM.cap) : null,
        }
      : null,
  };
}

// ─── Public entrypoint ─────────────────────────────────────────────────────

export async function renderSowPdf(input: SowInput): Promise<Buffer> {
  const [brand, firm] = await Promise.all([
    buildBrandTokens(input.firmId),
    loadFirmIdentity(input.firmId),
  ]);

  const context = {
    customer: input.customer,
    sow: input.sow,
    firm,
    brand,
    baseStyles: TEMPLATE_CSS,
    projectOverviewHtml: renderMarkdown(input.sow.projectOverview),
    changeOrderProcessHtml: renderMarkdown(input.sow.changeOrderProcess),
    termAndTerminationHtml: renderMarkdown(input.sow.termAndTermination),
    milestonesFormatted: formatMilestones(input.sow.milestones),
    totalPaymentPercent: sumPaymentPercent(input.sow.milestones),
    feesFormatted: formatFees(input.sow.fees),
    formattedEffectiveDate: formatDate(input.sow.effectiveDate),
  };

  const html = compiledTemplate(context);

  // domcontentloaded matches the proposal renderer — all assets are
  // inline except the optional logo URL.
  return htmlToPdf(html, { waitUntil: 'domcontentloaded' });
}
