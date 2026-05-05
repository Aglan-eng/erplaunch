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
    // Phase 38.1 — renamed from DECISION_CREATED to DECISION_LOGGED.
    await db.logActivity(id, request.jwtUser.firmId, 'DECISION_LOGGED', `Logged decision: ${body.title}`);
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

  // Phase 36 — POST /engagements/:id/decisions/:decisionId/request-signoff
  //
  // Flip clientSignoffStatus from NONE → PENDING so the decision surfaces in
  // the client portal under PortalDecisionSignoffs. The actual sign / decline
  // path runs through pendingSubmissions (Phase 32 acceptor); this endpoint
  // is just the consultant-side trigger that opens the request.
  //
  // Strict state machine: only NONE → PENDING is allowed. Re-requesting a
  // PENDING (or any other state) returns 409 to keep the audit trail clean
  // and make the consultant aware they're operating on an in-flight or
  // completed sign-off.
  fastify.post('/engagements/:id/decisions/:decisionId/request-signoff', async (request, reply) => {
    const { id, decisionId } = request.params as { id: string; decisionId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const decision = await db.findDecisionById(decisionId);
    if (!decision) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    // Defense-in-depth: even if the decisionId is real, refuse if it
    // doesn't belong to this engagement.
    if ((decision as Record<string, unknown>).engagementId !== id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }

    const currentStatus = ((decision as Record<string, unknown>).clientSignoffStatus as string | undefined) ?? 'NONE';
    if (currentStatus !== 'NONE') {
      return reply.code(409).send({
        error: {
          code: 'INVALID_TRANSITION',
          message: `Cannot request sign-off — decision is already ${currentStatus.toLowerCase()}`,
        },
      });
    }

    const updated = await db.updateDecisionSignoff(decisionId, {
      clientSignoffStatus: 'PENDING',
      clientSignoffAt: null,
      clientSignoffComment: null,
      clientSignoffMemberId: null,
      clientSignoffSourceSubmissionId: null,
    });

    const title = (decision as Record<string, unknown>).title as string;
    await db.logActivity(
      id,
      request.jwtUser.firmId,
      'DECISION_SIGNOFF_REQUESTED',
      `Requested client sign-off on decision: ${title}`,
    );

    return reply.send({ data: updated });
  });
}
