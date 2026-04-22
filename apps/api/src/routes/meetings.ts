import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';

export async function meetingRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements/:id/meetings
  fastify.get('/engagements/:id/meetings', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const meetings = await db.listMeetings(id);
    return reply.send({ data: meetings });
  });

  // POST /engagements/:id/meetings
  fastify.post('/engagements/:id/meetings', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as {
      title: string;
      meetingDate: string;
      attendees?: string[];
      notes?: string;
      actionItems?: Array<{ text: string; owner?: string; done?: boolean }>;
    };

    if (!body.title || !body.meetingDate) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'title and meetingDate are required' } });
    }

    const meeting = await db.createMeeting(id, body);
    await db.logActivity(id, request.jwtUser.firmId, 'MEETING_CREATED', `Created meeting: ${body.title}`);
    return reply.code(201).send({ data: meeting });
  });

  // PATCH /engagements/:id/meetings/:meetingId
  fastify.patch('/engagements/:id/meetings/:meetingId', async (request, reply) => {
    const { id, meetingId } = request.params as { id: string; meetingId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const existing = await db.listMeetings(id);
    const meeting = existing.find((m) => (m as Record<string, unknown>).id === meetingId);
    if (!meeting) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as Record<string, unknown>;
    const updated = await db.updateMeeting(meetingId, body);
    await db.logActivity(id, request.jwtUser.firmId, 'MEETING_UPDATED', `Updated meeting: ${(meeting as Record<string, unknown>).title}`);
    return reply.send({ data: updated });
  });

  // DELETE /engagements/:id/meetings/:meetingId
  fastify.delete('/engagements/:id/meetings/:meetingId', async (request, reply) => {
    const { id, meetingId } = request.params as { id: string; meetingId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const existing = await db.listMeetings(id);
    const meeting = existing.find((m) => (m as Record<string, unknown>).id === meetingId);
    if (!meeting) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    await db.deleteMeeting(meetingId);
    await db.logActivity(id, request.jwtUser.firmId, 'MEETING_DELETED', `Deleted meeting: ${(meeting as Record<string, unknown>).title}`);
    return reply.send({ data: { success: true } });
  });
}
