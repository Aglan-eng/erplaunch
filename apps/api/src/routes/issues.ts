import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';

export async function issueRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements/:id/issues
  fastify.get('/engagements/:id/issues', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const issues = await db.listIssues(id);
    return reply.send({ data: issues });
  });

  // POST /engagements/:id/issues
  fastify.post('/engagements/:id/issues', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as {
      title: string;
      description?: string;
      priority?: string;
      owner?: string;
    };

    if (!body.title) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'title is required' } });
    }

    const issue = await db.createIssue(id, body);
    await db.logActivity(id, request.jwtUser.firmId, 'ISSUE_CREATED', `Created issue: ${body.title}`);
    return reply.code(201).send({ data: issue });
  });

  // PATCH /engagements/:id/issues/:issueId
  fastify.patch('/engagements/:id/issues/:issueId', async (request, reply) => {
    const { id, issueId } = request.params as { id: string; issueId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const existing = await db.listIssues(id);
    const issue = existing.find((i) => (i as Record<string, unknown>).id === issueId);
    if (!issue) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as Record<string, unknown>;
    const updated = await db.updateIssue(issueId, body);
    await db.logActivity(id, request.jwtUser.firmId, 'ISSUE_UPDATED', `Updated issue: ${(issue as Record<string, unknown>).title}`);
    return reply.send({ data: updated });
  });

  // DELETE /engagements/:id/issues/:issueId
  fastify.delete('/engagements/:id/issues/:issueId', async (request, reply) => {
    const { id, issueId } = request.params as { id: string; issueId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const existing = await db.listIssues(id);
    const issue = existing.find((i) => (i as Record<string, unknown>).id === issueId);
    if (!issue) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    await db.deleteIssue(issueId);
    await db.logActivity(id, request.jwtUser.firmId, 'ISSUE_DELETED', `Deleted issue: ${(issue as Record<string, unknown>).title}`);
    return reply.send({ data: { success: true } });
  });
}
