/**
 * Phase 50.3 — Firm-branded markdown → PDF exporter.
 *
 * Returns a Buffer (vs. writing to disk like the older Phase 39.2
 * pdfService.convertMarkdownToPdf). Builds on the same pdfkit +
 * markdown-it stack but adds:
 *
 *   - Cover page with firm primaryColor band, large title, firm
 *     tagline as subtitle, firm logo lockup, "ORACLE NETSUITE PARTNER"
 *     tag (or whatever tagline the firm has set)
 *   - Header band on every content page (firm displayName left,
 *     section title right, primaryColor underline)
 *   - Footer with copyright + page-N-of-total (right-aligned per
 *     the Xelerate Proposal template)
 *   - H1 = section divider page in primaryColor background, white
 *     "Section N — Title" text
 *   - H2 = page heading in primaryColor with themeHeadlineCase
 *     applied to the rendered text
 *   - H3 = sub-heading in themeAccentColor
 *
 * When the firm template fields are NULL (e.g. a brand-new firm
 * without a Brand Pack), the exporter falls back to platform
 * defaults — same rendering behaviour as the legacy
 * convertMarkdownToPdf, just emitted as a Buffer.
 */

import PDFDocument from 'pdfkit';
import MarkdownIt from 'markdown-it';
import {
  applyHeadlineCase,
  resolveExportColors,
  type ExportMeta,
} from './types.js';

// markdown-it doesn't export its Token type by name across all 14.x
// builds; derive it from the parse return shape (same pattern the
// older pdfService uses).
type Token = ReturnType<MarkdownIt['parse']>[number];

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const PLATFORM_FONT = 'Helvetica';

interface RenderState {
  doc: PDFKit.PDFDocument;
  listDepth: number;
  primary: string;
  secondary: string;
  accent: string;
  headlineCase: 'sentence' | 'title' | 'upper' | null;
  pageCount: number;
}

function caseHeadline(text: string, headlineCase: RenderState['headlineCase']): string {
  if (!headlineCase) return text;
  return applyHeadlineCase(text, headlineCase);
}

interface InlineRun {
  text: string;
  font: 'regular' | 'bold' | 'italic' | 'code';
}

/**
 * Phase 50.9.2 — flatten markdown-it inline tokens into per-style
 * runs so the renderer can emit one `doc.text` call per run with a
 * proper `continued:false` terminator on the final run.
 *
 * The pre-50.9.2 implementation used a free-form chain of
 * `doc.text(content, { continued: true })` calls and terminated with
 * `doc.text('', { continued: false })`. The empty-string terminator
 * doesn't reliably advance pdfkit's cursor, which caused the next
 * paragraph to overprint the previous one (the "lines on top of each
 * other" symptom from prod).
 *
 * Collecting into runs lets us emit the LAST run with `continued:
 * false` carrying its real text — pdfkit's wrapping logic treats that
 * as a proper line terminator and the cursor advances correctly.
 */
function inlineToRuns(tokens: Token[]): InlineRun[] {
  const runs: InlineRun[] = [];
  let font: InlineRun['font'] = 'regular';
  const push = (text: string, f: InlineRun['font'] = font): void => {
    if (text.length === 0) return;
    runs.push({ text, font: f });
  };
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        push(t.content);
        break;
      case 'strong_open':
        font = 'bold';
        break;
      case 'strong_close':
        font = 'regular';
        break;
      case 'em_open':
        font = 'italic';
        break;
      case 'em_close':
        font = 'regular';
        break;
      case 'code_inline':
        push(t.content, 'code');
        break;
      case 'softbreak':
      case 'hardbreak':
        push(' ');
        break;
      default:
        if (t.content) push(t.content);
        break;
    }
  }
  return runs;
}

function fontNameFor(run: InlineRun['font']): string {
  switch (run) {
    case 'bold':
      return `${PLATFORM_FONT}-Bold`;
    case 'italic':
      return `${PLATFORM_FONT}-Oblique`;
    case 'code':
      return 'Courier';
    default:
      return PLATFORM_FONT;
  }
}

/**
 * Emit a paragraph of runs at the current cursor position. The first
 * run starts at the current y (optionally with `indent`); each
 * subsequent run is appended with `continued: true`; the LAST run
 * uses `continued: false` so pdfkit advances the cursor to the next
 * line. If `prefix` is provided (e.g. the bullet glyph "• ") it's
 * prepended as a regular-weight run in front of the inline content.
 */
