import { describe, it, expect } from 'vitest';

/**
 * Placeholder smoke test so the CI `vitest run` step passes.
 *
 * The SPA is covered end-to-end by the Playwright suite in apps/web-e2e/.
 * This file exists to satisfy `pnpm -r --if-present run test` in CI so that
 * a unit-test lane with zero assertions doesn't fail the pipeline. Real
 * component/unit tests should replace this as they are written.
 */
describe('smoke', () => {
  it('vitest is wired up', () => {
    expect(1 + 1).toBe(2);
  });
});
