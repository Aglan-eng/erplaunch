/**
 * Custom Adaptor parse service — extracts a draft PlatformAdaptor from one
 * or more uploaded source documents (vendor guides, implementation playbooks,
 * etc.). Pipeline:
 *
 *   1. Read each source file, extract plain text (PDF/TXT/DOCX/MD)
 *   2. Concatenate + truncate to fit Claude's context
 *   3. Ask Claude to produce a single JSON object matching PlatformAdaptor
 *   4. Validate the JSON with the SDK validator
 *   5. Persist to the CustomAdaptor row (status → READY or FAILED)
 *
 * Runs as an awaited background task from the upload route — Anthropic
 * calls are typically 10-30 seconds and the client polls GET /custom-adaptors/:id
 * for status updates. No queue dependency because this is a firm-level,
 * one-shot operation; failures mark the row FAILED and the user can retry.
 */
import { validateAdaptor } from '@ofoq/adaptor-sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as db from '../db/index.js';
import { getAnthropicClient } from './aiClient.js';

// Phase 37.4 — `ANTHROPIC_PARSE_MODEL` was an undocumented escape hatch
// (never set on Render); fall through to the platform-wide AI_MODEL or the
// Sonnet 4.6 default. Keeps a single knob for "which Claude model do we
// use across the API".
const MODEL_ID =
  process.env.ANTHROPIC_PARSE_MODEL ||
  process.env.AI_MODEL ||
  'claude-sonnet-4-6';
const MAX_DOC_CHARS = 180_000; // well under 200k-token context with headroom

export interface ParseOptions {
  customAdaptorId: string;
  uploadsDir: string;
}

