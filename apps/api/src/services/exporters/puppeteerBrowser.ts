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
 *   - Production (Render Alpine container): the Dockerfile apk-installs
 *     `chromium` and sets `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`.
 *     We launch puppeteer-core against that path. The distro Chromium
 *     is built against musl libc and runs natively under Alpine — no
 *     glibc shim required.
 *   - Local dev: set PUPPETEER_EXECUTABLE_PATH to a system Chrome path
 *     (e.g. `/c/Program Files/Google/Chrome/Application/chrome.exe` on
 *     Windows or `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
 *     on macOS). puppeteer-core does NOT bundle its own Chromium —
 *     that's the whole point of using the `-core` variant.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';

let _browserPromise: Promise<Browser> | null = null;
let _renderCount = 0;
const RECYCLE_AFTER_N_RENDERS = 100;

/** Lock for the concurrency=1 cap. When held, renders queue behind. */
let _renderLock: Promise<void> = Promise.resolve();
let _queueDepth = 0;
const MAX_QUEUE_DEPTH = 5;

/**
 * Alpine + Render Starter (512MB) flag set. The full list of flags
 * is what Sparticuz documented for low-memory containers, minus the
 * Sparticuz-specific font/cache flags we no longer need with the
 * distro binary. `--no-sandbox` is required under Alpine because the
 * sandbox needs CAP_SYS_ADMIN which Render dynos don't expose.
 */
const ALPINE_LAUNCH_ARGS: ReadonlyArray<string> = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--single-process',
  '--no-zygote',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
];

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
 */
async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!executablePath) {
    throw new Error(
      'PUPPETEER_EXECUTABLE_PATH is not set. ' +
        'In production the Dockerfile must apk-install chromium and set this env var to /usr/bin/chromium-browser. ' +
        'For local dev point it at a system Chrome/Chromium binary.',
    );
  }
  return puppeteer.launch({
    headless: true,
    executablePath,
    args: [...ALPINE_LAUNCH_ARGS],
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
