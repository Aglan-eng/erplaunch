import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { authenticatePortalSession } from '../middleware/portalAuth.js';
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

  // Phase 27 — GET /engagements/portal/:token/branding
  //
  // Lightweight pre-auth endpoint that returns ONLY the firm branding block
  // and the engagement's clientName. The PortalLoginPage (sign-in screen)
  // hits this on mount so the magic-link request page can render with the
  // firm's logo / displayName / colors before the user has authenticated.
  //
  // Why a separate endpoint instead of reusing GET /engagements/portal/:token:
  // the full endpoint ships ~15 KB of engagement / members / todos / meetings /
  // data-collection state to the response. Pre-auth, the magic-link page
  // needs only the firm header — shipping the rest to an unauthenticated
  // visitor is wasteful (and subtly information-leaky if the token is
  // shoulder-surfed).
  //
  // Same 404-on-bad-token semantics as the full endpoint.
  fastify.get('/engagements/portal/:token/branding', async (request, reply) => {
    const { token } = request.params as { token: string };
    const engagement = await db.findEngagementByPortalToken(token);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const engagementId = (engagement as { id: string }).id;
    const clientName = (engagement as { clientName?: string }).clientName ?? '';
    const branding = await db.getFirmBrandingByEngagementId(engagementId);

    return reply.send({ data: { branding, clientName } });
  });

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

    // Identify authenticated member.
    //
    // Two paths, in priority order:
    //   1. Phase 5A: a valid portal_token cookie → session-backed identity
    //   2. Legacy: ?member=inviteToken query param (kept for one release window
    //      so pre-rollout email invites still work)
    //
    // Neither is required — the read view is public. Missing/invalid auth just
    // leaves authenticatedMember = null and the SPA shows the sign-in CTA.
    let authenticatedMember: { id: string; name: string; role: string; email: string } | null = null;

    // Path 1: portal session cookie (non-fatal if absent or invalid)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = (await (request as any).portalJwtVerify()) as {
        type?: string;
        memberId?: string;
        engagementId?: string;
        jti?: string;
      };
      if (
        payload?.type === 'portal' &&
        payload.memberId &&
        payload.engagementId === engagementId &&
        payload.jti
      ) {
        const jtiHash = (await import('../middleware/portalAuth.js')).hashJti(payload.jti);
        const session = await db.findPortalSessionByJtiHash(jtiHash);
        if (
          session &&
          !session.revokedAt &&
          new Date(session.expiresAt).getTime() > Date.now() &&
          session.memberId === payload.memberId &&
          session.engagementId === engagementId
        ) {
          const r = await db.getDb().execute({
            sql: `SELECT id, name, role, email FROM ProjectMember WHERE id = ?`,
            args: [payload.memberId],
          });
          const row = r.rows[0] as Record<string, unknown> | undefined;
          if (row) {
            authenticatedMember = {
              id: row.id as string,
              name: row.name as string,
              role: row.role as string,
              email: row.email as string,
            };
          }
        }
      }
    } catch {
      // No/invalid portal cookie — fall through to legacy path
    }

    // Path 2: legacy ?member=inviteToken (only if cookie path didn't resolve)
    if (!authenticatedMember && memberToken) {
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
  // Phase 5.A: requires a valid portal_token session cookie. The session's
  // engagementId must match the URL :token's engagement to prevent cross-tenant
  // writes with a stolen but valid cookie.
  fastify.patch(
    '/engagements/portal/:token/todos/:todoId/complete',
    { preHandler: authenticatePortalSession },
    async (request, reply) => {
      const { token, todoId } = request.params as { token: string; todoId: string };

      const engagement = await db.findEngagementByPortalToken(token);
      if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const engagementId = (engagement as { id: string }).id;

      if (request.portalMember.engagementId !== engagementId) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Session does not belong to this engagement' } });
      }

      const member = await lookupMemberForAudit(request.portalMember.memberId);
      const memberName = member?.name ?? 'Client';

      const todo = await db.updatePortalTodo(todoId, engagementId, {
        completedAt: new Date().toISOString(),
        completedBy: memberName,
      });
      if (!todo) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      return reply.send({ data: todo });
    },
  );

  // PATCH /engagements/portal/:token/todos/:todoId/reopen — client reopens todo
  fastify.patch(
    '/engagements/portal/:token/todos/:todoId/reopen',
    { preHandler: authenticatePortalSession },
    async (request, reply) => {
      const { token, todoId } = request.params as { token: string; todoId: string };
      const engagement = await db.findEngagementByPortalToken(token);
      if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const engagementId = (engagement as { id: string }).id;

      if (request.portalMember.engagementId !== engagementId) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Session does not belong to this engagement' } });
      }

      const todo = await db.updatePortalTodo(todoId, engagementId, {
        completedAt: null,
        completedBy: null,
      });
      if (!todo) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      return reply.send({ data: todo });
    },
  );
}

/**
 * Lightweight name/id lookup for audit fields on portal mutations. Kept local
 * to this route module so we don't leak internal member shape through the
 * public db API.
 */
async function lookupMemberForAudit(memberId: string): Promise<{ id: string; name: string } | null> {
  const client = db.getDb();
  const r = await client.execute({
    sql: `SELECT id, name FROM ProjectMember WHERE id = ?`,
    args: [memberId],
  });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return { id: row.id as string, name: row.name as string };
}
