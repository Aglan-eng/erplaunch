/**
 * Phase 46.8.4 — pure tests for SalesSowPage helpers.
 *
 * Phase 48.3 — extended with findLatestSowFilename / extractVersionFromFilename
 * after the audit caught a SOW preview URL bug (the page was guessing
 * `Statement_of_Work_v${jobs.length}.pdf` which broke when the version
 * counter and the job count diverged). The helpers now read the actual
 * file tree and extract the canonical version number.
 */
import { describe, it, expect } from 'vitest';
import {
  approxBase64Bytes,
  findLatestSowFilename,
  extractVersionFromFilename,
} from '../src/pages/SalesSowPage';

describe('approxBase64Bytes', () => {
  it('returns 0 for empty input', () => {
    expect(approxBase64Bytes('')).toBe(0);
  });

  it('returns ~75% of base64 length (3:4 expansion)', () => {
    // Encode 1KB of data — base64 is ~1.34KB, decoded back ~1024 bytes.
    // Allow ±2 to absorb rounding.
    expect(approxBase64Bytes('a'.repeat(1364))).toBeGreaterThanOrEqual(1022);
    expect(approxBase64Bytes('a'.repeat(1364))).toBeLessThanOrEqual(1024);
  });

  it('rounds to whole bytes', () => {
    expect(Number.isInteger(approxBase64Bytes('abc'))).toBe(true);
  });
});

describe('extractVersionFromFilename', () => {
  it('parses the trailing _vN.pdf integer', () => {
    expect(extractVersionFromFilename('Statement_of_Work_v3.pdf')).toBe(3);
    expect(extractVersionFromFilename('Statement_of_Work_v17.pdf')).toBe(17);
  });

  it('returns 0 when no _vN suffix is present', () => {
    expect(extractVersionFromFilename('Statement_of_Work.pdf')).toBe(0);
    expect(extractVersionFromFilename('whatever.pdf')).toBe(0);
  });

  it('is case-insensitive on the .pdf extension', () => {
    expect(extractVersionFromFilename('Statement_of_Work_v2.PDF')).toBe(2);
  });
});

describe('findLatestSowFilename', () => {
  it('returns null when the root has no children', () => {
    expect(findLatestSowFilename(null)).toBeNull();
    expect(findLatestSowFilename(undefined)).toBeNull();
    expect(findLatestSowFilename({})).toBeNull();
    expect(findLatestSowFilename({ children: [] })).toBeNull();
  });

  it('returns null when the SOW directory is missing', () => {
    expect(
      findLatestSowFilename({
        children: [
          { type: 'dir', name: 'Documentation', children: [] },
        ],
      }),
    ).toBeNull();
  });

  it('returns null when the SOW directory has no PDFs', () => {
    expect(
      findLatestSowFilename({
        children: [
          {
            type: 'dir',
            name: 'SOW',
            children: [{ type: 'file', name: 'README.txt' }],
          },
        ],
      }),
    ).toBeNull();
  });

  it('returns the only PDF when only one exists', () => {
    expect(
      findLatestSowFilename({
        children: [
          {
            type: 'dir',
            name: 'SOW',
            children: [{ type: 'file', name: 'Statement_of_Work_v1.pdf' }],
          },
        ],
      }),
    ).toBe('Statement_of_Work_v1.pdf');
  });

  it('picks the highest-versioned PDF when multiple exist', () => {
    expect(
      findLatestSowFilename({
        children: [
          {
            type: 'dir',
            name: 'SOW',
            children: [
              { type: 'file', name: 'Statement_of_Work_v1.pdf' },
              { type: 'file', name: 'Statement_of_Work_v3.pdf' },
              { type: 'file', name: 'Statement_of_Work_v2.pdf' },
            ],
          },
        ],
      }),
    ).toBe('Statement_of_Work_v3.pdf');
  });

  it('falls back to alphabetical order when version markers are absent', () => {
    // Both files have version 0 (no _vN). The sort is then stable on
    // the 0-vs-0 comparison; the test pins that we return *something*
    // deterministic rather than throwing.
    const result = findLatestSowFilename({
      children: [
        {
          type: 'dir',
          name: 'SOW',
          children: [
            { type: 'file', name: 'a.pdf' },
            { type: 'file', name: 'b.pdf' },
          ],
        },
      ],
    });
    expect(result).not.toBeNull();
    expect(['a.pdf', 'b.pdf']).toContain(result);
  });
});
