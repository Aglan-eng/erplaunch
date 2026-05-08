import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { authenticatePortalSession } from '../middleware/portalAuth.js';
import * as db from '../db/index.js';
import { sendPortalInvite, APP_URL } from '../services/email.js';
import { allQuestions, type Question } from '@ofoq/shared';
import { findPendingSubmissionsByEngagement } from '../db/pendingSubmission.js';
import { createStagedFile } from '../db/stagedFile.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createId } from '@paralleldrive/cuid2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Mirror the constant in routes/dataCollection.ts. Inlined here to
// avoid a cross-route dependency. Phase 30 — staging subdirectory is
// created on demand at module load.
const PORTAL_UPLOADS_DIR = path.join(__dirname, '../../uploads');
const PORTAL_STAGING_DIR = path.join(PORTAL_UPLOADS_DIR, 'staged');
if (!fs.existsSync(PORTAL_STAGING_DIR)) {
  fs.mkdirSync(PORTAL_STAGING_DIR, { recursive: true });
}

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
    const clientName = (engagement as { clientName: string }).clientName;

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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${member.email}: ${message}`);
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
    const body = request.body as Parameters<typeof db.createPortalTodo>[1];
    const todo = await db.createPortalTodo(id, body);
    return reply.code(201).send({ data: todo });
  });

  // PATCH /engagements/:id/portal-todos/:todoId
  fastify.patch('/engagements/:id/portal-todos/:todoId', { onRequest: authenticate }, async (request, reply) => {
    const { id, todoId } = request.params as { id: string; todoId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const todo = await db.updatePortalTodo(todoId, id, request.body as Parameters<typeof db.updatePortalTodo>[2]);
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

    const engagementId = (engagement as { id: string }).id;
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
    type PortalMemberLike = { team?: string };
    type EngagementWithMembers = Record<string, unknown> & { members?: PortalMemberLike[] };
    const eng = engagement as EngagementWithMembers;
    const allMembers: PortalMemberLike[] = eng.members ?? [];
    const members = allMembers.filter((m) => {
      if (m.team === 'CONSULTANT') return settings.showConsultantTeam;
      return settings.showClientTeam;
    });

    // Strip internal fields
    const { members: _m, profile: _p, license: _l, conflicts: _c, ...engagementData } = eng;

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
        meetings: (meetings as Array<{ date?: string; scheduledAt?: string }>).filter((m) => {
          const d = m.date ?? m.scheduledAt;
          return !d || new Date(d) >= new Date(Date.now() - 7 * 86400000); // last 7d + future
        }),
        dataCollection: (dataCollection as Array<Record<string, unknown>>).map((item) => ({
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

  // Phase 29 — GET /engagements/portal/:token/questions
  //
  // Returns the wizard questions the client may answer from the portal:
  //   - allowlisted by the consultant via portalSettings.clientAnsweredQuestionIds
  //   - NOT already answered (i.e. not yet present as a key in
  //     BusinessProfile.answers — anything in answers is already source of truth)
  //   - NOT in flight as a PENDING WIZARD_ANSWER submission for this
  //     engagement (so the client doesn't re-submit while their previous
  //     submission awaits review)
  //
  // The server is the source of truth on what's answerable; the client just
  // renders. Questions whose IDs are allowlisted but no longer exist in the
  // bundled question banks (stale config after a question rename / removal)
  // are dropped silently — surfacing them would just confuse the client.
  fastify.get(
    '/engagements/portal/:token/questions',
    { preHandler: authenticatePortalSession },
    async (request, reply) => {
      const { token } = request.params as { token: string };

      const engagement = await db.findEngagementByPortalToken(token);
      if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const engagementId = (engagement as { id: string }).id;

      if (request.portalMember.engagementId !== engagementId) {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: 'Session does not belong to this engagement' },
        });
      }

      const settings = await db.getPortalSettings(engagementId);
      const allowlist = new Set(settings.clientAnsweredQuestionIds ?? []);
      if (allowlist.size === 0) {
        return reply.send({ data: [] });
      }

      const profile = await db.getProfile(engagementId);
      const answeredIds = new Set(
        Object.keys((profile?.answers as Record<string, unknown> | undefined) ?? {}),
      );

      const pending = await findPendingSubmissionsByEngagement(engagementId, { status: 'PENDING' });
      const inFlightQuestionIds = new Set(
        pending
          .filter((s) => s.targetType === 'WIZARD_ANSWER')
          .map((s) => (s.payload as { questionId?: string }).questionId)
          .filter((id): id is string => typeof id === 'string'),
      );

      // Hydrate from the bundled question bank. Defensive Map by id —
      // duplicates within allQuestions would otherwise break the lookup.
      const byId = new Map<string, Question>();
      for (const q of allQuestions as Question[]) byId.set(q.id, q);

      const visible: Question[] = [];
      for (const id of allowlist) {
        if (answeredIds.has(id)) continue;
        if (inFlightQuestionIds.has(id)) continue;
        const q = byId.get(id);
        if (!q) continue; // stale allowlist entry — skip silently
        visible.push(q);
      }

      // Stable order: by flow → section → order, mirroring the wizard.
      visible.sort((a, b) => {
        if (a.flow !== b.flow) return a.flow.localeCompare(b.flow);
        if (a.section !== b.section) return a.section.localeCompare(b.section);
        return a.order - b.order;
      });

      return reply.send({ data: visible });
    },
  );

  // Phase 30 — POST /api/v1/portal/data-files/staged
  //
  // Client multipart upload that lands in UPLOADS_DIR/staged/<id>_<ext>
  // and creates a StagedFile row. Returns { stagedFileId, ... } so the
  // client can then POST /portal/submissions with targetType='DATA_FILE'
  // referencing that ID. The 5MB cap from server.ts multipart config
  // applies (413 on overflow).
  fastify.post(
    '/portal/data-files/staged',
    { preHandler: authenticatePortalSession },
    async (request, reply) => {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({
          error: { code: 'NO_FILE', message: 'multipart file required' },
        });
      }
      const { engagementId, memberId } = request.portalMember;

      // Ext from original name; fallback to .bin if unknown.
      const ext = path.extname(data.filename || '') || '.bin';
      const stagedFilename = `${createId()}${ext}`;
      const stagedPath = path.join(PORTAL_STAGING_DIR, stagedFilename);

      let buffer: Buffer;
      try {
        buffer = await data.toBuffer();
      } catch (err) {
        request.log.error({ err }, 'failed to read multipart buffer');
        return reply.code(400).send({
          error: { code: 'UPLOAD_READ_FAILED', message: 'failed to read uploaded file' },
        });
      }
      try {
        fs.writeFileSync(stagedPath, buffer);
      } catch (err) {
        request.log.error({ err, stagedPath }, 'failed to write staged file');
        return reply.code(500).send({
          error: { code: 'UPLOAD_WRITE_FAILED', message: 'failed to write staged file' },
        });
      }

      const staged = await createStagedFile({
        engagementId,
        memberId,
        dataCollectionItemId: null,
        filename: stagedFilename,
        originalName: data.filename || stagedFilename,
        mimeType: data.mimetype ?? 'application/octet-stream',
        sizeBytes: buffer.length,
        storagePath: stagedPath,
      });

      return reply.code(201).send({
        data: {
          stagedFileId: staged.id,
          filename: staged.filename,
          originalName: staged.originalName,
          mimeType: staged.mimeType,
          sizeBytes: staged.sizeBytes,
        },
      });
    },
  );

  // Phase 30 — GET /api/v1/engagements/:id/staged-files/:stagedFileId/download
  //
  // Consultant-side preview of a staged file before accepting/rejecting
  // the submission. Auth + ownership checks; streams the file with the
  // original filename. 404 if the staged file is gone (e.g. another
  // reviewer already accepted/rejected, or 24h GC ran).
  fastify.get(
    '/engagements/:id/staged-files/:stagedFileId/download',
    { onRequest: authenticate },
    async (request, reply) => {
      const { id, stagedFileId } = request.params as {
        id: string;
        stagedFileId: string;
      };

      const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

      const { findStagedFileById } = await import('../db/stagedFile.js');
      const staged = await findStagedFileById(stagedFileId);
      if (!staged || staged.engagementId !== id) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }

      const filePath = path.join(PORTAL_STAGING_DIR, staged.filename);
      if (!fs.existsSync(filePath)) {
        return reply.code(404).send({
          error: { code: 'FILE_NOT_FOUND', message: 'staged file no longer on disk' },
        });
      }

      reply.header('Content-Type', staged.mimeType ?? 'application/octet-stream');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(staged.originalName)}"`,
      );
      return reply.send(fs.createReadStream(filePath));
    },
  );

  // ─── Phase 32 — Client-side decision sign-off list ─────────────────────────
  //
  // Returns DecisionItems the client should consider signing off on.
  // Filters to non-terminal sign-off states (NONE | PENDING) so once a
  // decision is signed/declined/rejected the client doesn't see it as
  // actionable again. Also enriches with the in-flight pending
  // submission ID for THIS member so the UI can show "submitted —
  // awaiting consultant" for the client's own outstanding submission.
  fastify.get(
    '/engagements/portal/:token/decisions',
    { preHandler: authenticatePortalSession },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const engagement = await db.findEngagementByPortalToken(token);
      if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const engagementId = (engagement as { id: string }).id;
      if (request.portalMember.engagementId !== engagementId) {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: 'Session does not belong to this engagement' },
        });
      }

      const decisions = await db.listDecisions(engagementId);
      const pending = await findPendingSubmissionsByEngagement(engagementId, { status: 'PENDING' });
      const inFlightByDecisionId = new Map<string, string>(); // decisionItemId → submissionId
      for (const sub of pending) {
        if (sub.targetType !== 'DECISION_SIGNOFF') continue;
        const decisionItemId = (sub.payload as { decisionItemId?: string }).decisionItemId;
        if (typeof decisionItemId === 'string' && sub.memberId === request.portalMember.memberId) {
          inFlightByDecisionId.set(decisionItemId, sub.id);
        }
      }

      const visible = (decisions as Array<Record<string, unknown>>).filter((d) => {
        const status = (d.clientSignoffStatus as string | null) ?? 'NONE';
        return status === 'NONE' || status === 'PENDING';
      }).map((d) => ({
        ...d,
        pendingSubmissionId: inFlightByDecisionId.get(d.id as string) ?? null,
      }));

      return reply.send({ data: visible });
    },
  );

  // ─── Phase 31 — Client-side conversation threads (read-only) ───────────────
  //
  // Client list/detail endpoints for messaging. Outbound messages go
  // through POST /portal/submissions with targetType='QA_MESSAGE'
  // (per §5.1 — pending review for client→consultant). Inbound
  // (consultant→client) messages are visible immediately.
  fastify.get(
    '/engagements/portal/:token/threads',
    { preHandler: authenticatePortalSession },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const engagement = await db.findEngagementByPortalToken(token);
      if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const engagementId = (engagement as { id: string }).id;
      if (request.portalMember.engagementId !== engagementId) {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: 'Session does not belong to this engagement' },
        });
      }
      const { listConversationThreadsByEngagement } = await import('../db/conversationThread.js');
      const threads = await listConversationThreadsByEngagement(engagementId);
      return reply.send({ data: threads });
    },
  );

  fastify.get(
    '/engagements/portal/:token/threads/:threadId',
    { preHandler: authenticatePortalSession },
    async (request, reply) => {
      const { token, threadId } = request.params as { token: string; threadId: string };
      const engagement = await db.findEngagementByPortalToken(token);
      if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const engagementId = (engagement as { id: string }).id;
      if (request.portalMember.engagementId !== engagementId) {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: 'Session does not belong to this engagement' },
        });
      }
      const { findConversationThreadById } = await import('../db/conversationThread.js');
      const { listMessagesByThread } = await import('../db/message.js');
      const thread = await findConversationThreadById(threadId);
      if (!thread || thread.engagementId !== engagementId) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
      const messages = await listMessagesByThread(threadId);
      return reply.send({ data: { thread, messages } });
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

  // ─── Phase 45.4 — Client closeout sign-off ────────────────────────────────
  //
  // GET returns the current sign-off state so the portal can show
  // "ready to sign", "already signed by Y", or "not yet ready" (when
  // the engagement isn't in CLOSEOUT). POST flips CLIENT_SIGNOFF to
  // DONE on the closeout checklist. Both gated on the same portal
  // session middleware as the rest of /portal/:token/*.
  //
  // The portal member's name is recorded in `notes` so the audit
  // trail shows which client representative signed off — the
  // matching CloseoutChecklistItem.completedBy column stores the
  // portal-member id.

  fastify.get(
    '/engagements/portal/:token/closeout-signoff',
    { preHandler: authenticatePortalSession },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const engagement = await db.findEngagementByPortalToken(token);
      if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const engagementId = (engagement as { id: string }).id;
      if (request.portalMember.engagementId !== engagementId) {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: 'Session does not belong to this engagement' },
        });
      }
      const status = (engagement as { status?: string }).status ?? 'DISCOVERY';
      // The checklist may not exist yet if the engagement hasn't entered
      // CLOSEOUT — return a friendly NOT_READY shape instead of 404 so
      // the portal can render the "your sign-off opens once we wrap up"
      // empty state.
      if (status !== 'CLOSEOUT') {
        return reply.send({
          data: {
            ready: false,
            stage: status,
            reason: 'Engagement is not yet in Closeout — sign-off opens once your project lead moves us there.',
          },
        });
      }
      const items = await db.listCloseoutChecklist(engagementId).catch(() => []);
      const signoff = items.find((i) => i.key === 'CLIENT_SIGNOFF');
      return reply.send({
        data: {
          ready: true,
          stage: status,
          status: signoff?.status ?? 'NOT_STARTED',
          signedBy: signoff?.notes ?? null,
          signedAt: signoff?.completedAt ?? null,
        },
      });
    },
  );

  fastify.post(
    '/engagements/portal/:token/closeout-signoff',
    { preHandler: authenticatePortalSession },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const engagement = await db.findEngagementByPortalToken(token);
      if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const engagementId = (engagement as { id: string }).id;
      if (request.portalMember.engagementId !== engagementId) {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: 'Session does not belong to this engagement' },
        });
      }
      const status = (engagement as { status?: string }).status ?? 'DISCOVERY';
      if (status !== 'CLOSEOUT') {
        return reply.code(409).send({
          error: {
            code: 'NOT_IN_CLOSEOUT',
            message: 'Sign-off is only available once the engagement is in Closeout.',
          },
        });
      }

      const member = await lookupMemberForAudit(request.portalMember.memberId);
      const memberName = member?.name ?? 'Client';

      const updated = await db.updateCloseoutChecklistItem({
        engagementId,
        key: 'CLIENT_SIGNOFF',
        status: 'DONE',
        // Stash the signing client's display name in notes so the
        // consultant + audit trail know who pressed the button.
        notes: `Signed off by ${memberName} via portal`,
        // byUserId is intended for User rows; portal members aren't in
        // the User table. Use the member id with a 'portal:' prefix so
        // any downstream audit join knows it's not a real userId.
        byUserId: `portal:${request.portalMember.memberId}`,
      });
      if (!updated) {
        return reply.code(404).send({
          error: {
            code: 'CHECKLIST_NOT_INITIALISED',
            message: 'Closeout checklist not yet created for this engagement.',
          },
        });
      }
      await db.logActivity(
        engagementId,
        (engagement as { firmId: string }).firmId,
        'CLOSEOUT_CLIENT_SIGNOFF',
        `${memberName} signed off via the client portal.`,
      );
      return reply.send({
        data: {
          status: updated.status,
          signedBy: memberName,
          signedAt: updated.completedAt,
        },
      });
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
