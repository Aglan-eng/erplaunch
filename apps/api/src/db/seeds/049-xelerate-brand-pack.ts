/**
 * Phase 49.5 + 50.8 — Xelerate Brand Pack auto-populate.
 *
 * Reads the canonical Xelerate Brand Pack from
 *   apps/api/src/db/seeds/data/xelerate-brand-pack.md
 * parses it via the Phase 49.3 brandPackParser, and writes the result
 * into the Xelerate firm row.
 *
 * Idempotency (Phase 50.8 change):
 *   - Looks up Xelerate by slug (`xelerate`) — NOT by hardcoded id.
 *     The original spec referenced firmId `lppcl9vlc2f2dw93zs3e0y07`
 *     but that's environment-specific; matching by slug works across
 *     dev / staging / prod without per-env config.
 *   - Computes SHA-256 of the seed file. Skips if the firm's stored
 *     `brandPackContentHash` matches — re-running with unchanged
 *     content is a no-op. Editing the seed file picks up the change
 *     on the next deploy.
 *   - Skips silently if no `xelerate` slug exists in this DB (dev
 *     environments where the seed hasn't created Xelerate yet).
 *
 * Why the change: the Phase 49.5 "skip when templateVersion > 1"
 * rule meant that once the seed ran once, subsequent edits to the
 * pack file (e.g. to land the real Xelerate identity over the
 * placeholder) were ignored. Content-hash idempotency makes the
 * seed file the source of truth — any edit there propagates on the
 * next deploy without manual intervention.
 *
 * Run via:
 *   pnpm --filter @ofoq/api exec tsx src/db/seeds/049-xelerate-brand-pack.ts
 *
 * Or programmatically via `seedXelerateBrandPack()` from this module.
 * Either way returns a structured result the caller can log.
 */

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, getDb, updateFirmTemplate, getFirmTemplate } from '../index.js';
import { parseBrandPack } from '../../services/brandPackParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_PATH = path.join(__dirname, 'data', 'xelerate-brand-pack.md');

export interface SeedResult {
  status: 'SEEDED' | 'SKIPPED_HASH_MATCH' | 'SKIPPED_NO_FIRM' | 'PARSE_ERROR';
  templateVersion?: number;
  firmId?: string;
  contentHash?: string;
  message: string;
}

/**
 * Compute the canonical SHA-256 hash of the pack contents. The hash
 * is taken over the raw bytes of the file with no normalisation — a
 * trailing newline edit or whitespace change WILL re-trigger the
 * seed, which is the intended behaviour (any author edit should
 * propagate).
 */
function hashPackContent(markdown: string): string {
  return crypto.createHash('sha256').update(markdown).digest('hex');
}

/**
 * Programmatic entrypoint — safe to call multiple times. Returns a
 * structured status the caller can log without parsing stdout.
 */
