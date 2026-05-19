/**
 * Phase 52.5 — Inbox routes.
 *
 *   GET   /api/v1/inbox
 *       Returns { forYou, watching, firmWide } per Phase 52 lock #2
 *       bucketing. firmWide is null unless the caller's User.role
 *       is APP_ADMIN.
 *
 *   POST  /api/v1/inbox/dismiss
 *       Body: { itemId }. Marks the item dismissed for this user
 *       for 7 days. Idempotent — re-posting the same itemId resets
 *       the dismissal clock.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { buildInbox, recordDismissal } from '../services/inbox/buildInbox.js';

const DismissBody = z.object({
  itemId: z.string().min(1).max(200),
});

async function isAppAdmin(userId: string): Promise<boolean> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT role FROM User WHERE id = ? LIMIT 1`,
    args: [userId],
  });
  const row = r.rows[0] as { role?: string } | undefined;
  return row?.role === 'APP_ADMIN';
}

export async function inboxRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/inbox', async (request, reply) => {
    const firmId = request.jwtUser.firmId;
    const userId = request.jwtUser.userId;
    const isAdmin = await isAppAdmin(userId);
    const response = await buildInbox({ firmId, userId, isAdmin });
    return reply.send(response);
  });

  fastify.post('/inbox/dismiss', async (request, reply) => {
    const parsed = DismissBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }
    await recordDismissal(request.jwtUser.userId, parsed.data.itemId);
    return reply.send({ ok: true });
  });
}
