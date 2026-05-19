/**
 * Phase 52.6 — Reports routes (five dashboards).
 *
 *   GET /api/v1/reports/pipeline       — pre-Won funnel + conversion
 *   GET /api/v1/reports/delivery       — active implementations
 *   GET /api/v1/reports/health         — managed-portfolio health
 *   GET /api/v1/reports/renewals       — 90-day exposure
 *   GET /api/v1/reports/utilization    — per-owner workload
 *
 * All firm-scoped via `request.jwtUser.firmId`. Auth via existing
 * middleware.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import {
  buildDeliveryReport,
  buildHealthReport,
  buildPipelineReport,
  buildRenewalsReport,
  buildUtilizationReport,
} from '../services/reports/buildReports.js';

export async function reportsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/reports/pipeline', async (request, reply) => {
    const result = await buildPipelineReport(request.jwtUser.firmId);
    return reply.send(result);
  });

  fastify.get('/reports/delivery', async (request, reply) => {
    const result = await buildDeliveryReport(request.jwtUser.firmId);
    return reply.send(result);
  });

  fastify.get('/reports/health', async (request, reply) => {
    const result = await buildHealthReport(request.jwtUser.firmId);
    return reply.send(result);
  });

  fastify.get('/reports/renewals', async (request, reply) => {
    const result = await buildRenewalsReport(request.jwtUser.firmId);
    return reply.send(result);
  });

  fastify.get('/reports/utilization', async (request, reply) => {
    const result = await buildUtilizationReport(request.jwtUser.firmId);
    return reply.send(result);
  });
}