export async function parseCustomAdaptor(opts: ParseOptions): Promise<void> {
  const { customAdaptorId, uploadsDir } = opts;
  const adaptor = await db.findCustomAdaptorById(customAdaptorId);
  if (!adaptor) throw new Error(`custom adaptor ${customAdaptorId} not found`);

  // Phase 37.4 — fail fast and CLEARLY when AI_API_KEY isn't configured.
  // Before this, the parser would burn through extraction, prompt-building,
  // and an Anthropic SDK call before throwing an opaque "API key required"
  // error that the consultant saw as "Parse failed" with no actionable hint.
  if (!process.env.AI_API_KEY) {
    await db.updateCustomAdaptorStatus(
      customAdaptorId,
      'FAILED',
      'AI not configured: AI_API_KEY environment variable is missing on the server.',
    );
    return;
  }

  // Mark PARSING so the UI can show a spinner
  await db.updateCustomAdaptorStatus(customAdaptorId, 'PARSING');

  try {
    const extracted = await extractFromSourceDocuments(adaptor.sourceDocuments, uploadsDir);
    if (!extracted.trim()) {
      await db.updateCustomAdaptorStatus(customAdaptorId, 'FAILED', 'No text could be extracted from the uploaded documents.');
      return;
    }

    const truncated = extracted.length > MAX_DOC_CHARS ? extracted.slice(0, MAX_DOC_CHARS) : extracted;

    const draft = await askClaudeForAdaptor({ name: adaptor.name, slug: adaptor.slug, docText: truncated });

    // Validate against the SDK contract. If it fails, record the error and
    // bail — never persist a malformed draft.
    const validation = validateAdaptor(draft);
    if (!validation.ok) {
      await db.updateCustomAdaptorStatus(
        customAdaptorId,
        'FAILED',
        `AI produced an invalid adaptor shape: ${validation.errors.join('; ')}`,
      );
      return;
    }

    // Phase 37.3 — soften phases. Claude sometimes returns
    // `phases.defaultPhases: []` when the source doc only describes phases
    // implicitly (numbered sections, a "Methodology" heading, etc.) and the
    // strict schema makes the LLM bail rather than half-fill. Run a
    // heuristic extractor over the source text in that case so we recover
    // the phase names + order at minimum.
    const phases = normalizePhases(draft.phases, truncated);

    await db.savePlatformAdaptorDraft(customAdaptorId, {
      manifest: draft.manifest,
      schema: draft.schema,
      license: draft.license,
      phases,
      generators: draft.generators,
      // Phase 14: Claude may emit a rules block today; we accept whatever it
      // produced as long as it parses as { id, version, rules: [] }. Falls
      // back to an empty pack so the column is never null post-parse.
      rules: normalizeRulesFromDraft(draft.rules, draft.manifest),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown parse error';
    await db.updateCustomAdaptorStatus(customAdaptorId, 'FAILED', msg);
  }
}

/**
 * Normalize whatever Claude produced in `rules` into a valid RulePack shape.
 * If nothing usable is there, return an empty pack keyed off the adaptor's
 * manifest id so the SPA doesn't hit a null rules field.
 */
function normalizeRulesFromDraft(raw: unknown, manifest: unknown): { id: string; version: string; rules: unknown[] } {
  const m = (manifest ?? {}) as { id?: string };
  const fallbackId = typeof m.id === 'string' && m.id ? `${m.id}-rules` : 'custom-rules';
  if (!raw || typeof raw !== 'object') {
    return { id: fallbackId, version: '1.0.0', rules: [] };
  }
  const r = raw as { id?: unknown; version?: unknown; rules?: unknown };
  return {
    id: typeof r.id === 'string' && r.id ? r.id : fallbackId,
    version: typeof r.version === 'string' && r.version ? r.version : '1.0.0',
    rules: Array.isArray(r.rules) ? r.rules : [],
  };
}

// ─── Document text extraction ────────────────────────────────────────────────

/**
 * Per-document text extraction. Branches first on filename suffix, then
 * falls back to mimeType. Phase 37.2 added the mimeType fallback so that
 * uploads with stripped or unrecognized filenames still extract correctly
 * — the prod failure mode was a `.md` upload coming through with a
 * different originalName, which fell into the catch-all utf8 branch
 * silently producing empty content for some browsers.
 *
 * Exported so the parser test suite can pin per-format behavior without
 * spinning up the whole pipeline.
 */
export async function extractTextFromDocument(input: {
  absPath: string;
  originalName: string;
  mimeType: string;
}): Promise<string> {
  const { absPath, originalName, mimeType } = input;
  if (!fs.existsSync(absPath)) return '';

  const lower = (originalName ?? '').toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();

  try {
    if (lower.endsWith('.pdf') || mime === 'application/pdf') {
      return await extractPdfText(absPath);
    }
    if (lower.endsWith('.docx') ||
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return await extractDocxText(absPath);
    }
    if (lower.endsWith('.md') || lower.endsWith('.markdown') || mime === 'text/markdown') {
      // Markdown is plain text from Claude's perspective — no syntax stripping
      // needed. Reading raw preserves headings/lists which actually help the
      // LLM identify structure (phase headings, module bullet lists, etc.).
      return fs.readFileSync(absPath, 'utf8');
    }
    if (lower.endsWith('.txt') || mime === 'text/plain') {
      return fs.readFileSync(absPath, 'utf8');
    }
    // Unknown file type — try utf8 anyway, ignore if garbage. Most likely an
    // older upload before stricter mime validation, or a vendor extension we
    // haven't encountered yet.
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    // Swallow per-file extraction errors; the caller continues with whatever
    // sibling docs succeeded. A failure to read one upload should never sink
    // the whole parse.
    return '';
  }
}

async function extractFromSourceDocuments(
  docs: Array<{ filename: string; originalName: string; mimeType: string }>,
  uploadsDir: string,
): Promise<string> {
  const chunks: string[] = [];
  for (const doc of docs) {
    const abs = path.join(uploadsDir, doc.filename);
    const text = await extractTextFromDocument({
      absPath: abs,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
    });
    if (text.trim()) {
      chunks.push(`=== Source: ${doc.originalName} ===\n${text.trim()}\n`);
    }
  }
  return chunks.join('\n\n');
}

// Phase 37.2 — exported under a `_testOnly` name so the parser test suite
// can drive the full extract-and-concatenate pipeline without standing up
// the Anthropic SDK or the rest of parseCustomAdaptor. Underscore prefix
// signals: not a public API, do not consume from production code.
export const _testOnlyExtractAll = extractFromSourceDocuments;

async function extractPdfText(filePath: string): Promise<string> {
  // Dynamic import so we don't pay PDFJS startup cost for non-PDF uploads
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it) => ('str' in it && typeof it.str === 'string' ? it.str : ''))
      .join(' ');
    out.push(pageText);
  }
  await pdf.cleanup();
  return out.join('\n\n');
}

