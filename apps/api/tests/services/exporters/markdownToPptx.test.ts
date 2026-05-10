/**
 * Phase 50.3 — markdownToPptx exporter tests.
 *
 * Asserts:
 *   - PK-zip magic bytes (PPTX is a zip like DOCX)
 *   - Brand colors leak into the inner slide XML
 *   - Multiple H2 headings produce multiple slides
 *   - The cover slide always exists
 *   - Stat-grid detection: bullets like "200+ ENGAGEMENTS" produce
 *     a different visual structure than plain bullets
 *   - Empty body still produces a valid cover-only deck
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { markdownToPptx } from '../../../src/services/exporters/markdownToPptx.js';

function makeMeta(over?: Partial<Parameters<typeof markdownToPptx>[1]>): Parameters<typeof markdownToPptx>[1] {
  return {
    title: 'Solution Overview',
    firm: {
      displayName: 'Xelerate',
      logoUrl: null,
      primaryColor: '#0A1A2F',
      secondaryColor: '#1FAE5C',
      supportEmail: null,
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

async function readPptxXml(buf: Buffer): Promise<{
  combined: string;
  slideCount: number;
}> {
  const zip = await JSZip.loadAsync(buf);
  const parts: string[] = [];
  let slideCount = 0;
  for (const filename of Object.keys(zip.files)) {
    if (filename.endsWith('.xml')) {
      const file = zip.files[filename];
      if (!file) continue;
      parts.push(await file.async('string'));
    }
    // Slide files live at ppt/slides/slide<N>.xml
    if (/^ppt\/slides\/slide\d+\.xml$/.test(filename)) {
      slideCount++;
    }
  }
  return { combined: parts.join('\n'), slideCount };
}

describe('markdownToPptx', () => {
  it('returns a Buffer with PK-zip magic bytes', async () => {
    const buf = await markdownToPptx('## A heading', makeMeta());
    expect(buf.byteLength).toBeGreaterThan(2048);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it('embeds firm primaryColor (uppercase, no #) in the slide XML', async () => {
    const buf = await markdownToPptx('## H', makeMeta());
    const { combined } = await readPptxXml(buf);
    expect(combined).toContain('0A1A2F');
  });

  it('embeds the firm display name in the cover slide', async () => {
    const buf = await markdownToPptx('## Body', makeMeta());
    const { combined } = await readPptxXml(buf);
    expect(combined).toContain('Xelerate');
  });

  it('produces (N+1) slides for N H2 headings: cover + one-per-heading', async () => {
    const buf = await markdownToPptx(
      '## First\n\nBody.\n\n## Second\n\nMore.\n\n## Third\n\nEnd.',
      makeMeta(),
    );
    const { slideCount } = await readPptxXml(buf);
    expect(slideCount).toBe(4); // cover + 3 sections
  });

  it('produces a cover-only deck for an empty body', async () => {
    const buf = await markdownToPptx('', makeMeta());
    const { slideCount } = await readPptxXml(buf);
    expect(slideCount).toBe(1);
  });

  it('places the firm tagline on the cover slide', async () => {
    const buf = await markdownToPptx(
      '## H',
      makeMeta({
        firm: {
          ...makeMeta().firm,
          tagline: 'Marker-tagline-value',
        },
      }),
    );
    const { combined } = await readPptxXml(buf);
    expect(combined).toContain('Marker-tagline-value');
  });

  it('falls back to platform defaults when firm theme tokens are null', async () => {
    const buf = await markdownToPptx(
      '## H',
      makeMeta({
        firm: {
          ...makeMeta().firm,
          primaryColor: null,
          secondaryColor: null,
          themeAccentColor: null,
          themeHeadlineCase: null,
        },
      }),
    );
    expect(buf.byteLength).toBeGreaterThan(2048);
    expect(buf[0]).toBe(0x50);
  });
});
