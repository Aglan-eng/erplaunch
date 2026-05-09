/**
 * Phase 46.8.4 — pure tests for SalesSowPage helpers.
 */
import { describe, it, expect } from 'vitest';
import { approxBase64Bytes } from '../src/pages/SalesSowPage';

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
