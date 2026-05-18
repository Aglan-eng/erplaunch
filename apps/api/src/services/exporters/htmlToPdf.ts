/**
 * Phase 51.1 — minimal HTML → PDF entrypoint.
 *
 * Wraps the puppeteer singleton with the contract every Phase 51.2+
 * caller needs:
 *   - Input: an HTML string already wrapped in `<html>…</html>`.
 *   - Output: a Buffer containing the rendered PDF.
 *
 * The 51.1 spike validates the round-trip works at all and benches
 * cold/warm performance under Sparticuz on Render. 51.2 ships the
 * Canva-grade CSS templates that turn rendered markdown into
 * proposal-quality HTML. 51.3 wires this into the export route
 * behind the USE_HTML_PDF_RENDERER flag.
 */

import { withPage } from './puppeteerBrowser.js';

export interface HtmlToPdfOptions {
  /**
   * A4 is the default. The render route layer hardcodes A4 today;
   * callers that need Letter (the US convention) opt in via this
   * field so we don't have to thread a per-firm preference yet.
   */
  format?: 'A4' | 'Letter';
  /** CSS margin syntax — e.g. '20mm' or '0' for full-bleed covers. */
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  /** Default true. Required for backgrounds + cover-page color blocks. */
  printBackground?: boolean;
  /**
   * Default 'networkidle0' so external fonts + the firm logo finish
   * loading before pdf().  Spike's bench uses 'domcontentloaded' on
   * synthetic HTML with no external resources to isolate Chromium
   * cost from network cost.
   */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
}

export async function htmlToPdf(html: string, options: HtmlToPdfOptions = {}): Promise<Buffer> {
  const format = options.format ?? 'A4';
  const printBackground = options.printBackground ?? true;
  const waitUntil = options.waitUntil ?? 'networkidle0';
  const margin = options.margin ?? { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' };

  return withPage(async (page) => {
    await page.setContent(html, { waitUntil });
    const pdf = await page.pdf({
      format,
      printBackground,
      margin,
      preferCSSPageSize: true,
    });
    // pdf() returns Uint8Array — coerce to Buffer for the existing
    // route layer that streams Buffer instances directly.
    return Buffer.from(pdf);
  });
}
