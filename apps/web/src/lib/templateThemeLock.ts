/**
 * Phase 49.4 — Theme-lock helpers for the firm template editor.
 *
 * The editor lets a firm admin write markdown freely, but on save we
 * enforce the firm's themeHeadlineCase against every `# Heading` and
 * `## Heading` line so the proposal generator's output stays
 * consistent with the firm's voice guide. The editor's color / font
 * pickers are also locked to the firm's primary/secondary/accent and
 * themeFontFamily — that lock is enforced visually (disabled
 * controls) rather than via this helper.
 *
 * Headline transformations:
 *   - sentence: "the quick brown fox" (only the first letter cap)
 *   - title:    "The Quick Brown Fox" (every "significant" word cap)
 *   - upper:    "THE QUICK BROWN FOX"
 *
 * Title-case keeps a small list of articles/conjunctions/prepositions
 * lowercase unless they're the first word — same convention the
 * Chicago Manual of Style uses. The list is intentionally short so
 * non-English firms get reasonable behaviour without a localisation
 * dep.
 */

import type { HeadlineCase } from './api';

const TITLE_CASE_LOWERCASE_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of',
  'on', 'or', 'so', 'the', 'to', 'up', 'yet', 'with',
]);

function toSentenceCase(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
}

function toTitleCase(s: string): string {
  const words = s.trim().split(/\s+/);
  return words
    .map((w, i) => {
      if (w.length === 0) return w;
      const lower = w.toLowerCase();
      if (i > 0 && TITLE_CASE_LOWERCASE_WORDS.has(lower)) return lower;
      return lower[0].toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export function applyHeadlineCase(text: string, mode: HeadlineCase): string {
  switch (mode) {
    case 'sentence':
      return toSentenceCase(text);
    case 'title':
      return toTitleCase(text);
    case 'upper':
      return text.toUpperCase();
    default:
      return text;
  }
}

/**
 * Apply the firm's themeHeadlineCase to every markdown heading in
 * the body (lines starting with `#`, `##`, `###`, etc.). Body text
 * is left untouched. Returns the rewritten markdown.
 *
 * When mode is null (firm hasn't set a headlineCase), returns the
 * input unchanged — the editor surfaces the absence in the lock
 * tooltip but doesn't force a default.
 */
export function enforceHeadlineCaseOnMarkdown(
  markdown: string,
  mode: HeadlineCase | null,
): string {
  if (mode === null) return markdown;
  return markdown
    .split('\n')
    .map((line) => {
      const m = line.match(/^(#{1,6})\s+(.+)$/);
      if (!m) return line;
      const [, hashes, headingText] = m;
      return `${hashes} ${applyHeadlineCase(headingText, mode)}`;
    })
    .join('\n');
}

/**
 * Phase 49.4 acceptance test #4: "Try to inject a different hex in
 * raw markdown → on save, value is overridden back to firm theme."
 *
 * Strip every 6-digit hex literal from the markdown so a firm admin
 * can't smuggle a non-theme color into their template body. The
 * editor's color pickers are visually disabled; this is the
 * defence-in-depth on the save path.
 *
 * NOTE: this is intentionally aggressive — every #abcdef pattern is
 * replaced with the firm's accent color. Firms that genuinely need
 * to embed a hex (e.g. citing a competitor's brand color) would have
 * to drop the # and write "abcdef" instead. That's a deliberate
 * tradeoff — the editor is for firm-voice templates, not arbitrary
 * markdown content.
 */
export function stripNonThemeHexLiterals(
  markdown: string,
  themeAccentColor: string | null,
): string {
  if (!themeAccentColor) return markdown;
  return markdown.replace(/#[0-9a-fA-F]{6}\b/g, themeAccentColor);
}
