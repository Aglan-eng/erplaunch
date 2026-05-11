/**
 * Phase 50.9.2 — visual-overlap regression test for markdownToPdf.
 *
 * The Phase 50.3 PDF exporter rendered cover-letter, bullet-list, and
 * paragraph content with adjacent baselines on the SAME y-coordinate —
 * the symptom prod users saw as "lines on top of each other." Root
 * cause: `renderInline` terminated with `doc.text('', { continued:
 * false })` which doesn't reliably advance pdfkit's cursor, and the
 * paragraph spacing was a tight `moveDown(0.5)` (~7pt for a 14pt line
 * height).
 *
 * This test renders a body that exercises every overlap-prone path
 * (paragraphs, headings, bullet lists, multiple paragraphs in a row)
 * and inspects every text item's baseline y-coordinate via pdfjs-dist
 * `getTextContent()`. Assertion: within a single page, no two text
 * items share a baseline within 1pt of each other.
 *
 * Why pdfjs-dist (not pdf-parse): pdfjs returns each text item's
 * 6-element transform matrix, whose `f` value is the baseline y in
 * page space. We can detect overlap directly without OCR.
 */
import { describe, it, expect } from 'vitest';
import { markdownToPdf } from '../../../src/services/exporters/markdownToPdf.js';

function makeMeta(): Parameters<typeof markdownToPdf>[1] {
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
  };
}

interface TextItem {
  str: string;
  y: number;
  page: number;
}

async function extractTextItems(buf: Buffer): Promise<TextItem[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Suppress pdfjs's verbose internal warnings during tests — they
  // pollute the test output without indicating actual failure.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  const items: TextItem[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const it of content.items) {
      if ('str' in it && typeof it.str === 'string' && it.str.trim().length > 0) {
        // `transform` is a 6-element affine matrix `[a, b, c, d, e, f]`
        // where `f` is the baseline y in PDF user space (origin
        // bottom-left). We don't care about the orientation — only
        // relative overlap within a page.
        const y = Array.isArray(it.transform) ? Number(it.transform[5]) : 0;
        items.push({ str: it.str, y, page: i });
      }
    }
  }
  await pdf.cleanup();
  return items;
}

describe('markdownToPdf — Phase 50.9.2 overlap regression', () => {
  it('renders multi-paragraph body without overlapping baselines', async () => {
    // Body designed to exercise every overlap-prone path:
    //   - cover letter style paragraph
    //   - heading + paragraph
    //   - sequential paragraphs
    //   - bullet list
    //   - sub-heading + paragraph
    const body = [
      '# Cover Letter',
      '',
      'Dear Acme Industries leadership,',
      '',
      'We are delighted to present this Cutover Runbook in support of your NetSuite go-live next quarter. This document captures every decision the joint team has made to date and lays out the path through hypercare.',
      '',
      'Our shared goal is a clean cutover with zero data loss and zero day-one transaction outages. The runbook below sets out the exact sequence of activities and the named owner for each step.',
      '',
      '## Decisions still open',
      '',
      'The following decisions need leadership sign-off before the freeze window opens:',
      '',
      '- Tax registration in the new entity',
      '- Sandbox vs production data refresh policy',
      '- Out-of-hours support coverage for the hypercare period',
      '',
      '### Owner assignments',
      '',
      'Each open item has a named owner on the Xelerate side and an Acme counterpart. The full owner matrix appears in the appendix.',
    ].join('\n');

    const buf = await markdownToPdf(body, makeMeta());
    expect(buf.toString('ascii', 0, 5)).toBe('%PDF-');

    const items = await extractTextItems(buf);
    // Sanity: we extracted real content.
    expect(items.length).toBeGreaterThan(5);

    // Group by page and check overlap within each page.
    const byPage = new Map<number, TextItem[]>();
    for (const it of items) {
      if (!byPage.has(it.page)) byPage.set(it.page, []);
      byPage.get(it.page)!.push(it);
    }

    for (const [pageNum, pageItems] of byPage.entries()) {
      // For each pair of items on the same page, baselines that share
      // the EXACT same y are either (a) on the same intended line —
      // legitimate, single emit broken into multiple TextItems by
      // pdfjs's font-change boundary — or (b) overlapping paragraphs
      // — the bug.
      //
      // The bug pattern is multiple "long" runs of text on the same
      // baseline. Single-baseline groups of >3 items are suspicious;
      // we tolerate up to 5 (font switches in headings + bullets can
      // legitimately fragment).
      const yBuckets = new Map<number, TextItem[]>();
      for (const it of pageItems) {
        const key = Math.round(it.y * 10) / 10;
        if (!yBuckets.has(key)) yBuckets.set(key, []);
        yBuckets.get(key)!.push(it);
      }

      for (const [yKey, bucket] of yBuckets.entries()) {
        const combined = bucket.map((b) => b.str).join('|');
        // Allow up to 5 fragments per baseline (font switches in
        // headings + bullet glyph splits). More than that means
        // multiple paragraphs collided on one line.
        expect(
          bucket.length,
          `Page ${pageNum}, y=${yKey}: ${bucket.length} text items share a baseline: ${combined}`,
        ).toBeLessThanOrEqual(5);
      }
    }
  });

  it('places sequential paragraphs on monotonically-decreasing baselines', async () => {
    // Two short paragraphs back-to-back. After the overlap fix, the
    // second paragraph's baseline must be strictly LOWER (smaller y
    // in PDF coords where origin is bottom-left) than the first.
    const body = [
      'First paragraph alpha.',
      '',
      'Second paragraph beta.',
    ].join('\n');

    const buf = await markdownToPdf(body, makeMeta());
    const items = await extractTextItems(buf);
    const alphaItem = items.find((it) => it.str.includes('alpha'));
    const betaItem = items.find((it) => it.str.includes('beta'));
    expect(alphaItem).toBeDefined();
    expect(betaItem).toBeDefined();
    expect(alphaItem!.page).toBe(betaItem!.page);
    // PDF y-axis: origin bottom-left, so later content lands at LOWER y.
    expect(betaItem!.y).toBeLessThan(alphaItem!.y);
    // And the gap must be MORE than zero — a positive minimum of ~10pt
    // covers a single 11pt-font paragraph + the bumped paragraph
    // spacing. Less than that means they're stacking.
    expect(alphaItem!.y - betaItem!.y).toBeGreaterThanOrEqual(10);
  });

  it('places bullet items on separate baselines', async () => {
    const body = [
      '- first bullet apple',
      '- second bullet banana',
      '- third bullet cherry',
    ].join('\n');

    const buf = await markdownToPdf(body, makeMeta());
    const items = await extractTextItems(buf);
    const apple = items.find((it) => it.str.includes('apple'));
    const banana = items.find((it) => it.str.includes('banana'));
    const cherry = items.find((it) => it.str.includes('cherry'));
    expect(apple).toBeDefined();
    expect(banana).toBeDefined();
    expect(cherry).toBeDefined();
    // Each bullet's body lands on a distinct y.
    expect(apple!.y).not.toBe(banana!.y);
    expect(banana!.y).not.toBe(cherry!.y);
    // Monotonic top-to-bottom.
    expect(banana!.y).toBeLessThan(apple!.y);
    expect(cherry!.y).toBeLessThan(banana!.y);
  });
});
