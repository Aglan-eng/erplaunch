import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';

// Phase 38.1 — whitelist of consultant-author activity actions accepted via
// POST /engagements/:id/activity. Kept narrow so manual entries don't pollute
// the action vocabulary with arbitrary strings; auto-emitted action names
// (RISK_ADDED, ISSUE_OPENED, etc.) live separately on the resource routes.
const MANUAL_ACTION_WHITELIST = new Set(['NOTE', 'OBSERVATION', 'TODO', 'DECISION']);

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

  // Phase 38.1 — POST /engagements/:id/activity
  // Manual consultant-authored activity entries: notes, observations, ad-hoc
  // todos, off-system decisions. The action MUST be one of the whitelisted
  // values so the activity feed's vocabulary stays bounded; arbitrary strings
  // are 400'd. detail is required + non-empty (a blank note has no audit
  // value).
  fastify.post('/engagements/:id/activity', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = (request.body ?? {}) as { action?: unknown; detail?: unknown };
    if (typeof body.action !== 'string' || !MANUAL_ACTION_WHITELIST.has(body.action)) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: `action must be one of: ${[...MANUAL_ACTION_WHITELIST].join(', ')}`,
        },
      });
    }
    if (typeof body.detail !== 'string' || !body.detail.trim()) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'detail is required' },
      });
    }

    const row = await db.logActivity(id, request.jwtUser.firmId, body.action, body.detail.trim());
    return reply.code(201).send({ data: row });
  });
}
