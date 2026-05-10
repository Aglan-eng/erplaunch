/**
 * Phase 50.3 — Firm-branded markdown → PPTX exporter.
 *
 * Uses pptxgenjs to produce a real .pptx file. The slide split rule:
 *   - Cover slide (always, generated from the doc title)
 *   - Each `## H2` heading starts a new slide
 *   - `### H3` headings within a slide render as sub-bullets
 *   - Inline content under the H2 becomes body bullets
 *
 * Layout decisions match the spec's pattern detection:
 *   - 2-4 short bullets → "card grid" layout
 *   - Numeric stats (`\b\d+[+%]?\b` followed by an UPPERCASE label) →
 *     "stat grid" layout (large numerals over UPPERCASE tags)
 *   - Markdown table → table slide
 *   - Otherwise → standard "title + bullets" layout
 *
 * Theme: primaryColor for the cover hero band, accentColor for stat
 * numerals + the title accent bar, secondaryColor for footer text.
 */

// pptxgenjs ships a CJS `module.exports = PptxGenJS` so the default
// import resolves through TypeScript's esModuleInterop. Casting the
// import to `any` is the established pattern in pptxgenjs's own
// README examples — their .d.ts marks the default export
// `export default PptxGenJS` but TS treats it as a namespace under
// node16 resolution.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as PptxGenJSImport from 'pptxgenjs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PptxGenJS: any =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((PptxGenJSImport as any).default ?? PptxGenJSImport) as any;
import MarkdownIt from 'markdown-it';
import { applyHeadlineCase, type ExportMeta } from './types.js';

type Token = ReturnType<MarkdownIt['parse']>[number];

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const PLATFORM_PRIMARY = '#0A1A2F';
const PLATFORM_SECONDARY = '#475569';
const PLATFORM_ACCENT = '#1FAE5C';

