/**
 * Go/No-Go Matrix generator (Pack V — Cutover, Component 3).
 *
 * Cross-platform — emits Documentation/Cutover/Go_No_Go_Matrix.md.
 *
 * Renders the decision matrix for the cutover weekend: T-2h pre-cutover
 * go/hold, mid-cutover checkpoint, T+windowH final go declaration.
 * Owners come from cutover.decisions.goNoGoOwners; criteria come from
 * cutover.decisions.goNoGoCriteria. Final-go owner is the entry whose
 * area starts with "Final go/no-go" (or last entry if not labelled).
 *
 * Sources:
 *   - PMI / PMBOK gate-review pattern (multi-stage decision sequence).
 *   - SuiteSuccess + SAP Activate go-live decision protocol.
 */

export interface GoNoGoMatrixGeneratorInput {
  clientName: string;
  adaptorName?: string;
  /** TEXTAREA cutover.decisions.goNoGoCriteria. */
  goNoGoCriteria?: string | null;
  /** TEXTAREA cutover.decisions.goNoGoOwners. */
  goNoGoOwners?: string | null;
  /** Number cutoverWindowHours (from Migration flow) — drives the
   *  mid-checkpoint timestamp. */
  cutoverWindowHours?: number;
}

export interface GoNoGoMatrixGeneratorOutput {
  markdown: string;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

interface ParsedCriterion {
  area: string;
  threshold: string;
}

interface ParsedOwner {
  area: string;
  owner: string;
}

const CRIT_LINE = /^([^:]+):\s*(.+)$/;

function parseCriteria(raw: string): ParsedCriterion[] {
  const out: ParsedCriterion[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(CRIT_LINE);
    if (!m) continue;
    out.push({ area: m[1].trim(), threshold: m[2].trim() });
  }
  return out;
}

function parseOwners(raw: string): ParsedOwner[] {
  const out: ParsedOwner[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(CRIT_LINE);
    if (!m) continue;
    out.push({ area: m[1].trim(), owner: m[2].trim() });
  }
  return out;
}

/**
 * Match a criterion to an owner by area-keyword overlap. Specificity-first
 * order: longer matches win. Falls back to the last owner if nothing
 * overlaps (catch-all "Final go/no-go" style entries).
 */
function findOwnerForArea(area: string, owners: ParsedOwner[]): string {
  if (owners.length === 0) return '_[ASSIGN owner]_';
  const lc = area.toLowerCase();
  // Longest area-keyword match wins.
  let best: ParsedOwner | undefined;
  let bestScore = 0;
  for (const o of owners) {
    const oLc = o.area.toLowerCase();
    // Tokenise the owner's area on whitespace + non-alpha.
    const tokens = oLc.split(/[^a-z]+/).filter((t) => t.length >= 3);
    let score = 0;
    for (const t of tokens) {
      if (lc.includes(t)) score += t.length;
    }
    if (score > bestScore) {
      best = o;
      bestScore = score;
    }
  }
  if (best) return best.owner;
  // Catch-all: return the LAST listed owner (typically "Final go/no-go").
  return owners[owners.length - 1].owner;
}

function findFinalOwner(owners: ParsedOwner[]): string {
  const final = owners.find((o) => /final go|final/i.test(o.area));
  if (final) return final.owner;
  if (owners.length > 0) return owners[owners.length - 1].owner;
  return '_[ASSIGN final go/no-go owner]_';
}

// ─── Markdown emission ──────────────────────────────────────────────────────

export function generateGoNoGoMatrix(
  input: GoNoGoMatrixGeneratorInput,
): GoNoGoMatrixGeneratorOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const criteria = parseCriteria((input.goNoGoCriteria ?? '').toString());
  const owners = parseOwners((input.goNoGoOwners ?? '').toString());
  const windowH = typeof input.cutoverWindowHours === 'number' && input.cutoverWindowHours > 0
    ? input.cutoverWindowHours
    : 36;
  const midCheckpoint = Math.floor(windowH / 2);

