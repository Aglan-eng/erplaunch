/**
 * Phase 45.5 — SLA portfolio dashboard route.
 *
 *   GET /sla/portfolio — every SLA_ACTIVE engagement in the user's
 *   firm, with a per-engagement health verdict + tally of open
 *   issues and days-since-activity. Powers the
 *   /sla/dashboard page.
 *
 * No RBAC matrix gate is applied here — every user in the firm can
 * see the portfolio (the data is high-level health metadata, not
 * client-specific content). Internal accountants on a single
 * engagement still get the firm-level view here because the
 * dashboard is a firm-wide cockpit.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';
import {
  summarizeSlaEngagement,
  tallyIssueCounts,
  type SlaPortfolioRow,
} from '../services/slaPortfolio.js';

interface PortfolioEntry extends SlaPortfolioRow {
  engagementId: string;
  clientName: string;
  enteredSlaAt: string | null;
  lastActivityAt: string | null;
  openIssueCounts: ReturnType<typeof tallyIssueCounts>;
}

export async function slaPortfolioRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/sla/portfolio', async (request, reply) => {
    const firmId = request.jwtUser.firmId;
    const dbClient = db.getDb();

    // 1. Pull every SLA_ACTIVE engagement for this firm. Cheap
    //    full-table scan today; once a firm has hundreds of active
    //    engagements this should move behind a status index.
    const engagements = await dbClient.execute({
      sql: `SELECT id, clientName FROM Engagement
            WHERE firmId = ? AND status = 'SLA_ACTIVE'
            ORDER BY clientName ASC`,
      args: [firmId],
    });
    const rows = engagements.rows as unknown as Array<{ id: string; clientName: string }>;
    if (rows.length === 0) {
      return reply.send({ data: [] });
    }

    const entries: PortfolioEntry[] = [];
    for (const eng of rows) {
      // 2. Find when this engagement entered SLA. Most recent
      //    HANDOFF_TO_SLA activity entry. Falls back to null when
      //    older engagements pre-date the handoff event.
      const handoff = await dbClient.execute({
        sql: `SELECT createdAt FROM ActivityLog
              WHERE engagementId = ? AND action = 'HANDOFF_TO_SLA'
              ORDER BY createdAt DESC LIMIT 1`,
        args: [eng.id],
      });
      const enteredSlaAt =
        handoff.rows[0]
          ? ((handoff.rows[0] as Record<string, unknown>).createdAt as string)
          : null;

      // 3. Most recent activity (any kind).
      const lastActivity = await dbClient.execute({
        sql: `SELECT createdAt FROM ActivityLog
              WHERE engagementId = ?
              ORDER BY createdAt DESC LIMIT 1`,
        args: [eng.id],
      });
      const lastActivityAt =
        lastActivity.rows[0]
          ? ((lastActivity.rows[0] as Record<string, unknown>).createdAt as string)
          : null;

      // 4. Open-issue tally.
      const issues = await dbClient.execute({
        sql: `SELECT priority, status FROM IssueItem WHERE engagementId = ?`,
        args: [eng.id],
      });
      const openIssueCounts = tallyIssueCounts(
        issues.rows as Array<{ priority?: string | null; status?: string | null }>,
      );

      const summary = summarizeSlaEngagement({
        enteredSlaAt,
        lastActivityAt,
        openIssueCounts,
      });

      entries.push({
        engagementId: eng.id,
        clientName: eng.clientName,
        enteredSlaAt,
        lastActivityAt,
        openIssueCounts,
        ...summary,
      });
    }

    // 5. Sort by health (worst first), then by days-on-SLA (newest
    //    first within the same bucket) so the operator's eye lands on
    //    the engagements that need attention.
    const HEALTH_ORDER = { RED: 0, AMBER: 1, GREEN: 2 } as const;
    entries.sort((a, b) => {
      const ha = HEALTH_ORDER[a.health];
      const hb = HEALTH_ORDER[b.health];
      if (ha !== hb) return ha - hb;
      return (a.daysOnSla ?? 0) - (b.daysOnSla ?? 0);
    });

    return reply.send({ data: entries });
  });
}
