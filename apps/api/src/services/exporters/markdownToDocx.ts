/**
 * Phase 50.3 — Firm-branded markdown → DOCX exporter.
 *
 * Uses the `docx` npm library to produce a real .docx file (PK-zip
 * payload, not a markdown-with-extension dodge).
 *
 * Brand application:
 *   - Cover page: large title in firm.primaryColor, tagline in
 *     firm.themeAccentColor as subtitle
 *   - H1 = section divider page (page break + full-width filled
 *     paragraph in primaryColor with white text)
 *   - H2 = page heading in primaryColor, themeHeadlineCase applied
 *   - H3 = sub-heading in themeAccentColor
 *   - Body: 11pt
 *   - Tables: header row fill in primaryColor with white text;
 *     alternating row fill on plain rows
 *   - Footer on every page: firm displayName · tagline (small,
 *     secondaryColor) + page-N pattern
 *
 * Markdown handling: paragraph / heading / list / table / horizontal
 * rule via markdown-it tokens. The exporter doesn't try to cover the
 * full markdown spec — code blocks render as plain monospace, images
 * are skipped (alt text retained), nested lists collapse to a single
 * level. That's deliberate scope for v1; full fidelity is a Phase 51
 * extension.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  PageBreak,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  Header,
  Footer,
  PageNumber,
  BorderStyle,
} from 'docx';
import MarkdownIt from 'markdown-it';
import {
  applyHeadlineCase,
  resolveExportColors,
  type ExportMeta,
} from './types.js';

type Token = ReturnType<MarkdownIt['parse']>[number];

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

/**
 * Strip the leading `#` and upper-case — docx wants 6-digit hex with
 * no `#` prefix. Input is already non-null because the caller resolves
 * via `resolveExportColors`.
 */
function toDocxHex(color: string): string {
  return color.replace(/^#/, '').toUpperCase();
}

function caseHeadline(text: string, c: 'sentence' | 'title' | 'upper' | null): string {
  if (!c) return text;
  return applyHeadlineCase(text, c);
}

interface InlinePart {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

/**
 * Walk markdown-it inline tokens into a flat list of `{text, bold,
 * italic, code}` parts so callers can re-wrap with table-cell color
 * overrides if needed. Returning plain TextRuns lost the formatting
 * metadata once it landed inside a `new TextRun(...)`.
 */
function inlineToParts(tokens: Token[]): InlinePart[] {
  const out: InlinePart[] = [];
  let bold = false;
  let italic = false;
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        if (t.content.length > 0) {
          out.push({ text: t.content, bold, italic });
        }
        break;
      case 'strong_open':
        bold = true;
        break;
      case 'strong_close':
        bold = false;
        break;
      case 'em_open':
        italic = true;
        break;
      case 'em_close':
        italic = false;
        break;
      case 'code_inline':
        out.push({ text: t.content, code: true });
        break;
      case 'softbreak':
      case 'hardbreak':
        out.push({ text: ' ' });
        break;
      default:
        if (t.content) out.push({ text: t.content });
        break;
    }
  }
  return out;
}

function partsToRuns(parts: ReadonlyArray<InlinePart>, color?: string): TextRun[] {
  return parts.map(
    (p) =>
      new TextRun({
        text: p.text,
        bold: p.bold,
        italics: p.italic,
        font: p.code ? 'Consolas' : undefined,
        color,
      }),
  );
}

function coverPageParagraphs(meta: ExportMeta, primaryHex: string, accentHex: string): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 800, after: 200 },
      children: [
        new TextRun({
          text: meta.firm.displayName.toUpperCase(),
          color: primaryHex,
          bold: true,
          size: 18,
        }),
      ],
    }),
  );
  out.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 200, after: 200 },
      children: [
        new TextRun({
          text: caseHeadline(meta.title, meta.firm.themeHeadlineCase),
          color: primaryHex,
          bold: true,
          size: 72,
        }),
      ],
    }),
  );
  if (meta.firm.tagline) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 200 },
        children: [new TextRun({ text: meta.firm.tagline, color: accentHex, size: 28 })],
      }),
    );
  }
  if (meta.engagement?.client) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: `Prepared for ${meta.engagement.client}`,
            size: 22,
          }),
        ],
      }),
    );
  }
  out.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 400 },
      children: [
        new TextRun({
          text: `${new Date().toISOString().slice(0, 10)} · ${meta.firm.displayName}`,
          size: 18,
        }),
      ],
    }),
  );
  out.push(new Paragraph({ children: [new PageBreak()] }));
  return out;
}

