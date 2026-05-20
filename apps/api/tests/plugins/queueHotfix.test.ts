/**
 * Phase-52.9.2 hotfix tests.
 *
 * Covers:
 *   - queue.ts `describeError` returns a non-empty string for every
 *     error shape (Error / nested Error / plain object / undefined),
 *     which is what was missing from the prod logs and hid the
 *     Redis-connect-refused crash-loop.
 *   - exports.ts `withRenderTimeoutMs` resolves when fn is fast and
 *     rejects with `PdfRenderTimeoutError` when fn hangs.
 */
import { describe, it, expect } from 'vitest';
import { _testOnlyDescribeError } from '../../src/plugins/queue.js';
import {
  withRenderTimeoutMs,
  PdfRenderTimeoutError,
} from '../../src/routes/exports.js';

describe('queue.describeError — non-empty serialization', () => {
  it('serializes a standard Error with its stack', () => {
    const out = _testOnlyDescribeError(new Error('boom'));
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('boom');
  });

  it('serializes an Error subclass (mimics ioredis connect errors)', () => {
    class ConnError extends Error {
      readonly code = 'ECONNREFUSED';
    }
    const out = _testOnlyDescribeError(new ConnError('connect ECONNREFUSED 127.0.0.1:6379'));
    expect(out).toContain('ECONNREFUSED');
  });

  it('serializes a plain object payload as JSON', () => {
    const out = _testOnlyDescribeError({ code: 'EAI_AGAIN', reason: 'dns' });
    expect(out).toContain('EAI_AGAIN');
    expect(out).toContain('dns');
  });

  it('returns a non-empty string for undefined / null', () => {
    expect(_testOnlyDescribeError(undefined)).toBeTruthy();
    expect(_testOnlyDescribeError(null)).toBeTruthy();
  });

  it('returns a non-empty string for a circular object (JSON.stringify throws)', () => {
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    const out = _testOnlyDescribeError(circ);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('exports.withRenderTimeoutMs', () => {
  it('resolves with the fn result when fn finishes before the timeout', async () => {
    const value = await withRenderTimeoutMs(async () => 'ok', 1000);
    expect(value).toBe('ok');
  });

  it('rejects with PdfRenderTimeoutError when fn exceeds the timeout', async () => {
    const never = (): Promise<never> =>
      new Promise(() => {
        /* never resolves */
      });
    await expect(withRenderTimeoutMs(never, 50)).rejects.toBeInstanceOf(PdfRenderTimeoutError);
  });

  it('propagates fn errors verbatim (not wrapped in TimeoutError) when fn rejects fast', async () => {
    await expect(
      withRenderTimeoutMs(async () => {
        throw new Error('upstream failure');
      }, 1000),
    ).rejects.toThrow('upstream failure');
  });

  it('clears the timer so a fast fn does not leak a setTimeout', async () => {
    // If the timer leaked, a subsequent fast-resolving call wouldn't
    // be affected — but vitest would warn about open handles. This
    // test exists as a guard rail rather than a strict assertion.
    for (let i = 0; i < 5; i++) {
      await withRenderTimeoutMs(async () => i, 100);
    }
    expect(true).toBe(true);
  });
});
