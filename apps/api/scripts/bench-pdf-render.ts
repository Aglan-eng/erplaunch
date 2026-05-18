/**
 * Phase 51.1 — local bench for the Chromium-on-Render spike.
 *
 * Runs 6 sequential PDF renders of a 10-page fixture and reports:
 *   - cold render time (first render, includes browser launch)
 *   - warm render times (subsequent 5)
 *   - process RSS after each render
 *   - PDF byte size to confirm output is real
 *
 * Acceptance gates from the locked Phase 51 decisions:
 *   - cold render < 8s
 *   - warm renders < 3s
 *   - RSS at concurrency=1 < 450MB
 *
 * Output: JSON to stdout + a human-readable summary to stderr.
 *
 * Run with:
 *   pnpm --filter @ofoq/api exec tsx scripts/bench-pdf-render.ts
 *
 * Requires PUPPETEER_EXECUTABLE_PATH to point at a Chromium binary.
 * On Render the Dockerfile sets this to /usr/bin/chromium-browser.
 * For local dev export PUPPETEER_EXECUTABLE_PATH to a system Chrome
 * before invoking. The Phase 51.1 spike docs/chromium-on-render-spike.md
 * tracks both environments' numbers side by side.
 */

import { htmlToPdf } from '../src/services/exporters/htmlToPdf.js';
import {
  closeBrowser,
  browserDiagnostics,
} from '../src/services/exporters/puppeteerBrowser.js';

interface RenderSample {
  index: number;
  isCold: boolean;
  durationMs: number;
  pdfBytes: number;
  rssMbAfter: number;
}

const TEN_PAGE_HTML = buildTenPageFixture();

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
}

function log(line: string): void {
  // eslint-disable-next-line no-console
  console.error(`[bench-pdf] ${line}`);
}

function buildTenPageFixture(): string {
  const sections = Array.from({ length: 10 }, (_, i) => `
    <section style="page-break-after: always; padding: 40px;">
      <h1 style="color: #0A1A2F; font-size: 28pt; margin-bottom: 16px;">
        Section ${i + 1} — Sample
      </h1>
      <p style="font-size: 11pt; line-height: 1.6; margin-bottom: 12px;">
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
        eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim
        ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut
        aliquip ex ea commodo consequat. Duis aute irure dolor in
        reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
        pariatur.
      </p>
      <ul style="font-size: 11pt; line-height: 1.6;">
        <li>Excepteur sint occaecat cupidatat non proident.</li>
        <li>Sunt in culpa qui officia deserunt mollit anim id est laborum.</li>
        <li>At vero eos et accusamus et iusto odio dignissimos.</li>
      </ul>
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 10pt;">
        <thead>
          <tr style="background: #1FAE5C; color: white;">
            <th style="padding: 8px; text-align: left;">SKU</th>
            <th style="padding: 8px; text-align: left;">Description</th>
            <th style="padding: 8px; text-align: right;">Annual</th>
          </tr>
        </thead>
        <tbody>
          ${Array.from({ length: 5 }, (_, j) => `
            <tr style="background: ${j % 2 === 0 ? '#FFFFFF' : '#F8F9FA'};">
              <td style="padding: 8px;">SKU-${i + 1}-${j + 1}</td>
              <td style="padding: 8px;">Sample line item ${j + 1}</td>
              <td style="padding: 8px; text-align: right;">$${(1000 * (j + 1)).toLocaleString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  `).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bench fixture</title></head><body style="margin:0;font-family:-apple-system,'Segoe UI',sans-serif;">${sections}</body></html>`;
}

async function runBench(): Promise<void> {
  const samples: RenderSample[] = [];
  log(`starting bench — ${TEN_PAGE_HTML.length} bytes of HTML, 6 sequential renders`);
  log(`environment: PUPPETEER_EXECUTABLE_PATH=${process.env.PUPPETEER_EXECUTABLE_PATH ?? '(unset)'} RENDER=${process.env.RENDER ?? '(unset)'} NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`);
  log(`process.platform=${process.platform} arch=${process.arch}`);
  log(`initial RSS: ${rssMb()} MB`);

  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    const pdf = await htmlToPdf(TEN_PAGE_HTML, { waitUntil: 'domcontentloaded' });
    const durationMs = Date.now() - t0;
    const sample: RenderSample = {
      index: i + 1,
      isCold: i === 0,
      durationMs,
      pdfBytes: pdf.byteLength,
      rssMbAfter: rssMb(),
    };
    samples.push(sample);
    log(`render #${sample.index} ${sample.isCold ? '(cold)' : '(warm)'}: ${sample.durationMs}ms, ${sample.pdfBytes} bytes, RSS=${sample.rssMbAfter} MB`);
    const diag = browserDiagnostics();
    log(`  diagnostics: ${JSON.stringify(diag)}`);
  }

  await closeBrowser();

  const cold = samples[0]!;
  const warm = samples.slice(1);
  const warmAvg = Math.round(warm.reduce((acc, s) => acc + s.durationMs, 0) / warm.length);
  const warmMax = Math.max(...warm.map((s) => s.durationMs));
  const peakRss = Math.max(...samples.map((s) => s.rssMbAfter));

  const result = {
    environment: {
      platform: process.platform,
      arch: process.arch,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? null,
      onRender: Boolean(process.env.RENDER),
      nodeVersion: process.version,
    },
    samples,
    summary: {
      coldRenderMs: cold.durationMs,
      warmRenderAvgMs: warmAvg,
      warmRenderMaxMs: warmMax,
      peakRssMb: peakRss,
      pdfBytesFirst: cold.pdfBytes,
    },
    gates: {
      coldUnder8s: cold.durationMs < 8000,
      warmUnder3s: warmMax < 3000,
      rssUnder450Mb: peakRss < 450,
      allPass:
        cold.durationMs < 8000 && warmMax < 3000 && peakRss < 450 && cold.pdfBytes > 1024,
    },
  };

  log('');
  log('═══════════════════════════════════════════════════════════');
  log(`SUMMARY: cold=${cold.durationMs}ms warmAvg=${warmAvg}ms warmMax=${warmMax}ms peakRss=${peakRss}MB`);
  log(`GATES:   coldUnder8s=${result.gates.coldUnder8s} warmUnder3s=${result.gates.warmUnder3s} rssUnder450Mb=${result.gates.rssUnder450Mb}`);
  log(`DECISION: ${result.gates.allPass ? 'PASS — proceed with Sparticuz on Render Starter' : 'FAIL — switch to Browserless.io fallback'}`);
  log('═══════════════════════════════════════════════════════════');

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

runBench().catch((err) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) log(err.stack);
  process.exit(1);
});
