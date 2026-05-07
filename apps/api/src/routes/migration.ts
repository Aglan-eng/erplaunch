import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';

export async function migrationRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements/:id/migration — Phase 44.3: READ on DATA_COLLECTION
  // (migration items are a sibling concept to data-collection items).
  fastify.get('/engagements/:id/migration', { preHandler: requirePermission('READ', 'DATA_COLLECTION') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const items = await db.listMigrationItems(id);
    return reply.send({ data: items });
  });

  // POST /engagements/:id/migration
  fastify.post('/engagements/:id/migration', { preHandler: requirePermission('WRITE', 'DATA_COLLECTION') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as {
      objectName: string;
      source?: string;
      recordCount?: number;
      owner?: string;
      notes?: string;
    };

    if (!body.objectName) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'objectName is required' } });
    }

    const item = await db.createMigrationItem(id, body);
    await db.logActivity(id, request.jwtUser.firmId, 'MIGRATION_ITEM_CREATED', `Created migration item: ${body.objectName}`);
    return reply.code(201).send({ data: item });
  });

  // PATCH /engagements/:id/migration/:itemId
  fastify.patch('/engagements/:id/migration/:itemId', { preHandler: requirePermission('WRITE', 'DATA_COLLECTION') }, async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const existing = await db.listMigrationItems(id);
    const item = existing.find((i) => (i as Record<string, unknown>).id === itemId);
    if (!item) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as Record<string, unknown>;
    const updated = await db.updateMigrationItem(itemId, body);
    await db.logActivity(id, request.jwtUser.firmId, 'MIGRATION_ITEM_UPDATED', `Updated migration item: ${(item as Record<string, unknown>).objectName}`);
    return reply.send({ data: updated });
  });

  // DELETE /engagements/:id/migration/:itemId
  fastify.delete('/engagements/:id/migration/:itemId', { preHandler: requirePermission('WRITE', 'DATA_COLLECTION') }, async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const existing = await db.listMigrationItems(id);
    const item = existing.find((i) => (i as Record<string, unknown>).id === itemId);
    if (!item) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    await db.deleteMigrationItem(itemId);
    await db.logActivity(id, request.jwtUser.firmId, 'MIGRATION_ITEM_DELETED', `Deleted migration item: ${(item as Record<string, unknown>).objectName}`);
    return reply.send({ data: { success: true } });
  });
}
