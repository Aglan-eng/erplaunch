/**
 * Phase 46.2 — Discovery Lite questionnaire routes.
 *
 * Two access paths:
 *
 *   Consultant side (auth required, gated on ENGAGEMENT_META WRITE):
 *     GET    /engagements/:id/discovery-lite
 *     PUT    /engagements/:id/discovery-lite
 *     POST   /engagements/:id/discovery-lite/complete
 *     POST   /engagements/:id/discovery-lite/share-token
 *     DELETE /engagements/:id/discovery-lite/share-token
 *
 *   Self-serve (no auth, opaque token):
 *     GET    /discovery-lite/:token
 *     PUT    /discovery-lite/:token
 *     POST   /discovery-lite/:token/complete
 *
 * The catalog is exported so the same UI can render either flow.
 * Adaptor-aware questions get their `options` filled at read time
 * from the engagement's adaptorId — keeps the catalog static.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';
import {
  DISCOVERY_LITE_QUESTIONS,
  missingRequiredAnswers,
  validateAnswer,
  type DiscoveryLiteQuestion,
} from '../services/discoveryLiteCatalog.js';
import { getAdaptorRegistry } from '@ofoq/adaptor-registry';

const SHARE_TOKEN_TTL_DAYS = 14;
const SHARE_TOKEN_TTL_MS = SHARE_TOKEN_TTL_DAYS * 86_400_000;

/**
 * Hydrate adaptor-aware questions with the modules the engagement's
 * adaptor advertises. Defensive — when the adaptor isn't found we
 * fall back to the catalog defaults so the form still renders.
 */
function hydrateQuestions(
  adaptorId: string | null,
): ReadonlyArray<DiscoveryLiteQuestion> {
  if (!adaptorId) return DISCOVERY_LITE_QUESTIONS;
  let modules: Array<{ id: string; label: string }> = [];
  try {
    const adaptor = getAdaptorRegistry().find(adaptorId);
    // The adaptor SDK exposes modules under license.modules with
    // shape { id, label, description? }. Fall back to defaults when
    // the adaptor isn't installed or the shape isn't what we expect.
    const m = adaptor?.license?.modules;
    if (Array.isArray(m)) {
      modules = m
        .filter((x): x is { id: string; label: string } =>
          typeof x === 'object' && x !== null && typeof (x as { id?: unknown }).id === 'string')
        .map((x) => ({ id: x.id, label: x.label ?? x.id }));
    }
  } catch {
    // Adaptor lookup is best-effort — fall through to defaults.
  }
  if (modules.length === 0) return DISCOVERY_LITE_QUESTIONS;
  return DISCOVERY_LITE_QUESTIONS.map((q) => {
    if (!q.adaptorAware) return q;
    return {
      ...q,
      options: modules.map((m) => ({ value: m.id, label: m.label })),
    };
  });
}

/**
 * Sanitize an answers payload — drops keys that don't match a known
 * question id, runs each through `validateAnswer`, and returns
 * either the cleaned set or the first validation error.
 */
function sanitizeAnswers(
  raw: unknown,
): { ok: true; answers: Record<string, unknown> } | { ok: false; error: string; field: string } {
  if (raw === null || raw === undefined) return { ok: true, answers: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'answers must be an object', field: '_root' };
  }
  const known = new Set(DISCOVERY_LITE_QUESTIONS.map((q) => q.id));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(k)) continue; // drop unknown keys silently
    const err = validateAnswer(k, v);
    if (err) return { ok: false, error: err, field: k };
    out[k] = v;
  }
  return { ok: true, answers: out };
}

