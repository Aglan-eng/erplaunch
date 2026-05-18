/**
 * Phase 51.3 — shared brand-pack-to-CSS-variables helper.
 *
 * Extracted from `templates/proposal/index.ts` so every Phase 51.x
 * template (proposal, SOW, future status-report / runbook /
 * solution-doc) injects the same CSS custom-property contract:
 *
 *   --brand-primary       ← Firm.primaryColor
 *   --brand-secondary     ← Firm.secondaryColor
 *   --brand-accent        ← FirmTemplate.themeAccentColor
 *   --brand-text          ← derived (neutral dark, reserved slot)
 *   --brand-bg            ← derived (neutral light, reserved slot)
 *   --brand-font-heading  ← FirmTemplate.themeFontFamily
 *   --brand-font-body     ← FirmTemplate.themeFontFamily
 *   --brand-logo-url      ← Firm.logoUrl, wrapped as `url("…")`
 *
 * Missing values fall through to `DEFAULT_BRAND` so an unbranded
 * firm still renders cleanly with vendor-neutral colour and font
 * choices.
 *
 * Bundled alongside:
 *   - `renderMarkdown` — `marked` + `sanitize-html` with the same
 *     allow-list every template uses for free-text fields.
 *   - `formatDate` — long-form date renderer used by cover pages.
 *   - `firmInitial` — fallback monogram when a firm has no logoUrl.
 *
 * Each template still owns its own pricing / domain-specific
 * formatting because the shape differs (proposal has line items;
 * SOW has fixedFee + tAndM; status report has KPI tiles; etc.).
 */

import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

import { getFirmBranding } from '../../../../db/firmBranding.js';
import { getFirmTemplate } from '../../../../db/firmTemplate.js';

// ─── Brand-pack tokens ──────────────────────────────────────────────────────

export interface BrandTokens {
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

/** Neutral defaults — used when the firm has no brand-pack value for
 *  a given slot. Tuned for legible, vendor-neutral output. */
export const DEFAULT_BRAND: BrandTokens = {
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

export async function buildBrandTokens(firmId: string): Promise<BrandTokens> {
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

/** Defence against CSS injection through a malformed logoUrl. Only
 *  ASCII URL-safe chars + the obvious URL punctuation survive; anything
 *  else strips. The DB-side validation already constrains the column
 *  but the URL may have come from a Phase 49 Brand Pack ingest, which
 *  is lighter-weight. */
export function escapeCssUrl(url: string): string {
  return url.replace(/[^A-Za-z0-9:/_\-.?=&%#~]/g, '');
}

// ─── Firm-identity helpers shared by every cover page ───────────────────────

export interface FirmIdentity {
  displayName: string;
  initial: string;
  tagline: string | null;
  supportEmail: string | null;
}

export async function loadFirmIdentity(firmId: string): Promise<FirmIdentity> {
  const branding = await getFirmBranding(firmId);
  const template = await getFirmTemplate(firmId);
  const displayName = branding?.displayName ?? 'ERPLaunch';
  return {
    displayName,
    initial: firmInitial(displayName),
    tagline: template?.tagline ?? null,
    supportEmail: branding?.supportEmail ?? null,
  };
}

export function firmInitial(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return '·';
  return trimmed.charAt(0).toUpperCase();
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

export function renderMarkdown(md: string): string {
  if (!md || md.trim().length === 0) return '';
  // marked's typings allow async + sync; we drive it synchronously
  // because the renderer pipeline doesn't need streaming.
  const html = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

// ─── Date helpers ───────────────────────────────────────────────────────────

/**
 * Accepts an ISO date (YYYY-MM-DD) OR full datetime. Renders in long
 * form suitable for cover pages + signature blocks. Returns the input
 * unchanged when it can't be parsed — caller decides whether to flag.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