  const finalOwner = findFinalOwner(owners);

  const preCutoverRows =
    criteria.length === 0
      ? '| _(no criteria captured)_ | _[ASSIGN]_ | _[ASSIGN]_ | ⏳ |'
      : criteria
          .map((c) => `| ${c.area} | ${c.threshold} | ${findOwnerForArea(c.area, owners)} | ⏳ |`)
          .join('\n');

  const ownerSignoffRows =
    owners.length === 0
      ? '| _[ASSIGN]_ | _[ASSIGN]_ | Go / No-Go | _______ | __________ |'
      : owners
          .map((o) => `| ${o.area} | ${o.owner} | Go / No-Go | _______ | __________ |`)
          .join('\n');

  const markdown = [
    `# Go/No-Go Decision Matrix — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Cutover Window:** ${windowH}h  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}  `,
    `**Final go/no-go owner:** ${finalOwner}`,
    '',
    'Three decision points across the cutover weekend. A no-go declaration at any ',
    'point triggers the rollback procedure (see `Documentation/Cutover/Rollback_Plan.md`).',
    '',
    '## Decision Sequence',
    '',
    '### T-2 hours: Pre-Cutover Go-or-Hold',
    '',
    'Final readiness check before the freeze fires. Hold here is recoverable; halting now ',
    'forces only a rescheduled cutover, not a rollback.',
    '',
    '| Area | Pass Threshold | Owner | Status |',
    '|------|----------------|-------|--------|',
    preCutoverRows,
    '',
    `### T+${midCheckpoint}h: Mid-Cutover Checkpoint`,
    '',
    'Halfway-through health check. Validates extract + transform completed; load is in flight ',
    'or just complete. A red flag here may still allow forward progress with elevated monitoring; ',
    'two consecutive red flags escalate to no-go.',
    '',
    '| Area | Pass Threshold | Owner | Status |',
    '|------|----------------|-------|--------|',
    `| Migration progress | Extract + Transform complete; Load in progress | ${findOwnerForArea('Migration', owners)} | ⏳ |`,
    `| Defect log | No new Critical defects since T+0 | ${findOwnerForArea('Functional', owners)} | ⏳ |`,
    `| Smoke pre-checks | At least 50% of pre-flight smoke ran clean | ${findOwnerForArea('Functional', owners)} | ⏳ |`,
    '',
    `### T+${windowH}h: Final Go Declaration`,
    '',
    'Last gate. All pre-cutover criteria revalidated; smoke complete; defect register clean.',
    '',
    '| Criterion | Pass Threshold | Owner | Status |',
    '|-----------|----------------|-------|--------|',
    `| All P0 smoke scenarios green | 100% | ${findOwnerForArea('Functional', owners)} | ⏳ |`,
    `| Zero open Critical defects | 0 | ${findOwnerForArea('Functional', owners)} | ⏳ |`,
    `| TB tie-out per entity | Within $0.01 | ${findOwnerForArea('Migration', owners)} | ⏳ |`,
    `| Final go declaration | All gates green | ${finalOwner} | ⏳ |`,
    '',
    '## Decision Authority',
    '',
    `The **final go/no-go is owned by**: **${finalOwner}**.`,
    '',
    'A no-go declaration at any decision point triggers the rollback plan — see ',
    '`Documentation/Cutover/Rollback_Plan.md`. The communication plan ',
    '(`Documentation/Cutover/Communication_Plan.md`) defines the cascade once a decision is made.',
    '',
    '## Sign-off',
    '',
    '| Area | Owner | Decision | Time | Signature |',
    '|------|-------|----------|------|-----------|',
    ownerSignoffRows,
    '',
    '_Generated by ERPLaunch — Pack V (Cutover Runbook)._',
    '',
  ].join('\n');

  return { markdown };
}
