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
}
