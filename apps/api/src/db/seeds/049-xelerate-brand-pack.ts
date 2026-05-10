/**
 * Phase 49.5 — Xelerate Brand Pack auto-populate.
 *
 * Reads the canonical Xelerate Brand Pack from
 *   apps/api/src/db/seeds/data/xelerate-brand-pack.md
 * parses it via the Phase 49.3 brandPackParser, and writes the result
 * into the Xelerate firm row.
 *
 * Idempotency:
 *   - Looks up Xelerate by slug (`xelerate`) — NOT by hardcoded id.
 *     The original spec referenced firmId `lppcl9vlc2f2dw93zs3e0y07`
 *     but that's environment-specific; matching by slug works across
 *     dev / staging / prod without per-env config.
 *   - Skips entirely if templateVersion > 1 (the firm has already
 *     been ingested or has been edited via the UI). This is the
 *     "skip if already seeded" guard the spec required so re-running
 *     this on every Render deploy doesn't blow away firm-level edits.
 *   - Skips silently if no `xelerate` slug exists in this DB (dev
 *     environments where the seed hasn't created Xelerate yet).
 *
 * Run via:
 *   pnpm --filter @ofoq/api exec tsx src/db/seeds/049-xelerate-brand-pack.ts
 *
 * Or programmatically via `seedXelerateBrandPack()` from this module.
 * Either way returns a structured result the caller can log.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, getDb, updateFirmTemplate, getFirmTemplate } from '../index.js';
import { parseBrandPack } from '../../services/brandPackParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_PATH = path.join(__dirname, 'data', 'xelerate-brand-pack.md');

export interface SeedResult {
  status: 'SEEDED' | 'SKIPPED_VERSIONED' | 'SKIPPED_NO_FIRM' | 'PARSE_ERROR';
  templateVersion?: number;
  firmId?: string;
  message: string;
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
    sql: `SELECT id FROM Firm WHERE slug = ? LIMIT 1`,
    args: ['xelerate'],
  });
  const firmId = (firmRes.rows[0] as { id?: string } | undefined)?.id;
  if (!firmId) {
    return {
      status: 'SKIPPED_NO_FIRM',
      message: 'No firm with slug "xelerate" found in this database — skipping.',
    };
  }

  // 2. Idempotency gate: if templateVersion > 1, the firm has been
  // ingested or hand-edited. Don't re-import.
  const existing = await getFirmTemplate(firmId);
  if (existing && existing.templateVersion > 1) {
    return {
      status: 'SKIPPED_VERSIONED',
      firmId,
      templateVersion: existing.templateVersion,
      message: `Xelerate firm already at templateVersion ${existing.templateVersion} — skipping seed.`,
    };
  }

  // 3. Load the Brand Pack from disk and parse it.
  const markdown = fs.readFileSync(PACK_PATH, 'utf8');
  const parsed = parseBrandPack(markdown);
  if (!parsed.ok) {
    return {
      status: 'PARSE_ERROR',
      firmId,
      message: `Brand Pack parse failed: ${parsed.message}`,
    };
  }

  // 4. Write the parsed patch. updateFirmTemplate bumps templateVersion
  // automatically, so the next run lands in the SKIPPED_VERSIONED branch.
  const updated = await updateFirmTemplate(firmId, parsed.patch);
  return {
    status: 'SEEDED',
    firmId,
    templateVersion: updated?.templateVersion,
    message: `Ingested Xelerate Brand Pack — templateVersion now ${updated?.templateVersion}`,
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
