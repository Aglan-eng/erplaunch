import type { FastifyReply } from 'fastify';
import { findEngagementByIdAndFirmId } from '../db/index.js';

export async function requireEngagementAccess(
  firmId: string,
  engagementId: string,
  reply: FastifyReply
): Promise<boolean> {
  const engagement = await findEngagementByIdAndFirmId(engagementId, firmId);

  if (!engagement) {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Engagement not found or access denied' } });
    return false;
  }

  return true;
}
