/**
 * Phase 51.1 — singleton Puppeteer browser for the htmlToPdf engine.
 *
 * Design (per the Phase 51 RFC):
 *   - One persistent Chromium instance, lazy-launched on first call.
 *   - Concurrency cap = 1 in-process (FIFO queue, max depth 5).
 *   - Auto-recycle after 100 renders to bound RSS growth.
 *   - Graceful shutdown via closeBrowser() — Fastify onClose hook.
 *
 * Browser binary:
 *   - Always uses @sparticuz/chromium's executablePath() resolved at
 *     RUNTIME (not via env vars or hardcoded paths). The first call
 *     extracts the bundled binary to a temp directory and returns its
 *     real path; subsequent calls inside the Sparticuz module cache
 *     it. An earlier revision hardcoded the temp path and ENOENT'd
 *     on Render — the binary lands in a different temp directory
 *     each cold boot, so we must resolve via executablePath() every
 *     time.
 *   - We use `puppeteer-core` (NOT `puppeteer`) so the API library
 *     never tries to download or use its own bundled Chromium —
 *     Sparticuz is always the source of truth.
 */

import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

let _browserPromise: Promise<Browser> | null = null;
let _renderCount = 0;
const RECYCLE_AFTER_N_RENDERS = 100;

/** Lock for the concurrency=1 cap. When held, renders queue behind. */
let _renderLock: Promise<void> = Promise.resolve();
let _queueDepth = 0;
const MAX_QUEUE_DEPTH = 5;

/**
 * Custom error thrown when the in-process render queue is saturated.
 * The route layer maps this to a 503 with Retry-After.
 */
export class RenderQueueFullError extends Error {
  constructor(currentDepth: number) {
    super(`Render queue full (depth=${currentDepth}/${MAX_QUEUE_DEPTH})`);
    this.name = 'RenderQueueFullError';
  }
}

/**
 * Lazy-launch + cache. Subsequent calls return the same promise so
 * concurrent first-callers don't spawn duplicate browsers.
 *
 * Launch options come straight from @sparticuz/chromium — args,
 * defaultViewport, executablePath (resolved at runtime), headless
 * mode. No env-var overrides; the binary is whatever Sparticuz says
 * it is at the moment of the call.
 */
async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
}

export async function getBrowser(): Promise<Browser> {
  if (_browserPromise) return _browserPromise;
  _browserPromise = launchBrowser();
  try {
    return await _browserPromise;
  } catch (err) {
    // Failed launch — clear the cache so a retry can try again.
    _browserPromise = null;
    throw err;
  }
}

/**
 * Run `fn` against a fresh Page from the singleton browser, then
 * close the page (NOT the browser) and recycle if we've hit
 * RECYCLE_AFTER_N_RENDERS.
 *
 * The concurrency cap is enforced here: every caller awaits the
 * shared `_renderLock` before running. Queue depth is tracked and
 * over-the-cap calls reject with RenderQueueFullError so the route
 * layer can respond with 503 + Retry-After instead of holding the
 * request open indefinitely.
 */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  if (_queueDepth >= MAX_QUEUE_DEPTH) {
    throw new RenderQueueFullError(_queueDepth);
  }
  _queueDepth++;
  const myTurn = _renderLock;
  let release: () => void = () => {};
  _renderLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await myTurn;
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      const result = await fn(page);
      _renderCount++;
      return result;
    } finally {
      // Close the page even if fn threw — leaking pages is the
      // documented Puppeteer memory leak.
      try {
        await page.close();
      } catch {
        // Best-effort.
      }
    }
  } finally {
    _queueDepth--;
    release();
    // Recycle after the lock is released so the next render's
    // browser.launch happens off the critical path.
    if (_renderCount >= RECYCLE_AFTER_N_RENDERS) {
      void recycleBrowser();
    }
  }
}

/**
 * Close the current browser and reset state so the next withPage()
 * launches fresh. Called automatically when the render counter
 * crosses RECYCLE_AFTER_N_RENDERS, OR explicitly by the Fastify
 * onClose hook on graceful shutdown.
 */
export async function closeBrowser(): Promise<void> {
  if (!_browserPromise) return;
  const promise = _browserPromise;
  _browserPromise = null;
  _renderCount = 0;
  try {
    const browser = await promise;
    await browser.close();
  } catch {
    // Best-effort — if the browser is already dead, the close throws.
  }
}

async function recycleBrowser(): Promise<void> {
  await closeBrowser();
  // The next withPage() call will lazy-launch a fresh instance.
}

/**
 * Pre-warm the browser at boot so the first user-facing render
 * doesn't pay the ~1.5s launch cost. Fire-and-forget — failures
 * here are logged but never abort startup.
 *
 * Skipped in NODE_ENV=test to keep the vitest fork pool fast.
 */
export async function warmBrowser(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  try {
    await getBrowser();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[puppeteerBrowser] warm failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Diagnostic-only view of the singleton state. The spike's bench
 * script reads this between renders to track RSS / queue depth /
 * recycle behaviour.
 */
export function browserDiagnostics(): {
  isLaunched: boolean;
  renderCount: number;
  queueDepth: number;
  recycleThreshold: number;
} {
  return {
    isLaunched: _browserPromise !== null,
    renderCount: _renderCount,
    queueDepth: _queueDepth,
    recycleThreshold: RECYCLE_AFTER_N_RENDERS,
  };
}
