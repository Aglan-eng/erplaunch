/**
 * Phase 49.3 — Brand Pack markdown parser.
 *
 * Splits a single markdown document into the 12 sections defined by
 * the Brand Pack contract and maps each into a FirmTemplatePatch ready
 * to hand to db.updateFirmTemplate. Strict on missing-section cases —
 * a malformed pack returns a structured error so the route layer can
 * surface a 400 with the missing section listed.
 *
 * The contract is documented in docs/firm-templates.md (Phase 49.7).
 * Headings drive the section split — every section starts with a
 * top-level `## N. Title` heading where N is the section ordinal:
 *
 *   ## 1. Tagline
 *   ## 2. Subtitle
 *   ## 3. Company Description
 *   ## 4. Why Us
 *   ## 5. Methodology
 *   ## 6. Roadmap
 *   ## 7. Proposal Structure
 *   ## 8. Pricing Template
 *   ## 9. Industry Verticals
 *   ## 10. Voice Guide
 *   ## 11. CTA Options
 *   ## 12. Theme
 *
 * Sections 1-4 + 10 are free-text markdown body. 5-9 + 11-12 are
 * structured — each subsection starts with a `### N.M Item title` line
 * and has named fields (Body / Outcome / Strategic context / etc.)
 * stamped as `**Field:** value`. Section 12 (Theme) is a flat
 * key:value block.
 */

import type {
  FirmTemplatePatch,
  MethodologyStep,
  RoadmapPhase,
  ProposalSection,
  PricingItem,
  IndustryVertical,
  CtaOption,
  HeadlineCase,
} from '../db/firmTemplate.js';
import { isHeadlineCase } from '../db/firmTemplate.js';

export interface BrandPackParseSuccess {
  ok: true;
  patch: FirmTemplatePatch;
}

export interface BrandPackParseError {
  ok: false;
  errorCode:
    | 'EMPTY_PACK'
    | 'MISSING_SECTIONS'
    | 'MALFORMED_SECTION'
    | 'INVALID_THEME';
  message: string;
  missingSections?: number[];
  malformedSection?: number;
}

export type BrandPackParseResult = BrandPackParseSuccess | BrandPackParseError;

const REQUIRED_SECTIONS: ReadonlyArray<{ id: number; title: string }> = [
  { id: 1, title: 'Tagline' },
  { id: 2, title: 'Subtitle' },
  { id: 3, title: 'Company Description' },
  { id: 4, title: 'Why Us' },
  { id: 5, title: 'Methodology' },
  { id: 6, title: 'Roadmap' },
  { id: 7, title: 'Proposal Structure' },
  { id: 8, title: 'Pricing Template' },
  { id: 9, title: 'Industry Verticals' },
  { id: 10, title: 'Voice Guide' },
  { id: 11, title: 'CTA Options' },
  { id: 12, title: 'Theme' },
];

/**
 * Split the pack into a Map<sectionId, body>. The body is the
 * markdown content between this section's `## N.` heading and the
 * next `## ` heading (or end-of-document).
 */
function splitSections(markdown: string): Map<number, string> {
  const out = new Map<number, string>();
  // Match `## 1.` through `## 99.` at the start of a line. Capture
  // the ordinal so we can key the map by section number.
  const headingRegex = /^##\s+(\d+)\.\s+.+$/gm;
  const matches: Array<{ id: number; index: number; lineEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRegex.exec(markdown)) !== null) {
    matches.push({
      id: Number(m[1]),
      index: m.index,
      lineEnd: m.index + m[0].length,
    });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].lineEnd;
    const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
    const body = markdown.slice(start, end).trim();
    out.set(matches[i].id, body);
  }
  return out;
}

/**
 * Extract a free-text paragraph block. Returns the body unchanged
 * (markdown-safe) trimmed of leading/trailing whitespace.
 */
function parseTextSection(body: string): string {
  return body.trim();
}

/**
 * Parse a structured subsection set. Each subsection starts with a
 * `### N.M Title` line and has body lines until the next `###` or
 * end of section. Returns an array of {title, body} pairs in source
 * order. Field-extraction is left to the per-section caller.
 */
function parseSubsections(body: string): Array<{ title: string; body: string }> {
  const out: Array<{ title: string; body: string }> = [];
  const subRegex = /^###\s+\d+\.\d+\s+(.+)$/gm;
  const matches: Array<{ title: string; index: number; lineEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = subRegex.exec(body)) !== null) {
    matches.push({
      title: m[1].trim(),
      index: m.index,
      lineEnd: m.index + m[0].length,
    });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].lineEnd;
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    out.push({
      title: matches[i].title,
      body: body.slice(start, end).trim(),
    });
  }
  return out;
}

