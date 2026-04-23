/**
 * adaptorBridge — converts PlatformAdaptor.QuestionDefinition (SDK shape) into
 * the @ofoq/shared Question shape that the existing wizard components
 * (QuestionCard, QuestionInput, SectionSuggestionPanel, etc.) are written
 * against.
 *
 * Phase 3C uses this so FlowSectionStep can pull questions from the active
 * adaptor's schema (any adaptor — built-in or custom) instead of the
 * hard-coded NetSuite banks imported from @ofoq/shared. Once everything has
 * been migrated, QuestionCard itself can be rewritten to speak the SDK shape
 * directly and this bridge can be retired.
 */
import type { Question as SharedQuestion, QuestionOption as SharedOption } from '@ofoq/shared';

type FlowId = SharedQuestion['flow'];

const VALID_FLOW_IDS = new Set<FlowId>(['R2R', 'P2P', 'O2C', 'PRODUCTION', 'RETURNS']);

interface RawOption {
  value: string;
  label: string;
  description?: string;
}

interface RawQuestion {
  id?: unknown;
  inputType?: unknown;
  required?: unknown;
  label?: unknown;
  help?: { title?: unknown; body?: unknown; example?: unknown };
  options?: unknown;
  dependsOn?: { questionId?: unknown; value?: unknown };
  consultantNote?: unknown;
  // Legacy/top-level fields that some adaptors include
  helpTitle?: unknown;
  helpBody?: unknown;
  exampleText?: unknown;
}

interface RawSection {
  id?: unknown;
  label?: unknown;
  order?: unknown;
  questions?: unknown;
}

interface RawFlow {
  id?: unknown;
  label?: unknown;
  sections?: unknown;
}

interface RawSchema {
  version?: unknown;
  flows?: unknown;
}

export interface BridgedSection {
  flowId: FlowId;
  sectionId: string;
  sectionLabel: string;
  sectionOrder: number;
  questions: SharedQuestion[];
}

/** Flatten an adaptor schema into a map keyed by the wizard's flow.section
 *  convention (e.g. "r2r.entities"). Missing / malformed data returns an
 *  empty map — callers should fall back to the legacy shared banks. */
export function bridgeAdaptorSchema(schema: unknown): Map<string, BridgedSection> {
  const out = new Map<string, BridgedSection>();
  const s = schema as RawSchema | null;
  if (!s || !Array.isArray(s.flows)) return out;

  for (const flow of s.flows as RawFlow[]) {
    const flowId = String(flow.id ?? '').toUpperCase() as FlowId;
    if (!VALID_FLOW_IDS.has(flowId)) continue;

    const flowKey = sectionPrefixFor(flowId);
    if (!Array.isArray(flow.sections)) continue;

    for (const section of flow.sections as RawSection[]) {
      const sectionId = String(section.id ?? '').trim();
      if (!sectionId) continue;
      const key = `${flowKey}.${sectionId}`;
      const questions = Array.isArray(section.questions)
        ? (section.questions as RawQuestion[])
            .map((q, idx) => bridgeQuestion(q, flowId, sectionId, idx + 1))
            .filter((q): q is SharedQuestion => q !== null)
        : [];
      out.set(key, {
        flowId,
        sectionId,
        sectionLabel: String(section.label ?? sectionId),
        sectionOrder: typeof section.order === 'number' ? section.order : 0,
        questions,
      });
    }
  }

  return out;
}

/** Questions in the wizard are keyed on "r2r.entities.*" — adaptors use the
 *  same prefix so the existing progress/mutation hooks keep working without
 *  changes. */
function sectionPrefixFor(flow: FlowId): string {
  switch (flow) {
    case 'R2R':        return 'r2r';
    case 'P2P':        return 'p2p';
    case 'O2C':        return 'o2c';
    case 'PRODUCTION': return 'mfg';
    case 'RETURNS':    return 'rtn';
  }
}

function bridgeQuestion(raw: RawQuestion, flow: FlowId, sectionId: string, order: number): SharedQuestion | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  const inputType = typeof raw.inputType === 'string' ? raw.inputType : null;
  const label = typeof raw.label === 'string' ? raw.label : null;
  if (!id || !inputType || !label) return null;

  // Help lookups — support both the SDK shape (nested help: {...}) and the
  // legacy flat shape we use in @ofoq/shared (helpTitle/helpBody/exampleText).
  const helpTitle =
    (raw.help && typeof raw.help.title === 'string' ? raw.help.title : null) ??
    (typeof raw.helpTitle === 'string' ? raw.helpTitle : '');
  const helpBody =
    (raw.help && typeof raw.help.body === 'string' ? raw.help.body : null) ??
    (typeof raw.helpBody === 'string' ? raw.helpBody : '');
  const exampleText =
    (raw.help && typeof raw.help.example === 'string' ? raw.help.example : null) ??
    (typeof raw.exampleText === 'string' ? raw.exampleText : '');

  const options: SharedOption[] | undefined = Array.isArray(raw.options)
    ? (raw.options as RawOption[])
        .filter((o) => o && typeof o.value === 'string' && typeof o.label === 'string')
        .map((o) => ({
          value: o.value,
          label: o.label,
          description: typeof o.description === 'string' ? o.description : '',
        }))
    : undefined;

  const dependsOn = raw.dependsOn && typeof raw.dependsOn.questionId === 'string'
    ? { questionId: raw.dependsOn.questionId, value: raw.dependsOn.value }
    : undefined;

  return {
    id,
    flow,
    section: sectionId,
    order,
    inputType: inputType as SharedQuestion['inputType'],
    options,
    required: raw.required === true,
    label,
    helpTitle: helpTitle ?? '',
    helpBody: helpBody ?? '',
    exampleText: exampleText ?? '',
    consultantNote: typeof raw.consultantNote === 'string' ? raw.consultantNote : undefined,
    dependsOn,
  };
}
