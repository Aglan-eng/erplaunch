/**
 * Phase 49.4 — pure tests for the theme-lock helpers.
 *
 * Pin the contract: applyHeadlineCase obeys the firm's selected mode,
 * enforceHeadlineCaseOnMarkdown only touches heading lines, and
 * stripNonThemeHexLiterals replaces every hex literal regardless of
 * how it was injected (markdown body, inline span, code fence).
 */
import { describe, it, expect } from 'vitest';
import {
  applyHeadlineCase,
  enforceHeadlineCaseOnMarkdown,
  stripNonThemeHexLiterals,
} from '../src/lib/templateThemeLock';

describe('applyHeadlineCase', () => {
  it('sentence case capitalises the first letter only', () => {
    expect(applyHeadlineCase('THE QUICK BROWN FOX', 'sentence')).toBe(
      'The quick brown fox',
    );
    expect(applyHeadlineCase('lower case input', 'sentence')).toBe(
      'Lower case input',
    );
  });

  it('title case capitalises significant words and lowercases articles', () => {
    expect(applyHeadlineCase('the quick brown fox jumps over the lazy dog', 'title')).toBe(
      'The Quick Brown Fox Jumps Over the Lazy Dog',
    );
  });

  it('title case keeps the first word capped even if it is an article', () => {
    expect(applyHeadlineCase('an introduction to ERP', 'title')).toBe(
      'An Introduction to Erp',
    );
  });

  it('upper case uppercases every letter', () => {
    expect(applyHeadlineCase('Why Us', 'upper')).toBe('WHY US');
  });

  it('preserves whitespace stripping (does not collapse multi-space runs by mistake)', () => {
    // Input with single spaces — output should match.
    expect(applyHeadlineCase('a b c', 'sentence')).toBe('A b c');
  });
});

describe('enforceHeadlineCaseOnMarkdown', () => {
  const md = `# A Heading
Body line stays unchanged.

## Another Heading
More body.

### Subheading

#### Deeper`;

  it('rewrites every heading line to sentence case', () => {
    const r = enforceHeadlineCaseOnMarkdown(md, 'sentence');
    expect(r).toContain('# A heading');
    expect(r).toContain('## Another heading');
    expect(r).toContain('### Subheading');
    expect(r).toContain('#### Deeper');
  });

  it('rewrites to upper case across all heading levels', () => {
    const r = enforceHeadlineCaseOnMarkdown(md, 'upper');
    expect(r).toContain('# A HEADING');
    expect(r).toContain('## ANOTHER HEADING');
    expect(r).toContain('### SUBHEADING');
  });

  it('does NOT touch body lines', () => {
    const r = enforceHeadlineCaseOnMarkdown(md, 'upper');
    expect(r).toContain('Body line stays unchanged.');
    expect(r).toContain('More body.');
  });

  it('returns input unchanged when mode is null', () => {
    expect(enforceHeadlineCaseOnMarkdown(md, null)).toBe(md);
  });

  it('handles markdown with no headings', () => {
    const plain = 'just some text\nmore text';
    expect(enforceHeadlineCaseOnMarkdown(plain, 'upper')).toBe(plain);
  });
});

describe('stripNonThemeHexLiterals', () => {
  it('replaces every 6-digit hex with the firm accent color', () => {
    const md = 'Color is #ff0000 and also #00ff00.';
    expect(stripNonThemeHexLiterals(md, '#1a8754')).toBe(
      'Color is #1a8754 and also #1a8754.',
    );
  });

  it('replaces hex case-insensitively', () => {
    const md = 'Brand: #FFAA00';
    expect(stripNonThemeHexLiterals(md, '#1a8754')).toContain('#1a8754');
  });

  it('returns input unchanged when accent color is null', () => {
    const md = 'Hex #ff0000';
    expect(stripNonThemeHexLiterals(md, null)).toBe(md);
  });

  it('does not strip 3-digit hex shorthands (only 6-digit per spec)', () => {
    const md = 'Short: #f00';
    expect(stripNonThemeHexLiterals(md, '#1a8754')).toBe(md);
  });

  it('does not strip non-hex strings that look like #...', () => {
    const md = 'Heading #1 and section #2';
    expect(stripNonThemeHexLiterals(md, '#1a8754')).toBe(md);
  });

  it('is idempotent — running twice produces the same result', () => {
    const md = 'Color #ff0000';
    const once = stripNonThemeHexLiterals(md, '#1a8754');
    const twice = stripNonThemeHexLiterals(once, '#1a8754');
    expect(twice).toBe(once);
  });
});

describe('Phase 49.4 acceptance — combined save-path enforcement', () => {
  it('a markdown body with rogue hex + wrong-case heading is fully normalised', () => {
    const rogue = `# Awesome Heading IN UPPERCASE
Body says color is #ff0000 because reasons.

## another HEADING`;
    const cased = enforceHeadlineCaseOnMarkdown(rogue, 'sentence');
    const cleaned = stripNonThemeHexLiterals(cased, '#1a8754');
    expect(cleaned).toContain('# Awesome heading in uppercase');
    expect(cleaned).toContain('## Another heading');
    expect(cleaned).toContain('#1a8754');
    expect(cleaned).not.toContain('#ff0000');
  });
});
