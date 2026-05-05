import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { convertMarkdownToPdf } from '../../src/services/pdfService.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erplaunch-pdf-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('convertMarkdownToPdf', () => {
  it('writes a file that starts with the PDF magic header', async () => {
    const out = path.join(tmpDir, 'tiny.pdf');
    await convertMarkdownToPdf('# Hello\n\nWorld.', out);
    const buf = fs.readFileSync(out);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('produces a substantially larger file than the legacy 837-byte placeholder', async () => {
    // The legacy fallback was a single-page hand-rolled PDF capped around
    // 800-1000 bytes. A pdfkit-rendered BRD-shape document should be
    // multi-KB even for short inputs (font dictionaries, page resources,
    // xref table all take space).
    const out = path.join(tmpDir, 'paragraph.pdf');
    const md = [
      '# Business Requirements Document',
      '',
      '## Executive Summary',
      '',
      'This document captures the scope of the implementation.',
      '',
      '## Stakeholders',
      '',
      '- Project Sponsor — accountable for outcomes',
      '- IT Lead — owns technical decisions',
      '- Finance Lead — signs off on financial scope',
      '',
    ].join('\n');
    await convertMarkdownToPdf(md, out);
    const stat = fs.statSync(out);
    // ~1.5KB+ — comfortably above the 837-byte placeholder, while staying
    // realistic for a short paragraphs+list document. pdfkit's compression
    // keeps small docs surprisingly compact.
    expect(stat.size).toBeGreaterThan(1500);
  });

  it('paginates when the input exceeds one page', async () => {
    // Generate enough markdown to force at least one page break (>120 lines).
    const lines = [
      '# Long BRD',
      '',
      ...Array.from({ length: 200 }, (_, i) => `Line ${i + 1} of body text — describes the implementation in detail.`),
    ];
    const out = path.join(tmpDir, 'long.pdf');
    await convertMarkdownToPdf(lines.join('\n'), out);
    const stat = fs.statSync(out);
    expect(stat.size).toBeGreaterThan(4000);
    // Multi-page docs reference multiple Page objects in the catalog.
    // pdfkit emits each page as `/Type /Page` (with an optional space) — the
    // surrounding negative-lookahead avoids `/Pages` which is the index obj.
    const buf = fs.readFileSync(out, 'utf8');
    const pageMatches = buf.match(/\/Type\s*\/Page(?!s)/g) || [];
    expect(pageMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('handles empty markdown without throwing', async () => {
    const out = path.join(tmpDir, 'empty.pdf');
    await convertMarkdownToPdf('', out);
    const buf = fs.readFileSync(out);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders headings + lists + paragraphs without crashing', async () => {
    const md = [
      '# H1',
      '## H2',
      '### H3',
      '',
      'Paragraph with **bold** and *italic*.',
      '',
      '- Bullet one',
      '- Bullet two',
      '  - Nested bullet',
      '',
      '1. Numbered one',
      '2. Numbered two',
      '',
      '```',
      'code block',
      'with two lines',
      '```',
      '',
      '> A blockquote',
    ].join('\n');
    const out = path.join(tmpDir, 'mixed.pdf');
    await expect(convertMarkdownToPdf(md, out)).resolves.toBeUndefined();
    expect(fs.statSync(out).size).toBeGreaterThan(1000);
  });
});
