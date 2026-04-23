/**
 * Adaptor SDK — the contract every platform adaptor implements.
 *
 * An adaptor is a single object (loadable lazily) that carries everything
 * ERPLaunch needs to run an engagement against one target platform:
 *
 *   - manifest:    identity (id, name, version, vendor)
 *   - schema:      the questionnaire (flows → sections → questions)
 *   - license:     the target's edition + module model
 *   - phases:      default project phases
 *   - rules:       a RulePack the rule engine evaluates
 *   - generators:  artifact definitions (BRD, scripts, workflows)
 *
 * The types intentionally avoid locking into any specific ERP — NetSuite,
 * Odoo, SAP, Custom all pick up the same shape. Existing NetSuite-shaped
 * code is wrapped into an adaptor instance (see @ofoq/adaptor-netsuite)
 * rather than rewritten.
 */

export type Capability =
  | 'document'
  | 'script'
  | 'workflow'
  | 'connector.read'
  | 'connector.push'
  | 'license.gating'
  | 'phase.planning';

export type AdaptorSource = 'built-in' | 'custom' | 'marketplace';

export interface AdaptorManifest {
  /** Stable ID used as the FK on Engagement.adaptorId. */
  id: string;
  /** Human-readable product name, e.g. "NetSuite". */
  name: string;
  /** Short tagline shown in the ERP picker. */
  tagline?: string;
  version: string;
  vendor: string;
  capabilities: Capability[];
  /** SDK semver the adaptor was built against; validated at register time. */
  minSdk: string;
  sourceKind: AdaptorSource;
}

// ─── Questionnaire ────────────────────────────────────────────────────────────

export type QuestionInputType =
  | 'BOOLEAN'
  | 'SINGLE_SELECT'
  | 'MULTI_SELECT'
  | 'TEXT'
  | 'TEXTAREA'
  | 'NUMBER'
  | 'TABLE'
  | 'DATE';

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionDefinition {
  id: string;
  inputType: QuestionInputType;
  required: boolean;
  label: string;
  help?: { title?: string; body?: string; example?: string };
  options?: QuestionOption[];
  dependsOn?: { questionId: string; value: unknown };
  consultantNote?: string;
  tags?: string[];
}

export interface SectionDefinition {
  id: string;
  label: string;
  order: number;
  questions: QuestionDefinition[];
}

export interface FlowDefinition {
  id: string;
  label: string;
  description?: string;
  sections: SectionDefinition[];
}

export interface QuestionnaireSchema {
  version: string;
  flows: FlowDefinition[];
}

// ─── License model ────────────────────────────────────────────────────────────

export interface EditionDefinition {
  id: string;
  label: string;
  includesModules: string[];
}

export interface ModuleDefinition {
  id: string;
  label: string;
  description?: string;
}

export interface LicenseModel {
  editions: EditionDefinition[];
  modules: ModuleDefinition[];
  defaultEditionId: string;
}

// ─── Phases ───────────────────────────────────────────────────────────────────

export interface PhaseDefinition {
  id: string;
  label: string;
  order: number;
  trigger: 'LICENSE' | 'REQUIREMENT';
  objectives?: string[];
}

export interface PhaseModel {
  defaultPhases: PhaseDefinition[];
}

// ─── Rules ────────────────────────────────────────────────────────────────────

export type ConflictSeverity = 'BLOCK' | 'WARN' | 'INFO';
export type ConflictType = 'LICENSE_GAP' | 'PHASE_DEPENDENCY' | 'CONFIG_CONFLICT' | 'DATA_WARNING';

/**
 * Declarative rule condition (Phase 12). Optional — rules without a `when`
 * clause stay metadata-only and must be evaluated by adaptor-specific code
 * (this is how the legacy NetSuite rule engine works). Rules WITH a `when`
 * clause can be fired by the generic `evaluateAdaptorRules()` evaluator
 * against any adaptor's answers + license.
 *
 * The expression language is intentionally small — authored by hand, read
 * by JSON — to keep authoring approachable and the evaluator boring.
 */
export type RuleCondition =
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition }
  | { answerEquals: { questionId: string; value: unknown } }
  | { answerTruthy: { questionId: string } }
  | { answerFalsy: { questionId: string } }
  /** True when the answer is strictly equal to ANY value in the allowed list.
   *  Useful for "fiscal year start must be one of twelve calendar months",
   *  "invoicing policy in (ORDERED, DELIVERED)", etc. Phase 15. */
  | { answerIn: { questionId: string; values: unknown[] } }
  /** True when the answer IS a number AND is strictly greater than the
   *  threshold. Non-numbers and missing answers both return false, so callers
   *  can compose with `answerTruthy` / `answerFalsy` to distinguish them. */
  | { answerNumberGreaterThan: { questionId: string; value: number } }
  /** True when the license has at least one of the listed modules. */
  | { licenseHasAnyModule: string[] }
  | { licenseEditionIn: string[] }
  | { licenseEditionNotIn: string[] }
  | { licenseHasModule: string }
  | { licenseMissingModule: string };

export interface RuleDefinition {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  questionIds: string[];
  message: string;
  resolution: string;
  /** Optional declarative trigger. When omitted the rule is documentation
   *  only and will not be fired by the generic evaluator. */
  when?: RuleCondition;
}

export interface RulePack {
  id: string;
  version: string;
  rules: RuleDefinition[];
}

// ─── Generators ───────────────────────────────────────────────────────────────