function sectionDivider(title: string, primaryHex: string, headlineCase: 'sentence' | 'title' | 'upper' | null): Paragraph[] {
  return [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 800 },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: primaryHex },
      children: [
        new TextRun({
          text: caseHeadline(title, headlineCase),
          color: 'FFFFFF',
          bold: true,
          size: 56,
        }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

/**
 * Build a table from markdown-it table tokens. The first row is the
 * header (primaryColor fill, white text); subsequent rows alternate
 * between plain + secondary-light fill.
 */
function tableFromTokens(
  tokens: Token[],
  startIdx: number,
  primaryHex: string,
): { table: Table; consumed: number } {
  const rows: TableRow[] = [];
  let isHeader = false;
  let cellParts: InlinePart[] = [];
  const currentRow: TableCell[] = [];
  let i = startIdx;
  let rowIndex = 0;

  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === 'thead_open') {
      isHeader = true;
    } else if (t.type === 'thead_close') {
      isHeader = false;
    } else if (t.type === 'tr_open') {
      // Start fresh row.
    } else if (t.type === 'th_open' || t.type === 'td_open') {
      cellParts = [];
    } else if (t.type === 'th_close' || t.type === 'td_close') {
      const fill = isHeader
        ? primaryHex
        : rowIndex % 2 === 0
          ? 'FFFFFF'
          : 'F8F9FA';
      const textColor = isHeader ? 'FFFFFF' : '1E293B';
      currentRow.push(
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill },
          children: [
            new Paragraph({
              children: partsToRuns(
                isHeader
                  ? cellParts.map((p) => ({ ...p, bold: true }))
                  : cellParts,
                textColor,
              ),
            }),
          ],
        }),
      );
    } else if (t.type === 'tr_close') {
      rows.push(new TableRow({ children: [...currentRow] }));
      currentRow.length = 0;
      rowIndex++;
    } else if (t.type === 'inline' && t.children) {
      cellParts = inlineToParts(t.children);
    } else if (t.type === 'table_close') {
      i++;
      break;
    }
    i++;
  }
  return {
    table: new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    }),
    consumed: i - startIdx,
  };
}

export async function markdownToDocx(
  markdown: string,
  meta: ExportMeta,
): Promise<Buffer> {
  // Phase 50.9.1 — shared resolver so DOCX honours the same fallback
  // chain (Firm color → Brand Pack accent → platform default) the PDF
  // exporter uses.
  const colors = resolveExportColors(meta.firm);
  const primaryHex = toDocxHex(colors.primary);
  const secondaryHex = toDocxHex(colors.secondary);
  const accentHex = toDocxHex(colors.accent);

  const bodyParagraphs: (Paragraph | Table)[] = [];
  bodyParagraphs.push(...coverPageParagraphs(meta, primaryHex, accentHex));

  const tokens: Token[] = markdown.trim() ? md.parse(markdown, {}) : [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case 'heading_open': {
        const level = Number(t.tag.slice(1)) || 1;
        const inline = tokens[i + 1];
        const text =
          inline && inline.type === 'inline'
            ? caseHeadline(inline.content, meta.firm.themeHeadlineCase)
            : '';
        if (level === 1) {
          bodyParagraphs.push(
            ...sectionDivider(text, primaryHex, meta.firm.themeHeadlineCase),
          );
        } else if (level === 2) {
          bodyParagraphs.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 360, after: 120 },
              children: [
                new TextRun({ text, color: primaryHex, bold: true, size: 32 }),
              ],
            }),
          );
        } else {
          bodyParagraphs.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 80 },
              children: [
                new TextRun({ text, color: accentHex, bold: true, size: 26 }),
              ],
            }),
          );
        }
        i += 2; // consume inline + heading_close
        break;
      }
      case 'paragraph_open': {
        const inline = tokens[i + 1];
        if (inline && inline.type === 'inline' && inline.children) {
          const runs = partsToRuns(inlineToParts(inline.children));
          if (runs.length > 0) {
            bodyParagraphs.push(
              new Paragraph({
                children: runs,
                spacing: { after: 120 },
              }),
            );
          }
          i++;
        }
        break;
      }
      case 'bullet_list_open': {
        // Collect every list_item_open within this bullet_list_open
        // until bullet_list_close at the matching depth.
        let depth = 1;
        i++;
        while (i < tokens.length && depth > 0) {
          const inner = tokens[i];
          if (inner.type === 'bullet_list_open') depth++;
          else if (inner.type === 'bullet_list_close') depth--;
          else if (inner.type === 'inline' && inner.children) {
            bodyParagraphs.push(
              new Paragraph({
                bullet: { level: 0 },
                children: partsToRuns(inlineToParts(inner.children)),
              }),
            );
          }
          i++;
        }
        i--; // outer for-loop will increment
        break;
      }
      case 'table_open': {
        const { table, consumed } = tableFromTokens(tokens, i, primaryHex);
        bodyParagraphs.push(table);
        i += consumed;
        break;
      }
      case 'hr':
        bodyParagraphs.push(
          new Paragraph({
            border: {
              bottom: {
                color: secondaryHex,
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
            spacing: { before: 120, after: 120 },
            children: [],
          }),
        );
        break;
      default:
        break;
    }
  }

  const doc = new Document({
    creator: meta.firm.displayName,
    title: meta.title,
    description: meta.firm.tagline ?? meta.title,
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: meta.firm.displayName,
                    color: primaryHex,
                    bold: true,
                    size: 16,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `${meta.firm.displayName}${
                      meta.firm.tagline ? ` · ${meta.firm.tagline}` : ''
                    } · `,
                    size: 16,
                    color: secondaryHex,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: secondaryHex,
                  }),
                  new TextRun({
                    text: ' / ',
                    size: 16,
                    color: secondaryHex,
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: secondaryHex,
                  }),
                ],
              }),
            ],
          }),
        },
        children: bodyParagraphs,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
