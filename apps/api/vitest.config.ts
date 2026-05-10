import { defineConfig } from 'vitest/config';

/**
 * Phase 48.6 — vitest config for the api package.
 *
 * `pool: 'forks'` is the load-bearing setting here. It puts each test
 * file in its own child process so the libSQL native binding only
 * ever exists in a single process at a time. With the default
 * `pool: 'threads'`, all 188 test files share the same Node process
 * and the libSQL native handles accumulate as `setupTestDb()` runs
 * per-suite. At process exit Node fires every Neon destructor
 * concurrently and the cleanup race surfaces as a SIGSEGV — which
 * CI sees as exit 139, marking the workflow failed even though every
 * test passed.
 *
 * Tradeoff: forks is ~10–20% slower than threads on a warm cache
 * because each file pays the Node startup tax. For this suite it
 * costs ~5–10s on CI. The price of a green workflow is worth it.
 *
 * `singleFork: false` (the default) keeps the parallelism — vitest
 * still runs N forks concurrently up to the worker count. We don't
 * pin a worker count here; vitest defaults to CPU/2 on CI which is
 * fine.
 *
 * `isolate: true` (the default) is preserved — module-level singletons
 * inside the api code (db client, registry maps, etc.) reset between
 * files so suites don't bleed state.
 */
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        // Each test file is its own subprocess. No cross-file native
        // handle accumulation, no teardown segfault.
        singleFork: false,
      },
    },
  },
});