/**
 * Pull a `**Field:** value` line out of a subsection body. Tolerates
 * both common markdown idioms — colon inside the bold (`**Field:**
 * value`, the more natural form) and colon outside (`**Field**:
 * value`). Returns null when the field is absent.
 */
function extractField(body: string, fieldName: string): string | null {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Two patterns, OR'd: colon-inside or colon-outside the bold markers.
  const re = new RegExp(
    `\\*\\*${escaped}:\\*\\*\\s*(.+?)$|\\*\\*${escaped}\\*\\*\\s*:\\s*(.+?)$`,
    'mi',
  );
  const m = body.match(re);
  if (!m) return null;
  // The matched group is whichever alternative fired. Pick the first
  // non-undefined capture group.
  return (m[1] ?? m[2] ?? '').trim() || null;
}

/**
 * Section 5 — Methodology. Subsections are the steps. Each subsection
 * has a body paragraph; we use the title for the step title and the
 * body for the description.
 */
function parseMethodology(body: string): MethodologyStep[] {
  return parseSubsections(body).map((s, i) => ({
    step: i + 1,
    title: s.title,
    body: s.body,
  }));
}

/**
 * Section 6 — Roadmap. Same shape as methodology but the subsection
 * count is the phase ordinal.
 */
function parseRoadmap(body: string): RoadmapPhase[] {
  return parseSubsections(body).map((s, i) => ({
    phase: i + 1,
    title: s.title,
    body: s.body,
  }));
}

/**
 * Section 7 — Proposal Structure. Each subsection has a list of
 * bullets (`- ` or `* `) we collect into the `bullets` array.
 */
function parseProposalStructure(body: string): ProposalSection[] {
  return parseSubsections(body).map((s, i) => {
    const bullets = s.body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, '').trim());
    return {
      section: i + 1,
      title: s.title,
      bullets,
    };
  });
}

/**
 * Section 8 — Pricing Template. Each subsection has `**SKU:** ...` +
 * `**Description:** ...` + `**Annual:** $123,456` fields. Annual is
 * parsed as a number, stripping currency symbols + commas.
 */
function parsePricingTemplate(body: string): { items: PricingItem[]; error: string | null } {
  const items: PricingItem[] = [];
  for (const sub of parseSubsections(body)) {
    const sku = extractField(sub.body, 'SKU');
    const description = extractField(sub.body, 'Description') ?? sub.title;
    const annualRaw = extractField(sub.body, 'Annual');
    if (!sku) {
      return { items, error: `pricing item "${sub.title}" missing SKU field` };
    }
    if (!annualRaw) {
      return { items, error: `pricing item "${sub.title}" missing Annual field` };
    }
    const stripped = annualRaw.replace(/[^0-9.-]/g, '');
    // An empty stripped string means the raw value had no digits at all
    // (e.g. "five thousand bucks") — Number('') is 0 which is a real
    // parse error, not a free price.
    if (stripped.length === 0) {
      return {
        items,
        error: `pricing item "${sub.title}" has non-numeric Annual: ${annualRaw}`,
      };
    }
    const annual = Number(stripped);
    if (!Number.isFinite(annual)) {
      return {
        items,
        error: `pricing item "${sub.title}" has non-numeric Annual: ${annualRaw}`,
      };
    }
    items.push({ sku, description, annual });
  }
  return { items, error: null };
}

/**
 * Section 9 — Industry Verticals. Each subsection has Outcome /
 * Strategic context / Approach fields.
 */
function parseIndustryVerticals(body: string): {
  items: IndustryVertical[];
  error: string | null;
} {
  const items: IndustryVertical[] = [];
  for (const sub of parseSubsections(body)) {
    const outcome = extractField(sub.body, 'Outcome');
    const strategicContext = extractField(sub.body, 'Strategic context');
    const approach = extractField(sub.body, 'Approach');
    if (!outcome || !strategicContext || !approach) {
      return {
        items,
        error: `industry "${sub.title}" missing one of Outcome / Strategic context / Approach`,
      };
    }
    items.push({
      name: sub.title,
      outcome,
      strategicContext,
      approach,
    });
  }
  return { items, error: null };
}

/**
 * Section 11 — CTA Options. Each subsection title is the CTA label;
 * body is the description (free text, may be multi-paragraph).
 */
