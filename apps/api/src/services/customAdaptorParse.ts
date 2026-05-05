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
import Anthropic from '@anthropic-ai/sdk';
import { validateAdaptor } from '@ofoq/adaptor-sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as db from '../db/index.js';

const MODEL_ID = process.env.ANTHROPIC_PARSE_MODEL || 'claude-sonnet-4-6';
const MAX_DOC_CHARS = 180_000; // well under 200k-token context with headroom

export interface ParseOptions {
  customAdaptorId: string;
  uploadsDir: string;
}

export async function parseCustomAdaptor(opts: ParseOptions): Promise<void> {
  const { customAdaptorId, uploadsDir } = opts;
  const adaptor = await db.findCustomAdaptorById(customAdaptorId);
  if (!adaptor) throw new Error(`custom adaptor ${customAdaptorId} not found`);

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

    await db.savePlatformAdaptorDraft(customAdaptorId, {
      manifest: draft.manifest,
      schema: draft.schema,
      license: draft.license,
      phases: draft.phases,
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
- Return EXACTLY the JSON object described — no wrapper, no commentary.`;

interface PlatformAdaptorDraft {
  manifest: unknown;
  schema: unknown;
  license: unknown;
  phases: unknown;
  rules: unknown;
  generators: unknown;
}

async function askClaudeForAdaptor(args: { name: string; slug: string; docText: string }): Promise<PlatformAdaptorDraft> {
  const anthropic = new Anthropic();
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
