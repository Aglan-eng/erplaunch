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

export interface RuleDefinition {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  questionIds: string[];
  message: string;
  resolution: string;
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
