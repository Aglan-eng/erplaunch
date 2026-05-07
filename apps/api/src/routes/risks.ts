import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';

export async function riskRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements/:id/risks — Phase 43.2: READ-gated.
  fastify.get('/engagements/:id/risks', { preHandler: requirePermission('READ', 'RISKS') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const risks = await db.listRisks(id);
    return reply.send({ data: risks });
  });

  // POST /engagements/:id/risks — WRITE-gated.
  fastify.post('/engagements/:id/risks', { preHandler: requirePermission('WRITE', 'RISKS') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as {
      title: string;
      description?: string;
      probability?: string;
      impact?: string;
      owner?: string;
      mitigation?: string;
    };

    if (!body.title) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'title is required' } });
    }

    const risk = await db.createRisk(id, body);
    // Phase 38.1 — renamed from RISK_CREATED to RISK_ADDED to match the
    // PO-facing action vocabulary documented on the dashboard.
    await db.logActivity(id, request.jwtUser.firmId, 'RISK_ADDED', `Added risk: ${body.title}`);
    return reply.code(201).send({ data: risk });
  });

  // PATCH /engagements/:id/risks/:riskId
  fastify.patch('/engagements/:id/risks/:riskId', { preHandler: requirePermission('WRITE', 'RISKS') }, async (request, reply) => {
    const { id, riskId } = request.params as { id: string; riskId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const existing = await db.listRisks(id);
    const risk = existing.find((r) => (r as Record<string, unknown>).id === riskId);
    if (!risk) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as Record<string, unknown>;
    const updated = await db.updateRisk(riskId, body);
    await db.logActivity(id, request.jwtUser.firmId, 'RISK_UPDATED', `Updated risk: ${(risk as Record<string, unknown>).title}`);
    return reply.send({ data: updated });
  });

  // DELETE /engagements/:id/risks/:riskId
  fastify.delete('/engagements/:id/risks/:riskId', { preHandler: requirePermission('WRITE', 'RISKS') }, async (request, reply) => {
    const { id, riskId } = request.params as { id: string; riskId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const existing = await db.listRisks(id);
    const risk = existing.find((r) => (r as Record<string, unknown>).id === riskId);
    if (!risk) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    await db.deleteRisk(riskId);
    await db.logActivity(id, request.jwtUser.firmId, 'RISK_DELETED', `Deleted risk: ${(risk as Record<string, unknown>).title}`);
    return reply.send({ data: { success: true } });
  });
}