async function extractDocxText(filePath: string): Promise<string> {
  // DOCX support is best-effort for Phase 2 — if mammoth isn't installed,
  // we fall back to raw extraction. The adaptor wizard UI warns users that
  // PDF is the recommended format.
  try {
    const mammoth = await import('mammoth' as string).catch(() => null);
    if (mammoth && 'extractRawText' in mammoth) {
      const buf = fs.readFileSync(filePath);
      const result = await (mammoth as unknown as { extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }> }).extractRawText({ buffer: buf });
      return result.value ?? '';
    }
  } catch {
    // fall through
  }
  return '';
}

// ─── Claude prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an ERP implementation expert building platform adaptors for ERPLaunch.

You will be given one or more source documents describing a target ERP / business system (vendor guide, in-house implementation playbook, module handbook, etc.). Your job is to distill those documents into a single JSON object matching the ERPLaunch PlatformAdaptor contract, so the platform can drive a scoping wizard, license model, phase plan, and document generation for that target.

Output strict JSON only — no prose, no markdown fences, no explanation. The top-level JSON object MUST conform to this schema:

{
  "manifest": {
    "id": "custom:<slug>",
    "name": "<human product name>",
    "tagline": "<optional short tagline, max 200 chars>",
    "version": "1.0.0",
    "vendor": "<vendor / author of the system>",
    "capabilities": ["document", "license.gating", "phase.planning"],
    "minSdk": "0.1.0",
    "sourceKind": "custom"
  },
  "schema": {
    "version": "1.0.0",
    "flows": [
      {
        "id": "R2R" | "P2P" | "O2C" | "PRODUCTION" | "RETURNS" | custom_flow_id,
        "label": "human readable label",
        "description": "optional",
        "sections": [
          {
            "id": "snake_case_id",
            "label": "human label",
            "order": 1,
            "questions": [
              {
                "id": "<slug>.<section>.<questionName>",
                "inputType": "BOOLEAN" | "SINGLE_SELECT" | "MULTI_SELECT" | "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "TABLE",
                "required": true|false,
                "label": "Question text shown to the consultant",
                "help": { "title": "optional", "body": "optional explanation", "example": "optional" },
                "options": [ { "value": "FOO", "label": "Foo" } ]  // only for SINGLE_SELECT / MULTI_SELECT
              }
            ]
          }
        ]
      }
    ]
  },
  "license": {
    "defaultEditionId": "<id of the most common / recommended edition>",
    "editions": [
      { "id": "BASIC", "label": "Basic", "includesModules": ["..."] }
    ],
    "modules": [
      { "id": "<ID>", "label": "<human>", "description": "optional" }
    ]
  },
  "phases": {
    "defaultPhases": [
      { "id": "discovery", "label": "Discovery", "order": 1, "trigger": "REQUIREMENT" }
    ]
  },
  "rules": { "id": "<slug>-rules", "version": "1.0.0", "rules": [] },
  "generators": [
    { "id": "brd", "label": "Business Requirements Document", "kind": "document", "outputMime": "application/pdf" }
  ]
}

Rules you MUST follow:
- Produce AT LEAST one flow with at least one section and one question. Questions MUST have unique IDs. Prefer 3-10 questions per section.
- Question IDs MUST start with the adaptor slug, lowercased — e.g. "myfactory.company.multiCompany".
- Keep total output under ~8000 tokens. Prefer depth in a few high-value sections over shallow coverage of everything.
- If the source docs don't mention something (e.g. licensing), infer a reasonable default instead of leaving arrays empty; editions must have at least one entry.
- Always include at least "brd" and "solution-doc" generators.
- Return EXACTLY the JSON object described — no wrapper, no commentary.

