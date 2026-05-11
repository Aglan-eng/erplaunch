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
  /** Combined branding + template fields. Exporters pull what they
   *  need; null fields fall back to platform defaults. We widen
   *  primary/secondary to nullable since the firm hasn't always
   *  configured them — the underlying FirmBranding type defaults
   *  these to platform values in DEFAULT_BRANDING, but in tests +
   *  the exporter signature we keep the door open for null. */
  firm: Omit<FirmBranding, 'primaryColor' | 'secondaryColor'> & {
    primaryColor: string | null;
    secondaryColor: string | null;
  } & FirmTemplate;
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

/**
 * Platform-default palette used when the firm has neither a branding
 * override nor a Brand Pack accent configured. Defined here (not in
 * each exporter) so all three formats agree on the fallback hex.
 */
export const PLATFORM_PRIMARY_HEX = '#0F172A';
export const PLATFORM_SECONDARY_HEX = '#475569';
export const PLATFORM_ACCENT_HEX = '#1FAE5C';

export interface ResolvedExportColors {
  primary: string;
  secondary: string;
  accent: string;
}

/**
 * Phase 50.9.1 — single source of truth for exporter color resolution.
 *
 * Fallback chain (the bug fix):
 *   primary   ← Firm.primaryColor  → Brand Pack themeAccentColor → PLATFORM_PRIMARY
 *   secondary ← Firm.secondaryColor → Brand Pack themeAccentColor → PLATFORM_SECONDARY
 *   accent    ← Brand Pack themeAccentColor → Firm.primaryColor   → PLATFORM_ACCENT
 *
 * The pre-50.9.1 wiring landed PLATFORM_PRIMARY (purple `#4f46e5`)
 * into firms that hadn't set primaryColor in Settings → Branding even
 * when they HAD ingested a Brand Pack — because getFirmBranding
 * returned the platform purple as a concrete value, the exporter's
 * `?? PLATFORM_PRIMARY` never fired.
 *
 * Centralising the resolver here ensures PDF / DOCX / PPTX exporters
 * stay in lockstep when a future hotfix tweaks the chain.
 */
export function resolveExportColors(firm: {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  themeAccentColor?: string | null;
}): ResolvedExportColors {
  return {
    primary: firm.primaryColor ?? firm.themeAccentColor ?? PLATFORM_PRIMARY_HEX,
    secondary: firm.secondaryColor ?? firm.themeAccentColor ?? PLATFORM_SECONDARY_HEX,
    accent: firm.themeAccentColor ?? firm.primaryColor ?? PLATFORM_ACCENT_HEX,
  };
}
