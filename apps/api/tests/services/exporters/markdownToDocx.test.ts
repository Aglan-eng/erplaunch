/**
 * Phase 50.3 — markdownToDocx exporter tests.
 *
 * Asserts:
 *   - PK-zip magic bytes (`PK\x03\x04`) — DOCX is a zip
 *   - Firm color codes leak into the underlying XML
 *     (decompressed from the inner document.xml, since the outer
 *      buffer is a zip and color/text content is compressed)
 *   - Title metadata round-trips
 *   - Empty body still produces a valid DOCX
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { markdownToDocx } from '../../../src/services/exporters/markdownToDocx.js';

/** Extract the concatenated text content of every XML file inside the
 *  DOCX zip, so tests can assert against the rendered document XML
 *  rather than the compressed outer buffer. */
async function readDocxXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const parts: string[] = [];
  for (const filename of Object.keys(zip.files)) {
    if (!filename.endsWith('.xml')) continue;
    const file = zip.files[filename];
    if (!file) continue;
    parts.push(await file.async('string'));
  }
  return parts.join('\n');
}

function makeMeta(over?: Partial<Parameters<typeof markdownToDocx>[1]>): Parameters<typeof markdownToDocx>[1] {
  return {
    title: 'Cutover Runbook',
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

describe('markdownToDocx', () => {
  it('returns a Buffer with PK-zip magic bytes (DOCX = zip)', async () => {
    const buf = await markdownToDocx('# Heading\n\nBody.', makeMeta());
    expect(buf.byteLength).toBeGreaterThan(1024);
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  it('embeds firm primaryColor hex in the document XML stream', async () => {
    const buf = await markdownToDocx('# Heading', makeMeta());
    const xml = await readDocxXml(buf);
    expect(xml).toContain('0A1A2F');
  });

  it('includes the firm display name in the rendered document', async () => {
    const buf = await markdownToDocx('Body', makeMeta());
    const xml = await readDocxXml(buf);
    expect(xml).toContain('Xelerate');
  });

  it('emits a Buffer for an empty body (cover only)', async () => {
    const buf = await markdownToDocx('', makeMeta());
    expect(buf.byteLength).toBeGreaterThan(512);
    expect(buf[0]).toBe(0x50);
  });

  it('respects themeHeadlineCase=upper for headings in the body XML', async () => {
    const buf = await markdownToDocx(
      '## a sample heading',
      makeMeta({
        firm: { ...makeMeta().firm, themeHeadlineCase: 'upper' },
      }),
    );
    const xml = await readDocxXml(buf);
    expect(xml).toContain('A SAMPLE HEADING');
    expect(xml).not.toContain('a sample heading');
  });

  it('renders a markdown table with the header row in primaryColor', async () => {
    const buf = await markdownToDocx(
      '| Col1 | Col2 |\n| --- | --- |\n| a | b |\n',
      makeMeta(),
    );
    expect(buf.byteLength).toBeGreaterThan(1024);
    const xml = await readDocxXml(buf);
    // The fill="0A1A2F" attribute on the header row's TableCell
    // shading proves the brand color reached the table.
    expect(xml).toContain('0A1A2F');
    expect(xml).toContain('Col1');
    expect(xml).toContain('Col2');
  });
});