PHASES — extract these aggressively. Scan the source documents for ANY of:
- Sections titled "Phases", "Methodology", "Implementation Approach",
  "Stages", "Lifecycle", or any synonym ("Project Stages", "Implementation
  Plan", "Roadmap").
- Numbered or bulleted lists of implementation steps under such a heading
  (e.g. "1. Plan / 2. Build / 3. Validate" — those are phases).
- Names like Define / Discovery / Configure / Train / Test / UAT / Deploy
  / Cutover / Go-Live / Go Live / Refine / Hypercare — these are
  conventional ERP phase names; extract every one you encounter.

For each phase, populate at minimum { id, label, order, trigger }. Use
trigger='REQUIREMENT' by default and only switch to 'LICENSE' when the
source explicitly says the phase is gated by a license/edition. Do not
fabricate a "duration" or "objectives" field unless the source explicitly
states them. Returning fewer phases than the source describes — or an
empty defaultPhases array when phases are visible in the text — is a
PARSE FAILURE.`;

interface PlatformAdaptorDraft {
  manifest: unknown;
  schema: unknown;
  license: unknown;
  phases: unknown;
  rules: unknown;
  generators: unknown;
}

async function askClaudeForAdaptor(args: { name: string; slug: string; docText: string }): Promise<PlatformAdaptorDraft> {
  // Phase 37.4 — explicit AI_API_KEY wiring. Surfaces a clear error when
  // the env var is missing instead of letting the SDK throw a less helpful
  // "API key required" deep in `messages.create`.
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('AI not configured: AI_API_KEY environment variable is missing.');
  }
  const userPrompt = `Target system name: ${args.name}
Target slug: ${args.slug}

Source documents describing this system:
${args.docText}

Produce the adaptor JSON now. JSON only.`;

  const response = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const first = response.content[0];
  if (!first || first.type !== 'text') {
    throw new Error('Claude returned no text content');
  }
  const clean = first.text.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  try {
    return JSON.parse(clean) as PlatformAdaptorDraft;
  } catch (err) {
    throw new Error(`Claude output was not valid JSON: ${(err as Error).message}`);
  }
}

// ─── Phase 37.3 — phase normalization & heuristic extraction ─────────────────
//
// The single-prompt Claude call sometimes returns `phases.defaultPhases: []`
// even when the source clearly enumerates phases (the JDE primer was the
// PO-flagged regression). Rather than constrain Claude further (which made
// Claude bail in early experiments) we run a heuristic over the source text
// after the fact and merge it in when Claude came back empty.

interface NormalizedPhase {
  id: string;
  label: string;
  order: number;
  trigger: 'LICENSE' | 'REQUIREMENT';
  objectives?: string[];
}

interface NormalizedPhaseModel {
  defaultPhases: NormalizedPhase[];
}

const PHASE_SECTION_PATTERN =
  /^[#\s>\-*]*(?:phases?|methodology|implementation\s+approach|stages?|lifecycle|implementation\s+plan|roadmap|project\s+stages?)\b[^\n]*$/im;

const NUMBERED_LINE_PATTERN = /^\s*(\d+)[.)]\s+(.+?)\s*$/;
const BULLET_LINE_PATTERN = /^\s*[-*•]\s+(.+?)\s*$/;

function slugifyPhaseId(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s*\/\s*/g, '-')      // "Define / Discovery" → "define-discovery"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'phase';
}

/**
 * Heuristic phase extraction. Locates the first phase-section heading,
 * walks forward until the list ends, and returns one phase per
 * numbered or bulleted item. Strips trailing description text after a
 * dash/em-dash so the label is the phase name only.
 *
 * Exported for direct unit testing.
 */
export function extractPhasesFromText(sourceText: string): NormalizedPhase[] {
  if (!sourceText || typeof sourceText !== 'string') return [];

  const lines = sourceText.split(/\r?\n/);
  let i = 0;
  // Find the first phase-section heading.
  for (; i < lines.length; i++) {
    if (PHASE_SECTION_PATTERN.test(lines[i])) break;
  }
  if (i >= lines.length) return [];

  // Walk forward collecting numbered or bulleted items. Stop on a blank
  // line followed by a non-list line, or on the next clearly-different
  // heading.
  const items: { order: number; label: string }[] = [];
  let nextOrder = 1;
  i++;
  let blankSeen = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      if (items.length > 0) blankSeen = true;
      continue;
    }
    const numbered = line.match(NUMBERED_LINE_PATTERN);
    const bullet = line.match(BULLET_LINE_PATTERN);
    if (numbered) {
      const ord = Number(numbered[1]);
      const raw = numbered[2];
      items.push({ order: Number.isFinite(ord) && ord > 0 ? ord : nextOrder, label: cleanPhaseLabel(raw) });
      nextOrder = (items[items.length - 1].order ?? nextOrder) + 1;
      blankSeen = false;
    } else if (bullet) {
      items.push({ order: nextOrder, label: cleanPhaseLabel(bullet[1]) });
      nextOrder++;
      blankSeen = false;
    } else if (blankSeen) {
      // Non-list, non-blank line after the list — end of the section.
      break;
    } else if (/^[#=].*/.test(line.trim())) {
      // A new heading also ends the phase section.
      break;
    }
    // Continuation lines of an earlier item (indented description text)
    // are ignored — we keep just the leading label.
  }

  return items.map((it, idx) => ({
    id: slugifyPhaseId(it.label),
    label: it.label,
    order: it.order || idx + 1,
    trigger: 'REQUIREMENT' as const,
  }));
}

function cleanPhaseLabel(raw: string): string {
  // Strip trailing description after an em-dash or hyphen-with-spaces.
  // "Define / Discovery — high-level scoping" → "Define / Discovery"
  return raw
    .replace(/\s+[—–-]\s+.*$/, '')
    .replace(/\s+\(.*\)\s*$/, '') // strip trailing parentheticals
    .trim();
}

/**
 * Apply the heuristic fallback when Claude's phases block is empty/null.
 * Always returns a well-formed PhaseModel-shaped object — non-empty
 * `defaultPhases` when the source described phases, otherwise an empty
 * array (validator still passes; downstream UI shows the consultant a
 * gentle "no phases inferred" prompt).
 *
 * Exported for unit testing of the merge semantics.
 */
export function normalizePhases(rawPhases: unknown, sourceText: string): NormalizedPhaseModel {
  const claudeArr = Array.isArray((rawPhases as { defaultPhases?: unknown })?.defaultPhases)
    ? ((rawPhases as { defaultPhases: unknown[] }).defaultPhases)
    : [];

  const fillFromClaude = (raw: unknown, idx: number): NormalizedPhase | null => {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as { id?: unknown; label?: unknown; name?: unknown; order?: unknown; trigger?: unknown; objectives?: unknown };
    const label = (typeof r.label === 'string' && r.label.trim())
      || (typeof r.name === 'string' && r.name.trim());
    if (!label) return null;
    const id = (typeof r.id === 'string' && r.id.trim()) ? r.id : slugifyPhaseId(label);
    const order = typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : idx + 1;
    const trigger = r.trigger === 'LICENSE' ? 'LICENSE' : 'REQUIREMENT';
    const out: NormalizedPhase = { id, label, order, trigger };
    if (Array.isArray(r.objectives)) {
      out.objectives = r.objectives.filter((o): o is string => typeof o === 'string');
    }
    return out;
  };

  const claudePhases = claudeArr
    .map(fillFromClaude)
    .filter((p): p is NormalizedPhase => p !== null);

  if (claudePhases.length > 0) {
    return { defaultPhases: claudePhases };
  }

  // Claude came back empty (or with only un-fillable shapes) — try the
  // text heuristic.
  const heuristic = extractPhasesFromText(sourceText);
  return { defaultPhases: heuristic };
}
