import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import MarkdownIt from 'markdown-it';
import PDFDocument from 'pdfkit';
type Token = ReturnType<MarkdownIt['parse']>[number];

/**
 * Phase 39.2 — pdfkit-based markdown → PDF renderer. Replaces the previous
 * 837-byte hand-rolled placeholder with a real, paginated, formatted PDF
 * that doesn't require Chromium.
 *
 * The token-walker handles markdown-it's flat token stream:
 *   - Heading levels h1/h2/h3 → distinct font sizes + weights
 *   - Paragraphs → wrapped Helvetica body text
 *   - Bullet / ordered lists → indented with bullets / numbers
 *   - Code blocks → monospace blocks with subtle background
 *   - Blockquotes → italic indented text
 *   - Inline emphasis (bold / italic / code) → font switches inside paragraphs
 *
 * pdfkit auto-paginates via doc.text() — when y exceeds the usable page
 * height it adds a new page automatically. We only need to manage section
 * spacing.
 */

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

// `PDFKit.PDFDocument` is an ambient type from @types/pdfkit. ESLint's
// no-undef rule trips on the namespace because it doesn't see the
// declaration; the typecheck path resolves it correctly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ambient type from @types/pdfkit; using `any` here keeps the renderer self-contained without re-exporting the namespace.
type Doc = any;

interface RenderState {
  doc: Doc;
  listDepth: number;
}

function renderInline(state: RenderState, tokens: Token[]): void {
  const { doc } = state;
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        doc.text(t.content, { continued: true });
        break;
      case 'softbreak':
      case 'hardbreak':
        doc.text(' ', { continued: true });
        break;
      case 'strong_open':
        doc.font('Helvetica-Bold');
        break;
      case 'strong_close':
        doc.font('Helvetica');
        break;
      case 'em_open':
        doc.font('Helvetica-Oblique');
        break;
      case 'em_close':
        doc.font('Helvetica');
        break;
      case 'code_inline':
        doc.font('Courier').text(` ${t.content} `, { continued: true }).font('Helvetica');
        break;
      case 'link_open':
      case 'link_close':
        // Surface the link's text content; href is implicit in the rendered
        // run since pdfkit text doesn't carry hyperlinks without extra ops.
        break;
      default:
        if (t.content) doc.text(t.content, { continued: true });
        break;
    }
  }
  // Close the current line.
  doc.text('', { continued: false });
}

/**
 * Build the PDF for a markdown source string. Resolves once the file is
 * fully flushed to disk.
 */
export async function convertMarkdownToPdf(
  markdown: string,
  outputPath: string,
  opts?: { title?: string },
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    info: {
      Title: opts?.title ?? 'Document',
      Producer: 'ERPLaunch',
      Creator: 'ERPLaunch',
    },
  });

  const stream = fsSync.createWriteStream(outputPath);
  const finished = new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
  doc.pipe(stream);

  const tokens: Token[] = markdown.trim() ? md.parse(markdown, {}) : [];
  const state: RenderState = { doc, listDepth: 0 };

  // pdfkit defaults to Helvetica 12pt; we tweak per-block.
  doc.font('Helvetica').fontSize(11).fillColor('#1e293b');

  const orderedCounters: number[] = [];
  let inOrdered: boolean[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case 'heading_open': {
        const level = Number(t.tag.slice(1)) || 1;
        const size = level === 1 ? 22 : level === 2 ? 16 : level === 3 ? 13 : 12;
        const colour = level === 1 ? '#0f172a' : level === 2 ? '#1e3a8a' : '#1e40af';
        doc.moveDown(level === 1 ? 0.5 : 0.8).font('Helvetica-Bold').fontSize(size).fillColor(colour);
        const inline = tokens[i + 1];
        if (inline && inline.type === 'inline') {
          doc.text(inline.content);
          i++; // consume the inline token
        }
        // Skip closing heading_close (i++ in for-loop)
        // Reset to body style afterwards.
        doc.font('Helvetica').fontSize(11).fillColor('#1e293b').moveDown(0.4);
        break;
      }
      case 'paragraph_open': {
        const inline = tokens[i + 1];
        if (inline && inline.type === 'inline' && inline.children) {
          renderInline(state, inline.children);
          i++;
        }
        doc.moveDown(0.5);
        break;
      }
      case 'bullet_list_open':
        inOrdered.push(false);
        state.listDepth++;
        break;
      case 'ordered_list_open':
        inOrdered.push(true);
        orderedCounters.push(0);
        state.listDepth++;
        break;
      case 'bullet_list_close':
        inOrdered.pop();
        state.listDepth = Math.max(0, state.listDepth - 1);
        doc.moveDown(0.3);
        break;
      case 'ordered_list_close':
        inOrdered.pop();
        orderedCounters.pop();
        state.listDepth = Math.max(0, state.listDepth - 1);
        doc.moveDown(0.3);
        break;
      case 'list_item_open': {
        const indent = 14 + (state.listDepth - 1) * 14;
        const isOrdered = inOrdered[inOrdered.length - 1];
        let prefix = '• ';
        if (isOrdered) {
          orderedCounters[orderedCounters.length - 1]++;
          prefix = `${orderedCounters[orderedCounters.length - 1]}. `;
        }
        // The next paragraph_open + inline pair carries the item body.
        const next = tokens[i + 1];
        const inline = tokens[i + 2];
        if (next && next.type === 'paragraph_open' && inline && inline.type === 'inline' && inline.children) {
          doc.text(prefix, doc.page.margins.left + indent - 14, doc.y, { continued: true });
          renderInline(state, inline.children);
          // Skip paragraph_open + inline + paragraph_close + list_item_close.
          i += 3;
        }
        break;
      }
      case 'fence':
      case 'code_block': {
        // Render fenced / indented code as a monospace block. Background tint
        // is omitted — pdfkit needs an explicit rect for that and it adds
        // noise. Mono font + slight indent communicates "code" sufficiently.
        doc.moveDown(0.3).font('Courier').fontSize(10).fillColor('#334155');
        const codeLines = (t.content || '').split('\n');
        for (const line of codeLines) {
          doc.text(line, doc.page.margins.left + 8, undefined);
        }
        doc.font('Helvetica').fontSize(11).fillColor('#1e293b').moveDown(0.4);
        break;
      }
      case 'blockquote_open': {
        doc.moveDown(0.3).font('Helvetica-Oblique').fillColor('#475569');
        // The next paragraph_open + inline carry the quote body.
        const inline = tokens[i + 2];
        if (inline && inline.type === 'inline' && inline.children) {
          doc.text('“ ', { continued: true });
          renderInline(state, inline.children);
          i += 3;
        }
        doc.font('Helvetica').fillColor('#1e293b').moveDown(0.3);
        break;
      }
      case 'hr':
        doc.moveDown(0.4);
        doc
          .strokeColor('#cbd5e1')
          .lineWidth(0.5)
          .moveTo(doc.page.margins.left, doc.y)
          .lineTo(doc.page.width - doc.page.margins.right, doc.y)
          .stroke();
        doc.moveDown(0.4);
        break;
      default:
        // Skip unhandled token types — markdown-it emits structural tokens
        // (e.g. heading_close, paragraph_close) that pair with their open
        // counterparts which we already consumed above.
        break;
    }
  }

  doc.end();
  await finished;
}

