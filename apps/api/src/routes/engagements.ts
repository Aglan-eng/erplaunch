import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { processJob } from '../services/generation.js';
import { streamJobZip } from '../services/archiveService.js';
import { buildFileTree, resolveSafePath, mimeForExtension } from '../services/jobFileTree.js';
import type { GenerationJobData } from '../plugins/queue.js';
import {
  CreateEngagementSchema,
  UpdateEngagementSchema,
  PatchProfileSchema,
  PutLicenseSchema,
  CreateJobSchema,
} from '@ofoq/shared';
import { evaluate } from '@ofoq/rule-engine';
import type { Phase, LicenseProfile } from '@ofoq/shared';
import { getAdaptorRegistry } from '@ofoq/adaptor-registry';
import { evaluateAdaptorRules, type RulePack } from '@ofoq/adaptor-sdk';
import * as db from '../db/index.js';
import { generateAIAdvice, computeInputHash } from '../services/aiAdvisor.js';
import { generateFullProfile, generateSectionSuggestions } from '../services/aiProfileGenerator.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createId } from '@paralleldrive/cuid2';
import { findSectionLabel, flattenAdaptorSchemaToQuestions } from '../services/adaptorSchemaHelpers.js';
import type { Question as SharedQuestion } from '@ofoq/shared';
import {
  nextStage,
  previousStage,
  toStage,
  handoffEventFor,
  handoffMessageFor,
} from '../services/lifecycleTransitions.js';
import {
  resolveVisibilityScope,
  applyVisibilityScope,
} from '../services/engagementVisibility.js';
import {
  filterEngagementForAccountant,
  filterEngagementListForAccountant,
  isAccountantOnly,
} from '../services/internalAccountantFilter.js';
import { listFirmRolesForUser, listEngagementRolesForUser } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve an adaptorId into a platform descriptor + a question bank usable
 * by the NetSuite-shaped AI services. Built-ins come from the process
 * registry; custom adaptors come from the firm's DB (only PUBLISHED rows
 * contribute context). Returns undefined fields when the adaptor is unknown
 * so callers can fall back to their pre-SPI defaults.
 */
async function resolveAdaptorContext(
  adaptorId: string,
  firmId: string,
): Promise<{
  platform?: { id: string; name: string; vendor?: string };
  adaptorQuestions?: SharedQuestion[];
}> {
  if (adaptorId.startsWith('custom:')) {
    const slug = adaptorId.slice('custom:'.length);
    const row = await db.findCustomAdaptorByFirmAndSlug(firmId, slug);
    if (!row || row.status !== 'PUBLISHED') return {};
    const manifest = (row.parsedManifest ?? {}) as { name?: string; vendor?: string };
    const schema = row.parsedSchema as Parameters<typeof flattenAdaptorSchemaToQuestions>[0];
    const questions = flattenAdaptorSchemaToQuestions(schema);
    return {
      platform: {
        id: adaptorId,
        name: manifest.name ?? row.name,
        vendor: manifest.vendor,
      },
      adaptorQuestions: questions.length > 0 ? questions : undefined,
    };
  }
  if (adaptorId === 'netsuite') return {}; // let callers use the legacy @ofoq/shared bank
  const adaptor = getAdaptorRegistry().find(adaptorId);
  if (!adaptor) return {};
  const questions = flattenAdaptorSchemaToQuestions(adaptor.schema as unknown as Parameters<typeof flattenAdaptorSchemaToQuestions>[0]);
  return {
    platform: {
      id: adaptorId,
      name: adaptor.manifest.name,
      vendor: adaptor.manifest.vendor,
    },
    adaptorQuestions: questions.length > 0 ? questions : undefined,
  };
}

/**
 * Return the RulePack for an adaptor. Built-in adapters source it from the
 * process-wide registry; custom adaptors source it from the firm's DB row
 * (Phase 14 — authored via PATCH /custom-adaptors/:id/draft). Returns null
 * when the adaptor has no rules to evaluate, which the caller treats as
 * "don't re-evaluate, just clear stale conflicts."
 */
async function resolveRulePack(adaptorId: string, firmId: string): Promise<RulePack | null> {
  if (adaptorId.startsWith('custom:')) {
    const slug = adaptorId.slice('custom:'.length);
    const row = await db.findCustomAdaptorByFirmAndSlug(firmId, slug);
    if (!row || row.status !== 'PUBLISHED') return null;
    const raw = row.parsedRules as RulePack | null | undefined;
    if (!raw || !Array.isArray(raw.rules) || raw.rules.length === 0) return null;
    return raw;
  }
  const reg = getAdaptorRegistry();
  const adaptor = reg.find(adaptorId);
  return adaptor?.rules ?? null;
}

