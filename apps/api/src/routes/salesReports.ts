/**
 * Phase 46.7 — Sales performance report routes.
 *
 *   GET /sales/reports/funnel
 *   GET /sales/reports/leaderboard
 *   GET /sales/reports/loss-reasons
 *   GET /sales/reports/time-to-close
 *
 * All four are restricted to APP_ADMIN + SALES_MANAGER. SALES_REP
 * users get 403 — they see their own pipeline already; the reports
 * are aggregated views meant for management.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';
import {
  pipelineFunnel,
  salesRepLeaderboard,
  lossReasonBreakdown,
  timeToCloseDistribution,
  type PipelineRow,
} from '../services/salesReports.js';

const REPORT_VIEWER_ROLES = new Set(['APP_ADMIN', 'SALES_MANAGER']);

async function requireReportViewer(userId: string): Promise<boolean> {
  const firmRoles = await db.listFirmRolesForUser(userId);
  return firmRoles.some((r) => REPORT_VIEWER_ROLES.has(r));
}

async function loadPipelineRows(firmId: string): Promise<PipelineRow[]> {
  const r = await db.getDb().execute({
    sql: `SELECT status, estimatedValue, createdAt, wonAt, lostAt, salesCycleDays, salesRepUserId
          FROM Engagement
          WHERE firmId = ?`,
    args: [firmId],
  });
  return r.rows.map((row) => {
    const r2 = row as unknown as {
      status: string;
      estimatedValue: number | null;
      createdAt: string;
      wonAt: string | null;
      lostAt: string | null;
      salesCycleDays: number | null;
      salesRepUserId: string | null;
    };
    return {
      status: r2.status,
      estimatedValue: r2.estimatedValue === null || r2.estimatedValue === undefined
        ? null
        : Number(r2.estimatedValue),
      createdAt: r2.createdAt,
      wonAt: r2.wonAt ?? null,
      lostAt: r2.lostAt ?? null,
      salesCycleDays: r2.salesCycleDays === null || r2.salesCycleDays === undefined
        ? null
        : Number(r2.salesCycleDays),
      salesRepUserId: r2.salesRepUserId ?? null,
    };
  });
}

export async function salesReportsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/sales/reports/funnel', async (request, reply) => {
    if (!(await requireReportViewer(request.jwtUser.userId))) {
      return reply.code(403).send({
        error: { code: 'NOT_A_REPORT_VIEWER', message: 'Sales reports are restricted to APP_ADMIN + SALES_MANAGER.' },
      });
    }
    const rows = await loadPipelineRows(request.jwtUser.firmId);
    return reply.send({ data: pipelineFunnel(rows) });
  });

  fastify.get('/sales/reports/leaderboard', async (request, reply) => {
    if (!(await requireReportViewer(request.jwtUser.userId))) {
      return reply.code(403).send({
        error: { code: 'NOT_A_REPORT_VIEWER', message: 'Sales reports are restricted to APP_ADMIN + SALES_MANAGER.' },
      });
    }
    const rows = await loadPipelineRows(request.jwtUser.firmId);
    return reply.send({ data: salesRepLeaderboard(rows) });
  });

  fastify.get('/sales/reports/loss-reasons', async (request, reply) => {
    if (!(await requireReportViewer(request.jwtUser.userId))) {
      return reply.code(403).send({
        error: { code: 'NOT_A_REPORT_VIEWER', message: 'Sales reports are restricted to APP_ADMIN + SALES_MANAGER.' },
      });
    }
    const losses = await db.listLossDetailsByFirm(request.jwtUser.firmId);
    return reply.send({
      data: {
        breakdown: lossReasonBreakdown(losses),
        recentLosses: losses.slice(0, 20),
      },
    });
  });

  fastify.get('/sales/reports/time-to-close', async (request, reply) => {
    if (!(await requireReportViewer(request.jwtUser.userId))) {
      return reply.code(403).send({
        error: { code: 'NOT_A_REPORT_VIEWER', message: 'Sales reports are restricted to APP_ADMIN + SALES_MANAGER.' },
      });
    }
    const rows = await loadPipelineRows(request.jwtUser.firmId);
    return reply.send({ data: timeToCloseDistribution(rows) });
  });

  // Phase 46.8.7 — generate the SALES_PERFORMANCE_REPORT PDF. The
  // route renders the PDF synchronously and streams the bytes back so
  // the operator gets an immediate download — no background job
  // needed because the data sources are firm-wide aggregates and
  // pdfkit completes in well under the request timeout.
  fastify.post('/sales/reports/export-pdf', async (request, reply) => {
    if (!(await requireReportViewer(request.jwtUser.userId))) {
      return reply.code(403).send({
        error: { code: 'NOT_A_REPORT_VIEWER', message: 'Sales reports are restricted to APP_ADMIN + SALES_MANAGER.' },
      });
    }
    const rows = await loadPipelineRows(request.jwtUser.firmId);
    const losses = await db.listLossDetailsByFirm(request.jwtUser.firmId);
    const firm = await db.findFirmById(request.jwtUser.firmId);
    const firmName =
      ((firm as { name?: string } | null)?.name ?? 'Your firm');

    // Hydrate sales-rep names so the leaderboard isn't full of cuids.
    const repIds = Array.from(
      new Set(rows.map((r) => r.salesRepUserId).filter((v): v is string => !!v)),
    );
    const nameByUserId = new Map<string, string>();
    if (repIds.length > 0) {
      const placeholders = repIds.map(() => '?').join(',');
      const usersR = await db.getDb().execute({
        sql: `SELECT id, name FROM User WHERE id IN (${placeholders})`,
        args: repIds,
      });
      for (const u of usersR.rows) {
        const r2 = u as unknown as { id: string; name: string | null };
        if (r2.name) nameByUserId.set(r2.id, r2.name);
      }
    }
    const leaderboardRaw = salesRepLeaderboard(rows);
    const leaderboard = leaderboardRaw.map((r) => ({
      ...r,
      salesRepName: nameByUserId.get(r.salesRepUserId),
    }));

    const periodEndDate = new Date().toISOString().slice(0, 10);
    const periodLabel = (() => {
      const d = new Date(periodEndDate);
      const month = d.toLocaleString('en-GB', { month: 'long' });
      return `${month} ${d.getFullYear()}`;
    })();

    const { generateSalesPerformanceReportPdf } = await import(
      '../services/generators/salesPerformanceReportGenerator.js'
    );
    const breakdown = lossReasonBreakdown(losses);
    const pdf = await generateSalesPerformanceReportPdf({
      firmName,
      periodEndDate,
      periodLabel,
      funnel: pipelineFunnel(rows),
      leaderboard,
      lossReasons: {
        total: breakdown.total,
        byReason: breakdown.byReason,
        recentLosses: losses.slice(0, 8).map((l) => ({
          clientName: l.clientName,
          lossReason: l.lossReason,
          competitorName: l.competitorName,
          estimatedValue: l.estimatedValue,
          lostAt: l.lostAt,
        })),
      },
      timeToClose: timeToCloseDistribution(rows),
    });

    const filename = `Sales_Performance_${periodLabel.replace(/\s+/g, '_')}.pdf`;
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(pdf);
  });
}
