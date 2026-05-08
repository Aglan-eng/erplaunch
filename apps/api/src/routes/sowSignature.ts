/**
 * Phase 46.5 — SOW signature flow routes.
 *
 * Consultant side (auth + ENGAGEMENT_META gate):
 *   GET    /engagements/:id/sow-signatures
 *                                       — list all signature attempts
 *                                         for an engagement
 *   POST   /engagements/:id/sow-signatures/docusign
 *                                       — create + send DocuSign envelope
 *                                         for the latest SOW version
 *   POST   /engagements/:id/sow-signatures/manual-upload
 *                                       — register a manually-signed PDF
 *                                         (multipart upload, PDF-only, 10MB cap)
 *
 * Webhook (no auth — DocuSign HMAC verification could be added later):
 *   POST   /webhooks/docusign           — envelope status change events
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import * as db from '../db/index.js';
import {
  isDocuSignConfigured,
  sendDocuSignEnvelope,
  mapDocusignStatus,
  DocuSignError,
} from '../services/docusign.js';
import { dispatchSowSigned } from '../services/sowSignedEvent.js';
import { isSowSignatureStatus } from '../db/sowSignature.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createId } from '@paralleldrive/cuid2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIGNED_UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads', 'signed-sow');

const MANUAL_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

async function ensureSignedDir(): Promise<void> {
  await fs.mkdir(SIGNED_UPLOADS_DIR, { recursive: true });
}

export async function sowSignatureRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Consultant side ─────────────────────────────────────────────────────
  fastify.register(async (consultant) => {
    consultant.addHook('preHandler', authenticate);

    consultant.get(
      '/engagements/:id/sow-signatures',
      { preHandler: requirePermission('READ', 'ENGAGEMENT_META') },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
        if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
        const sigs = await db.listSowSignaturesByEngagement(id);
        return reply.send({
          data: {
            signatures: sigs,
            docusignConfigured: isDocuSignConfigured(),
          },
        });
      },
    );

    // POST docusign — create envelope for the latest SOW version.
    consultant.post(
      '/engagements/:id/sow-signatures/docusign',
      { preHandler: requirePermission('WRITE', 'ENGAGEMENT_META') },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
        if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

        if (!isDocuSignConfigured()) {
          return reply.code(409).send({
            error: {
              code: 'DOCUSIGN_NOT_CONFIGURED',
              message: 'DocuSign isn\'t configured for this firm. Use the manual-upload path.',
            },
          });
        }

        const latest = await db.findLatestSowVersion(id);
        if (!latest) {
          return reply.code(409).send({
            error: { code: 'NO_SOW_VERSION', message: 'Generate the SOW before sending for signature.' },
          });
        }

        const body = (request.body ?? {}) as {
          signerName?: unknown;
          signerEmail?: unknown;
          signerTitle?: unknown;
          emailSubject?: unknown;
        };
        if (typeof body.signerName !== 'string' || body.signerName.trim().length === 0) {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'signerName is required' } });
        }
        if (typeof body.signerEmail !== 'string' || !/.+@.+\..+/.test(body.signerEmail)) {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'signerEmail must be a valid email' } });
        }

        // Read the SOW PDF off disk. The generation pipeline writes
        // it under outputs/<jobId>/SOW/Statement_of_Work_v<N>.pdf.
        const pdfPath = path.join(
          __dirname,
          '..',
          '..',
          'outputs',
          latest.jobId,
          'SOW',
          `Statement_of_Work_v${latest.version}.pdf`,
        );
        let pdfBytes: Buffer;
        try {
          pdfBytes = await fs.readFile(pdfPath);
        } catch {
          return reply.code(409).send({
            error: { code: 'SOW_PDF_MISSING', message: 'Could not find the generated SOW PDF on disk.' },
          });
        }

        try {
          const result = await sendDocuSignEnvelope({
            emailSubject:
              typeof body.emailSubject === 'string' && body.emailSubject.length > 0
                ? body.emailSubject
                : `SOW for ${(eng as { clientName?: string }).clientName ?? 'your engagement'} — please sign`,
            documentBase64: pdfBytes.toString('base64'),
            documentName: `Statement_of_Work_v${latest.version}.pdf`,
            signerName: body.signerName.trim(),
            signerEmail: body.signerEmail.trim(),
          });
          const sig = await db.createSowSignature({
            engagementId: id,
            sowVersionId: latest.id,
            signaturePath: 'DOCUSIGN',
            docusignEnvelopeId: result.envelopeId,
            status: 'SENT',
            createdByUserId: request.jwtUser.userId,
          });
          await db.updateSowSignature(sig.id, {
            signedByName: body.signerName.trim(),
            signedByEmail: body.signerEmail.trim(),
            signedByTitle:
              typeof body.signerTitle === 'string' && body.signerTitle.length > 0 ? body.signerTitle : null,
          });
          await db.logActivity(
            id,
            request.jwtUser.firmId,
            'SOW_SENT_FOR_SIGNATURE',
            `SOW v${latest.version} sent to ${body.signerEmail.trim()} via DocuSign.`,
          );
          return reply.code(201).send({ data: sig });
        } catch (err) {
          if (err instanceof DocuSignError) {
            return reply.code(502).send({
              error: { code: err.code, message: err.message },
            });
          }
          throw err;
        }
      },
    );

    // POST manual-upload — accept a JSON payload with base64 PDF +
    // signer metadata. We avoid multipart here to keep the route
    // surface lean; the file size is checked against
    // MANUAL_UPLOAD_MAX_BYTES post-decode.
    consultant.post(
      '/engagements/:id/sow-signatures/manual-upload',
      { preHandler: requirePermission('WRITE', 'ENGAGEMENT_META') },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const eng = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
        if (!eng) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

        const latest = await db.findLatestSowVersion(id);
        if (!latest) {
          return reply.code(409).send({
            error: { code: 'NO_SOW_VERSION', message: 'Generate the SOW before recording a signature.' },
          });
        }

        const body = (request.body ?? {}) as {
          fileBase64?: unknown;
          signedByName?: unknown;
          signedByEmail?: unknown;
          signedByTitle?: unknown;
          signedDate?: unknown;
        };
        if (typeof body.fileBase64 !== 'string' || body.fileBase64.length === 0) {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'fileBase64 is required' } });
        }
        if (typeof body.signedByName !== 'string' || body.signedByName.trim().length === 0) {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'signedByName is required' } });
        }

        let bytes: Buffer;
        try {
          bytes = Buffer.from(body.fileBase64, 'base64');
        } catch {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'fileBase64 is not valid base64' } });
        }
        if (bytes.length === 0) {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'uploaded file is empty' } });
        }
        if (bytes.length > MANUAL_UPLOAD_MAX_BYTES) {
          return reply.code(413).send({
            error: { code: 'FILE_TOO_LARGE', message: `Max upload is ${MANUAL_UPLOAD_MAX_BYTES} bytes.` },
          });
        }
        // Cheap PDF-magic check — refuses non-PDF uploads with a
        // clear message instead of letting them sit in the uploads
        // dir untyped.
        const magic = bytes.subarray(0, 4).toString('ascii');
        if (magic !== '%PDF') {
          return reply.code(400).send({
            error: { code: 'NOT_A_PDF', message: 'Uploaded file is not a PDF.' },
          });
        }

        await ensureSignedDir();
        const filename = `${id}_v${latest.version}_${createId()}.pdf`;
        const fullPath = path.join(SIGNED_UPLOADS_DIR, filename);
        await fs.writeFile(fullPath, bytes);
        const signedFileUrl = `/uploads/signed-sow/${filename}`;

        const sig = await db.createSowSignature({
          engagementId: id,
          sowVersionId: latest.id,
          signaturePath: 'MANUAL',
          status: 'SIGNED',
          createdByUserId: request.jwtUser.userId,
        });
        await db.updateSowSignature(sig.id, {
          signedFileUrl,
          signedByName: body.signedByName.trim(),
          signedByEmail:
            typeof body.signedByEmail === 'string' && body.signedByEmail.length > 0 ? body.signedByEmail : null,
          signedByTitle:
            typeof body.signedByTitle === 'string' && body.signedByTitle.length > 0 ? body.signedByTitle : null,
          signedAt:
            typeof body.signedDate === 'string' && body.signedDate.length > 0
              ? body.signedDate
              : new Date().toISOString(),
        });

        // Fire SOW_SIGNED — Phase 46.6 hooks here for auto-conversion.
        await dispatchSowSigned({ signatureId: sig.id, signedFileUrl });
        await db.logActivity(
          id,
          request.jwtUser.firmId,
          'SOW_SIGNED_MANUAL',
          `Signed SOW v${latest.version} uploaded for ${body.signedByName.trim()}.`,
        );
        const fresh = await db.findSowSignatureById(sig.id);
        return reply.code(201).send({ data: fresh });
      },
    );
  });

  // ── DocuSign webhook (no auth) ──────────────────────────────────────────
  fastify.post('/webhooks/docusign', async (request, reply) => {
    const body = (request.body ?? {}) as {
      envelopeId?: unknown;
      status?: unknown;
      signerName?: unknown;
      signerEmail?: unknown;
      signerIp?: unknown;
    };
    if (typeof body.envelopeId !== 'string' || typeof body.status !== 'string') {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'envelopeId and status are required' },
      });
    }
    const sig = await db.findSowSignatureByEnvelopeId(body.envelopeId);
    if (!sig) {
      // Unknown envelope — DocuSign expects a 200 so it doesn't retry
      // forever; we log and move on.
      request.log.warn({ envelopeId: body.envelopeId }, 'docusign webhook for unknown envelope');
      return reply.code(200).send({ ok: true, ignored: true });
    }

    const mapped = mapDocusignStatus(body.status);
    if (!isSowSignatureStatus(mapped)) {
      request.log.warn({ status: body.status }, 'docusign webhook: unmappable status');
      return reply.code(200).send({ ok: true, ignored: true });
    }

    const now = new Date().toISOString();
    const patch: Parameters<typeof db.updateSowSignature>[1] = { status: mapped };
    if (mapped === 'SIGNED') patch.signedAt = now;
    if (mapped === 'DECLINED') patch.declinedAt = now;
    if (typeof body.signerName === 'string') patch.signedByName = body.signerName;
    if (typeof body.signerEmail === 'string') patch.signedByEmail = body.signerEmail;

    await db.updateSowSignature(sig.id, patch);

    if (mapped === 'SIGNED') {
      // DocuSign returns the final document via a separate API call;
      // for the webhook path we just record the SIGNED status. The
      // signed file URL stays null until a future "fetch completed
      // envelope" sweep runs (left for ops). The auto-conversion
      // (Phase 46.6) doesn't strictly need the file on disk.
      await dispatchSowSigned({ signatureId: sig.id });
    }

    return reply.send({ ok: true });
  });
}
