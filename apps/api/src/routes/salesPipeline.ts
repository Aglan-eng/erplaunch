/**
 * Phase 46.1 — Sales pipeline routes.
 *
 *   GET   /sales/pipeline             — list engagements at sales stages
 *                                       (PROSPECT/PROPOSED/CONTRACTED/WON/LOST),
 *                                       filtered by visibility scope.
 *   POST  /sales/prospects            — quick-add a PROSPECT engagement
 *                                       (clientName + leadSource + sales rep
 *                                       + estimatedValue + estimatedCloseDate).
 *   PATCH /sales/prospects/:id/stage  — drag-drop stage transition. Only
 *                                       intra-sales transitions allowed
 *                                       here; full-lifecycle moves stay
 *                                       on /engagements/:id/advance.
 *
 * RBAC: gated to APP_ADMIN / SALES_MANAGER / SALES_REP at the route
 * level via the firmRoles + engagement roles check; the matrix's
 * ENGAGEMENT_META resource is the canonical permission. SALES_REP
 * sees only their own deals via the Phase 44.1 visibility scope.
 *
 * Note on the stage-transition route: it uses the same auth gate as
 * /engagements/:id/advance but is a separate handler because the
 * sales pipeline can move into off-flow stages (WON/LOST) that the
 * linear /advance handler refuses. POST-converted engagements
 * (DISCOVERY+) shouldn't be touched by this — the route refuses
 * any stage that isn't in SALES_PIPELINE_STAGES.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';
import {
  SALES_PIPELINE_STAGES,
  columnForEngagement,
  daysInStage,
  isLeadSource,
  type SalesStage,
} from '../services/salesPipeline.js';
import {
  resolveVisibilityScope,
  applyVisibilityScope,
} from '../services/engagementVisibility.js';

const SALES_VIEWER_ROLES = new Set(['APP_ADMIN', 'SALES_MANAGER']);

async function userCanSeeSalesPipeline(userId: string): Promise<boolean> {
  const firmRoles = await db.listFirmRolesForUser(userId);
  if (firmRoles.some((r) => SALES_VIEWER_ROLES.has(r))) return true;
  // SALES_REP is engagement-scoped; if any EngagementRole(SALES_REP)
  // exists for this user we let them in (the visibility filter trims
  // to their own deals further down).
  const sql = `SELECT 1 FROM EngagementRole WHERE userId = ? AND role = 'SALES_REP' LIMIT 1`;
  const r = await db.getDb().execute({ sql, args: [userId] });
  return r.rows.length > 0;
}

interface PipelineRow {
  id: string;
  clientName: string;
  status: string;
  leadSource: string | null;
  prospectScore: number | null;
  estimatedValue: number | null;
  estimatedCloseDate: string | null;
  lostReason: string | null;
  salesRepUserId: string | null;
  updatedAt: string;
  createdAt: string;
}

export async function salesPipelineRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/sales/pipeline', async (request, reply) => {
    if (!(await userCanSeeSalesPipeline(request.jwtUser.userId))) {
      return reply.code(403).send({
        error: { code: 'NOT_A_SALES_USER', message: 'Sales pipeline is restricted to sales-role users.' },
      });
    }

    const placeholders = SALES_PIPELINE_STAGES.map(() => '?').join(',');
    const rows = await db.getDb().execute({
      sql: `SELECT id, clientName, status, leadSource, prospectScore, estimatedValue,
                   estimatedCloseDate, lostReason, salesRepUserId, updatedAt, createdAt
            FROM Engagement
            WHERE firmId = ? AND status IN (${placeholders})
            ORDER BY updatedAt DESC`,
      args: [request.jwtUser.firmId, ...SALES_PIPELINE_STAGES],
    });

    // Apply visibility scope so SALES_REP sees only their own.
    const scope = await resolveVisibilityScope({
      userId: request.jwtUser.userId,
      firmId: request.jwtUser.firmId,
    });
    const all = rows.rows as unknown as PipelineRow[];
    const visible = applyVisibilityScope(all, scope);

    // Phase 46.2 — bulk-fetch DiscoveryLite presence/completion so
    // PROSPECT engagements bucket into NEW vs QUALIFIED vs
    // DISCOVERY_LITE without N+1 queries.
    const dlMap = await db.listDiscoveryLiteByEngagementIds(visible.map((v) => v.id));
    const now = new Date();
    const data = visible.map((e) => {
      const dl = dlMap.get(e.id);
      return {
        ...e,
        column: columnForEngagement({
          status: e.status,
          hasDiscoveryLite: dl?.hasAnswers ?? false,
          discoveryLiteCompleted: dl?.completed ?? false,
        }),
        daysInStage: daysInStage(e.updatedAt, now),
      };
    });
    return reply.send({ data });
  });

  // POST /sales/prospects — quick-add a PROSPECT engagement.
  fastify.post(
    '/sales/prospects',
    { preHandler: requirePermission('WRITE', 'ENGAGEMENT_META') },
    async (request, reply) => {
      const body = (request.body ?? {}) as {
        clientName?: unknown;
        leadSource?: unknown;
        salesRepUserId?: unknown;
        estimatedValue?: unknown;
        estimatedCloseDate?: unknown;
      };
      if (typeof body.clientName !== 'string' || body.clientName.trim().length === 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'clientName is required' },
        });
      }
      let leadSource: string | null = null;
      if (body.leadSource !== undefined && body.leadSource !== null) {
        if (typeof body.leadSource !== 'string' || !isLeadSource(body.leadSource)) {
          return reply.code(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'leadSource must be WEBSITE, REFERRAL, OUTBOUND, EVENT, or OTHER' },
          });
        }
        leadSource = body.leadSource;
      }
      const estimatedValue =
        typeof body.estimatedValue === 'number' && Number.isFinite(body.estimatedValue)
          ? body.estimatedValue
          : null;
      const estimatedCloseDate =
        typeof body.estimatedCloseDate === 'string' && body.estimatedCloseDate.length > 0
          ? body.estimatedCloseDate
          : null;
      const salesRepUserId =
        typeof body.salesRepUserId === 'string' && body.salesRepUserId.length > 0
          ? body.salesRepUserId
          : null;

      const engagement = await db.createEngagement({
        firmId: request.jwtUser.firmId,
        clientName: body.clientName.trim(),
        status: 'PROSPECT',
        leadSource,
        estimatedValue,
        estimatedCloseDate,
        salesRepUserId,
      });
      if (!engagement) {
        return reply.code(500).send({
          error: { code: 'CREATE_FAILED', message: 'Could not create the prospect.' },
        });
      }

      // If a sales rep was specified, also grant them the engagement-
      // level SALES_REP role so the visibility filter shows the deal
      // on their pipeline. APP_ADMIN/SALES_MANAGER see it regardless.
      if (salesRepUserId) {
        try {
          await db.grantEngagementRole({
            engagementId: (engagement as { id: string }).id,
            userId: salesRepUserId,
            role: 'SALES_REP',
            assignedModules: null,
            actorUserId: request.jwtUser.userId,
          });
        } catch (err) {
          request.log.warn(
            { err: String(err), engagementId: (engagement as { id: string }).id },
            'sales rep role grant failed',
          );
        }
      }

      await db.logActivity(
        (engagement as { id: string }).id,
        request.jwtUser.firmId,
        'PROSPECT_CREATED',
        `Prospect "${body.clientName.trim()}" added to pipeline${leadSource ? ` (${leadSource})` : ''}.`,
      );

      return reply.code(201).send({ data: engagement });
    },
  );

  // PATCH /sales/prospects/:id/stage — drag-drop transition.
  fastify.patch(
    '/sales/prospects/:id/stage',
    { preHandler: requirePermission('WRITE', 'ENGAGEMENT_META') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { status?: unknown };
      if (typeof body.status !== 'string' || !SALES_PIPELINE_STAGES.includes(body.status as SalesStage)) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_STAGE',
            message: 'status must be one of PROSPECT, PROPOSED, CONTRACTED, WON, LOST.',
          },
        });
      }
      const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const currentStatus = ((eng as Record<string, unknown>).status as string | undefined) ?? '';
      if (
        !SALES_PIPELINE_STAGES.includes(currentStatus as SalesStage) &&
        currentStatus !== ''
      ) {
        return reply.code(409).send({
          error: {
            code: 'NOT_IN_SALES_FUNNEL',
            message: 'Engagement is past the sales funnel — use the lifecycle /advance route.',
          },
        });
      }

      const updated = await db.updateEngagement(id, { status: body.status });
      // Phase 46.7 — stamp lostAt when entering the LOST column so
      // reports can pull "deals lost in the last 30 days" without
      // joining through ActivityLog.
      if (body.status === 'LOST') {
        await db.getDb().execute({
          sql: `UPDATE Engagement SET lostAt = ?, updatedAt = ? WHERE id = ?`,
          args: [new Date().toISOString(), new Date().toISOString(), id],
        });
      }
      await db.logActivity(
        id,
        request.jwtUser.firmId,
        body.status === 'LOST' ? 'PROSPECT_LOST' : 'PROSPECT_STAGE_CHANGED',
        `${currentStatus || 'PROSPECT'} → ${body.status}`,
      );
      return reply.send({ data: updated });
    },
  );

  // PATCH /sales/prospects/:id/loss-detail — record categorized loss
  // reason. Frontend posts this after a card is dropped into LOST and
  // the operator answers the modal.
  fastify.patch(
    '/sales/prospects/:id/loss-detail',
    { preHandler: requirePermission('WRITE', 'ENGAGEMENT_META') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
      if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      const body = (request.body ?? {}) as {
        lossReason?: unknown;
        competitorName?: unknown;
        notes?: unknown;
      };
      if (typeof body.lossReason !== 'string' || !db.isLossReason(body.lossReason)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'lossReason must be PRICE, TIMING, NO_DECISION, LOST_TO_COMPETITOR, INTERNAL_BUILD, or OTHER',
          },
        });
      }
      const detail = await db.upsertLossDetail({
        engagementId: id,
        lossReason: body.lossReason,
        competitorName:
          typeof body.competitorName === 'string' && body.competitorName.length > 0
            ? body.competitorName
            : null,
        notes: typeof body.notes === 'string' && body.notes.length > 0 ? body.notes : null,
        recordedByUserId: request.jwtUser.userId,
      });
      // Mirror the lossReason onto the engagement column for the
      // pipeline list query (which doesn't join EngagementLossDetail).
      await db.updateEngagement(id, { lostReason: body.lossReason });
      await db.logActivity(
        id,
        request.jwtUser.firmId,
        'PROSPECT_LOSS_DETAIL_RECORDED',
        `Loss reason: ${body.lossReason}${detail.competitorName ? ` (${detail.competitorName})` : ''}`,
      );
      return reply.send({ data: detail });
    },
  );
}
