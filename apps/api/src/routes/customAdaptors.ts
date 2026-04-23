/**
 * Custom Adaptor routes (Phase 2)
 *
 * A custom adaptor lets a firm onboard any ERP / business system that isn't
 * a built-in (NetSuite / Odoo) by uploading vendor docs or their own
 * implementation playbook. The flow:
 *
 *   POST   /custom-adaptors                          — create (name, slug)
 *   POST   /custom-adaptors/:id/documents            — upload one PDF/DOCX/TXT
 *   POST   /custom-adaptors/:id/parse                — kick off Claude parse
 *   GET    /custom-adaptors                          — list for firm
 *   GET    /custom-adaptors/:id                      — get one with parsed draft
 *   PATCH  /custom-adaptors/:id/draft                — edit parsed fields
 *   POST   /custom-adaptors/:id/publish              — mark as PUBLISHED
 *   POST   /custom-adaptors/:id/archive              — soft-delete
 *
 * Every route is firm-scoped via request.jwtUser.firmId — a firm can only
 * see and mutate its own adaptors.
 */
import type { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createId } from '@paralleldrive/cuid2';
import {
  CreateCustomAdaptorSchema,
  UpdateCustomAdaptorDraftSchema,
} from '@ofoq/shared';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';
import { parseCustomAdaptor } from '../services/customAdaptorParse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../../uploads/custom-adaptors');

// Ensure upload directory exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]);

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB per file (matches fastify-multipart config)

export async function customAdaptorRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // ── List
  fastify.get('/custom-adaptors', async (request, reply) => {
    const rows = await db.listCustomAdaptorsForFirm(request.jwtUser.firmId);
    return reply.send({ data: rows });
  });

  // ── Create
  fastify.post('/custom-adaptors', async (request, reply) => {
    const parsed = CreateCustomAdaptorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    // Block slugs that collide with built-in adaptors so `custom:<slug>`
    // engagement IDs can never clash with a built-in adaptor id.
    const blocked = new Set(['netsuite', 'odoo', 'sap', 'oracle-fusion', 'ms-dynamics', 'erpnext']);
    if (blocked.has(parsed.data.slug)) {
      return reply.code(400).send({
        error: { code: 'SLUG_RESERVED', message: `"${parsed.data.slug}" is reserved for a built-in adaptor.` },
      });
    }

    const existing = await db.findCustomAdaptorByFirmAndSlug(request.jwtUser.firmId, parsed.data.slug);
    if (existing) {
      return reply.code(409).send({ error: { code: 'SLUG_TAKEN', message: `You already have a custom adaptor with slug "${parsed.data.slug}".` } });
    }

    const row = await db.createCustomAdaptor({
      firmId: request.jwtUser.firmId,
      name: parsed.data.name,
      slug: parsed.data.slug,
    });
    return reply.code(201).send({ data: row });
  });

  // ── Get one (firm-scoped)
  fastify.get('/custom-adaptors/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await db.findCustomAdaptorById(id);
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (row.firmId !== request.jwtUser.firmId) return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
    return reply.send({ data: row });
  });

  // ── Upload a single document
  fastify.post('/custom-adaptors/:id/documents', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await db.findCustomAdaptorById(id);
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (row.firmId !== request.jwtUser.firmId) return reply.code(403).send({ error: { code: 'FORBIDDEN' } });

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: { code: 'NO_FILE' } });

    if (!ALLOWED_MIME.has(file.mimetype)) {
      return reply.code(400).send({
        error: { code: 'UNSUPPORTED_MIME', message: `Unsupported file type: ${file.mimetype}. Upload PDF, DOCX, TXT, or MD.` },
      });
    }

    const ext = path.extname(file.filename) || '';
    const storedName = `${id}_${createId()}${ext}`;
    const absPath = path.join(UPLOADS_DIR, storedName);

    const buffer = await file.toBuffer();
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ error: { code: 'FILE_TOO_LARGE', message: 'Each file must be under 5 MB.' } });
    }
    fs.writeFileSync(absPath, buffer);

    const updated = await db.appendCustomAdaptorDocument(id, {
      filename: storedName,
      originalName: file.filename,
      mimeType: file.mimetype,
      size: buffer.length,
    });

    return reply.code(201).send({ data: updated });
  });

  // ── Kick off AI parse (non-blocking; client polls GET /:id for status)
  fastify.post('/custom-adaptors/:id/parse', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await db.findCustomAdaptorById(id);
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (row.firmId !== request.jwtUser.firmId) return reply.code(403).send({ error: { code: 'FORBIDDEN' } });

    if (!Array.isArray(row.sourceDocuments) || row.sourceDocuments.length === 0) {
      return reply.code(400).send({
        error: { code: 'NO_DOCUMENTS', message: 'Upload at least one source document before parsing.' },
      });
    }

    // Fire-and-forget. The parse service updates the row's status to
    // PARSING → READY or FAILED. If the process crashes mid-parse the row
    // stays in PARSING; a follow-up POST /parse can retry.
    parseCustomAdaptor({ customAdaptorId: id, uploadsDir: UPLOADS_DIR }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'unknown error';
      fastify.log.error(`[customAdaptor] parse for ${id} crashed: ${msg}`);
    });

    return reply.code(202).send({ data: { id, status: 'PARSING' } });
  });

  // ── Edit the parsed draft before publish
  fastify.patch('/custom-adaptors/:id/draft', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await db.findCustomAdaptorById(id);
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (row.firmId !== request.jwtUser.firmId) return reply.code(403).send({ error: { code: 'FORBIDDEN' } });

    const parsed = UpdateCustomAdaptorDraftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    // Merge — only overwrite fields the caller actually sent
    const updated = await db.savePlatformAdaptorDraft(id, {
      manifest: parsed.data.manifest ?? row.parsedManifest,
      schema: parsed.data.schema ?? row.parsedSchema,
      license: parsed.data.license ?? row.parsedLicense,
      phases: parsed.data.phases ?? row.parsedPhases,
      generators: parsed.data.generators ?? row.parsedGenerators,
    });

    return reply.send({ data: updated });
  });

  // ── Publish
  fastify.post('/custom-adaptors/:id/publish', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await db.findCustomAdaptorById(id);
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (row.firmId !== request.jwtUser.firmId) return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
    if (row.status !== 'READY' && row.status !== 'PUBLISHED') {
      return reply.code(400).send({
        error: { code: 'NOT_READY', message: `Adaptor is in status ${row.status}. Only READY adaptors can be published.` },
      });
    }
    const published = await db.publishCustomAdaptor(id);
    return reply.send({ data: published });
  });

  // ── Archive (soft-delete)
  fastify.post('/custom-adaptors/:id/archive', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await db.findCustomAdaptorById(id);
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (row.firmId !== request.jwtUser.firmId) return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
    await db.archiveCustomAdaptor(id);
    return reply.code(204).send();
  });
}
