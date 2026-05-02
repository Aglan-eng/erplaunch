import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Bundle loader for the lifecycle validation harness.
 *
 * Reads the most-recent NSIX/<adaptor>_DEMO_BUNDLE/<latest_iso>/Documentation/
 * folder and returns Map<filename, contents>. Tests in lifecycleScore.test.ts
 * consume the map to evaluate per-phase rubric checks.
 *
 * NSIX_ROOT layout (mirror of generate-*-demo-bundle.ts drivers):
 *   NSIX/
 *     ofoq-accelerator/                        ← repo root
 *       apps/api/tests/lifecycle/_helpers.ts   ← this file
 *     ODOO_DEMO_BUNDLE/<iso>/Documentation/
 *     NETSUITE_DEMO_BUNDLE/<iso>/Documentation/
 *
 * apps/api/tests/lifecycle/ → repo root → NSIX/ → <ADAPTOR>_DEMO_BUNDLE/.
 * Same path arithmetic generate-odoo-demo-bundle.ts uses.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// apps/api/tests/lifecycle → apps/api/tests → apps/api → apps → repo root → NSIX/
const NSIX_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

export type AdaptorId = 'odoo' | 'netsuite';

export interface BundleLoadResult {
  /** Absolute path to the Documentation/ folder used. */
  bundlePath: string;
  /** Map<filename, fileContents> — all .md / .html files under Documentation/. */
  files: Map<string, string>;
}

/**
 * Locate the most-recent timestamped bundle for the given adaptor and
 * load every file under its Documentation/ folder into a map.
 *
 * Throws if no bundle exists yet — the caller is expected to have run
 * generate-*-demo-bundle.ts at least once before invoking this. The test
 * harness re-runs the drivers in beforeAll.
 */
export async function loadLatestBundle(adaptor: AdaptorId): Promise<BundleLoadResult> {
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
  const docDir = path.join(bundleRoot, latest, 'Documentation');

  let docFiles: string[];
  try {
    docFiles = await fs.readdir(docDir);
  } catch {
    throw new Error(`Lifecycle harness: Documentation/ not found in ${docDir}.`);
  }

  const files = new Map<string, string>();
  for (const filename of docFiles) {
    const full = path.join(docDir, filename);
    const stat = await fs.stat(full);
    if (!stat.isFile()) continue;
    const content = await fs.readFile(full, 'utf8');
    files.set(filename, content);
  }

  return { bundlePath: docDir, files };
}

/**
 * Convenience predicate: does any file in the bundle contain the given
 * substring (case-insensitive)? Used by checks like "contains
 * 'Acceptance Criteria'" without pinning to a specific file.
 *
 * Most checks pin to a specific file via files.get(name) and substring
 * search the contents directly; this helper covers the cross-file
 * "appears anywhere in the bundle" pattern.
 *
 * Signature accepts ReadonlyMap so checklist.ts (which exports
 * BundleFiles = ReadonlyMap<string, string>) can call directly without
 * a cast.
 */
export function bundleContains(files: ReadonlyMap<string, string>, needle: string): boolean {
  const n = needle.toLowerCase();
  for (const content of files.values()) {
    if (content.toLowerCase().includes(n)) return true;
  }
  return false;
}

/**
 * Convenience predicate: does the named file exist AND contain the
 * given substring (case-insensitive)?
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