export type GeneratorKind = 'document' | 'script' | 'workflow';

export interface OutputGeneratorDefinition {
  id: string;
  label: string;
  kind: GeneratorKind;
  outputMime: string;
  description?: string;
}

// ─── Full adaptor ─────────────────────────────────────────────────────────────

export interface PlatformAdaptor {
  manifest: AdaptorManifest;
  schema: QuestionnaireSchema;
  license: LicenseModel;
  phases: PhaseModel;
  rules: RulePack;
  generators: OutputGeneratorDefinition[];
}

export const SDK_VERSION = '0.1.0';

// ─── Generic rule evaluator (Phase 12) ───────────────────────────────────────
//
// Runs any RulePack against an engagement's answers + license and returns a
// list of RuleEvaluation results (one per rule whose `when` clause fires).
// Rules without a `when` clause are skipped — they remain metadata-only and
// must be evaluated by adaptor-specific code.
//
// Intentionally framework-free: the evaluator is a pure function with zero
// dependencies beyond these types, so the API, the SPA, and future adaptors
// can all share one canonical evaluation implementation.

export interface AdaptorRuleInput {
  answers: Record<string, unknown>;
  license: {
    edition: string;
    modules: string[];
  };
}

export interface AdaptorRuleConflict {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  questionIds: string[];
  message: string;
  resolution: string;
}

export function evaluateAdaptorRules(
  rules: RulePack,
  input: AdaptorRuleInput,
): AdaptorRuleConflict[] {
  const out: AdaptorRuleConflict[] = [];
  if (!rules || !Array.isArray(rules.rules)) return out;
  for (const rule of rules.rules) {
    if (!rule.when) continue;
    if (!matches(rule.when, input)) continue;
    out.push({
      id: rule.id,
      type: rule.type,
      severity: rule.severity,
      questionIds: rule.questionIds,
      message: rule.message,
      resolution: rule.resolution,
    });
  }
  return out;
}

function matches(cond: RuleCondition, input: AdaptorRuleInput): boolean {
  if ('all' in cond) return cond.all.every((c) => matches(c, input));
  if ('any' in cond) return cond.any.some((c) => matches(c, input));
  if ('not' in cond) return !matches(cond.not, input);
  if ('answerEquals' in cond) {
    return deepEqual(input.answers[cond.answerEquals.questionId], cond.answerEquals.value);
  }
  if ('answerTruthy' in cond) {
    return isTruthy(input.answers[cond.answerTruthy.questionId]);
  }
  if ('answerFalsy' in cond) {
    return !isTruthy(input.answers[cond.answerFalsy.questionId]);
  }
  if ('answerIn' in cond) {
    const v = input.answers[cond.answerIn.questionId];
    return cond.answerIn.values.some((expected) => deepEqual(v, expected));
  }
  if ('answerNumberGreaterThan' in cond) {
    const v = input.answers[cond.answerNumberGreaterThan.questionId];
    return typeof v === 'number' && Number.isFinite(v) && v > cond.answerNumberGreaterThan.value;
  }
  if ('licenseHasAnyModule' in cond) {
    return cond.licenseHasAnyModule.some((m) => input.license.modules.includes(m));
  }
  if ('licenseEditionIn' in cond) {
    return cond.licenseEditionIn.includes(input.license.edition);
  }
  if ('licenseEditionNotIn' in cond) {
    return !cond.licenseEditionNotIn.includes(input.license.edition);
  }
  if ('licenseHasModule' in cond) {
    return input.license.modules.includes(cond.licenseHasModule);
  }
  if ('licenseMissingModule' in cond) {
    return !input.license.modules.includes(cond.licenseMissingModule);
  }
  // Unknown condition shapes must never silently match — return false.
  return false;
}

function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length > 0;
  return Boolean(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!deepEqual(ao[k], bo[k])) return false;
    return true;
  }
  return false;
}

// ─── Validator (runtime shape check at register time) ────────────────────────

import { z } from 'zod';

const ManifestSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  tagline: z.string().max(200).optional(),
  version: z.string().min(1),
  vendor: z.string().min(1),
  capabilities: z.array(z.string()),
  minSdk: z.string().min(1),
  sourceKind: z.enum(['built-in', 'custom', 'marketplace']),
});

export interface AdaptorValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateAdaptor(adaptor: unknown): AdaptorValidationResult {
  const errors: string[] = [];
  if (!adaptor || typeof adaptor !== 'object') {
    return { ok: false, errors: ['adaptor must be an object'] };
  }
  const a = adaptor as Partial<PlatformAdaptor>;

  const mRes = ManifestSchema.safeParse(a.manifest);
  if (!mRes.success) errors.push(`manifest: ${mRes.error.message}`);

  if (!a.schema || !Array.isArray((a.schema as QuestionnaireSchema).flows)) {
    errors.push('schema.flows must be an array');
  }
  if (!a.license || !Array.isArray((a.license as LicenseModel).editions)) {
    errors.push('license.editions must be an array');
  }
  if (!a.phases || !Array.isArray((a.phases as PhaseModel).defaultPhases)) {
    errors.push('phases.defaultPhases must be an array');
  }
  if (!a.rules || !Array.isArray((a.rules as RulePack).rules)) {
    errors.push('rules.rules must be an array');
  }
  if (!Array.isArray(a.generators)) {
    errors.push('generators must be an array');
  }

  return { ok: errors.length === 0, errors };
}