export async function engagementRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements
  // Phase 37.1 — by default ARCHIVED engagements are filtered out so the
  // dashboard isn't cluttered with old test data. Pass ?includeArchived=true
  // (e.g., from an admin "Archived Engagements" view) to opt in.
  //
  // Phase 44.1 — engagement-list visibility filter. Firm-level roles see
  // every engagement; engagement-level-only roles see only the rows they
  // hold a current-stage assignment on (per VISIBILITY_RULES). A user
  // with no roles at all sees an empty list.
  fastify.get('/engagements', async (request, reply) => {
    const { includeArchived } = request.query as { includeArchived?: string };
    const engagements = await db.listEngagements(request.jwtUser.firmId, {
      includeArchived: includeArchived === 'true',
    });
    const scope = await resolveVisibilityScope({
      userId: request.jwtUser.userId,
      firmId: request.jwtUser.firmId,
    });
    const visible = applyVisibilityScope(
      engagements as Array<{ id: string }>,
      scope,
    );

    // Phase 44.2 — INTERNAL_ACCOUNTANT field-strip on the list. The
    // dashboard returns just structural + billing-shaped fields when
    // the user is an accountant with no other elevated firm role.
    // Engagement-level role mixing (e.g. accountant who's a PM on a
    // few deals) is detected per-engagement when they click through
    // to GET /engagements/:id below — the list itself uses the
    // simpler firm-only check.
    const firmRoles = await listFirmRolesForUser(request.jwtUser.userId);
    if (isAccountantOnly({ firmRoles, engagementRoles: [] })) {
      const stripped = filterEngagementListForAccountant(
        visible as Array<Record<string, unknown>>,
      );
      return reply.send({ data: stripped });
    }
    return reply.send({ data: visible });
  });

  // POST /engagements
  fastify.post('/engagements', async (request, reply) => {
    const result = CreateEngagementSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: result.error.message } });
    }

    // Adaptor validation: if caller picked an adaptor, confirm it's available
    // to this firm. Built-in adaptors live in the process-wide registry;
    // custom adaptors (prefix `custom:<slug>`) live per-firm in the DB.
    const registry = getAdaptorRegistry();
    const requestedAdaptorId = result.data.adaptorId ?? 'netsuite';
    const isCustom = requestedAdaptorId.startsWith('custom:');
    if (isCustom) {
      const slug = requestedAdaptorId.slice('custom:'.length);
      const custom = await db.findCustomAdaptorByFirmAndSlug(request.jwtUser.firmId, slug);
      if (!custom || custom.status !== 'PUBLISHED') {
        return reply.code(400).send({
          error: { code: 'UNKNOWN_ADAPTOR', message: `Custom adaptor "${slug}" is not published in your firm.` },
        });
      }
    } else if (!registry.has(requestedAdaptorId)) {
      return reply.code(400).send({
        error: { code: 'UNKNOWN_ADAPTOR', message: `Adaptor "${requestedAdaptorId}" is not available on this deployment.` },
      });
    }

    const engagement = await db.createEngagement({
      firmId: request.jwtUser.firmId,
      clientName: result.data.clientName,
      adaptorId: requestedAdaptorId,
    });
    return reply.code(201).send({ data: engagement });
  });

  // GET /engagements/:id
  fastify.get('/engagements/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementById(id);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (engagement.firmId !== request.jwtUser.firmId) return reply.code(403).send({ error: { code: 'FORBIDDEN' } });

    // Phase 44.2 — accountant field-strip on single-engagement read.
    // Pulls the user's engagement-level roles for THIS engagement so
    // a mixed-role user (accountant + PROJECT_LEAD on this deal) gets
    // the full payload. Pure accountants get the stripped one.
    const firmRoles = await listFirmRolesForUser(request.jwtUser.userId);
    const engRoleAssignments = await listEngagementRolesForUser(request.jwtUser.userId, id);
    const engRoles = engRoleAssignments.map((a) => a.role);
    if (isAccountantOnly({ firmRoles, engagementRoles: engRoles })) {
      return reply.send({ data: filterEngagementForAccountant(engagement as Record<string, unknown>) });
    }
    return reply.send({ data: engagement });
  });

  // GET /engagements/:id/adaptor — full PlatformAdaptor for this engagement
  // (built-in from the process-wide registry, or custom from DB). This is
  // what the wizard will read to render sections/questions, and what the
  // rule engine + generators should route through.
  fastify.get('/engagements/:id/adaptor', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementById(id) as (Record<string, unknown> & { firmId: string; adaptorId?: string }) | null;
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (engagement.firmId !== request.jwtUser.firmId) return reply.code(403).send({ error: { code: 'FORBIDDEN' } });

    const adaptorId = engagement.adaptorId ?? 'netsuite';

    if (adaptorId.startsWith('custom:')) {
      const slug = adaptorId.slice('custom:'.length);
      const row = await db.findCustomAdaptorByFirmAndSlug(request.jwtUser.firmId, slug);
      if (!row || row.status !== 'PUBLISHED') {
        return reply.code(404).send({ error: { code: 'ADAPTOR_NOT_PUBLISHED', message: `Custom adaptor "${slug}" is not published.` } });
      }
      // Phase 14: custom rules live in parsedRules when the firm has authored
      // them; otherwise return an empty pack so the SPA can still render the
      // rule count badge consistently (just as 0).
      const customRules = (row.parsedRules ?? { id: `custom:${slug}-rules`, version: '1.0.0', rules: [] });
      return reply.send({
        data: {
          id: adaptorId,
          source: 'custom',
          manifest: row.parsedManifest,
          schema: row.parsedSchema,
          license: row.parsedLicense,
          phases: row.parsedPhases,
          generators: row.parsedGenerators,
          rules: customRules,
        },
      });
    }

    const registry = getAdaptorRegistry();
    const adaptor = registry.find(adaptorId);
    if (!adaptor) {
      return reply.code(404).send({ error: { code: 'ADAPTOR_MISSING', message: `Adaptor "${adaptorId}" is not registered on this deployment.` } });
    }
    return reply.send({
      data: {
        id: adaptorId,
        source: 'built-in',
        manifest: adaptor.manifest,
        schema: adaptor.schema,
        license: adaptor.license,
        phases: adaptor.phases,
        generators: adaptor.generators,
        rules: adaptor.rules,
      },
    });
  });

  // DELETE /engagements/:id
  // Phase 37.1 — switch to cascade-delete inside a transaction. The previous
  // implementation hit SQLITE_CONSTRAINT (FOREIGN KEY) → 500 for any engagement
  // with related rows in tables that lack ON DELETE CASCADE. Now returns 404
  // (instead of 500) when the engagement was already deleted — making the
  // endpoint idempotent for clean-up scripts.
  fastify.delete('/engagements/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const deleted = await db.deleteEngagementCascade(id);
    if (!deleted) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    await db.logActivity(id, request.jwtUser.firmId, 'ENGAGEMENT_DELETED', `Deleted engagement: ${(check as Record<string, unknown>).clientName}`).catch(() => {
      // Activity log will fail because the engagement row no longer exists
      // (FK constraint). That's expected — the audit trail of a deletion
      // can't reference a row that was just deleted. Swallow.
    });
    return reply.code(204).send();
  });

  // Phase 37.1 — POST /engagements/:id/archive
  // Soft-archive: flips status to ARCHIVED and stashes previousStatus.
  // Idempotent (re-archiving an already-ARCHIVED engagement is a 200 no-op).
  fastify.post('/engagements/:id/archive', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const wasAlreadyArchived = (check as Record<string, unknown>).status === 'ARCHIVED';
    const updated = await db.archiveEngagement(id);
    if (!wasAlreadyArchived) {
      await db.logActivity(
        id,
        request.jwtUser.firmId,
        'ENGAGEMENT_ARCHIVED',
        `Archived engagement: ${(check as Record<string, unknown>).clientName}`,
      );
    }
    return reply.send({ data: updated });
  });

  // Phase 37.1 — POST /engagements/:id/unarchive
  // Restores the engagement's previousStatus, falling back to DISCOVERY when
  // no prior status was recorded.
  fastify.post('/engagements/:id/unarchive', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const updated = await db.unarchiveEngagement(id);
    if (!updated) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    await db.logActivity(
      id,
      request.jwtUser.firmId,
      'ENGAGEMENT_UNARCHIVED',
      `Restored engagement: ${(check as Record<string, unknown>).clientName}`,
    );
    return reply.send({ data: updated });
  });

  // PATCH /engagements/:id — Phase 44.3: WRITE-gated on ENGAGEMENT_META.
  fastify.patch('/engagements/:id', { preHandler: requirePermission('WRITE', 'ENGAGEMENT_META') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const result = UpdateEngagementSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: result.error.message } });
    }
    const updated = await db.updateEngagement(id, result.data);
    return reply.send({ data: updated });
  });

  // ─── Phase 43.3 — lifecycle stage transitions ─────────────────────────────
  //
  // Two routes that wrap updateEngagement with the canonical stage
  // ordering + handoff event firing. /advance and /regress are the
  // recommended entry points; PATCH /engagements/:id can still set
  // arbitrary status values for back-compat but won't fire handoffs.

  // POST /engagements/:id/advance — bump the stage forward by one.
  fastify.post('/engagements/:id/advance', async (request, reply) => {
    const { id } = request.params as { id: string };
    const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const currentStatus = ((eng as Record<string, unknown>).status as string | undefined) ?? 'DISCOVERY';
    const next = nextStage(currentStatus);
    if (!next) {
      return reply.code(409).send({
        error: {
          code: 'TERMINAL_STAGE',
          message: 'Engagement is at the terminal stage (ARCHIVED) — cannot advance further.',
        },
      });
    }
    // Phase 45.4 — refuse CLOSEOUT → SLA_ACTIVE unless both
    // CLIENT_SIGNOFF and SLA_TEAM_ACCEPT are DONE (or NA). The
    // checklist exists by virtue of the GOLIVE → CLOSEOUT transition
    // (Phase 45.1) and is the source of truth for "both parties have
    // explicitly signed off on the handover".
    if (toStage(currentStatus) === 'CLOSEOUT' && next === 'SLA_ACTIVE') {
      try {
        const items = await db.listCloseoutChecklist(id);
        const { canTransitionToSlaActive, TRANSITION_BLOCKERS } = await import(
          '../services/closeoutChecklist.js'
        );
        if (!canTransitionToSlaActive(items)) {
          const blocking = TRANSITION_BLOCKERS.filter((k) => {
            const item = items.find((i) => i.key === k);
            return !item || (item.status !== 'DONE' && item.status !== 'NA');
          });
          return reply.code(409).send({
            error: {
              code: 'DUAL_SIGNOFF_REQUIRED',
              message:
                `Cannot move to SLA_ACTIVE — both client sign-off and SLA team acceptance must be complete. Pending: ${blocking.join(', ')}.`,
              blocking,
            },
          });
        }
      } catch (err) {
        // If we can't read the checklist (shouldn't happen for a row in
        // CLOSEOUT) we err on the side of NOT advancing so a malformed
        // engagement can't slip through the gate.
        request.log.error({ err: String(err), engagementId: id }, 'closeout dual sign-off check failed');
        return reply.code(500).send({
          error: { code: 'SIGNOFF_CHECK_FAILED', message: 'Could not verify dual sign-off status.' },
        });
      }
    }
    const updated = await db.updateEngagement(id, { status: next });
    const fromStage = toStage(currentStatus);
    const event = handoffEventFor(fromStage, next);
    await db.logActivity(
      id,
      request.jwtUser.firmId,
      event,
      handoffMessageFor(event, fromStage, next),
    );
    // Phase 45.1 — when entering CLOSEOUT, auto-create the 9-item
    // checklist so the new step page has rows to render. Idempotent
    // — re-entering CLOSEOUT (advance after a regress) doesn't
    // duplicate. Failure is non-fatal since the checklist can be
    // re-bootstrapped manually if it somehow doesn't land.
    if (next === 'CLOSEOUT') {
      try {
        await db.createCloseoutChecklist(id);
      } catch (err) {
        request.log.warn({ err: String(err), engagementId: id }, 'closeout checklist auto-create failed');
      }
      // Phase 45.3 — fire the handoff event flow ONLY on the first
      // entry into CLOSEOUT. We detect re-entry by checking whether
      // a HANDOFF thread already exists for this engagement — if so,
      // skip so a regress + re-advance doesn't spawn duplicate
      // threads, jobs, or emails.
      try {
        const existingThreads = await (await import('../db/conversationThread.js'))
          .listConversationThreadsByEngagement(id);
        const alreadyHandedOff = existingThreads.some((t) => t.kind === 'HANDOFF');
        if (!alreadyHandedOff) {
          const { triggerCloseoutHandoff } = await import('../services/handoffEvents.js');
          await triggerCloseoutHandoff({
            engagementId: id,
            firmId: request.jwtUser.firmId,
            clientName: ((eng as Record<string, unknown>).clientName as string | undefined) ?? 'Engagement',
          });
        }
      } catch (err) {
        request.log.warn({ err: String(err), engagementId: id }, 'closeout handoff event flow failed');
      }
    }
    return reply.send({ data: updated, transition: { from: fromStage, to: next, event } });
  });

  // POST /engagements/:id/regress — move backwards by one.
  fastify.post('/engagements/:id/regress', async (request, reply) => {
    const { id } = request.params as { id: string };
    const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const currentStatus = ((eng as Record<string, unknown>).status as string | undefined) ?? 'DISCOVERY';
    const prev = previousStage(currentStatus);
    if (!prev) {
      return reply.code(409).send({
        error: {
          code: 'INITIAL_STAGE',
          message: 'Engagement is at the initial stage (PROSPECT) — cannot regress further.',
        },
      });
    }
    const updated = await db.updateEngagement(id, { status: prev });
    const fromStage = toStage(currentStatus);
    const event = handoffEventFor(fromStage, prev); // always ENGAGEMENT_REGRESSED
    await db.logActivity(
      id,
      request.jwtUser.firmId,
      event,
      handoffMessageFor(event, fromStage, prev),
    );
    return reply.send({ data: updated, transition: { from: fromStage, to: prev, event } });
  });

  // GET /engagements/:id/profile
  fastify.get('/engagements/:id/profile', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const profile = await db.getProfile(id);
    return reply.send({ data: profile });
  });

  // PATCH /engagements/:id/profile
  fastify.patch('/engagements/:id/profile', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const result = PatchProfileSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: result.error.message } });
    }
    const existing = await db.getProfile(id);
    const currentAnswers = (existing?.answers ?? {}) as Record<string, unknown>;
    const merged = { ...currentAnswers, ...result.data.answers };
    const profile = await db.upsertProfile(id, merged);

    // Phase 38.1 — single de-noised PROFILE_ANSWERED entry per PATCH. The
    // detail summarises which sections were touched (a) so the feed reads
    // human-friendly and (b) so we don't write N entries for a bulk save
    // (would drown out everything else).
    const newKeys = Object.keys(result.data.answers ?? {});
    if (newKeys.length > 0) {
      const sections = Array.from(new Set(newKeys.map((k) => k.split('.').slice(0, 2).join('.'))));
      const sectionList = sections.slice(0, 3).join(', ') + (sections.length > 3 ? `, +${sections.length - 3} more` : '');
      await db.logActivity(
        id,
        request.jwtUser.firmId,
        'PROFILE_ANSWERED',
        `Answered ${newKeys.length} question${newKeys.length === 1 ? '' : 's'}${sectionList ? ` in ${sectionList}` : ''}`,
      );
    }

    // Rule evaluation now branches per-adaptor:
    //   - netsuite → legacy hand-written rule engine (full answer+phases context)
    //   - else     → generic adaptor-sdk evaluator against adaptor.rules if the
    //     adaptor ships a rule pack; otherwise clears stale conflicts.
    const engagementAdaptorId = (check as { adaptorId?: string }).adaptorId ?? 'netsuite';
    let allConflicts: Array<{
      id: string; type: string; severity: string; questionIds: string[]; message: string; resolution: string;
    }> = [];
    if (engagementAdaptorId === 'netsuite') {
      const license = await db.getLicense(id);
      const phases = await db.getPhases(id);
      const ruleInput = {
        answers: merged,
        license: {
          id: license?.id as string ?? '',
          engagementId: id,
          edition: license?.edition as string ?? 'MID_MARKET',
          modules: (license?.modules as string[]) ?? [],
          updatedAt: new Date(),
        } as LicenseProfile,
        phases: (phases as unknown as Phase[]),
      };
      const { conflicts, warnings, infos } = evaluate(ruleInput);
      allConflicts = [...conflicts, ...warnings, ...infos];
      // NS Pack 1+ — NetSuite registry rules also evaluate via the
      // generic adaptor-sdk evaluator. Legacy `evaluate()` continues
      // to fire the LIC-* and R2R-* rules sourced from @ofoq/shared;
      // the registry's RulePack adds the new ns.foundation.* /
      // ns.tax.* / ns.localization.* rules. Append + de-dupe by rule
      // id so a rule listed in both sources doesn't surface twice.
      const pack = await resolveRulePack(engagementAdaptorId, request.jwtUser.firmId);
      if (pack) {
        const seen = new Set(allConflicts.map((c) => c.id));
        const packConflicts = evaluateAdaptorRules(pack, {
          answers: merged,
          license: {
            edition: (license?.edition as string) ?? 'MID_MARKET',
            modules: (license?.modules as string[]) ?? [],
          },
        });
        for (const c of packConflicts) if (!seen.has(c.id)) allConflicts.push(c);
      }
    } else {
      const pack = await resolveRulePack(engagementAdaptorId, request.jwtUser.firmId);
      if (pack) {
        const license = await db.getLicense(id);
        allConflicts = evaluateAdaptorRules(pack, {
          answers: merged,
          license: {
            edition: (license?.edition as string) ?? '',
            modules: (license?.modules as string[]) ?? [],
          },
        });
      }
    }
    await db.replaceConflicts(id, allConflicts.map((c) => ({
      ruleId: c.id,
      type: c.type,
      severity: c.severity,
      questionIds: c.questionIds,
      message: c.message,
      resolution: c.resolution,
    })));
    return reply.send({ data: { profile, conflicts: allConflicts } });
  });

  // POST /engagements/:id/copy-answers  — copy answers from another engagement
  fastify.post('/engagements/:id/copy-answers', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const { sourceEngagementId } = request.body as { sourceEngagementId: string };
    if (!sourceEngagementId) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'sourceEngagementId required' } });
    const sourceCheck = await db.findEngagementByIdAndFirmId(sourceEngagementId, request.jwtUser.firmId);
    if (!sourceCheck) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Source engagement not found' } });
    const sourceProfile = await db.getProfile(sourceEngagementId);
    if (!sourceProfile?.answers) return reply.send({ data: { copied: 0 } });
    const sourceAnswers = sourceProfile.answers as Record<string, unknown>;
    const existing = await db.getProfile(id);
    const currentAnswers = (existing?.answers ?? {}) as Record<string, unknown>;
    // Merge: existing answers take precedence (only fill blanks)
    const merged = { ...sourceAnswers, ...currentAnswers };
    await db.upsertProfile(id, merged);
    return reply.send({ data: { copied: Object.keys(sourceAnswers).length, total: Object.keys(merged).length } });
  });

  // GET /engagements/:id/license
  fastify.get('/engagements/:id/license', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const license = await db.getLicense(id);
    return reply.send({ data: license });
  });

  // PUT /engagements/:id/license
  fastify.put('/engagements/:id/license', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const result = PutLicenseSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: result.error.message } });
    }
    const license = await db.upsertLicense(id, result.data);
    // upsertLicense always persists then re-reads, so null here would be a
    // genuine data-integrity bug worth surfacing loudly rather than papering
    // over with defaults.
    if (!license) {
      return reply.code(500).send({ error: { code: 'LICENSE_PERSIST_FAILED' } });
    }
    // Phase 38.1 — emit LICENSE_UPDATED with a one-line summary of what
    // shifted so the activity feed shows edition/module changes inline.
    const moduleSummary = (result.data.modules ?? []).slice(0, 3).join(', ') + ((result.data.modules?.length ?? 0) > 3 ? `, +${(result.data.modules?.length ?? 0) - 3} more` : '');
    await db.logActivity(
      id,
      request.jwtUser.firmId,
      'LICENSE_UPDATED',
      `Set license to ${result.data.edition}${moduleSummary ? ` with modules: ${moduleSummary}` : ''}`,
    );

    // Re-evaluate rules with the updated license so conflict state stays in
    // sync (mirrors PATCH /profile). Dispatch on adaptor: NetSuite → legacy
    // rule engine; everything else → generic adaptor-sdk evaluator.
    const engagementAdaptorId = (check as { adaptorId?: string }).adaptorId ?? 'netsuite';
    let allConflicts: Array<{
      id: string; type: string; severity: string; questionIds: string[]; message: string; resolution: string;
    }> = [];
    if (engagementAdaptorId === 'netsuite') {
      const profile = await db.getProfile(id);
      const phases = await db.getPhases(id);
      const ruleInput = {
        answers: (profile?.answers ?? {}) as Record<string, unknown>,
        license: {
          id: (license.id as string) ?? '',
          engagementId: id,
          edition: (license.edition as string) ?? 'MID_MARKET',
          modules: (license.modules as string[]) ?? [],
          updatedAt: new Date(),
        } as LicenseProfile,
        phases: (phases as unknown as Phase[]),
      };
      const { conflicts, warnings, infos } = evaluate(ruleInput);
      allConflicts = [...conflicts, ...warnings, ...infos];
      // NS Pack 1+ — also run the registry-side RulePack against the
      // updated license. See PATCH /profile for the rationale.
      const pack = await resolveRulePack(engagementAdaptorId, request.jwtUser.firmId);
      if (pack) {
        const seen = new Set(allConflicts.map((c) => c.id));
        const packConflicts = evaluateAdaptorRules(pack, {
          answers: (profile?.answers ?? {}) as Record<string, unknown>,
          license: {
            edition: (license.edition as string) ?? 'MID_MARKET',
            modules: (license.modules as string[]) ?? [],
          },
        });
        for (const c of packConflicts) if (!seen.has(c.id)) allConflicts.push(c);
      }
    } else {
      const pack = await resolveRulePack(engagementAdaptorId, request.jwtUser.firmId);
      if (pack) {
        const profile = await db.getProfile(id);
        allConflicts = evaluateAdaptorRules(pack, {
          answers: (profile?.answers ?? {}) as Record<string, unknown>,
          license: {
            edition: (license.edition as string) ?? '',
            modules: (license.modules as string[]) ?? [],
          },
        });
      }
    }
    await db.replaceConflicts(id, allConflicts.map((c) => ({
      ruleId: c.id,
      type: c.type,
      severity: c.severity,
      questionIds: c.questionIds,
      message: c.message,
      resolution: c.resolution,
    })));

    return reply.send({ data: { license, conflicts: allConflicts } });
  });

  // GET /engagements/:id/phases
  fastify.get('/engagements/:id/phases', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const phases = await db.getPhases(id);
    return reply.send({ data: phases });
  });

  // PUT /engagements/:id/phases
  fastify.put('/engagements/:id/phases', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const phases = request.body as Array<{ name: string; order: number; flows: string[]; trigger?: string; status?: string }>;
    const updated = await db.replacePhases(id, phases);
    return reply.send({ data: updated });
  });

  // GET /engagements/:id/generators — the generator catalog from the active
  // adaptor (built-in or published custom). The frontend uses this to render
  // a dynamic Generate panel instead of hard-coding NetSuite job types.
  fastify.get('/engagements/:id/generators', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementById(id) as (Record<string, unknown> & { firmId: string; adaptorId?: string }) | null;
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (engagement.firmId !== request.jwtUser.firmId) return reply.code(403).send({ error: { code: 'FORBIDDEN' } });

    const adaptorId = engagement.adaptorId ?? 'netsuite';
    let generators: unknown[] = [];
    if (adaptorId.startsWith('custom:')) {
      const slug = adaptorId.slice('custom:'.length);
      const row = await db.findCustomAdaptorByFirmAndSlug(request.jwtUser.firmId, slug);
      if (row?.status === 'PUBLISHED' && Array.isArray(row.parsedGenerators)) {
        generators = row.parsedGenerators as unknown[];
      }
    } else {
      const adaptor = getAdaptorRegistry().find(adaptorId);
      if (adaptor) generators = adaptor.generators;
    }
    return reply.send({ data: generators });
  });

  // POST /engagements/:id/generate
  fastify.post('/engagements/:id/generate', { preHandler: requirePermission('WRITE', 'GENERATORS') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const result = CreateJobSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: result.error.message } });
    }
    const job = await db.createJob(id, result.data.type);
    const jobId = job!.id as string;

    // Enqueue via BullMQ when available; fall back to setImmediate otherwise.
    // Use a 3-second timeout so the HTTP response is never blocked by Redis being down.
    let queued = false;
    type FastifyWithQueue = typeof fastify & { generationQueue?: { add: (...args: unknown[]) => Promise<unknown> } };
    const fastifyWithQueue = fastify as FastifyWithQueue;
    if (fastifyWithQueue.generationQueue) {
      try {
        await Promise.race([
          fastifyWithQueue.generationQueue.add(
            'generate',
            { jobId } satisfies GenerationJobData,
            { jobId }
          ),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('queue_timeout')), 3000)
          ),
        ]);
        queued = true;
      } catch {
        fastify.log.warn('BullMQ enqueue failed — falling back to setImmediate for job ' + jobId);
      }
    }
    if (!queued) {
      setImmediate(() => processJob(jobId, db));
    }

    return reply.code(201).send({ data: job });
  });

  // GET /engagements/:id/jobs
  fastify.get('/engagements/:id/jobs', { preHandler: requirePermission('READ', 'GENERATORS') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const jobs = await db.listJobs(id);
    return reply.send({ data: jobs });
  });

  // GET /engagements/:id/jobs/:jobId
  fastify.get('/engagements/:id/jobs/:jobId', { preHandler: requirePermission('READ', 'GENERATORS') }, async (request, reply) => {
    const { id, jobId } = request.params as { id: string; jobId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const job = await db.findJobByIdAndEngagementId(jobId, id);
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.send({ data: job });
  });

  // GET /engagements/:id/jobs/:jobId/download — stream full output as ZIP
  fastify.get('/engagements/:id/jobs/:jobId/download', async (request, reply) => {
    const { id, jobId } = request.params as { id: string; jobId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const job = await db.findJobByIdAndEngagementId(jobId, id);
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if ((job as { status?: string }).status !== 'COMPLETE') return reply.code(400).send({ error: { code: 'JOB_NOT_COMPLETE', message: 'Job is not yet complete' } });
    const outputDir = path.join(__dirname, '..', '..', 'outputs', jobId);
    await streamJobZip(outputDir, jobId, reply);
  });

  // Phase 39.3 — GET /engagements/:id/jobs/:jobId/files
  // Returns the JSON tree of the job's output directory (folder hierarchy
  // + file names + sizes, no content). Powers the deliverable browser UI's
  // sidebar.
  fastify.get('/engagements/:id/jobs/:jobId/files', async (request, reply) => {
    const { id, jobId } = request.params as { id: string; jobId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const job = await db.findJobByIdAndEngagementId(jobId, id);
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const outputDir = path.join(__dirname, '..', '..', 'outputs', jobId);
    if (!await fs.access(outputDir).then(() => true).catch(() => false)) {
      // No output yet — return an empty tree rather than 404 so the UI can
      // render a "this job hasn't been run yet" empty state.
      return reply.send({ data: { name: '', type: 'dir', children: [] } });
    }
    const tree = await buildFileTree(outputDir);
    return reply.send({ data: tree });
  });

  // Phase 39.3 — GET /engagements/:id/jobs/:jobId/files/*
  // Streams a single file's content with appropriate Content-Type. The
  // `*` wildcard captures the relative path inside the job's output dir;
  // resolveSafePath() rejects anything that escapes via `..`.
  fastify.get('/engagements/:id/jobs/:jobId/files/*', async (request, reply) => {
    const { id, jobId } = request.params as { id: string; jobId: string; '*': string };
    const subPath = (request.params as Record<string, string>)['*'];
    if (!subPath) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'file path required' } });
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const job = await db.findJobByIdAndEngagementId(jobId, id);
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const outputDir = path.join(__dirname, '..', '..', 'outputs', jobId);
    const safePath = resolveSafePath(outputDir, subPath);
    if (!safePath) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const buf = await fs.readFile(safePath);
    return reply
      .header('Content-Type', mimeForExtension(safePath))
      .header('Cache-Control', 'no-cache')
      .send(buf);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Phase 47.2 — Microsoft Project Schedule XML — direct download
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // GET /engagements/:id/project-plan/latest.xml — convenience endpoint
  // that streams the latest COMPLETE MS_PROJECT_PLAN job's Project_Plan.xml.
  // Bookmark-able URL pattern that powers the dashboard kanban quick-download
  // icon and the engagement page "Open in MS Project" link. Returns 404 when
  // no completed job exists yet — the UI then prompts the user to generate
  // one. Content-Disposition uses the engagement's clientName so the file
  // saves as "<Client> - Project Plan.xml" instead of the opaque jobId path.
  fastify.get('/engagements/:id/project-plan/latest.xml', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const jobs = (await db.listJobs(id)) as Array<Record<string, unknown>>;
    const latest = jobs.find(
      (j) => (j.type as string) === 'MS_PROJECT_PLAN' && (j.status as string) === 'COMPLETE',
    );
    if (!latest) {
      return reply.code(404).send({
        error: {
          code: 'NO_PROJECT_PLAN',
          message:
            'No completed MS_PROJECT_PLAN job exists for this engagement yet. Generate one via POST /engagements/:id/generate first.',
        },
      });
    }
    const jobId = latest.id as string;
    const filePath = path.join(__dirname, '..', '..', 'outputs', jobId, 'Project_Plan.xml');
    const exists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      // The job row claims COMPLETE but the file isn't on disk — outputs
      // dir was wiped or the worker crashed mid-write. Nudge the caller to
      // regenerate rather than serve a partial / empty file.
      return reply.code(404).send({
        error: {
          code: 'PROJECT_PLAN_MISSING',
          message: 'The Project_Plan.xml file for the latest completed job is missing. Regenerate the plan.',
        },
      });
    }
    const buf = await fs.readFile(filePath);
    const safeClientName = String((check as Record<string, unknown>).clientName ?? 'Project_Plan')
      .replace(/[^A-Za-z0-9._\- ]+/g, '_')
      .trim();
    return reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="${safeClientName} - Project Plan.xml"`,
      )
      .header('Cache-Control', 'no-cache')
      .send(buf);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Project Members
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // GET /engagements/:id/members
  fastify.get('/engagements/:id/members', { preHandler: requirePermission('READ', 'MEMBERS') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const members = await db.getMembers(id);
    return reply.send({ data: members });
  });

  // POST /engagements/:id/members
  fastify.post('/engagements/:id/members', { preHandler: requirePermission('WRITE', 'MEMBERS') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const body = request.body as { name: string; role: string; team?: string; email?: string; phone?: string };
    if (!body.name) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
    const member = await db.addMember(id, body);
    // Phase 38.1 — surface team membership changes in the activity feed.
    const teamLabel = body.team === 'CONSULTANT' ? 'consultant team' : 'client team';
    await db.logActivity(id, request.jwtUser.firmId, 'MEMBER_ADDED', `Added ${body.name} (${body.role}) to the ${teamLabel}`);
    return reply.code(201).send({ data: member });
  });

  // DELETE /engagements/:id/members/:memberId
  fastify.delete('/engagements/:id/members/:memberId', { preHandler: requirePermission('WRITE', 'MEMBERS') }, async (request, reply) => {
    const { id, memberId } = request.params as { id: string; memberId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    // Phase 38.1 — capture name BEFORE delete so the activity entry has
    // something to display.
    const members = await db.getMembers(id);
    const target = members.find((m) => (m as Record<string, unknown>).id === memberId);
    await db.deleteMember(memberId, id);
    if (target) {
      const targetName = (target as Record<string, unknown>).name as string;
      await db.logActivity(id, request.jwtUser.firmId, 'MEMBER_REMOVED', `Removed ${targetName} from the team`);
    }
    return reply.send({ data: { ok: true } });
  });

  // PATCH /engagements/:id/members/:memberId
  fastify.patch('/engagements/:id/members/:memberId', {
    onRequest: authenticate,
    preHandler: requirePermission('WRITE', 'MEMBERS'),
  }, async (request, reply) => {
    const { id, memberId } = request.params as { id: string; memberId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const body = request.body as Parameters<typeof db.updateMember>[2];
    const member = await db.updateMember(memberId, id, body);
    if (!member) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const memberName = (member as Record<string, unknown>).name as string;
    await db.logActivity(id, request.jwtUser.firmId, 'MEMBER_UPDATED', `Updated ${memberName}`);
    return reply.send({ data: member });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section Comments
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // GET /engagements/:id/comments
  fastify.get('/engagements/:id/comments', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const comments = await db.getSectionComments(id);
    return reply.send({ data: comments });
  });

  // PUT /engagements/:id/comments/:sectionKey
  fastify.put('/engagements/:id/comments/:sectionKey', async (request, reply) => {
    const { id, sectionKey } = request.params as { id: string; sectionKey: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const { text } = request.body as { text: string };
    if (typeof text !== 'string') {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'text is required' } });
    }
    const comment = await db.upsertSectionComment(id, sectionKey, text);
    return reply.send({ data: comment });
  });

  // Phase 38.2 — POST /engagements/:id/comments
  // Multi-comment-per-section (thread) creator. The legacy PUT path stays
  // for the wizard's auto-saved single-note-per-section UI.
  fastify.post('/engagements/:id/comments', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const body = (request.body ?? {}) as { sectionKey?: unknown; body?: unknown; mentionMemberIds?: unknown };
    if (typeof body.sectionKey !== 'string' || !body.sectionKey.trim()) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'sectionKey is required' } });
    }
    if (typeof body.body !== 'string' || !body.body.trim()) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'body is required' } });
    }
    const mentions = Array.isArray(body.mentionMemberIds)
      ? body.mentionMemberIds.filter((m): m is string => typeof m === 'string')
      : undefined;
    const comment = await db.createSectionComment({
      engagementId: id,
      sectionKey: body.sectionKey,
      body: body.body,
      authorUserId: request.jwtUser.userId,
      mentionMemberIds: mentions,
    });
    await db.logActivity(
      id,
      request.jwtUser.firmId,
      'SECTION_COMMENTED',
      `Commented on ${body.sectionKey}: ${body.body.length > 80 ? `${body.body.slice(0, 80)}…` : body.body}`,
    );
    return reply.code(201).send({ data: comment });
  });

  // Phase 38.2 — PATCH /engagements/:id/comments/:commentId
  fastify.patch('/engagements/:id/comments/:commentId', async (request, reply) => {
    const { id, commentId } = request.params as { id: string; commentId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const existing = await db.findSectionCommentById(commentId);
    if (!existing || (existing as Record<string, unknown>).engagementId !== id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }
    const body = (request.body ?? {}) as { body?: unknown };
    if (typeof body.body !== 'string' || !body.body.trim()) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'body is required' } });
    }
    const updated = await db.updateSectionCommentBody(commentId, body.body);
    return reply.send({ data: updated });
  });

  // Phase 38.2 — DELETE /engagements/:id/comments/:commentId
  fastify.delete('/engagements/:id/comments/:commentId', async (request, reply) => {
    const { id, commentId } = request.params as { id: string; commentId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const existing = await db.findSectionCommentById(commentId);
    if (!existing || (existing as Record<string, unknown>).engagementId !== id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }
    await db.deleteSectionCommentById(commentId);
    return reply.code(204).send();
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section Images
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // GET /engagements/:id/images
  fastify.get('/engagements/:id/images', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const images = await db.getSectionImages(id);
    return reply.send({ data: images });
  });

  // POST /engagements/:id/images (multipart file upload)
  // Phase 38.2 — MIME re-validation, 10MB explicit cap, SECTION_IMAGE_ADDED
  // activity hook. Server-level multipart cap is 11MB (one over the route
  // cap) so this route's check returns 413 cleanly instead of letting the
  // multipart layer throw mid-stream.
  fastify.post('/engagements/:id/images', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const SECTION_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: { code: 'NO_FILE', message: 'No file uploaded' } });
    }

    const sectionKey = (data.fields?.sectionKey as { value?: string } | undefined)?.value || 'unknown';
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(data.mimetype)) {
      return reply.code(400).send({ error: { code: 'INVALID_TYPE', message: 'Only PNG, JPG, WEBP, GIF allowed' } });
    }

    // Stream-buffer with byte counting so a 12MB upload is rejected with a
    // clean 413 instead of a generic multipart throw.
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of data.file) {
      totalBytes += chunk.length;
      if (totalBytes > SECTION_IMAGE_MAX_BYTES) {
        return reply.code(413).send({
          error: {
            code: 'FILE_TOO_LARGE',
            message: `Section images must be under ${SECTION_IMAGE_MAX_BYTES / (1024 * 1024)} MB.`,
          },
        });
      }
      chunks.push(chunk);
    }

    // Save file to disk
    const engDir = path.join(__dirname, '..', 'uploads', id);
    await fs.mkdir(engDir, { recursive: true });
    const ext = path.extname(data.filename) || '.png';
    const storedName = `${createId()}${ext}`;
    const filePath = path.join(engDir, storedName);
    await fs.writeFile(filePath, Buffer.concat(chunks));

    const image = await db.addSectionImage(id, sectionKey, storedName, data.filename, data.mimetype);
    await db.logActivity(
      id,
      request.jwtUser.firmId,
      'SECTION_IMAGE_ADDED',
      `Added image to ${sectionKey}: ${data.filename}`,
    );
    return reply.code(201).send({ data: image });
  });

  // DELETE /engagements/:id/images/:imageId
  fastify.delete('/engagements/:id/images/:imageId', async (request, reply) => {
    const { id, imageId } = request.params as { id: string; imageId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const image = await db.deleteSectionImage(imageId);
    if (image) {
      const filePath = path.join(__dirname, '..', 'uploads', id, image.filename as string);
      try { await fs.unlink(filePath); } catch { /* file may not exist */ }
    }
    return reply.send({ data: { ok: true } });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // AI Implementation Expert
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // GET /engagements/:id/ai-advice/:sectionKey (get cached)
  fastify.get('/engagements/:id/ai-advice/:sectionKey', async (request, reply) => {
    const { id, sectionKey } = request.params as { id: string; sectionKey: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const advice = await db.getAIAdvice(id, sectionKey);
    return reply.send({ data: advice });
  });

  // GET /engagements/:id/ai-advice (get all cached advice)
  fastify.get('/engagements/:id/ai-advice', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const allAdvice = await db.getAllAIAdvice(id);
    return reply.send({ data: allAdvice });
  });

  // POST /engagements/:id/ai-advice/:sectionKey (generate / refresh)
  fastify.post('/engagements/:id/ai-advice/:sectionKey', async (request, reply) => {
    const { id, sectionKey } = request.params as { id: string; sectionKey: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    // Gather context
    const profile = await db.getProfile(id);
    const answers = (profile?.answers ?? {}) as Record<string, unknown>;
    const license = await db.getLicense(id);
    // Phase 39.4 — pull the full comment thread for this section, not just
    // the first row. Phase 38.2 made section comments multi-per-section but
    // the advisor was still reading getSectionComment() (single row), so
    // additional consultant context was silently dropped from the prompt.
    const commentText = await db.listSectionCommentBodies(id, sectionKey);
    const conflicts = await db.getConflicts(id);

    type ConflictRow = { questionIds?: string[]; message: string; severity: string; resolution: string };
    const sectionConflicts = (conflicts as ConflictRow[])
      .filter((c) => c.questionIds?.some((q) => q.startsWith(`${sectionKey}.`)))
      .map((c) => ({
        message: c.message,
        severity: c.severity,
        resolution: c.resolution,
      }));

    // Platform context (Phase 7) — look up the engagement's adaptor so the
    // advisor prompt is framed correctly for the target system.
    const adaptorId = (check as { adaptorId?: string }).adaptorId ?? 'netsuite';
    let platformContext: { id: string; name: string; vendor?: string; sectionLabel?: string } | undefined;
    if (adaptorId.startsWith('custom:')) {
      const slug = adaptorId.slice('custom:'.length);
      const row = await db.findCustomAdaptorByFirmAndSlug(request.jwtUser.firmId, slug);
      if (row?.status === 'PUBLISHED') {
        const manifest = (row.parsedManifest ?? {}) as { name?: string; vendor?: string };
        const schema = (row.parsedSchema ?? {}) as { flows?: Array<{ sections?: Array<{ id?: string; label?: string }> }> };
        const sectionLabel = findSectionLabel(schema, sectionKey);
        platformContext = {
          id: adaptorId,
          name: manifest.name ?? row.name,
          vendor: manifest.vendor,
          sectionLabel,
        };
      }
    } else {
      const adaptor = getAdaptorRegistry().find(adaptorId);
      if (adaptor) {
        const sectionLabel = findSectionLabel(adaptor.schema as unknown as { flows?: Array<{ sections?: Array<{ id?: string; label?: string }> }> }, sectionKey);
        platformContext = {
          id: adaptorId,
          name: adaptor.manifest.name,
          vendor: adaptor.manifest.vendor,
          sectionLabel,
        };
      }
    }

    const advisorInput = {
      sectionKey,
      answers,
      comment: commentText,
      license: {
        edition: (license?.edition as string) || 'MID_MARKET',
        modules: (license?.modules as string[]) || [],
      },
      conflicts: sectionConflicts,
      platform: platformContext,
    };

    // Check if cached result is still fresh
    const inputHash = computeInputHash(advisorInput);
    const cached = await db.getAIAdvice(id, sectionKey);
    if (cached && cached.answersHash === inputHash) {
      return reply.send({ data: cached });
    }

    // Generate new advice
    const advice = await generateAIAdvice(advisorInput);
    const stored = await db.upsertAIAdvice(id, sectionKey, advice, inputHash);
    return reply.send({ data: stored });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // AI Profile Generation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // POST /engagements/:id/generate-profile — AI generates full business profile
  fastify.post('/engagements/:id/generate-profile', async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as {
      industry: string;
      companySize: 'SMALL' | 'MEDIUM' | 'LARGE' | 'ENTERPRISE';
      country: string;
      additionalContext?: string;
    };

    if (!body.industry || !body.companySize || !body.country) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'industry, companySize, and country are required' } });
    }

    const license = await db.getLicense(id);

    // Phase 8: resolve the engagement's adaptor so the AI profile generator
    // can prompt against the right platform + question bank.
    const engRow = engagement as Record<string, unknown>;
    const adaptorId = (engRow.adaptorId as string | undefined) ?? 'netsuite';
    const { platform, adaptorQuestions } = await resolveAdaptorContext(adaptorId, request.jwtUser.firmId);

    const result = await generateFullProfile({
      clientName: engRow.clientName as string,
      industry: body.industry,
      companySize: body.companySize,
      country: body.country,
      additionalContext: body.additionalContext,
      license: license ? {
        edition: (license.edition as string) || 'MID_MARKET',
        modules: (license.modules as string[]) || [],
      } : undefined,
      platform,
      adaptorQuestions,
    });

    // Merge AI answers with existing (AI fills blanks, doesn't overwrite)
    const profile = await db.getProfile(id);
    const existingAnswers = (profile?.answers ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...existingAnswers };

    for (const [key, value] of Object.entries(result.answers)) {
      if (!(key in merged) || merged[key] === null || merged[key] === undefined || merged[key] === '') {
        merged[key] = value;
      }
    }

    // Save merged profile
    await db.upsertProfile(id, merged);

    // Re-evaluate rules — mirror the pattern used after license + profile edits
    // (see earlier handlers in this file) so a single conflict surface stays
    // authoritative regardless of which code path triggered re-evaluation.
    // Phase 12: non-NetSuite adaptors now route through the generic
    // evaluator instead of always clearing their conflicts.
    let allConflicts: Array<{ id: string; type: string; severity: string; questionIds: string[]; message: string; resolution: string; }> = [];
    if (adaptorId === 'netsuite') {
      const updatedLicense = await db.getLicense(id);
      const phases = await db.getPhases(id);
      const { conflicts, warnings, infos } = evaluate({
        answers: merged,
        license: (updatedLicense as unknown) as LicenseProfile,
        phases: ((phases || []) as unknown) as Phase[],
      });
      allConflicts = [...conflicts, ...warnings, ...infos];
      // NS Pack 1+ — also run the registry-side RulePack alongside
      // the legacy evaluator. See PATCH /profile for the rationale.
      const pack = await resolveRulePack(adaptorId, request.jwtUser.firmId);
      if (pack) {
        const seen = new Set(allConflicts.map((c) => c.id));
        const packConflicts = evaluateAdaptorRules(pack, {
          answers: merged,
          license: {
            edition: (updatedLicense?.edition as string) ?? 'MID_MARKET',
            modules: (updatedLicense?.modules as string[]) ?? [],
          },
        });
        for (const c of packConflicts) if (!seen.has(c.id)) allConflicts.push(c);
      }
    } else {
      const pack = await resolveRulePack(adaptorId, request.jwtUser.firmId);
      if (pack) {
        const updatedLicense = await db.getLicense(id);
        allConflicts = evaluateAdaptorRules(pack, {
          answers: merged,
          license: {
            edition: (updatedLicense?.edition as string) ?? '',
            modules: (updatedLicense?.modules as string[]) ?? [],
          },
        });
      }
    }
    await db.replaceConflicts(id, allConflicts.map((c) => ({
      ruleId: c.id,
      type: c.type,
      severity: c.severity,
      questionIds: c.questionIds,
      message: c.message,
      resolution: c.resolution,
    })));

    await db.logActivity(id, request.jwtUser.firmId, 'PROFILE_GENERATED', `AI generated ${Object.keys(result.answers).length} answers for business profile`);

    return reply.send({
      data: {
        answersGenerated: Object.keys(result.answers).length,
        answersApplied: Object.keys(merged).length - Object.keys(existingAnswers).length,
        confidence: result.confidence,
        notes: result.notes,
        summary: result.summary,
      },
    });
  });

  // POST /engagements/:id/suggest-answers/:sectionKey — AI suggests answers for a section
  fastify.post('/engagements/:id/suggest-answers/:sectionKey', async (request, reply) => {
    const { id, sectionKey } = request.params as { id: string; sectionKey: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const profile = await db.getProfile(id);
    const answers = (profile?.answers ?? {}) as Record<string, unknown>;
    const license = await db.getLicense(id);

    const body = (request.body || {}) as { industry?: string; companySize?: string; country?: string };

    // Phase 8: plumb adaptor context so suggestions come from the right
    // platform's expert persona + question bank.
    const engRow = engagement as Record<string, unknown>;
    const adaptorId = (engRow.adaptorId as string | undefined) ?? 'netsuite';
    const { platform, adaptorQuestions } = await resolveAdaptorContext(adaptorId, request.jwtUser.firmId);

    // Phase 40.5 — fold engagement context (risks, decisions, members)
    // into the suggestion prompt so Claude's recommendations stay
    // consistent with what the team has already agreed to. Each fetch
    // is independently tolerant of missing data so a brand-new
    // engagement still gets useful suggestions.
    const [riskRows, decisionRows, memberRows] = await Promise.all([
      db.listRisks(id).catch(() => []),
      db.listDecisions(id).catch(() => []),
      db.getMembers(id).catch(() => []),
    ]);
    const engagementContext = {
      risks: (riskRows as Array<Record<string, unknown>>).map((r) => ({
        title: String(r.title ?? ''),
        severity: r.severity ? String(r.severity) : undefined,
      })),
      decisions: (decisionRows as Array<Record<string, unknown>>).map((d) => ({
        title: String(d.title ?? ''),
      })),
      members: (memberRows as Array<Record<string, unknown>>).map((m) => ({
        name: String(m.name ?? ''),
        role: String(m.role ?? ''),
      })),
    };

    const suggestions = await generateSectionSuggestions(
      sectionKey,
      answers,
      {
        industry: body.industry || 'General',
        companySize: body.companySize || 'MEDIUM',
        country: body.country || 'UAE',
      },
      {
        edition: (license?.edition as string) || 'MID_MARKET',
        modules: (license?.modules as string[]) || [],
      },
      { platform, adaptorQuestions, engagementContext },
    );

    return reply.send({ data: suggestions });
  });
}