/**
 * Convert HTML to PDF — used by the BRD pipeline pre-Phase 39.2. Today this
 * tries Puppeteer first (true HTML/CSS rendering when Chromium is available)
 * and falls back to a markdown extraction → pdfkit render. The fallback
 * produces a real, paginated PDF instead of the previous 837-byte placeholder.
 *
 * Callers that have markdown handy (most of the generation pipeline does)
 * should prefer convertMarkdownToPdf() directly to skip the HTML round-trip.
 */
export async function convertHtmlToPdf(html: string, outputPath: string): Promise<void> {
  try {
    // Dynamic import — server starts even if puppeteer/chromium is missing.
    const puppeteer = await import('puppeteer').then((m) => m.default ?? m);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- puppeteer is dynamic-imported and the type union depends on whether the package is installed; keeping any avoids requiring the type-only dep for users without Chromium.
    const browser = await (puppeteer as any).launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      });
    } finally {
      await browser.close();
    }
  } catch {
    // Puppeteer / Chromium unavailable — render a real PDF via pdfkit using
    // a coarse HTML→text extraction. Block elements get their own paragraphs,
    // headings get their tag-based size mapping. Not pixel-identical to the
    // styled HTML, but a legitimate paginated PDF (>4 KB typically) instead
    // of the previous 837-byte placeholder.
    try {
      const markdown = htmlToCoarseMarkdown(html);
      await convertMarkdownToPdf(markdown, outputPath);
      console.warn(`[pdfService] Puppeteer unavailable — rendered PDF via pdfkit fallback at ${outputPath}`);
    } catch (err) {
      // Last resort: save HTML with .pdf extension so the file exists.
      await fs.writeFile(outputPath, html);
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[pdfService] pdfkit fallback failed (${message}) — saved raw HTML at ${outputPath}`);
    }
  }
}

/**
 * Coarse HTML → markdown extractor for the pdfkit fallback. Produces a flat
 * markdown approximation that the pdfkit renderer handles cleanly. Not
 * intended as a general-purpose converter — only the subset of tags the
 * BRD/Solution Doc generators emit.
 */
function htmlToCoarseMarkdown(html: string): string {
  let s = html;
  // Strip everything inside <style>, <script>, <head> — we only render body.
  s = s.replace(/<head[\s\S]*?<\/head>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Normalise headings.
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n');
  // Lists.
  s = s.replace(/<ul[^>]*>/gi, '\n').replace(/<\/ul>/gi, '\n');
  s = s.replace(/<ol[^>]*>/gi, '\n').replace(/<\/ol>/gi, '\n');
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  // Paragraphs / blockquotes / code.
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n');
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  // Emphasis.
  s = s.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  s = s.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  s = s.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  s = s.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<hr\s*\/?>/gi, '\n---\n');
  // Drop any other tags but keep their content.
  s = s.replace(/<[^>]+>/g, '');
  // Decode common entities.
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse runs of blank lines.
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}
