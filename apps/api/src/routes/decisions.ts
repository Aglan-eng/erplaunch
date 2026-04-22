import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';

export async function decisionRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements/:id/decisions
  fastify.get('/engagements/:id/decisions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const decisions = await db.listDecisions(id);
    return reply.send({ data: decisions });
  });

  // POST /engagements/:id/decisions
  fastify.post('/engagements/:id/decisions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as {
      title: string;
      description?: string;
      decidedBy?: string;
      decidedAt?: string;
      rationale?: string;
    };

    if (!body.title) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'title is required' } });
    }

    const decision = await db.createDecision(id, body);
    await db.logActivity(id, request.jwtUser.firmId, 'DECISION_CREATED', `Created decision: ${body.title}`);
    return reply.code(201).send({ data: decision });
  });

  // PATCH /engagements/:id/decisions/:decisionId
  fastify.patch('/engagements/:id/decisions/:decisionId', async (request, reply) => {
    const { id, decisionId } = request.params as { id: string; decisionId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const existing = await db.listDecisions(id);
    const decision = existing.find((d) => (d as Record<string, unknown>).id === decisionId);
    if (!decision) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as Record<string, unknown>;
    const updated = await db.updateDecision(decisionId, body);
    await db.logActivity(id, request.jwtUser.firmId, 'DECISION_UPDATED', `Updated decision: ${(decision as Record<string, unknown>).title}`);
    return reply.send({ data: updated });
  });

  // DELETE /engagements/:id/decisions/:decisionId
  fastify.delete('/engagements/:id/decisions/:decisionId', async (request, reply) => {
    const { id, decisionId } = request.params as { id: string; decisionId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const existing = await db.listDecisions(id);
    const decision = existing.find((d) => (d as Record<string, unknown>).id === decisionId);
    if (!decision) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    await db.deleteDecision(decisionId);
    await db.logActivity(id, request.jwtUser.firmId, 'DECISION_DELETED', `Deleted decision: ${(decision as Record<string, unknown>).title}`);
    return reply.send({ data: { success: true } });
  });
}
