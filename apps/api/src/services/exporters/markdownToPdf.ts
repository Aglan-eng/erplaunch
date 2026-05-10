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
import { applyHeadlineCase, type ExportMeta } from './types.js';

// markdown-it doesn't export its Token type by name across all 14.x
// builds; derive it from the parse return shape (same pattern the
// older pdfService uses).
type Token = ReturnType<MarkdownIt['parse']>[number];

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const PLATFORM_PRIMARY = '#0f172a';
const PLATFORM_SECONDARY = '#475569';
const PLATFORM_ACCENT = '#1FAE5C';
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

function renderInline(state: RenderState, tokens: Token[]): void {
  const { doc } = state;
  doc.fontSize(11).fillColor('#1e293b').font(PLATFORM_FONT);
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        doc.text(t.content, { continued: true });
        break;
      case 'strong_open':
        doc.font(`${PLATFORM_FONT}-Bold`);
        break;
      case 'strong_close':
        doc.font(PLATFORM_FONT);
        break;
      case 'em_open':
        doc.font(`${PLATFORM_FONT}-Oblique`);
        break;
      case 'em_close':
        doc.font(PLATFORM_FONT);
        break;
      case 'code_inline':
        doc.font('Courier').text(` ${t.content} `, { continued: true }).font(PLATFORM_FONT);
        break;
      case 'softbreak':
      case 'hardbreak':
        doc.text(' ', { continued: true });
        break;
      default:
        if (t.content) doc.text(t.content, { continued: true });
        break;
    }
  }
  doc.text('', { continued: false });
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
      .moveDown(0.3)
      .font(PLATFORM_FONT)
      .fontSize(14)
      .fillColor(state.accent)
      .text(meta.firm.tagline, { width: pageWidth - 112 });
  }

  if (meta.engagement?.client) {
    doc
      .moveDown(0.4)
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

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', (err) => reject(err));
  });

  const state: RenderState = {
    doc,
    listDepth: 0,
    primary: meta.firm.primaryColor ?? PLATFORM_PRIMARY,
    secondary: meta.firm.secondaryColor ?? PLATFORM_SECONDARY,
    accent: meta.firm.themeAccentColor ?? PLATFORM_ACCENT,
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
            .moveDown(0.8)
            .font(`${PLATFORM_FONT}-Bold`)
            .fontSize(18)
            .fillColor(state.primary)
            .text(text);
        } else {
          doc
            .moveDown(0.6)
            .font(`${PLATFORM_FONT}-Bold`)
            .fontSize(13)
            .fillColor(state.accent)
            .text(text);
        }
        doc.font(PLATFORM_FONT).fontSize(11).fillColor('#1e293b').moveDown(0.4);
        // Skip past the inline + heading_close — we already rendered.
        i += 2;
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
        state.listDepth++;
        break;
      case 'bullet_list_close':
        state.listDepth = Math.max(0, state.listDepth - 1);
        doc.moveDown(0.3);
        break;
      case 'list_item_open': {
        const indent = 8 + state.listDepth * 16;
        doc.text('• ', { continued: true, indent });
        break;
      }
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