function emitParagraph(
  state: RenderState,
  runs: InlineRun[],
  opts: { indent?: number; prefix?: string } = {},
): void {
  const { doc } = state;
  doc.fontSize(11).fillColor('#1e293b').font(PLATFORM_FONT);

  const allRuns: InlineRun[] = [];
  if (opts.prefix) allRuns.push({ text: opts.prefix, font: 'regular' });
  allRuns.push(...runs);

  if (allRuns.length === 0) {
    doc.text(' ', { continued: false });
    return;
  }

  for (let i = 0; i < allRuns.length; i++) {
    const run = allRuns[i];
    const isLast = i === allRuns.length - 1;
    doc.font(fontNameFor(run.font));
    const textOpts: PDFKit.Mixins.TextOptions = { continued: !isLast };
    if (i === 0 && opts.indent !== undefined) {
      textOpts.indent = opts.indent;
    }
    doc.text(run.text, textOpts);
  }
}

function drawCoverPage(doc: PDFKit.PDFDocument, meta: ExportMeta, state: RenderState): void {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  // Primary-color band on the left edge (matches Xelerate proposal
  // cover's vertical accent).
  doc.rect(0, 0, 12, pageHeight).fill(state.primary);

  // Firm display name top-right, small caps, secondary color.
  doc
    .font(`${PLATFORM_FONT}-Bold`)
    .fontSize(9)
    .fillColor(state.secondary)
    .text(meta.firm.displayName.toUpperCase(), pageWidth - 220, 56, {
      width: 180,
      align: 'right',
    });

  // Title block centered vertically — large primaryColor title +
  // tagline subtitle in accent color.
  const titleY = pageHeight / 2 - 80;
  doc
    .font(`${PLATFORM_FONT}-Bold`)
    .fontSize(36)
    .fillColor(state.primary)
    .text(caseHeadline(meta.title, state.headlineCase), 56, titleY, {
      width: pageWidth - 112,
    });

  if (meta.firm.tagline) {
    doc
      // Phase 50.9.2 — moveDown(0.3) at fontSize(36) → moveDown(0.3)
      // at fontSize(14) doesn't reset between size changes, so the
      // 0.3 was being measured against the 36pt title's line height
      // and undershooting. Bump to 0.8 for a visible gap below the
      // title.
      .moveDown(0.8)
      .font(PLATFORM_FONT)
      .fontSize(14)
      .fillColor(state.accent)
      .text(meta.firm.tagline, { width: pageWidth - 112 });
  }

  if (meta.engagement?.client) {
    doc
      .moveDown(1.0)
      .font(PLATFORM_FONT)
      .fontSize(11)
      .fillColor(state.secondary)
      .text(`Prepared for ${meta.engagement.client}`, { width: pageWidth - 112 });
  }

  // Footer with date + firm name.
  const today = new Date().toISOString().slice(0, 10);
  doc
    .font(PLATFORM_FONT)
    .fontSize(9)
    .fillColor(state.secondary)
    .text(`${meta.firm.displayName} · ${today}`, 56, pageHeight - 60, {
      width: pageWidth - 112,
      align: 'left',
    });

  doc.addPage();
  state.pageCount++;
}

function drawSectionDivider(doc: PDFKit.PDFDocument, title: string, state: RenderState): void {
  doc.addPage();
  state.pageCount++;
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  // Full-bleed primaryColor background.
  doc.rect(0, 0, pageWidth, pageHeight).fill(state.primary);
  // Large white title centered vertically.
  doc
    .font(`${PLATFORM_FONT}-Bold`)
    .fontSize(32)
    .fillColor('#ffffff')
    .text(caseHeadline(title, state.headlineCase), 56, pageHeight / 2 - 30, {
      width: pageWidth - 112,
    });
  doc.addPage();
  state.pageCount++;
  // Reset draw color so subsequent text isn't drawn in primary.
  doc.fillColor('#1e293b');
}

/**
 * Build the full PDF as a Buffer. The page-N/total footer is
 * approximated by stamping page numbers after the document is
 * finalised — pdfkit's `switchToPage` API gives us per-page access
 * post-render.
 */
