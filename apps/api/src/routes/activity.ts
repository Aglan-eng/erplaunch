import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';

export async function activityRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements/:id/activity
  fastify.get('/engagements/:id/activity', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { limit } = request.query as { limit?: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const activity = await db.listActivity(id, parsedLimit);
    return reply.send({ data: activity });
  });
}
