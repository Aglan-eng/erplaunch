/**
 * Phase 51.2 — proposal template input contract.
 *
 * This is the structured payload `renderProposalPdf` (in `index.ts`)
 * accepts. The route layer at POST /api/exports/proposal validates
 * the request body against this shape via Zod, then passes it
 * through to the renderer. Brand-pack styling (colors, fonts, logo)
 * is NOT in this input — it's looked up by `firmId` at render time
 * from the Phase 49 Firm template fields.
 */

export interface ProposalCustomer {
  name: string;
  address?: string;
  contactName?: string;
}

export interface ProposalDeliverable {
  name: string;
  description: string;
}

export interface ProposalTimelinePhase {
  phase: string;
  weeks: number;
  description: string;
}

export interface ProposalLineItem {
  description: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface ProposalPricing {
  lineItems: ProposalLineItem[];
  subtotal: number;
  tax?: number;
  total: number;
  /** ISO 4217 — e.g. "USD", "AED", "EUR". Drives Intl.NumberFormat. */
  currency: string;
}

export interface ProposalContent {
  title: string;
  /** ISO 8601 date string — e.g. "2026-05-19". The renderer formats
   *  it locally so callers don't need to think about presentation. */
  date: string;
  preparedBy: string;
  /** Markdown allowed. Rendered via `marked` + sanitized via
   *  `sanitize-html` before being placed in the template. */
  summary: string;
  /** Plain-text bullets — rendered as <li> elements. */
  scope: string[];
  /** Markdown allowed (see `summary`). */
  approach: string;
  deliverables: ProposalDeliverable[];
  timeline: ProposalTimelinePhase[];
  pricing: ProposalPricing;
  /** Markdown allowed (see `summary`). */
  terms: string;
}

export interface ProposalInput {
  /** Firm scope — drives brand-pack lookup at render time. */
  firmId: string;
  customer: ProposalCustomer;
  proposal: ProposalContent;
}
