import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';

/**
 * Converts an array of objects to CSV string.
 */
function toCSV(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';

  const keys = columns ?? Object.keys(rows[0]);
  const header = keys.map(escapeCSV).join(',');
  const body = rows.map((row) =>
    keys.map((k) => escapeCSV(String(row[k] ?? ''))).join(',')
  );
  return [header, ...body].join('\r\n');
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements/:id/export/risks
  fastify.get('/engagements/:id/export/risks', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const risks = await db.listRisks(id);
    const csv = toCSV(
      risks as Record<string, unknown>[],
      ['id', 'title', 'description', 'probability', 'impact', 'status', 'owner', 'mitigation', 'createdAt']
    );

    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="risks-${id}.csv"`)
      .send(csv);
  });

  // GET /engagements/:id/export/issues
  fastify.get('/engagements/:id/export/issues', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const issues = await db.listIssues(id);
    const csv = toCSV(
      issues as Record<string, unknown>[],
      ['id', 'title', 'description', 'priority', 'status', 'owner', 'createdAt']
    );

    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="issues-${id}.csv"`)
      .send(csv);
  });

  // GET /engagements/:id/export/decisions
  fastify.get('/engagements/:id/export/decisions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const decisions = await db.listDecisions(id);
    const csv = toCSV(
      decisions as Record<string, unknown>[],
      ['id', 'title', 'description', 'status', 'owner', 'decidedAt', 'createdAt']
    );

    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="decisions-${id}.csv"`)
      .send(csv);
  });

  // GET /engagements/:id/export/all — combined export
  fastify.get('/engagements/:id/export/all', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const [risks, issues, decisions, meetings, members] = await Promise.all([
      db.listRisks(id),
      db.listIssues(id),
      db.listDecisions(id),
      db.listMeetings(id),
      db.getMembers(id),
    ]);

    const sections: string[] = [];

    sections.push('=== ENGAGEMENT ===');
    sections.push(`Client: ${(engagement as Record<string, unknown>).clientName}`);
    sections.push(`Status: ${(engagement as Record<string, unknown>).status}`);
    sections.push('');

    if ((members as unknown[]).length > 0) {
      sections.push('=== TEAM MEMBERS ===');
      sections.push(toCSV(members as Record<string, unknown>[], ['id', 'name', 'email', 'role']));
      sections.push('');
    }

    if ((risks as unknown[]).length > 0) {
      sections.push('=== RISKS ===');
      sections.push(toCSV(risks as Record<string, unknown>[], ['id', 'title', 'description', 'probability', 'impact', 'status', 'owner', 'mitigation']));
      sections.push('');
    }

    if ((issues as unknown[]).length > 0) {
      sections.push('=== ISSUES ===');
      sections.push(toCSV(issues as Record<string, unknown>[], ['id', 'title', 'description', 'priority', 'status', 'owner']));
      sections.push('');
    }

    if ((decisions as unknown[]).length > 0) {
      sections.push('=== DECISIONS ===');
      sections.push(toCSV(decisions as Record<string, unknown>[], ['id', 'title', 'description', 'status', 'owner', 'decidedAt']));
      sections.push('');
    }

    if ((meetings as unknown[]).length > 0) {
      sections.push('=== MEETINGS ===');
      sections.push(toCSV(meetings as Record<string, unknown>[], ['id', 'title', 'date', 'attendees', 'notes']));
      sections.push('');
    }

    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="engagement-${id}-export.csv"`)
      .send(sections.join('\r\n'));
  });
}
