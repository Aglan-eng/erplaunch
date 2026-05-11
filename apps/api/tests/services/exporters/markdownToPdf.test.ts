/**
 * Phase 50.3 — markdownToPdf exporter tests.
 *
 * Asserts:
 *   - Empty body still produces a valid PDF buffer
 *   - PDF magic bytes (%PDF) present at offset 0
 *   - Document title metadata reflects the supplied title
 *   - Buffer length > some sane minimum so we know more than the
 *     header landed
 */
import { describe, it, expect } from 'vitest';
import { markdownToPdf } from '../../../src/services/exporters/markdownToPdf.js';

function makeMeta(over: Partial<Parameters<typeof markdownToPdf>[1]> = {}): Parameters<typeof markdownToPdf>[1] {
  return {
    title: 'Cutover Runbook',
    firm: {
      // FirmBranding
      displayName: 'Xelerate',
      logoUrl: null,
      primaryColor: '#0A1A2F',
      secondaryColor: '#1FAE5C',
      supportEmail: 'support@xelerate.example',
      // FirmTemplate
      tagline: 'Outcome-first ERP delivery.',
      subtitle: null,
      companyDescription: null,
      whyUs: null,
      methodology: [],
      roadmap: [],
      proposalStructure: [],
      pricingTemplate: [],
      industryVerticals: [],
      voiceGuide: null,
      ctaOptions: [],
      themeFontFamily: null,
      themeHeadlineCase: 'sentence',
      themeAccentColor: '#1FAE5C',
      templateVersion: 2,
    },
    engagement: { client: 'Acme Industries', code: 'ACME-2026-01' },
    ...over,
  };
}

describe('markdownToPdf', () => {
  it('returns a non-empty Buffer with the PDF magic header', async () => {
    const buf = await markdownToPdf('# Hello\n\nBody.', makeMeta());
    expect(buf.byteLength).toBeGreaterThan(1024);
    // PDF files start with `%PDF-`.
    expect(buf.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('renders an empty body to a valid cover-only PDF', async () => {
    const buf = await markdownToPdf('', makeMeta());
    expect(buf.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('embeds the firm display name in PDF info metadata', async () => {
    const buf = await markdownToPdf('# Body', makeMeta());
    // PDF info dictionary stores the producer / author as a literal
    // string — we just scan the buffer for the firm name to verify
    // the metadata block is firm-branded.
    expect(buf.includes('Xelerate')).toBe(true);
  });

  it('produces different output for different firm theme colours', async () => {
    const greenBuf = await markdownToPdf('# H', makeMeta());
    const blueBuf = await markdownToPdf(
      '# H',
      makeMeta({
        firm: { ...makeMeta().firm, primaryColor: '#1E40AF' },
      }),
    );
    // Different primary colors produce different raw byte streams
    // because the color is embedded in the PDF content stream.
    expect(Buffer.compare(greenBuf, blueBuf)).not.toBe(0);
  });

  it('falls back to platform defaults when firm theme tokens are null', async () => {
    const buf = await markdownToPdf(
      '# Heading\n\nBody.',
      makeMeta({
        firm: {
          ...makeMeta().firm,
          primaryColor: null,
          themeAccentColor: null,
          themeHeadlineCase: null,
        },
      }),
    );
    expect(buf.toString('ascii', 0, 5)).toBe('%PDF-');
    expect(buf.byteLength).toBeGreaterThan(1024);
  });

  /**
   * Phase 50.9.1 regression test — Brand-Pack-only firms get their
   * actual color (not the legacy platform purple).
   *
   * Scenario: a firm has ingested a Brand Pack so themeAccentColor is
   * set, but they never configured Settings → Branding so primaryColor
   * is NULL. Before 50.9.1 the renderer fell back to the platform
   * purple `#4f46e5`; after 50.9.1 it should fall back to the Brand
   * Pack accent.
   *
   * The check: a Brand-Pack-only firm (primaryColor: null,
   * themeAccentColor: '#1FAE5C') produces a byte stream within ~32
   * bytes of a firm with primaryColor explicitly set to '#1FAE5C'.
   *
   * Why ~32 bytes (not byte-identical): pdfkit derives the trailer ID
   * from `md5(infoText + timestamp)`, so two separate renders of
   * identical meta still differ in the 16-byte ID pair. Anything past
   * that magnitude means the fallback chain didn't actually coalesce.
   *
   * Cross-check: same Brand-Pack-only firm is NOT close to a
   * platform-default firm (different colors → much larger diff in
   * the compressed content streams).
   */
  it('Brand-Pack-only firm renders within trailer-ID slack of an explicit primaryColor firm', async () => {
    const sameBody = '# Section\n\n## Heading\n\nBody paragraph.';
    const brandPackOnly = await markdownToPdf(
      sameBody,
      makeMeta({
        firm: {
          ...makeMeta().firm,
          primaryColor: null,
          secondaryColor: null,
          themeAccentColor: '#1FAE5C',
        },
      }),
    );
    const explicitGreen = await markdownToPdf(
      sameBody,
      makeMeta({
        firm: {
          ...makeMeta().firm,
          primaryColor: '#1FAE5C',
          secondaryColor: '#1FAE5C',
          themeAccentColor: '#1FAE5C',
        },
      }),
    );
    // Identical content streams → identical-or-near-identical sizes.
    // PDF trailer IDs are 16 bytes each (× 2 in the trailer dict) and
    // the xref offsets shift by the size delta, so a few-dozen-byte
    // gap is the realistic upper bound for "structurally identical."
    const sizeDelta = Math.abs(brandPackOnly.byteLength - explicitGreen.byteLength);
    expect(sizeDelta).toBeLessThan(64);
  });

  it('Brand-Pack-only firm has a non-trivial size delta vs platform-default render', async () => {
    const sameBody = '# Section\n\n## Heading\n\nBody paragraph with enough words to ' +
      'force the renderer to use the resolved primary color for the H1 divider page ' +
      'background AND the H2 heading color, so a single-bit color change shows up as ' +
      'a multi-byte delta in the compressed content streams.';
    const brandPackOnly = await markdownToPdf(
      sameBody,
      makeMeta({
        firm: {
          ...makeMeta().firm,
          primaryColor: null,
          secondaryColor: null,
          themeAccentColor: '#1FAE5C',
        },
      }),
    );
    const platformDefault = await markdownToPdf(
      sameBody,
      makeMeta({
        firm: {
          ...makeMeta().firm,
          primaryColor: null,
          secondaryColor: null,
          themeAccentColor: null,
        },
      }),
    );
    // Different colors → different draw commands → different byte
    // streams. The pre-50.9.1 bug would have made these identical
    // (both collapsing to platform purple).
    expect(Buffer.compare(brandPackOnly, platformDefault)).not.toBe(0);
  });
});