function toHex(color: string | null | undefined, fallback: string): string {
  if (!color) return fallback.replace(/^#/, '');
  return color.replace(/^#/, '');
}

function caseHeadline(text: string, c: 'sentence' | 'title' | 'upper' | null): string {
  if (!c) return text;
  return applyHeadlineCase(text, c);
}

interface SlideBlock {
  title: string;
  bullets: string[];
  subBullets: Map<number, string[]>;
  table?: { header: string[]; rows: string[][] };
}

/**
 * Slice the token stream into per-slide blocks. The first H2 boundary
 * resets the current block; pre-H2 content (intro paragraph) is
 * discarded — by convention the doc body starts with a section, not
 * a preamble.
 */
function tokensToSlides(tokens: Token[]): SlideBlock[] {
  const slides: SlideBlock[] = [];
  let current: SlideBlock | null = null;
  let inTable = false;
  let tableHeader: string[] = [];
  let tableRows: string[][] = [];
  let currentRow: string[] = [];
  let inThead = false;

  function flushTable(): void {
    if (current && tableHeader.length > 0) {
      current.table = { header: tableHeader, rows: tableRows };
    }
    tableHeader = [];
    tableRows = [];
    currentRow = [];
    inTable = false;
    inThead = false;
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open') {
      const level = Number(t.tag.slice(1)) || 1;
      const inline = tokens[i + 1];
      const text = inline && inline.type === 'inline' ? inline.content : '';
      if (level === 1 || level === 2) {
        // New slide.
        if (current) slides.push(current);
        current = {
          title: text,
          bullets: [],
          subBullets: new Map(),
        };
      } else if (level === 3 && current) {
        // Sub-bullet header — track as its own indented item.
        const idx = current.bullets.length;
        const sub = current.subBullets.get(idx) ?? [];
        sub.push(text);
        current.subBullets.set(idx, sub);
      }
      i += 2; // inline + heading_close
      continue;
    }
    if (t.type === 'paragraph_open') {
      const inline = tokens[i + 1];
      if (inline && inline.type === 'inline' && current) {
        current.bullets.push(inline.content);
      }
      i++;
      continue;
    }
    if (t.type === 'bullet_list_open') {
      // Walk children and collect their inline content as bullets.
      let depth = 1;
      i++;
      while (i < tokens.length && depth > 0) {
        const inner = tokens[i];
        if (inner.type === 'bullet_list_open') depth++;
        else if (inner.type === 'bullet_list_close') depth--;
        else if (inner.type === 'inline' && current) {
          current.bullets.push(inner.content);
        }
        i++;
      }
      i--; // outer loop increment
      continue;
    }
    if (t.type === 'table_open') {
      inTable = true;
      continue;
    }
    if (t.type === 'thead_open') {
      inThead = true;
      continue;
    }
    if (t.type === 'thead_close') {
      inThead = false;
      continue;
    }
    if (t.type === 'tr_open') {
      currentRow = [];
      continue;
    }
    if (t.type === 'tr_close') {
      if (inThead) tableHeader = [...currentRow];
      else tableRows.push([...currentRow]);
      continue;
    }
    if (t.type === 'inline' && inTable && t.children) {
      const text = t.children
        .filter((c) => c.type === 'text')
        .map((c) => c.content)
        .join('');
      currentRow.push(text);
      continue;
    }
    if (t.type === 'table_close') {
      flushTable();
      continue;
    }
  }
  if (current) slides.push(current);
  return slides;
}

/**
 * Heuristic: does the bullet content look like a stat grid? We trigger
 * on bullets matching `<NUMBER>+ <UPPERCASE LABEL>` (e.g. "200+ ENGAGEMENTS").
 */
function isStatGrid(bullets: ReadonlyArray<string>): boolean {
  if (bullets.length < 2 || bullets.length > 6) return false;
  return bullets.every((b) => /^\d+\+?%?\s+[A-Z][A-Z\s]+/.test(b.trim()));
}

function isCardGrid(bullets: ReadonlyArray<string>): boolean {
  if (bullets.length < 2 || bullets.length > 4) return false;
  return bullets.every((b) => b.length < 200 && !b.includes('\n'));
}

export async function markdownToPptx(
  markdown: string,
  meta: ExportMeta,
): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = meta.title;
  pres.author = meta.firm.displayName;
  pres.company = meta.firm.displayName;

  const primary = toHex(meta.firm.primaryColor, PLATFORM_PRIMARY);
  const secondary = toHex(meta.firm.secondaryColor, PLATFORM_SECONDARY);
  const accent = toHex(meta.firm.themeAccentColor, PLATFORM_ACCENT);

  // ── Cover slide ───────────────────────────────────────────────────
  const cover = pres.addSlide();
  cover.background = { color: primary };
  cover.addText(meta.firm.displayName.toUpperCase(), {
    x: 0.5,
    y: 0.3,
    w: 6,
    h: 0.4,
    fontSize: 11,
    color: 'FFFFFF',
    bold: true,
  });
  cover.addText(caseHeadline(meta.title, meta.firm.themeHeadlineCase), {
    x: 0.5,
    y: 2.2,
    w: 12,
    h: 1.6,
    fontSize: 44,
    color: 'FFFFFF',
    bold: true,
  });
  if (meta.firm.tagline) {
    cover.addText(meta.firm.tagline, {
      x: 0.5,
      y: 4.0,
      w: 12,
      h: 0.6,
      fontSize: 20,
      color: accent,
    });
  }
  if (meta.engagement?.client) {
    cover.addText(`Prepared for ${meta.engagement.client}`, {
      x: 0.5,
      y: 5.5,
      w: 12,
      h: 0.4,
      fontSize: 14,
      color: 'FFFFFF',
    });
  }

  // ── Content slides ────────────────────────────────────────────────
  const tokens: Token[] = markdown.trim() ? md.parse(markdown, {}) : [];
  const slideBlocks = tokensToSlides(tokens);

  for (const block of slideBlocks) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };

    // Title with green accent bar on the left.
    slide.addShape('rect', {
      x: 0.4,
      y: 0.5,
      w: 0.06,
      h: 0.6,
      fill: { color: accent },
      line: { color: accent, width: 0 },
    });
    slide.addText(caseHeadline(block.title, meta.firm.themeHeadlineCase), {
      x: 0.6,
      y: 0.4,
      w: 12,
      h: 0.8,
      fontSize: 28,
      color: primary,
      bold: true,
    });

    // Body — choose layout based on content shape.
    if (block.table) {
      const headerRow = block.table.header.map((cell) => ({
        text: cell,
        options: { bold: true, color: 'FFFFFF', fill: { color: primary } },
      }));
      const bodyRows = block.table.rows.map((row, ri) =>
        row.map((cell) => ({
          text: cell,
          options: {
            color: '1E293B',
            fill: { color: ri % 2 === 0 ? 'FFFFFF' : 'F8F9FA' },
          },
        })),
      );
      slide.addTable([headerRow, ...bodyRows], {
        x: 0.5,
        y: 1.6,
        w: 12,
        fontSize: 12,
        border: { color: secondary, pt: 0.5 },
      });
    } else if (isStatGrid(block.bullets)) {
      // 1-4 stat tiles across the slide.
      const tileW = 12 / block.bullets.length;
      block.bullets.forEach((b, idx) => {
        const m = b.trim().match(/^(\d+\+?%?)\s+(.+)$/);
        if (!m) return;
        const [, num, label] = m;
        slide.addText(num, {
          x: 0.4 + idx * tileW,
          y: 1.8,
          w: tileW - 0.2,
          h: 1.6,
          fontSize: 64,
          color: accent,
          bold: true,
          align: 'center',
        });
        slide.addText(label.toUpperCase(), {
          x: 0.4 + idx * tileW,
          y: 3.4,
          w: tileW - 0.2,
          h: 0.5,
          fontSize: 12,
          color: primary,
          bold: true,
          align: 'center',
        });
      });
    } else if (isCardGrid(block.bullets)) {
      const cols = Math.min(block.bullets.length, 2);
      const rows = Math.ceil(block.bullets.length / cols);
      const cardW = (12 - 0.5 * (cols - 1)) / cols;
      const cardH = (4.5 - 0.5 * (rows - 1)) / rows;
      block.bullets.forEach((b, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        slide.addShape('rect', {
          x: 0.5 + c * (cardW + 0.5),
          y: 1.8 + r * (cardH + 0.5),
          w: cardW,
          h: cardH,
          fill: { color: 'F8F9FA' },
          line: { color: accent, width: 2 },
        });
        slide.addText(b, {
          x: 0.7 + c * (cardW + 0.5),
          y: 2.0 + r * (cardH + 0.5),
          w: cardW - 0.4,
          h: cardH - 0.4,
          fontSize: 14,
          color: primary,
        });
      });
    } else {
      // Standard bulleted content.
      const bulletItems = block.bullets.flatMap((b, idx) => {
        const items: { text: string; options: object }[] = [
          { text: b, options: { bullet: true, fontSize: 14, color: '1E293B' } },
        ];
        const subs = block.subBullets.get(idx) ?? [];
        for (const sub of subs) {
          items.push({
            text: sub,
            options: { bullet: true, indentLevel: 1, fontSize: 12, color: secondary },
          });
        }
        return items;
      });
      if (bulletItems.length > 0) {
        slide.addText(bulletItems, {
          x: 0.6,
          y: 1.4,
          w: 12,
          h: 5.0,
          paraSpaceAfter: 6,
        });
      }
    }

    // Footer — firm name + slide number, in secondary at 60% opacity.
    slide.addText(
      `${meta.firm.displayName}${meta.firm.tagline ? ` · ${meta.firm.tagline}` : ''}`,
      { x: 0.5, y: 6.9, w: 8, h: 0.3, fontSize: 9, color: secondary },
    );
    slide.addText(`${slideBlocks.indexOf(block) + 2} / ${slideBlocks.length + 1}`, {
      x: 11.5,
      y: 6.9,
      w: 1.5,
      h: 0.3,
      fontSize: 9,
      color: secondary,
      align: 'right',
    });
  }

  // pptxgenjs returns a Buffer when `outputType: 'nodebuffer'` is set.
  const out = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  return out;
}