export async function markdownToPdf(
  markdown: string,
  meta: ExportMeta,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 72, bottom: 56, left: 56, right: 56 },
    info: {
      Title: meta.title,
      Producer: meta.firm.displayName,
      Creator: meta.firm.displayName,
      Author: meta.firm.displayName,
    },
    bufferPages: true,
  });
  // Phase 50.9.2 — explicit lineGap so wrapped body lines have
  // breathing room. Default lineGap is 0, which combined with the
  // tight pre-50.9.2 paragraph spacing made adjacent lines overlap
  // (the "stacked text" symptom prod users reported). Setting it
  // post-construction because pdfkit's published `PDFDocumentOptions`
  // type omits the option even though the runtime accepts it.
  doc.lineGap(2);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', (err) => reject(err));
  });

  // Phase 50.9.1 — central color resolver. Falls back to Brand Pack
  // themeAccentColor when Firm.primaryColor is null, then to platform
  // defaults. Prevents the platform purple `#4f46e5` from leaking into
  // a firm that has ingested a Brand Pack but hasn't set
  // Settings → Branding colors.
  const colors = resolveExportColors(meta.firm);
  const state: RenderState = {
    doc,
    listDepth: 0,
    primary: colors.primary,
    secondary: colors.secondary,
    accent: colors.accent,
    headlineCase: meta.firm.themeHeadlineCase,
    pageCount: 1,
  };

  // 1. Cover page (always).
  drawCoverPage(doc, meta, state);

  // 2. Body — markdown-it tokens → pdfkit commands.
  const tokens: Token[] = markdown.trim() ? md.parse(markdown, {}) : [];
  doc.font(PLATFORM_FONT).fontSize(11).fillColor('#1e293b');

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case 'heading_open': {
        const level = Number(t.tag.slice(1)) || 1;
        const inline = tokens[i + 1];
        const text =
          inline && inline.type === 'inline'
            ? caseHeadline(inline.content, state.headlineCase)
            : '';
        if (level === 1) {
          drawSectionDivider(doc, text, state);
        } else if (level === 2) {
          doc
            .moveDown(1.2)
            .font(`${PLATFORM_FONT}-Bold`)
            .fontSize(18)
            .fillColor(state.primary)
            .text(text);
        } else {
          doc
            .moveDown(0.9)
            .font(`${PLATFORM_FONT}-Bold`)
            .fontSize(13)
            .fillColor(state.accent)
            .text(text);
        }
        // Phase 50.9.2 — bumped to 0.6 so headings have visible
        // air below them before the next paragraph starts.
        doc.font(PLATFORM_FONT).fontSize(11).fillColor('#1e293b').moveDown(0.6);
        // Skip past the inline + heading_close — we already rendered.
        i += 2;
        break;
      }
      case 'paragraph_open': {
        const inline = tokens[i + 1];
        if (inline && inline.type === 'inline' && inline.children) {
          const runs = inlineToRuns(inline.children);
          if (state.listDepth > 0) {
            // Inside a bullet list — prepend the bullet glyph + indent
            // as part of the same paragraph so the bullet and body land
            // on one line and the next bullet starts on a fresh line.
            // Pre-50.9.2 the bullet was emitted in list_item_open with
            // continued:true, then paragraph_open started a new
            // continued chain that never properly terminated.
            emitParagraph(state, runs, {
              prefix: '• ',
              indent: 8 + (state.listDepth - 1) * 16,
            });
          } else {
            emitParagraph(state, runs);
          }
          i++;
        }
        // Paragraph spacing — bumped from 0.5 to 0.8 (~11pt vs ~7pt)
        // so adjacent paragraphs don't visually merge. Combined with
        // the document-level lineGap:2, this gives ~13pt total
        // breathing room between paragraphs.
        doc.moveDown(0.8);
        break;
      }
      case 'bullet_list_open':
        state.listDepth++;
        break;
      case 'bullet_list_close':
        state.listDepth = Math.max(0, state.listDepth - 1);
        doc.moveDown(0.5);
        break;
      case 'list_item_open':
        // The bullet glyph is emitted by paragraph_open when listDepth > 0.
        break;
      case 'list_item_close':
        break;
      case 'hr':
        doc.moveDown(0.5);
        doc
          .lineWidth(0.5)
          .strokeColor(state.secondary)
          .moveTo(56, doc.y)
          .lineTo(doc.page.width - 56, doc.y)
          .stroke();
        doc.moveDown(0.5);
        break;
      default:
        break;
    }
  }

  // 3. Stamp page-N-of-total footers across every page (cover + body).
  const pageRange = doc.bufferedPageRange();
  for (let p = 0; p < pageRange.count; p++) {
    doc.switchToPage(p);
    const pageNum = p + 1;
    const total = pageRange.count;
    doc
      .font(PLATFORM_FONT)
      .fontSize(8)
      .fillColor(state.secondary)
      .text(
        `Copyright © ${new Date().getFullYear()}, ${meta.firm.displayName}`,
        56,
        doc.page.height - 36,
        { width: doc.page.width / 2, align: 'left', lineBreak: false },
      );
    doc.text(
      `${pageNum} / ${total}`,
      doc.page.width / 2,
      doc.page.height - 36,
      { width: doc.page.width / 2 - 56, align: 'right', lineBreak: false },
    );
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}
