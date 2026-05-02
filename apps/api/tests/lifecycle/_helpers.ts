import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Bundle loader for the lifecycle validation harness.
 *
 * Reads the most-recent NSIX/<adaptor>_DEMO_BUNDLE/<latest_iso>/ folder
 * and returns a structured snapshot the rubric in checklist.ts can
 * evaluate against.
 *
 * Layout (mirror of generate-*-demo-bundle.ts drivers):
 *   NSIX/
 *     ofoq-accelerator/                        ← repo root
 *       apps/api/tests/lifecycle/_helpers.ts   ← this file
 *     ODOO_DEMO_BUNDLE/<iso>/Documentation/   ← prose deliverables
 *     NETSUITE_DEMO_BUNDLE/<iso>/
 *       Documentation/                          ← prose deliverables
 *       SDF/Objects/customrecord_*.xml          ← build artefacts
 *       SDF/manifest.xml, SDF/deploy.xml        ← build artefacts (future)
 *
 * The snapshot exposes two separate maps:
 *   - docs            — flat map of files in Documentation/ (filename
 *                        only; e.g. 'BRD.md'). Existing 45 phase checks
 *                        consume this. No path change.
 *   - buildArtefacts  — recursive map of everything ELSE under the
 *                        bundle root, keyed by path relative to the
 *                        bundle root (e.g. 'SDF/Objects/customrecord_
 *                        approval_tracker.xml'). New Phase 4 checks
 *                        consume this. Empty for adaptors / engagements
 *                        that don't ship build artefacts (e.g. Odoo
 *                        today; future Odoo packs will populate it
 *                        with .xml + .py module templates).
 *
 * Plus the adaptor identity, so per-adaptor `applicable` predicates
 * in the rubric (e.g. SDF checks N/A on Odoo) can branch cleanly.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// apps/api/tests/lifecycle → apps/api/tests → apps/api → apps → repo root → NSIX/
const NSIX_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

export type AdaptorId = 'odoo' | 'netsuite';

export interface BundleSnapshot {
  /** Absolute path to the bundle root (parent of Documentation/ + SDF/ etc.). */
  bundlePath: string;
  /** Which adaptor produced the bundle — drives per-adaptor rubric checks. */
  adaptor: AdaptorId;
  /** Flat map of files in <bundle>/Documentation/. Filename only — no
   *  'Documentation/' prefix. Existing 45 phase checks read this. */
  docs: ReadonlyMap<string, string>;
  /** Recursive map of files under <bundle>/ EXCLUDING Documentation/.
   *  Key is the relative path from bundle root, e.g.
   *  'SDF/Objects/customrecord_approval_tracker.xml'. New Phase 4
   *  checks read this. Empty when the bundle ships no build artefacts. */
  buildArtefacts: ReadonlyMap<string, string>;
}

/**
 * Locate the most-recent timestamped bundle for the given adaptor and
 * load it into a BundleSnapshot.
 *
 * Throws with a clear "run generate-*-demo-bundle.ts first" message if
 * no bundle exists yet — the caller is expected to have run the demo
 * driver before invoking the harness.
 */
export async function loadLatestBundle(adaptor: AdaptorId): Promise<BundleSnapshot> {
  const bundleRoot = path.join(
    NSIX_ROOT,
    adaptor === 'odoo' ? 'ODOO_DEMO_BUNDLE' : 'NETSUITE_DEMO_BUNDLE',
  );

  let entries: string[];
  try {
    entries = await fs.readdir(bundleRoot);
  } catch {
    throw new Error(
      `Lifecycle harness: bundle root not found at ${bundleRoot}. ` +
      `Run pnpm --filter @ofoq/api exec tsx scripts/generate-${adaptor}-demo-bundle.ts first.`,
    );
  }

  // ISO timestamps sort lexicographically. Latest = max.
  const timestamps = entries
    .filter((e) => /^\d{4}-\d{2}-\d{2}T/.test(e))
    .sort();
  if (timestamps.length === 0) {
    throw new Error(`Lifecycle harness: no timestamped bundles in ${bundleRoot}.`);
  }
  const latest = timestamps[timestamps.length - 1];
  const bundlePath = path.join(bundleRoot, latest);

  // ── docs map: flat read of bundle/Documentation/ ──
  const docDir = path.join(bundlePath, 'Documentation');
  const docs = new Map<string, string>();
  try {
    const docFiles = await fs.readdir(docDir);
    for (const filename of docFiles) {
      const full = path.join(docDir, filename);
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      docs.set(filename, await fs.readFile(full, 'utf8'));
    }
  } catch {
    // Documentation/ missing means the bundle is broken — surface it.
    throw new Error(`Lifecycle harness: Documentation/ not found in ${bundlePath}.`);
  }

  // ── buildArtefacts map: recursive walk of bundle/ excluding Documentation/ ──
  const buildArtefacts = new Map<string, string>();
  await collectBuildArtefacts(bundlePath, '', buildArtefacts);

  return { bundlePath, adaptor, docs, buildArtefacts };
}

/**
 * Recursively walk dir under bundle root, skipping Documentation/ at
 * the top level. Files are added to `out` keyed by the path RELATIVE
 * to bundle root (using forward slashes for cross-OS test stability).
 */
async function collectBuildArtefacts(
  bundleRoot: string,
  relativeSoFar: string,
  out: Map<string, string>,
): Promise<void> {
  const absoluteDir = path.join(bundleRoot, relativeSoFar);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return; // missing dir is fine — just no build artefacts
  }

  for (const entry of entries) {
    // Skip Documentation/ at the top level — it's the docs map.
    if (relativeSoFar === '' && entry.name === 'Documentation') continue;

    // Always use forward slashes in the relative key so test
    // assertions are portable across Windows + Unix runners.
    const childRel = relativeSoFar
      ? `${relativeSoFar}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      await collectBuildArtefacts(bundleRoot, childRel, out);
    } else if (entry.isFile()) {
      const full = path.join(bundleRoot, childRel);
      out.set(childRel, await fs.readFile(full, 'utf8'));
    }
  }
}

// ─── Convenience predicates (consumed by checklist.ts) ───────────────────────

/**
 * Cross-doc substring search (case-insensitive). Used by checks like
 * "contains 'Acceptance Criteria' anywhere" without pinning to a
 * specific filename.
 */
export function bundleContains(files: ReadonlyMap<string, string>, needle: string): boolean {
  const n = needle.toLowerCase();
  for (const content of files.values()) {
    if (content.toLowerCase().includes(n)) return true;
  }
  return false;
}

/**
 * Pin to a specific file + substring search (case-insensitive). Most
 * phase checks use this against the docs map.
 */
export function fileContains(
  files: ReadonlyMap<string, string>,
  filename: string,
  needle: string,
): boolean {
  const content = files.get(filename);
  if (!content) return false;
  return content.toLowerCase().includes(needle.toLowerCase());
}

/** Number of lines in a named file (0 if file is missing). */
export function fileLineCount(files: ReadonlyMap<string, string>, filename: string): number {
  const content = files.get(filename);
  if (!content) return 0;
  return content.split('\n').length;
}

/**
 * Re-export NSIX_ROOT so the test harness can write the gap report
 * alongside the bundles.
 */
export { NSIX_ROOT };
