import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Logo upload limits (Phase 18). 2 MB caps line up with what firm brand
 *  guidelines typically specify; the allowed MIME set is PNG + JPEG only.
 *
 *  Why no SVG: serving SVG from the same origin as the app would make the
 *  logo a stored-XSS vector unless properly sanitized. DOMPurify is the
 *  right fix but adds a server-side DOM dependency; we defer it to a
 *  later phase and explicitly reject SVG uploads for now. */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ALLOWED_MIMES = new Set<string>(['image/png', 'image/jpeg']);
const LOGO_MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

/**
 * Consultant-facing firm branding surface (Phase 5A / Day 3).
 * Scope is intentionally minimal for pilot: displayName, two colors,
 * supportEmail. Logo upload is a separate follow-up to keep this PR small.
 */

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const UpdateBrandingSchema = z.object({
  displayName: z.string().trim().min(1).max(100).nullable().optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  primaryColor: HexColor.nullable().optional(),
  secondaryColor: HexColor.nullable().optional(),
  supportEmail: z.string().email().max(200).nullable().optional(),
});

export async function firmBrandingRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/firm/branding',
    { preHandler: authenticate },
    async (request) => {
      const { firmId } = request.jwtUser;
      const branding = await db.getFirmBranding(firmId);
      return { data: branding };
    },
  );

  fastify.patch(
    '/firm/branding',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = UpdateBrandingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
      }
      const { firmId } = request.jwtUser;
      const branding = await db.updateFirmBranding(firmId, parsed.data);
      return { data: branding };
    },
  );

  /**
   * POST /firm/branding/logo — upload a new firm logo (Phase 18).
   *
   * Accepts PNG or JPEG up to 2 MB. Stores at
   *   apps/api/uploads/firm-logos/<firmId>/<cuid>.<ext>
   * which is served by the static-file mount at /uploads/.
   *
   * On success, updates Firm.logoUrl to the public URL and returns the
   * fresh branding row — the SPA can drop the returned logoUrl straight
   * into the settings form so the preview reflects the upload immediately.
   *
   * Old logos are NOT purged server-side on replacement — they're still
   * reachable by old URL until the next deploy. The cost is a handful of
   * KB per firm per logo change; we can add a GC sweep in a later phase.
   */
  fastify.post(
    '/firm/branding/logo',
    { preHandler: authenticate },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ error: { code: 'NO_FILE', message: 'No file uploaded.' } });
      }
      if (!LOGO_ALLOWED_MIMES.has(file.mimetype)) {
        return reply.code(400).send({
          error: {
            code: 'UNSUPPORTED_MIME',
            message: `Logo must be PNG or JPEG. Uploaded: ${file.mimetype}.`,
          },
        });
      }

      // Buffer the stream so we can enforce the size cap after the fact —
      // @fastify/multipart is already configured with fileSize: 5MB at the
      // plugin level, so this is a belt-and-braces check.
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of file.file) {
        total += chunk.length;
        if (total > LOGO_MAX_BYTES) {
          // Stop accumulating; drain the rest of the stream so the
          // connection cleans up cleanly.
          return reply.code(413).send({
            error: { code: 'FILE_TOO_LARGE', message: 'Logo must be under 2 MB.' },
          });
        }
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const { firmId } = request.jwtUser;
      const firmDir = path.join(__dirname, '..', '..', 'uploads', 'firm-logos', firmId);
      await fs.mkdir(firmDir, { recursive: true });
      const ext = LOGO_MIME_TO_EXT[file.mimetype] ?? '.bin';
      const storedName = `${createId()}${ext}`;
      await fs.writeFile(path.join(firmDir, storedName), buffer);

      // Absolute URL — the SPA and API are on different origins (Vercel +
      // Render in prod), so we can't return a relative path. Prefer an
      // explicit API_PUBLIC_URL env when present; otherwise derive from the
      // request so local dev works out of the box.
      const origin = (process.env.API_PUBLIC_URL?.replace(/\/$/, ''))
        ?? `${request.protocol}://${request.hostname}`;
      const publicUrl = `${origin}/uploads/firm-logos/${firmId}/${storedName}`;
      const branding = await db.updateFirmBranding(firmId, { logoUrl: publicUrl });
      return reply.code(201).send({ data: branding });
    },
  );
}
