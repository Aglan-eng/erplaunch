/**
 * Action Items routes (Phase 38.3).
 *
 * Project-scoped to-do surface that complements PortalTodo. Where PortalTodo
 * is portal-only (visible to clients), ActionItems are general engagement
 * tasks the consultant tracks alongside risks/issues/decisions.
 *
 * Activity hooks emit ACTION_ITEM_CREATED on POST, ACTION_ITEM_COMPLETED on
 * the OPEN→DONE transition (DONE timestamps `completedAt`), and
 * ACTION_ITEM_UPDATED on any other PATCH.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';

export async function actionItemRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements/:id/action-items
  fastify.get('/engagements/:id/action-items', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.send({ data: await db.listActionItems(id) });
  });

  // POST /engagements/:id/action-items
  fastify.post('/engagements/:id/action-items', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const body = (request.body ?? {}) as {
      title?: unknown; description?: unknown; owner?: unknown;
      priority?: unknown; dueDate?: unknown; status?: unknown;
    };
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'title is required' } });
    }
    const item = await db.createActionItem(id, {
      title: body.title,
      description: typeof body.description === 'string' ? body.description : undefined,
      owner: typeof body.owner === 'string' ? body.owner : undefined,
      priority: typeof body.priority === 'string' ? body.priority : undefined,
      dueDate: typeof body.dueDate === 'string' ? body.dueDate : undefined,
      status: typeof body.status === 'string' ? body.status : undefined,
      createdBy: request.jwtUser.userId,
    });
    await db.logActivity(id, request.jwtUser.firmId, 'ACTION_ITEM_CREATED', `Created action item: ${body.title}`);
    return reply.code(201).send({ data: item });
  });

  // PATCH /engagements/:id/action-items/:itemId
  fastify.patch('/engagements/:id/action-items/:itemId', async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const existing = await db.findActionItemById(itemId);
    if (!existing || (existing as Record<string, unknown>).engagementId !== id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const priorStatus = (existing as Record<string, unknown>).status as string | undefined;
    const newStatus = typeof body.status === 'string' ? body.status : undefined;
    // Stamp completedAt automatically on OPEN/IN_PROGRESS → DONE.
    const justCompleted = newStatus === 'DONE' && priorStatus !== 'DONE';
    const updates: Parameters<typeof db.updateActionItem>[1] = {
      title: typeof body.title === 'string' ? body.title : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      owner: typeof body.owner === 'string' ? body.owner : undefined,
      priority: typeof body.priority === 'string' ? body.priority : undefined,
      dueDate: typeof body.dueDate === 'string' ? body.dueDate : undefined,
      status: newStatus,
    };
    if (justCompleted) updates.completedAt = new Date().toISOString();

    const updated = await db.updateActionItem(itemId, updates);
    const action = justCompleted ? 'ACTION_ITEM_COMPLETED' : 'ACTION_ITEM_UPDATED';
    const verb = justCompleted ? 'Completed' : 'Updated';
    const title = (existing as Record<string, unknown>).title as string;
    await db.logActivity(id, request.jwtUser.firmId, action, `${verb} action item: ${title}`);
    return reply.send({ data: updated });
  });

  // DELETE /engagements/:id/action-items/:itemId
  fastify.delete('/engagements/:id/action-items/:itemId', async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const existing = await db.findActionItemById(itemId);
    if (!existing || (existing as Record<string, unknown>).engagementId !== id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }
    await db.deleteActionItem(itemId);
    return reply.code(204).send();
  });
}