export async function discoveryLiteRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Consultant side ─────────────────────────────────────────────────────
  fastify.register(async (consultant) => {
    consultant.addHook('preHandler', authenticate);

    consultant.get(
      '/engagements/:id/discovery-lite',
      { preHandler: requirePermission('READ', 'ENGAGEMENT_META') },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
        if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
        const adaptorId =
          ((eng as Record<string, unknown>).adaptorId as string | undefined) ?? null;
        const record = await db.findDiscoveryLite(id);
        return reply.send({
          data: {
            questions: hydrateQuestions(adaptorId),
            record: record ?? {
              engagementId: id,
              answers: {},
              completedAt: null,
              shareToken: null,
              shareTokenIssuedAt: null,
              shareTokenExpiresAt: null,
              lastEditedBy: null,
              createdAt: null,
              updatedAt: null,
            },
          },
        });
      },
    );

    consultant.put(
      '/engagements/:id/discovery-lite',
      { preHandler: requirePermission('WRITE', 'ENGAGEMENT_META') },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
        if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

        const body = (request.body ?? {}) as { answers?: unknown };
        const sanitized = sanitizeAnswers(body.answers);
        if (!sanitized.ok) {
          return reply.code(400).send({
            error: { code: 'VALIDATION_ERROR', field: sanitized.field, message: sanitized.error },
          });
        }
        const updated = await db.upsertDiscoveryLite({
          engagementId: id,
          answers: sanitized.answers,
          lastEditedBy: request.jwtUser.userId,
        });
        return reply.send({ data: updated });
      },
    );

    consultant.post(
      '/engagements/:id/discovery-lite/complete',
      { preHandler: requirePermission('WRITE', 'ENGAGEMENT_META') },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
        if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

        const existing = await db.findDiscoveryLite(id);
        if (!existing) {
          return reply.code(409).send({
            error: { code: 'NOT_STARTED', message: 'No Discovery Lite answers on file yet.' },
          });
        }
        const missing = missingRequiredAnswers(existing.answers);
        if (missing.length > 0) {
          return reply.code(409).send({
            error: {
              code: 'INCOMPLETE',
              message: `Required questions are not yet answered.`,
              missingFields: missing,
            },
          });
        }
        const updated = await db.upsertDiscoveryLite({
          engagementId: id,
          completedAt: new Date().toISOString(),
          lastEditedBy: request.jwtUser.userId,
        });
        await db.logActivity(
          id,
          request.jwtUser.firmId,
          'DISCOVERY_LITE_COMPLETED',
          'Pre-sales questionnaire marked complete.',
        );
        return reply.send({ data: updated });
      },
    );

    consultant.post(
      '/engagements/:id/discovery-lite/share-token',
      { preHandler: requirePermission('WRITE', 'ENGAGEMENT_META') },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
        if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
        const token = db.newShareToken();
        const now = new Date();
        const expires = new Date(now.getTime() + SHARE_TOKEN_TTL_MS);
        const updated = await db.upsertDiscoveryLite({
          engagementId: id,
          shareToken: token,
          shareTokenIssuedAt: now.toISOString(),
          shareTokenExpiresAt: expires.toISOString(),
        });
        await db.logActivity(
          id,
          request.jwtUser.firmId,
          'DISCOVERY_LITE_SHARED',
          `Self-serve link issued (expires ${expires.toISOString().slice(0, 10)}).`,
        );
        return reply.send({
          data: { token, expiresAt: expires.toISOString(), record: updated },
        });
      },
    );

    consultant.delete(
      '/engagements/:id/discovery-lite/share-token',
      { preHandler: requirePermission('WRITE', 'ENGAGEMENT_META') },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
        if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
        const updated = await db.upsertDiscoveryLite({
          engagementId: id,
          shareToken: null,
          shareTokenIssuedAt: null,
          shareTokenExpiresAt: null,
        });
        return reply.send({ data: updated });
      },
    );
  });

  // ── Self-serve (token) ──────────────────────────────────────────────────
  fastify.register(async (selfServe) => {
    // No auth gate — token is the auth.
    async function loadByToken(token: string) {
      const record = await db.findDiscoveryLiteByShareToken(token);
      if (!record) return { error: 'NOT_FOUND' as const };
      if (record.shareTokenExpiresAt && new Date(record.shareTokenExpiresAt).getTime() < Date.now()) {
        return { error: 'EXPIRED' as const };
      }
      const eng = await db.findEngagementById(record.engagementId);
      if (!eng) return { error: 'NOT_FOUND' as const };
      return { record, engagement: eng };
    }

    selfServe.get('/discovery-lite/:token', async (request, reply) => {
      const { token } = request.params as { token: string };
      const r = await loadByToken(token);
      if ('error' in r) {
        return reply.code(r.error === 'EXPIRED' ? 410 : 404).send({
          error: { code: r.error === 'EXPIRED' ? 'LINK_EXPIRED' : 'NOT_FOUND' },
        });
      }
      const adaptorId =
        ((r.engagement as Record<string, unknown>).adaptorId as string | undefined) ?? null;
      const clientName = ((r.engagement as Record<string, unknown>).clientName as string | undefined) ?? '';
      // Strip the share token from the response — the recipient
      // shouldn't see fields that let them re-mint a different link.
      return reply.send({
        data: {
          questions: hydrateQuestions(adaptorId),
          clientName,
          answers: r.record.answers,
          completedAt: r.record.completedAt,
        },
      });
    });

    selfServe.put('/discovery-lite/:token', async (request, reply) => {
      const { token } = request.params as { token: string };
      const r = await loadByToken(token);
      if ('error' in r) {
        return reply.code(r.error === 'EXPIRED' ? 410 : 404).send({
          error: { code: r.error === 'EXPIRED' ? 'LINK_EXPIRED' : 'NOT_FOUND' },
        });
      }
      // If already completed, refuse further edits. The consultant
      // can re-open by clearing completedAt server-side (intentionally
      // no UI for that today).
      if (r.record.completedAt) {
        return reply.code(409).send({
          error: { code: 'ALREADY_COMPLETED', message: 'This questionnaire has already been submitted.' },
        });
      }
      const body = (request.body ?? {}) as { answers?: unknown };
      const sanitized = sanitizeAnswers(body.answers);
      if (!sanitized.ok) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', field: sanitized.field, message: sanitized.error },
        });
      }
      const updated = await db.upsertDiscoveryLite({
        engagementId: r.record.engagementId,
        answers: sanitized.answers,
        // Don't stamp lastEditedBy — self-serve has no userId.
      });
      return reply.send({
        data: { answers: updated.answers, completedAt: updated.completedAt },
      });
    });

    selfServe.post('/discovery-lite/:token/complete', async (request, reply) => {
      const { token } = request.params as { token: string };
      const r = await loadByToken(token);
      if ('error' in r) {
        return reply.code(r.error === 'EXPIRED' ? 410 : 404).send({
          error: { code: r.error === 'EXPIRED' ? 'LINK_EXPIRED' : 'NOT_FOUND' },
        });
      }
      const missing = missingRequiredAnswers(r.record.answers);
      if (missing.length > 0) {
        return reply.code(409).send({
          error: { code: 'INCOMPLETE', missingFields: missing },
        });
      }
      const completedAt = new Date().toISOString();
      await db.upsertDiscoveryLite({
        engagementId: r.record.engagementId,
        completedAt,
      });
      const firmId = ((r.engagement as Record<string, unknown>).firmId as string | undefined) ?? '';
      try {
        await db.logActivity(
          r.record.engagementId,
          firmId,
          'DISCOVERY_LITE_COMPLETED',
          'Self-serve questionnaire submitted by prospect.',
        );
      } catch {
        // Best-effort — activity log failure shouldn't block submission.
      }

      // Phase 46.8.2 — notify the assigned sales rep that answers
      // landed. Looks up the rep by Engagement.salesRepUserId
      // (denormalised pointer set at quick-add time) and falls back
      // to firm-level SALES_MANAGER recipients when no rep is set.
      // Email failure is non-fatal — the prospect's submit shouldn't
      // fail because SMTP is down.
      try {
        const engRecord = r.engagement as Record<string, unknown>;
        const salesRepUserId = engRecord.salesRepUserId as string | null | undefined;
        const clientName = (engRecord.clientName as string | undefined) ?? 'a prospect';
        let recipients: Array<{ email: string; name: string }> = [];
        if (salesRepUserId) {
          const u = await db.findUserById(salesRepUserId);
          if (u && u.email) recipients.push({ email: u.email, name: u.name ?? '' });
        } else {
          const managers = await db.listFirmUsersByRole(firmId, 'SALES_MANAGER');
          recipients = managers
            .filter((m) => !!m.email)
            .map((m) => ({ email: m.email, name: m.name ?? '' }));
        }
        const { sendDiscoveryLiteCompletedEmail } = await import('../services/email.js');
        for (const rcpt of recipients) {
          if (!rcpt.email) continue;
          await sendDiscoveryLiteCompletedEmail(rcpt.email, {
            recipientName: rcpt.name || 'there',
            clientName,
            engagementId: r.record.engagementId,
          });
        }
      } catch {
        // Non-fatal — best-effort notification.
      }
      return reply.send({ data: { completedAt } });
    });
  });
}
