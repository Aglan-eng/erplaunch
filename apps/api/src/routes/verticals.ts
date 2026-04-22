import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';
import { VERTICALS, getVertical } from '../config/verticals.js';

export async function verticalsRoutes(fastify: FastifyInstance) {

  // GET /verticals — list all available vertical definitions
  fastify.get('/verticals', { onRequest: authenticate }, async (_request, reply) => {
    return reply.send({
      data: VERTICALS.map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description,
        iconId: v.iconId,
        color: v.color,
        textColor: v.textColor,
        tag: v.tag ?? null,
        productUrl: v.productUrl ?? null,
        moduleCount: v.modules.length,
        riskCount: v.risks.length,
        timelineMilestones: v.timeline.length,
        dataTemplateIds: v.dataTemplateIds,
      })),
    });
  });

  // GET /verticals/:id — full definition including questions, modules, risks, timeline
  fastify.get('/verticals/:id', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const vertical = getVertical(id);
    if (!vertical) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.send({ data: vertical });
  });

  // GET /engagements/:id/vertical-workspaces — list child vertical workspaces
  fastify.get('/engagements/:id/vertical-workspaces', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const workspaces = await db.listVerticalWorkspaces(id);

    // Enrich each workspace with its vertical definition metadata
    const enriched = workspaces.map((ws: Record<string, unknown>) => {
      const def = getVertical(ws.verticalType as string);
      return {
        ...ws,
        verticalMeta: def
          ? { name: def.name, iconId: def.iconId, color: def.color, textColor: def.textColor, tag: def.tag ?? null }
          : null,
      };
    });

    return reply.send({ data: enriched });
  });

  // POST /engagements/:id/vertical-workspaces — create a new vertical workspace
  fastify.post('/engagements/:id/vertical-workspaces', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { verticalType: string; verticalSettings?: Record<string, unknown> };

    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const vertical = getVertical(body.verticalType);
    if (!vertical) return reply.code(400).send({ error: { code: 'INVALID_VERTICAL', message: `Unknown vertical: ${body.verticalType}` } });

    const workspace = await db.createVerticalEngagement({
      firmId: request.jwtUser.firmId,
      clientName: `${(engagement as Record<string, unknown>).clientName} — ${vertical.name}`,
      verticalType: body.verticalType,
      parentEngagementId: id,
      verticalSettings: body.verticalSettings,
    });

    // Seed pre-built risks from vertical definition
    if (vertical.risks.length > 0) {
      for (const risk of vertical.risks) {
        await db.createRisk((workspace as Record<string, unknown>).id as string, {
          title: risk.title,
          description: risk.description,
          probability: 'MEDIUM',
          impact: risk.riskScore === 'CRITICAL' ? 'CRITICAL' : risk.riskScore,
          mitigation: risk.mitigation,
          owner: undefined,
        });
      }
    }

    await db.logActivity(
      id,
      request.jwtUser.firmId,
      'VERTICAL_WORKSPACE_CREATED',
      `Created ${vertical.name} vertical workspace`,
    );

    return reply.code(201).send({ data: workspace });
  });

  // GET /engagements/:id/vertical-settings — get vertical configuration answers
  fastify.get('/engagements/:id/vertical-settings', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const settings = await db.getVerticalSettings(id);
    return reply.send({ data: settings });
  });

  // PATCH /engagements/:id/vertical-settings — save vertical question answers
  fastify.patch('/engagements/:id/vertical-settings', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const settings = await db.updateVerticalSettings(id, request.body as Record<string, unknown>);
    return reply.send({ data: settings });
  });
}
