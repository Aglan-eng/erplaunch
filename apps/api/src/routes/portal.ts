import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';
import { sendPortalInvite, APP_URL } from '../services/email.js';

export async function portalRoutes(fastify: FastifyInstance) {

  // ─── Consultant-side (auth required) ────────────────────────────────────────

  // POST /engagements/:id/portal-token — generate share link
  fastify.post('/engagements/:id/portal-token', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const token = await db.upsertPortalToken(id);
    const portalUrl = `${APP_URL}/portal/${token}`;
    return reply.code(201).send({ data: { token, url: portalUrl } });
  });

  // GET /engagements/:id/portal-settings
  fastify.get('/engagements/:id/portal-settings', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.send({ data: await db.getPortalSettings(id) });
  });

  // PATCH /engagements/:id/portal-settings
  fastify.patch('/engagements/:id/portal-settings', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const settings = await db.updatePortalSettings(id, request.body as Record<string, unknown>);
    return reply.send({ data: settings });
  });

  // POST /engagements/:id/portal-invites — send email invites to all CLIENT members with email
  fastify.post('/engagements/:id/portal-invites', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    // Ensure a portal token exists — create one if missing
    let portalToken: string;
    try {
      const tokenRow = await db.upsertPortalToken(id);
      portalToken = tokenRow;
    } catch {
      return reply.code(500).send({ error: { code: 'TOKEN_ERROR' } });
    }

    // Generate per-member invite tokens
    await db.generateMemberInviteTokens(id);

    // Fetch members (now with inviteTokens populated)
    const members = await db.getClientMembersWithEmail(id);

    if (members.length === 0) {
      return reply.send({ data: { sent: 0, message: 'No client members with email addresses found.' } });
    }

    const settings = await db.getPortalSettings(id);
    const clientName = (engagement as any).clientName as string;

    let sent = 0;
    const errors: string[] = [];

    for (const member of members) {
      if (!member.inviteToken) continue;
      const portalUrl = `${APP_URL}/portal/${portalToken}?member=${member.inviteToken}`;
      try {
        await sendPortalInvite(member.email, {
          memberName: member.name,
          memberRole: member.role,
          clientName,
          portalUrl,
          customMessage: settings.customMessage || undefined,
        });
        sent++;
      } catch (err: any) {
        errors.push(`${member.email}: ${err.message}`);
        fastify.log.error({ err, email: member.email }, 'Failed to send portal invite');
      }
    }

    return reply.send({
      data: {
        sent,
        total: members.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `Invites sent to ${sent} of ${members.length} client members.`,
      },
    });
  });

  // ─── Portal Todos (consultant CRUD) ─────────────────────────────────────────

  // GET /engagements/:id/portal-todos
  fastify.get('/engagements/:id/portal-todos', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.send({ data: await db.listPortalTodos(id) });
  });

  // POST /engagements/:id/portal-todos
  fastify.post('/engagements/:id/portal-todos', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const body = request.body as any;
    const todo = await db.createPortalTodo(id, body);
    return reply.code(201).send({ data: todo });
  });

  // PATCH /engagements/:id/portal-todos/:todoId
  fastify.patch('/engagements/:id/portal-todos/:todoId', { onRequest: authenticate }, async (request, reply) => {
    const { id, todoId } = request.params as { id: string; todoId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const todo = await db.updatePortalTodo(todoId, id, request.body as any);
    if (!todo) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.send({ data: todo });
  });

  // DELETE /engagements/:id/portal-todos/:todoId
  fastify.delete('/engagements/:id/portal-todos/:todoId', { onRequest: authenticate }, async (request, reply) => {
    const { id, todoId } = request.params as { id: string; todoId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    await db.deletePortalTodo(todoId, id);
    return reply.code(204).send();
  });

  // ─── Public portal endpoints (no auth) ──────────────────────────────────────

  // GET /engagements/portal/:token — main portal data
  // Accepts ?member=inviteToken to authenticate as a specific member
  fastify.get('/engagements/portal/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const { member: memberToken } = request.query as { member?: string };

    const engagement = await db.findEngagementByPortalToken(token);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const engagementId = (engagement as any).id as string;
    const settings = await db.getPortalSettings(engagementId);
    const branding = await db.getFirmBrandingByEngagementId(engagementId);

    // Identify authenticated member (if memberToken provided)
    let authenticatedMember: { id: string; name: string; role: string; email: string } | null = null;
    if (memberToken) {
      const found = await db.findMemberByInviteToken(memberToken);
      if (found && found.engagementId === engagementId) {
        authenticatedMember = { id: found.id, name: found.name, role: found.role, email: found.email };
      }
    }

    // Fetch sections based on settings
    const [risks, issues, decisions, todos, meetings, dataCollection] = await Promise.all([
      settings.showRisks        ? db.listRisks(engagementId)           : Promise.resolve([]),
      settings.showIssues       ? db.listIssues(engagementId)          : Promise.resolve([]),
      settings.showDecisions    ? db.listDecisions(engagementId)       : Promise.resolve([]),
      settings.showTodos        ? db.listPortalTodos(engagementId)     : Promise.resolve([]),
      settings.showMeetings     ? db.listMeetings(engagementId)        : Promise.resolve([]),
      settings.showDataCollection ? db.listDataCollectionItems(engagementId) : Promise.resolve([]),
    ]);

    // Filter committee by settings
    const allMembers = (engagement as any).members ?? [];
    const members = allMembers.filter((m: any) => {
      if (m.team === 'CONSULTANT') return settings.showConsultantTeam;
      return settings.showClientTeam;
    });

    // Strip internal fields
    const { members: _m, profile: _p, license: _l, conflicts: _c, ...engagementData } = engagement as any;

    return reply.send({
      data: {
        branding,
        engagement: {
          ...engagementData,
          startDate: settings.showTimeline ? engagementData.startDate : null,
          contractEndDate: settings.showTimeline ? engagementData.contractEndDate : null,
          portalSettings: settings,
        },
        authenticatedMember,
        members,
        risks,
        issues,
        decisions,
        todos,
        meetings: (meetings as any[]).filter((m: any) => {
          const d = m.date ?? m.scheduledAt;
          return !d || new Date(d) >= new Date(Date.now() - 7 * 86400000); // last 7d + future
        }),
        dataCollection: (dataCollection as any[]).map((item: any) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          category: item.category,
          status: item.status,
          dueDate: item.dueDate,
          fileCount: item.fileCount ?? 0,
        })),
      },
    });
  });

  // PATCH /engagements/portal/:token/todos/:todoId/complete — client marks todo done
  fastify.patch('/engagements/portal/:token/todos/:todoId/complete', async (request, reply) => {
    const { token, todoId } = request.params as { token: string; todoId: string };
    const { memberToken } = request.body as { memberToken?: string };

    const engagement = await db.findEngagementByPortalToken(token);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const engagementId = (engagement as any).id as string;

    // Verify member
    let memberName = 'Client';
    if (memberToken) {
      const found = await db.findMemberByInviteToken(memberToken);
      if (found && found.engagementId === engagementId) {
        memberName = found.name;
      }
    }

    const todo = await db.updatePortalTodo(todoId, engagementId, {
      completedAt: new Date().toISOString(),
      completedBy: memberName,
    });
    if (!todo) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.send({ data: todo });
  });

  // PATCH /engagements/portal/:token/todos/:todoId/reopen — client reopens todo
  fastify.patch('/engagements/portal/:token/todos/:todoId/reopen', async (request, reply) => {
    const { token, todoId } = request.params as { token: string; todoId: string };
    const engagement = await db.findEngagementByPortalToken(token);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const engagementId = (engagement as any).id as string;
    const todo = await db.updatePortalTodo(todoId, engagementId, {
      completedAt: null,
      completedBy: null,
    });
    if (!todo) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.send({ data: todo });
  });
}
