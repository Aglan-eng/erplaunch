# Phase 51.1 — Chromium-on-Render spike report

**Branch:** `phase-51-1-chromium-spike` (not merged to `main`)
**Date:** 2026-05-18
**Decision gate:** validate Sparticuz on Render Starter before sinking
CSS effort into a pipeline that won't deploy.

## Context

Phase 51 replaces the imperative pdfkit pipeline with an HTML/CSS →
headless Chromium PDF renderer. The locked decision (PHASE_51_52_DECISIONS_LOCKED.md
#1) is Render Starter ($7/mo, 512MB RAM) running
`@sparticuz/chromium` + `puppeteer` in-process, concurrency=1,
recycled every 100 renders. Fallback if it doesn't fit: Browserless.io
at $50/mo.

This document captures the spike artefacts so the user (a) sees
what was measured locally, (b) knows exactly what still needs to be
verified on Render before Phase 51.2 starts, and (c) has the
fallback trigger criteria spelled out so the decision is mechanical
not subjective.

## What the spike ships

A throwaway Fastify route on this branch (`POST /spike/render`),
gated on `SPIKE_ENABLED=true`. Takes `{ html }` and returns the
rendered PDF bytes. Plus `GET /spike/diag` for the in-process
diagnostics (launch state, render count, queue depth).

Files:

- `apps/api/src/services/exporters/puppeteerBrowser.ts` — singleton
  with cross-env launcher (Sparticuz on Render/Lambda, system Chrome
  via `PUPPETEER_EXECUTABLE_PATH` on dev), concurrency=1 FIFO with
  max queue depth 5, auto-recycle after 100 renders, graceful
  `closeBrowser()` for the Fastify `onClose` hook.
- `apps/api/src/services/exporters/htmlToPdf.ts` — thin wrapper:
  `setContent(html) → page.pdf({ format: 'A4', printBackground })`.
- `apps/api/scripts/bench-pdf-render.ts` — 6 sequential renders of a
  synthetic 10-page fixture (10 H1 sections, paragraphs, bullet
  lists, a 5-row pricing table per section). Reports cold render,
  warm renders, peak RSS, and pass/fail against the locked gates.

## Acceptance gates (locked decision 1)

| Gate | Threshold | Why |
|------|-----------|-----|
| Cold render | < 8 s | First request after a Render dyno cold-start |
| Warm render (max of 5) | < 3 s | Steady-state perceived performance |
| Peak RSS | < 450 MB | Render Starter is 512MB; headroom for spikes |
| PDF output | > 1 KB + `%PDF` magic | Sanity check the render produced real output |

If any gate fails on Render → STOP Phase 51, switch to Browserless.io,
update Phase 51 RFC and re-bench.

## Local bench results — Windows + system Chrome

These are NOT the production numbers — they're the dev-environment
sanity check that the pipeline works end-to-end before paying for
Render. Different binary (system Chrome v131 stable, not Sparticuz),
different OS (Windows 11, not Linux), different memory floor (8GB
laptop, not 512MB dyno). Treat them as upper-bound performance
indicators (real Render Linux + Sparticuz binary tends to be 1.3–1.8×
slower for cold start, similar for warm).

Command run:
```
PUPPETEER_EXECUTABLE_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe" \
  npx tsx scripts/bench-pdf-render.ts
```

| Metric | Value | Gate | Pass |
|--------|-------|------|------|
| Cold render | 2,627 ms | < 8,000 ms | ✓ |
| Warm render avg | 385 ms | — | ✓ |
| Warm render max | 405 ms | < 3,000 ms | ✓ |
| Peak RSS | 111.1 MB | < 450 MB | ✓ |
| PDF size | 138,196 bytes | > 1 KB | ✓ |

All 6 renders returned identical byte counts (the cold start
exclusively paid the Chromium launch overhead, not the render
itself).

**Local verdict: PASS on every gate by a wide margin** — cold render
is 33% of the threshold, warm is 14%, RSS is 25%. Even with a 2× Render
Linux penalty + Sparticuz binary overhead, projected production numbers
land at: cold ~5.3 s, warm ~810 ms, RSS ~220 MB. All still inside
gates.

## What needs the user

I cannot deploy to Render from this session. Three steps the user must
do before Phase 51 can advance from spike to production:

### 1. Create the throwaway Render service

- New service on Render dashboard, plan **Starter** ($7/mo).
- Connect to this repo, branch `phase-51-1-chromium-spike`.
- Build command: `pnpm install --frozen-lockfile && pnpm -F @ofoq/api build`
- Start command: `pnpm -F @ofoq/api start`
- Environment variables to set:
  - `SPIKE_ENABLED=true`
  - `USE_SPARTICUZ_CHROMIUM=true` (forces Sparticuz path on Render
    even though `RENDER=true` already triggers it — explicit is safer)
  - `DATABASE_URL=file:/tmp/spike.db` (ephemeral; not used by the
    spike route but the existing API boots require it)
  - `JWT_SECRET=anything-spike-only`
  - `CORS_ORIGIN=*`

### 2. Run the bench from the Render shell

Once the service is live:

```
USE_SPARTICUZ_CHROMIUM=true pnpm -F @ofoq/api exec tsx scripts/bench-pdf-render.ts
```

Capture the final JSON. Compare against the gates above.

### 3. Report the numbers

Paste the JSON `summary` + `gates` blocks back to me. Three outcomes:

- **All gates PASS** → I proceed with Phase 51.2 (Canva-grade CSS
  templates) against Sparticuz in-process, on the existing main API
  service plan-upgraded to Starter.
- **RSS or render-time fails by ≤ 20%** → I'll try one tuning pass
  (drop `--disable-extensions`, set `chromium.setHeadlessMode('shell')`,
  lower viewport to 1024×768). If that doesn't close the gap, switch
  to Browserless.
- **Anything fails by > 20%** → switch to Browserless.io fallback,
  rewrite Phase 51.2 spec accordingly, ship a thin HTTP-client
  service module instead of the Sparticuz singleton.

## Operational notes for future me

- **Pre-warm at boot.** `puppeteerBrowser.warmBrowser()` fires
  fire-and-forget after route registration. First user-facing render
  pays only the page.setContent + pdf cost, not the Chromium launch.
- **Graceful shutdown.** The spike route registers a Fastify `onClose`
  hook that calls `closeBrowser()`. Render's SIGTERM gives the API
  30s before kill — plenty of headroom.
- **Concurrency cap = 1.** Strict FIFO. Over-cap requests get 503 +
  `Retry-After: 5`. Phase 51.2 might want to bump this to 2 once
  Starter headroom is confirmed; that's a one-line change to
  `MAX_QUEUE_DEPTH`.
- **Recycle after 100 renders.** Chromium leaks ~1–2 MB per page via
  resource caches; recycling bounds steady-state RSS growth. Matches
  the AWS Lambda execution-context-reuse pattern Sparticuz documents.
- **Where the singleton state lives.** Module-level (`_browserPromise`,
  `_renderCount`, `_queueDepth`). Safe under the existing vitest
  `pool: 'forks'` config because each test file gets its own process,
  so cross-test state cannot leak. Skipped in `NODE_ENV=test` for the
  warm hook so vitest doesn't spawn a real Chromium on every test
  file.

## Out of scope for the spike

- No CSS templates yet — that's 51.2.
- No wiring into the export route — that's 51.3.
- No automated tests against Chromium — the bench script IS the
  validation artefact; vitest unit-testing a launched Chromium across
  fork boundaries would be flaky and slow without proving anything
  the bench doesn't already prove.
- No prod main-branch changes — the spike route is `SPIKE_ENABLED`-
  gated and the branch hasn't been merged.
