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
});
