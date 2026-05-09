/**
 * Phase 46.8.7 — Sales performance report PDF generator.
 *
 * Renders a multi-page PDF version of the four /sales/reports/*
 * endpoints. Triggered from the /sales/reports page's "Export PDF"
 * button. Real pdfkit output (no Chromium dependency).
 *
 * Pages:
 *   1. Cover (firm name, period, generated date, three KPIs)
 *   2. Funnel (table form: stage, count, total estimated value)
 *   3. Leaderboard (per-rep deals/revenue/win rate)
 *   4. Loss reasons (count + percentage + value per reason; top recent losses)
 *   5. Time-to-close (median + p90 + histogram bars)
 *
 * Two exports — one pure helper for tests + the pdfkit-bound
 * generator. Same split pattern as Phase 46.4's SOW generator.
 */

export interface SalesPerformanceReportInput {
  firmName: string;
  /** ISO date — anchors "Period ending <date>" + filename. */
  periodEndDate: string;
  /** Human-readable period label (e.g. "Q2 2026" or "May 2026"). */
  periodLabel: string;

  funnel: {
    stages: ReadonlyArray<{ stage: string; count: number; totalEstimatedValue: number }>;
    totalWon: number;
    totalLost: number;
    winRate: number;
  };

  leaderboard: ReadonlyArray<{
    salesRepUserId: string;
    salesRepName?: string;
    dealsWon: number;
    dealsLost: number;
    revenueClosed: number;
    avgDealSize: number;
    winRate: number;
    medianSalesCycleDays: number | null;
  }>;

  lossReasons: {
    total: number;
    byReason: Record<string, { count: number; pct: number; totalEstimatedValue: number }>;
    recentLosses: ReadonlyArray<{
      clientName: string;
      lossReason: string;
      competitorName: string | null;
      estimatedValue: number | null;
      lostAt: string | null;
    }>;
  };

  timeToClose: {
    median: number | null;
    p90: number | null;
    histogram: ReadonlyArray<{ bucket: string; count: number }>;
  };
}

const STAGE_LABELS: Record<string, string> = {
  PROSPECT: 'Prospect',
  PROPOSED: 'Proposal',
  CONTRACTED: 'Contracted',
  WON: 'Won',
  LOST: 'Lost',
};

const LOSS_REASON_LABELS: Record<string, string> = {
  PRICE: 'Price',
  TIMING: 'Timing',
  NO_DECISION: 'No decision',
  LOST_TO_COMPETITOR: 'Lost to competitor',
  INTERNAL_BUILD: 'Built in-house',
  OTHER: 'Other',
};

function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Pure helper — derives the three headline KPIs from the raw inputs.
 * Exported so the cover-page section can be tested without rendering
 * a PDF.
 */
export interface SalesPerformanceKpis {
  winRatePct: number;
  totalRevenueClosed: number;
  dealsClosed: number;
}

export function computeSalesPerformanceKpis(
  input: SalesPerformanceReportInput,
): SalesPerformanceKpis {
  const winRatePct = Math.round(input.funnel.winRate * 100);
  const totalRevenueClosed = input.leaderboard.reduce(
    (sum, r) => sum + (r.revenueClosed ?? 0),
    0,
  );
  const dealsClosed = input.funnel.totalWon + input.funnel.totalLost;
  return { winRatePct, totalRevenueClosed, dealsClosed };
}

/**
 * Render the report as a PDF buffer. Lazy-imports pdfkit so unrelated
 * generators don't pay the load cost.
 */
