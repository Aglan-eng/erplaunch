import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { processJob } from '../services/generation.js';
import { streamJobZip } from '../services/archiveService.js';
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
import * as db from '../db/index.js';
import { generateAIAdvice, computeInputHash } from '../services/aiAdvisor.js';
import { generateFullProfile, generateSectionSuggestions } from '../services/aiProfileGenerator.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createId } from '@paralleldrive/cuid2';
import { findSectionLabel, flattenAdaptorSchemaToQuestions } from '../services/adaptorSchemaHelpers.js';
import type { Question as SharedQuestion } from '@ofoq/shared';

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

export async function engagementRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /engagements
  fastify.get('/engagements', async (request, reply) => {
    const engagements = await db.listEngagements(request.jwtUser.firmId);
    return reply.send({ data: engagements });
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
      return reply.send({
        data: {
          id: adaptorId,
          source: 'custom',
          manifest: row.parsedManifest,
          schema: row.parsedSchema,
          license: row.parsedLicense,
          phases: row.parsedPhases,
          generators: row.parsedGenerators,
          rules: { id: `custom:${slug}-rules`, version: '1.0.0', rules: [] },
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
  fastify.delete('/engagements/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    await db.deleteEngagement(id);
    return reply.code(204).send();
  });

  // PATCH /engagements/:id
  fastify.patch('/engagements/:id', async (request, reply) => {
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

    // Rule evaluation is NetSuite-specific today; skip for other adaptors
    // until Phase 4 routes through adaptor.rules. See license PUT for the
    // mirrored guard.
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
      await db.replaceConflicts(id, allConflicts.map((c) => ({
        ruleId: c.id,
        type: c.type,
        severity: c.severity,
        questionIds: c.questionIds,
        message: c.message,
        resolution: c.resolution,
      })));
    } else {
      await db.replaceConflicts(id, []);
    }
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

    // Re-evaluate rules with the updated license so conflict state stays in sync,
    // exactly as patchProfile does after saving answers. The rule engine today
    // is NetSuite-specific; other adaptors get a no-op evaluation (Phase 4 will
    // route through adaptor.rules once non-NetSuite rule packs exist).
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
      await db.replaceConflicts(id, allConflicts.map((c) => ({
        ruleId: c.id,
        type: c.type,
        severity: c.severity,
        questionIds: c.questionIds,
        message: c.message,
        resolution: c.resolution,
      })));
    } else {
      // Clear any stale NetSuite-shaped conflicts from a previous adaptor.
      await db.replaceConflicts(id, []);
    }

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
  fastify.post('/engagements/:id/generate', async (request, reply) => {
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
    if ((fastify as any).generationQueue) {
      try {
        await Promise.race([
          (fastify as any).generationQueue.add(
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
  fastify.get('/engagements/:id/jobs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const jobs = await db.listJobs(id);
    return reply.send({ data: jobs });
  });

  // GET /engagements/:id/jobs/:jobId
  fastify.get('/engagements/:id/jobs/:jobId', async (request, reply) => {
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
    const job = await db.findJobByIdAndEngagementId(jobId, id) as any;
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (job.status !== 'COMPLETE') return reply.code(400).send({ error: { code: 'JOB_NOT_COMPLETE', message: 'Job is not yet complete' } });
    const outputDir = path.join(__dirname, '..', '..', 'outputs', jobId);
    await streamJobZip(outputDir, jobId, reply);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Project Members
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // GET /engagements/:id/members
  fastify.get('/engagements/:id/members', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const members = await db.getMembers(id);
    return reply.send({ data: members });
  });

  // POST /engagements/:id/members
  fastify.post('/engagements/:id/members', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const body = request.body as { name: string; role: string; team?: string; email?: string; phone?: string };
    if (!body.name) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
    const member = await db.addMember(id, body);
    return reply.code(201).send({ data: member });
  });

  // DELETE /engagements/:id/members/:memberId
  fastify.delete('/engagements/:id/members/:memberId', async (request, reply) => {
    const { id, memberId } = request.params as { id: string; memberId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    await db.deleteMember(memberId, id);
    return reply.send({ data: { ok: true } });
  });

  // PATCH /engagements/:id/members/:memberId
  fastify.patch('/engagements/:id/members/:memberId', { onRequest: authenticate }, async (request, reply) => {
    const { id, memberId } = request.params as { id: string; memberId: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const body = request.body as any;
    const member = await db.updateMember(memberId, id, body);
    if (!member) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
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
  fastify.post('/engagements/:id/images', async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!check) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: { code: 'NO_FILE', message: 'No file uploaded' } });
    }

    const sectionKey = (data.fields?.sectionKey as any)?.value || 'unknown';
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(data.mimetype)) {
      return reply.code(400).send({ error: { code: 'INVALID_TYPE', message: 'Only PNG, JPG, WEBP, GIF allowed' } });
    }

    // Save file to disk
    const engDir = path.join(__dirname, '..', 'uploads', id);
    await fs.mkdir(engDir, { recursive: true });
    const ext = path.extname(data.filename) || '.png';
    const storedName = `${createId()}${ext}`;
    const filePath = path.join(engDir, storedName);

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    await fs.writeFile(filePath, Buffer.concat(chunks));

    const image = await db.addSectionImage(id, sectionKey, storedName, data.filename, data.mimetype);
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
    const comment = await db.getSectionComment(id, sectionKey);
    const conflicts = await db.getConflicts(id);

    const sectionConflicts = conflicts
      .filter((c: any) => {
        const qIds = c.questionIds as string[];
        return qIds?.some((q: string) => q.startsWith(`${sectionKey}.`));
      })
      .map((c: any) => ({
        message: c.message as string,
        severity: c.severity as string,
        resolution: c.resolution as string,
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
      comment: (comment?.text as string) || '',
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
    // NetSuite-only: the rule engine today only speaks the NetSuite rule
    // pack, so skip it for non-NetSuite adaptors and clear any stale
    // conflicts instead.
    if (adaptorId === 'netsuite') {
      const updatedLicense = await db.getLicense(id);
      const phases = await db.getPhases(id);
      const { conflicts, warnings, infos } = evaluate({
        answers: merged,
        license: (updatedLicense as unknown) as LicenseProfile,
        phases: ((phases || []) as unknown) as Phase[],
      });
      const allConflicts = [...conflicts, ...warnings, ...infos];
      await db.replaceConflicts(id, allConflicts.map((c) => ({
        ruleId: c.id,
        type: c.type,
        severity: c.severity,
        questionIds: c.questionIds,
        message: c.message,
        resolution: c.resolution,
      })));
    } else {
      await db.replaceConflicts(id, []);
    }

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
      { platform, adaptorQuestions },
    );

    return reply.send({ data: suggestions });
  });
}