function parseCtaOptions(body: string): CtaOption[] {
  return parseSubsections(body).map((s) => ({
    label: s.title,
    description: s.body,
  }));
}

/**
 * Section 12 — Theme. Flat key:value lines. Required keys:
 *   - Font family — string
 *   - Headline case — sentence|title|upper
 *   - Accent color — hex
 */
function parseTheme(body: string): {
  fontFamily: string | null;
  headlineCase: HeadlineCase | null;
  accentColor: string | null;
  error: string | null;
} {
  const fontFamily = extractField(body, 'Font family');
  const headlineCaseRaw = extractField(body, 'Headline case');
  const accentColor = extractField(body, 'Accent color');
  if (!fontFamily) return { fontFamily: null, headlineCase: null, accentColor: null, error: 'Theme section missing Font family' };
  if (!headlineCaseRaw) return { fontFamily: null, headlineCase: null, accentColor: null, error: 'Theme section missing Headline case' };
  if (!isHeadlineCase(headlineCaseRaw)) {
    return {
      fontFamily: null,
      headlineCase: null,
      accentColor: null,
      error: `Theme Headline case must be sentence|title|upper, got: ${headlineCaseRaw}`,
    };
  }
  if (!accentColor) {
    return { fontFamily: null, headlineCase: null, accentColor: null, error: 'Theme section missing Accent color' };
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
    return {
      fontFamily: null,
      headlineCase: null,
      accentColor: null,
      error: `Theme Accent color must be a 6-digit hex like #1a2b3c, got: ${accentColor}`,
    };
  }
  return {
    fontFamily,
    headlineCase: headlineCaseRaw,
    accentColor,
    error: null,
  };
}

export function parseBrandPack(markdown: string): BrandPackParseResult {
  if (!markdown || markdown.trim().length === 0) {
    return {
      ok: false,
      errorCode: 'EMPTY_PACK',
      message: 'Brand pack markdown is empty.',
    };
  }

  const sections = splitSections(markdown);

  // Strict: every required section must be present.
  const missing = REQUIRED_SECTIONS.filter((s) => !sections.has(s.id)).map((s) => s.id);
  if (missing.length > 0) {
    return {
      ok: false,
      errorCode: 'MISSING_SECTIONS',
      message: `Brand pack is missing required sections: ${missing
        .map((id) => `#${id} (${REQUIRED_SECTIONS.find((s) => s.id === id)?.title})`)
        .join(', ')}`,
      missingSections: missing,
    };
  }

  const tagline = parseTextSection(sections.get(1) ?? '');
  const subtitle = parseTextSection(sections.get(2) ?? '');
  const companyDescription = parseTextSection(sections.get(3) ?? '');
  const whyUs = parseTextSection(sections.get(4) ?? '');
  const methodology = parseMethodology(sections.get(5) ?? '');
  const roadmap = parseRoadmap(sections.get(6) ?? '');
  const proposalStructure = parseProposalStructure(sections.get(7) ?? '');

  const pricing = parsePricingTemplate(sections.get(8) ?? '');
  if (pricing.error) {
    return {
      ok: false,
      errorCode: 'MALFORMED_SECTION',
      message: `Section 8 (Pricing Template): ${pricing.error}`,
      malformedSection: 8,
    };
  }

  const verticals = parseIndustryVerticals(sections.get(9) ?? '');
  if (verticals.error) {
    return {
      ok: false,
      errorCode: 'MALFORMED_SECTION',
      message: `Section 9 (Industry Verticals): ${verticals.error}`,
      malformedSection: 9,
    };
  }

  const voiceGuide = parseTextSection(sections.get(10) ?? '');
  const ctaOptions = parseCtaOptions(sections.get(11) ?? '');

  const theme = parseTheme(sections.get(12) ?? '');
  if (theme.error) {
    return {
      ok: false,
      errorCode: 'INVALID_THEME',
      message: `Section 12 (Theme): ${theme.error}`,
      malformedSection: 12,
    };
  }

  return {
    ok: true,
    patch: {
      tagline,
      subtitle,
      companyDescription,
      whyUs,
      methodology,
      roadmap,
      proposalStructure,
      pricingTemplate: pricing.items,
      industryVerticals: verticals.items,
      voiceGuide,
      ctaOptions,
      themeFontFamily: theme.fontFamily,
      themeHeadlineCase: theme.headlineCase,
      themeAccentColor: theme.accentColor,
    },
  };
}
