/**
 * Hotfix tests — `Content-Disposition` for PDF exports.
 *
 * Bug: Node's HTTP layer rejected non-Latin-1 bytes in the header
 * value (`ERR_INVALID_CHAR`), so any customer / document title with
 * an em-dash, smart quote, non-breaking space, or accented character
 * blew up the response with a 500 *after* a perfectly good PDF had
 * already been rendered.
 *
 * These tests pin the header builder in isolation. End-to-end
 * Chromium rendering is covered by the existing
 * `proposalPdf.test.ts` integration suite — it already exercises
 * the full route path on environments with Chromium available.
 */
import { describe, it, expect } from 'vitest';
import { contentDispositionForPdf } from '../../src/routes/exports.js';

function isLatin1Only(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0xff) return false;
  }
  return true;
}

describe('contentDispositionForPdf', () => {
  it('produces both an ASCII filename and an RFC-5987 filename*', () => {
    const out = contentDispositionForPdf('Acme — Café Proposal');
    expect(out).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''/);
    expect(out).toMatch(/filename="[\x20-\x7E]+"/);
    // The UTF-8 portion percent-encodes the original including the em-dash.
    expect(out).toContain("filename*=UTF-8''");
    expect(out).toContain(encodeURIComponent('Acme — Café Proposal.pdf'));
  });

  it('returns a value containing only Latin-1 bytes (HTTP header safe)', () => {
    const inputs = [
      'Acme — Café Proposal',
      '[DEMO] Gamma — Proposal "Q3" 2026',
      'Müller GmbH — SOW',
      'مشروع تجريبي', // RTL Arabic — fully non-ASCII
      'Foo Bar', // non-breaking space
      'Smart ‘quotes’ and “double”',
    ];
    for (const name of inputs) {
      const out = contentDispositionForPdf(name);
      expect(isLatin1Only(out), `Output for ${JSON.stringify(name)} must be Latin-1 only`).toBe(
        true,
      );
      // Sanity: never empty, always declared as attachment.
      expect(out.startsWith('attachment;')).toBe(true);
    }
  });

  it('falls back to "document.pdf" when input collapses to empty after sanitisation', () => {
    const out = contentDispositionForPdf('—   ‘  ’');
    expect(out).toContain('filename="document.pdf"');
  });

  it('strips embedded quotes and backslashes (would otherwise break the header)', () => {
    const out = contentDispositionForPdf('Bad "name" \\with\\ slashes');
    // The ASCII portion sits inside double-quotes; embedded quotes would
    // terminate the value early — the helper drops them.
    const asciiMatch = out.match(/filename="([^"]+)"/);
    expect(asciiMatch).not.toBeNull();
    const asciiPart = asciiMatch![1];
    expect(asciiPart).not.toContain('"');
    expect(asciiPart).not.toContain('\\');
  });

  it('appends .pdf when input lacks the extension', () => {
    const out = contentDispositionForPdf('Plain title');
    expect(out).toContain('filename="Plain title.pdf"');
  });

  it('preserves an existing .pdf extension without doubling it', () => {
    const out = contentDispositionForPdf('Already named.pdf');
    expect(out).toContain('filename="Already named.pdf"');
    expect(out).not.toContain('.pdf.pdf');
  });

  it('preserves the em-dash in the UTF-8 filename* portion', () => {
    const out = contentDispositionForPdf('[DEMO] Gamma — Proposal');
    // em-dash (U+2014) → %E2%80%94 when UTF-8 + percent-encoded
    expect(out).toContain('%E2%80%94');
  });
});
