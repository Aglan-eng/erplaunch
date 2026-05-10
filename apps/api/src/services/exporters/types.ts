/**
 * Phase 50.3 — Shared types for the firm-branded exporters.
 *
 * Every exporter takes the same `ExportMeta` shape so the route layer
 * doesn't need format-specific glue code. The meta covers everything
 * the templates need to brand the output: firm branding (Phase 27
 * colors + logo), firm template fields (Phase 49 tagline / theme
 * tokens), engagement context (client name + code), and the
 * user-visible document title.
 */

import type { FirmBranding } from '../../db/firmBranding.js';
import type { FirmTemplate, HeadlineCase } from '../../db/firmTemplate.js';

/**
 * Apply themeHeadlineCase to a heading string. Mirrors the web-side
 * helper at apps/web/src/lib/templateThemeLock.ts but lives here so
 * the api package doesn't reach across the workspace boundary.
 * Title case uses the Chicago Manual lowercase set for words after
 * the first.
 */
const TITLE_CASE_LOWERCASE_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of',
  'on', 'or', 'so', 'the', 'to', 'up', 'yet', 'with',
]);

export function applyHeadlineCase(text: string, mode: HeadlineCase | null): string {
  if (!mode) return text;
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  switch (mode) {
    case 'sentence':
      return trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
    case 'title':
      return trimmed
        .split(/\s+/)
        .map((w, i) => {
          if (w.length === 0) return w;
          const lower = w.toLowerCase();
          if (i > 0 && TITLE_CASE_LOWERCASE_WORDS.has(lower)) return lower;
          return lower[0].toUpperCase() + lower.slice(1);
        })
        .join(' ');
    case 'upper':
      return trimmed.toUpperCase();
    default:
      return trimmed;
  }
}

export interface ExportMeta {
  /** User-visible document title — used in the cover page / first slide / PDF metadata. */
  title: string;
  /** Combined branding + template fields. Exporters pull what they need;
   *  null fields fall back to platform defaults. */
  firm: FirmBranding & FirmTemplate;
  /** Optional engagement context. When present, exporters surface the
   *  client name in the cover page metadata + the footer. */
  engagement?: {
    client: string;
    code?: string | null;
  };
}

/** Friendly default for the "ORACLE NETSUITE PARTNER" tag the Xelerate
 *  visual templates use. Firms with no `tagline` get the bare display
 *  name in the cover; firms with a tagline get the tagline as the
 *  subtitle line — this constant is reserved for future per-firm
 *  partner-status tags. */
export const PARTNER_TAG_DEFAULT = '';

/** PNG width × height we assume for firm logos when rendering in PDF
 *  / PPTX. Real logos are scaled to fit while preserving aspect
 *  ratio; this is just the layout box. */
export const LOGO_BOX_WIDTH_PT = 72;
export const LOGO_BOX_HEIGHT_PT = 24;