export async function seedXelerateBrandPack(): Promise<SeedResult> {
  const db = getDb();

  // 1. Find the Xelerate firm by slug. We DON'T hard-code an id —
  // the slug is the stable identifier across environments.
  const firmRes = await db.execute({
    sql: `SELECT id, brandPackContentHash FROM Firm WHERE slug = ? LIMIT 1`,
    args: ['xelerate'],
  });
  const firmRow = firmRes.rows[0] as
    | { id?: string; brandPackContentHash?: string | null }
    | undefined;
  const firmId = firmRow?.id;
  if (!firmId) {
    return {
      status: 'SKIPPED_NO_FIRM',
      message: 'No firm with slug "xelerate" found in this database — skipping.',
    };
  }

  // 2. Load the Brand Pack from disk and compute its content hash.
  const markdown = fs.readFileSync(PACK_PATH, 'utf8');
  const contentHash = hashPackContent(markdown);

  // 3. Idempotency gate: if the stored hash matches the current
  // file's hash, the seed has nothing to do.
  if (firmRow.brandPackContentHash && firmRow.brandPackContentHash === contentHash) {
    return {
      status: 'SKIPPED_HASH_MATCH',
      firmId,
      contentHash,
      message: `Xelerate Brand Pack content hash unchanged (${contentHash.slice(0, 12)}…) — skipping seed.`,
    };
  }

  // 4. Parse the pack. Fail loudly on parser errors so a malformed
  // edit doesn't silently corrupt the firm template.
  const parsed = parseBrandPack(markdown);
  if (!parsed.ok) {
    return {
      status: 'PARSE_ERROR',
      firmId,
      contentHash,
      message: `Brand Pack parse failed: ${parsed.message}`,
    };
  }

  // 5. Write the parsed patch + the new content hash atomically.
  // updateFirmTemplate bumps templateVersion automatically; the
  // hash column is updated in a second statement so a parse failure
  // above leaves the previous content's hash in place.
  const updated = await updateFirmTemplate(firmId, parsed.patch);
  await db.execute({
    sql: `UPDATE Firm SET brandPackContentHash = ? WHERE id = ?`,
    args: [contentHash, firmId],
  });

  // Phase 50.9.3 — post-write read-back assertion. If the parser
  // silently produced a no-op patch (e.g. the section keys shifted
  // and parseBrandPack returned an empty object that updateFirmTemplate
  // accepted without writing), templateVersion would bump but the real
  // content wouldn't land. Reading back and checking the tagline marker
  // catches that class of bug — the seed surfaces ASSERT_FAIL loudly
  // instead of silently leaving the placeholder content on prod (the
  // exact symptom that motivated Phase 50.9.3).
  //
  // The marker is the lead phrase from the canonical
  // xelerate-brand-pack.md. If we edit the pack and the lead changes,
  // this assertion needs to be updated in lockstep — that's intentional:
  // it forces a deliberate update rather than a silent drift.
  const persisted = await getFirmTemplate(firmId);
  const persistedTagline = persisted?.tagline ?? '';
  if (!persistedTagline.includes('Business Enabling Technologies')) {
    return {
      status: 'PARSE_ERROR',
      firmId,
      contentHash,
      templateVersion: updated?.templateVersion,
      message:
        `Post-write tagline assertion FAILED — read-back tagline does not contain the real Xelerate marker. ` +
        `Got: ${JSON.stringify(persistedTagline.slice(0, 80))}. ` +
        `This indicates the parser silently produced a no-op patch or the seed file content drifted. ` +
        `Templates version was bumped to ${updated?.templateVersion} but the firm voice may still be the placeholder.`,
    };
  }

  return {
    status: 'SEEDED',
    firmId,
    contentHash,
    templateVersion: updated?.templateVersion,
    message: `Ingested Xelerate Brand Pack (hash ${contentHash.slice(0, 12)}…) — templateVersion now ${updated?.templateVersion}`,
  };
}

// CLI entrypoint — only runs when invoked directly (not when imported
// by the Phase 49.6 smoke test or another seed wrapper).
async function runFromCli(): Promise<void> {
  await initDb();
  const result = await seedXelerateBrandPack();
  // eslint-disable-next-line no-console
  console.log(`[seed:xelerate-brand-pack] ${result.status}: ${result.message}`);
  if (result.status === 'PARSE_ERROR') {
    process.exit(1);
  }
}

// Detect direct invocation by comparing import.meta.url against the
// resolved path of process.argv[1]. When this file is imported by a
// test (or another module), argv[1] points at vitest / the host
// script, not this file — so the CLI block stays dormant. When tsx
// invokes the file directly (via the package.json script), they
// match.
const argv1 = process.argv[1] ?? '';
if (argv1.length > 0 && import.meta.url === pathToFileUrlString(argv1)) {
  runFromCli().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[seed:xelerate-brand-pack] failed:', err);
    process.exit(1);
  });
}

function pathToFileUrlString(p: string): string {
  // Minimal path → file:// URL coercion. Avoids pulling in the
  // `url` module's pathToFileURL helper which collides with our
  // existing fileURLToPath import.
  // Replace backslashes (Windows) with forward slashes and prepend
  // file:// (or file:/// on POSIX where p starts with `/`).
  const fwd = p.replace(/\\/g, '/');
  return fwd.startsWith('/') ? `file://${fwd}` : `file:///${fwd}`;
}