export async function generateSalesPerformanceReportPdf(
  input: SalesPerformanceReportInput,
): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  const kpis = computeSalesPerformanceKpis(input);

  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 60 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Cover ────────────────────────────────────────────────────────
      doc.fontSize(11).font('Helvetica').fillColor('#666');
      doc.text(input.firmName);
      doc.moveDown(0.3);
      doc.fontSize(28).font('Helvetica-Bold').fillColor('#111');
      doc.text('Sales Performance Report');
      doc.moveDown(0.3);
      doc.fontSize(13).font('Helvetica').fillColor('#444');
      doc.text(`${input.periodLabel} · period ending ${input.periodEndDate}`);
      doc.moveDown(2);
      // KPI tiles — three side-by-side boxes.
      const tileY = doc.y;
      const tileH = 80;
      const tileW = (612 - 60 * 2 - 16) / 3;
      const tile = (x: number, label: string, value: string, sub?: string) => {
        doc.rect(x, tileY, tileW, tileH).fill('#f3f4f6').fillColor('#111');
        doc.fontSize(10).font('Helvetica').fillColor('#666');
        doc.text(label, x + 12, tileY + 12, { width: tileW - 24 });
        doc.fontSize(22).font('Helvetica-Bold').fillColor('#111');
        doc.text(value, x + 12, tileY + 28, { width: tileW - 24 });
        if (sub) {
          doc.fontSize(9).font('Helvetica').fillColor('#888');
          doc.text(sub, x + 12, tileY + 56, { width: tileW - 24 });
        }
      };
      tile(60, 'Win rate', `${kpis.winRatePct}%`, `${input.funnel.totalWon} won · ${input.funnel.totalLost} lost`);
      tile(60 + tileW + 8, 'Revenue closed', dollars(kpis.totalRevenueClosed));
      tile(60 + (tileW + 8) * 2, 'Deals closed', String(kpis.dealsClosed));
      doc.y = tileY + tileH + 16;
      // Executive summary paragraph.
      doc.fontSize(11).font('Helvetica').fillColor('#222');
      const summary = composeExecutiveSummary(input, kpis);
      doc.text(summary, 60, doc.y, { lineGap: 3 });

      // ── Funnel ───────────────────────────────────────────────────────
      doc.addPage();
      sectionHeading(doc, '1. Pipeline funnel');
      tableHeader(doc, ['Stage', 'Count', 'Total estimated value']);
      for (const s of input.funnel.stages) {
        tableRow(doc, [
          STAGE_LABELS[s.stage] ?? s.stage,
          String(s.count),
          dollars(s.totalEstimatedValue),
        ]);
      }
      doc.moveDown(1);
      doc.fontSize(10).font('Helvetica').fillColor('#666');
      doc.text(
        `Win rate over closed deals: ${kpis.winRatePct}% (${input.funnel.totalWon} of ${kpis.dealsClosed}).`,
      );

      // ── Leaderboard ──────────────────────────────────────────────────
      doc.addPage();
      sectionHeading(doc, '2. Sales rep leaderboard');
      if (input.leaderboard.length === 0) {
        doc.fontSize(11).font('Helvetica').fillColor('#777');
        doc.text('No closed deals attributable to a sales rep this period.');
      } else {
        tableHeader(doc, ['Rep', 'Won', 'Lost', 'Revenue', 'Avg deal', 'Win rate']);
        for (const r of input.leaderboard) {
          tableRow(doc, [
            (r.salesRepName ?? r.salesRepUserId).slice(0, 24),
            String(r.dealsWon),
            String(r.dealsLost),
            dollars(r.revenueClosed),
            r.dealsWon === 0 ? '—' : dollars(r.avgDealSize),
            `${Math.round(r.winRate * 100)}%`,
          ]);
        }
      }

      // ── Loss reasons ─────────────────────────────────────────────────
      doc.addPage();
      sectionHeading(doc, '3. Loss reasons');
      if (input.lossReasons.total === 0) {
        doc.fontSize(11).font('Helvetica').fillColor('#777');
        doc.text('No losses recorded this period.');
      } else {
        tableHeader(doc, ['Reason', 'Count', '%', 'Pipeline lost']);
        for (const [reason, b] of Object.entries(input.lossReasons.byReason)) {
          tableRow(doc, [
            LOSS_REASON_LABELS[reason] ?? reason,
            String(b.count),
            `${Math.round(b.pct * 100)}%`,
            dollars(b.totalEstimatedValue),
          ]);
        }
        if (input.lossReasons.recentLosses.length > 0) {
          doc.moveDown(1);
          doc.fontSize(11).font('Helvetica-Bold').fillColor('#111');
          doc.text('Recent losses');
          doc.moveDown(0.5);
          tableHeader(doc, ['Client', 'Reason', 'Competitor', 'Value']);
          for (const l of input.lossReasons.recentLosses.slice(0, 8)) {
            tableRow(doc, [
              l.clientName,
              LOSS_REASON_LABELS[l.lossReason] ?? l.lossReason,
              l.competitorName ?? '—',
              l.estimatedValue ? dollars(l.estimatedValue) : '—',
            ]);
          }
        }
      }

      // ── Time to close ────────────────────────────────────────────────
      doc.addPage();
      sectionHeading(doc, '4. Time to close');
      doc.fontSize(11).font('Helvetica').fillColor('#222');
      const median = input.timeToClose.median ?? '—';
      const p90 = input.timeToClose.p90 ?? '—';
      doc.text(`Median sales cycle: ${median}${input.timeToClose.median !== null ? ' days' : ''}`);
      doc.text(`p90 sales cycle: ${p90}${input.timeToClose.p90 !== null ? ' days' : ''}`);
      doc.moveDown(0.5);
      // Histogram as bars (text-based; pdfkit shapes feel heavyweight
      // for a simple distribution chart in this report).
      const maxCount = Math.max(1, ...input.timeToClose.histogram.map((h) => h.count));
      for (const h of input.timeToClose.histogram) {
        const barW = 200 * (h.count / maxCount);
        const startY = doc.y;
        doc.fontSize(10).font('Helvetica').fillColor('#444');
        doc.text(h.bucket, 60, startY, { continued: false });
        doc.rect(140, startY + 1, Math.max(2, barW), 12).fill('#6366f1');
        doc.fillColor('#111');
        doc.fontSize(10).text(String(h.count), 360, startY);
        doc.y = startY + 18;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Pure helpers + table primitives ────────────────────────────────────────

function composeExecutiveSummary(
  input: SalesPerformanceReportInput,
  kpis: SalesPerformanceKpis,
): string {
  const lines: string[] = [];
  lines.push(
    `In ${input.periodLabel}, your team closed ${kpis.dealsClosed} ${
      kpis.dealsClosed === 1 ? 'deal' : 'deals'
    } at a ${kpis.winRatePct}% win rate, totalling ${dollars(kpis.totalRevenueClosed)} in closed revenue.`,
  );
  if (input.lossReasons.total > 0) {
    const topReason = Object.entries(input.lossReasons.byReason).sort(
      (a, b) => b[1].count - a[1].count,
    )[0];
    if (topReason) {
      lines.push(
        ` The most common loss reason was ${
          LOSS_REASON_LABELS[topReason[0]] ?? topReason[0]
        } (${topReason[1].count} of ${input.lossReasons.total}).`,
      );
    }
  }
  if (input.timeToClose.median !== null) {
    lines.push(
      ` Median sales cycle landed at ${input.timeToClose.median} days; p90 was ${input.timeToClose.p90 ?? '—'} days.`,
    );
  }
  return lines.join('');
}

interface PdfDoc {
  fontSize: (n: number) => PdfDoc;
  font: (name: string) => PdfDoc;
  fillColor: (c: string) => PdfDoc;
  text: (s: string, x?: number, y?: number, opts?: object) => PdfDoc;
  moveDown: (n?: number) => PdfDoc;
  rect: (x: number, y: number, w: number, h: number) => { fill: (c: string) => PdfDoc };
  y: number;
}

function sectionHeading(doc: PdfDoc, title: string): void {
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#111').text(title);
  doc.moveDown(0.4);
}

function tableHeader(doc: PdfDoc, cols: string[]): void {
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#666');
  const colWidth = (612 - 60 * 2) / cols.length;
  let x = 60;
  const startY = doc.y;
  for (const c of cols) {
    doc.text(c, x, startY, { width: colWidth });
    x += colWidth;
  }
  doc.y = startY + 14;
  doc.fillColor('#222').font('Helvetica');
}

function tableRow(doc: PdfDoc, cols: string[]): void {
  doc.fontSize(10).font('Helvetica').fillColor('#222');
  const colWidth = (612 - 60 * 2) / cols.length;
  let x = 60;
  const startY = doc.y;
  for (const c of cols) {
    doc.text(c, x, startY, { width: colWidth });
    x += colWidth;
  }
  doc.y = startY + 16;
}
