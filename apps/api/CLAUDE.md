# apps/api — agent notes

This file is read by Claude Code instances working in this package. Keep
notes here that future agents need to avoid foot-guns specific to the
api code.

## Test runner — vitest with `pool: 'forks'` (Phase 48.6)

The api package's `vitest.config.ts` pins `pool: 'forks'` for a reason.
Do **NOT** remove it without reproducing CI green first.

### Symptom if you do

Every CI run after the change will show:

```
Test Files  188 passed (188)
     Tests  2694 passed (2694)
/c/Program Files/nodejs/npx: line 65: PID Segmentation fault
EXIT=139
```

GitHub Actions sees exit 139 and marks the unit-tests job FAILED even
though every test passed. The summary line never reaches the workflow
log because the runner crashes before the reporter flushes.

### Root cause

`setupTestDb()` in `tests/_helpers/testDb.ts` mints a fresh libSQL
file-backed database per test suite by re-pointing `DATABASE_URL` and
calling `initDb()`. With the default `pool: 'threads'`, every test
file shares a single Node process — and each `initDb()` overwrites
the module-level `_client` singleton without releasing the previous
handle. Across 70+ test files the leaked native handles accumulate.
At process exit Node fires every Neon (libSQL native binding)
destructor concurrently and the cleanup race surfaces as a SIGSEGV.

### Fix

**`pool: 'forks'` in `vitest.config.ts`.** Each test file gets its
own child process. The libSQL native handle only ever exists in one
process at a time and the OS reclaims it on subprocess exit without
going through Neon destructors.

`closeDb()` is also exported from `src/db/index.ts` as a utility for
production code that genuinely needs to recycle the connection (e.g.
a future graceful-shutdown handler). It is **NOT** called from
`setupTestDb()`'s cleanup. We tried that during Phase 48.6 and it
broke the smoke test — some routes fire async background work
(`setImmediate(() => processJob(...))` on generate) that outlives
the test's afterAll. Closing the client synchronously crashed that
work with `DB not initialised` after the test had already reported
pass. The forks pool handles the lifecycle for us; per-test cleanup
just deletes the temp DB files, not the client.

The cost of `pool: 'forks'` is ~5–10 seconds of additional Node
startup time on CI. That's worth a green CI signal.

### When to revisit

Watch for libSQL releases that fix the underlying Neon binding cleanup
race. Their changelog will mention "fix segfault on process exit" or
similar. If/when that lands, you can drop `pool: 'forks'` and
fall back to `pool: 'threads'` for the speedup. Verify by:

```bash
cd apps/api && npx vitest run --pool=threads 2>&1 | tail -5
```

A clean exit 0 with the summary line printed means it's safe to
delete the config.

## Other api-specific gotchas

- **libSQL date format:** SQLite's `datetime('now')` default returns
  a TZ-less `YYYY-MM-DD HH:MM:SS` string that JS interprets as local
  time. For SLA breach math we need real UTC, so write timestamps
  via `new Date().toISOString()` from application code (see
  `db/tickets.ts.createTicket`). Don't add new tables that rely on
  the SQLite default if the column will feed time-based business
  logic.

- **Module-level acceptor / payload-schema registries:** The
  PendingSubmission acceptor + Zod schema registries in
  `services/pendingSubmissionAcceptors.ts` +
  `services/pendingSubmissionPayloadSchemas.ts` are populated via
  side-effect imports in `server.ts`. When you add a new `targetType`,
  ALWAYS add the matching `import './services/<thing>Acceptor.js'`
  line to `server.ts` — without it, `getAcceptor()` returns null at
  runtime and the route layer 500s with `NO_ACCEPTOR_REGISTERED`.

- **JSON columns:** `Engagement.license`, `Engagement.profile`,
  `Engagement.conflicts`, etc. are stored as TEXT and parsed via
  `parseRow()` helpers in `db/index.ts`. New nested keys typed as
  `any` are fine at the storage layer but try to give callers
  narrower types where you can — there's a long-standing tracking
  comment (§6.1) about migrating these to typed shapes.
