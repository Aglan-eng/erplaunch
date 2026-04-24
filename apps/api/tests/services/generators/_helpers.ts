import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURES_DIR = path.join(__dirname, 'fixtures');

/**
 * Normalize an XML string for fixture comparison.
 *
 * We keep this deliberately narrow:
 *  - Trim whitespace off the start and end of every line (kills inconsistent
 *    template indentation).
 *  - Drop lines that are pure whitespace.
 *  - Preserve attribute values exactly — we only touch inter-tag whitespace.
 *
 * This is enough for comparing the generated SDF XML against checked-in
 * fixtures without caring about how the template literal was indented in
 * the source. If fixture diffs get brittle we can upgrade to a real
 * parse-and-compare later.
 */
export function normalizeXml(s: string): string {
  return s.split('\n').map((line) => line.trim()).filter((line) => line.length > 0).join('\n');
}

export function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}
