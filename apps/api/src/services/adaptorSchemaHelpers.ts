import type { Question } from '@ofoq/shared';

/**
 * Pull a human-readable section label out of an adaptor schema given a
 * wizard section key like "r2r.entities". Falls back to undefined when the
 * schema is malformed or the section isn't declared on this adaptor; the
 * caller treats undefined as "use the default SECTION_CONTEXT lookup".
 */
export function findSectionLabel(
  schema: { flows?: Array<{ sections?: Array<{ id?: string; label?: string }> }> } | null | undefined,
  sectionKey: string,
): string | undefined {
  if (!schema || !Array.isArray(schema.flows)) return undefined;
  const parts = sectionKey.split('.');
  const targetSectionId = parts.slice(1).join('.');
  if (!targetSectionId) return undefined;
  for (const flow of schema.flows) {
    if (!Array.isArray(flow.sections)) continue;
    for (const section of flow.sections) {
      if (section?.id === targetSectionId && typeof section.label === 'string') {
        return section.label;
      }
    }
  }
  return undefined;
}

type FlowId = Question['flow'];

const FLOW_WIZARD_PREFIX: Record<FlowId, string> = {
  R2R: 'r2r',
  P2P: 'p2p',
  O2C: 'o2c',
  PRODUCTION: 'mfg',
  RETURNS: 'rtn',
};

const VALID_FLOW_IDS = new Set<FlowId>(['R2R', 'P2P', 'O2C', 'PRODUCTION', 'RETURNS']);

interface RawOption { value?: unknown; label?: unknown; description?: unknown }
interface RawQuestion {
  id?: unknown;
  inputType?: unknown;
  required?: unknown;
  label?: unknown;
  options?: unknown;
  dependsOn?: { questionId?: unknown; value?: unknown };
  consultantNote?: unknown;
  help?: { title?: unknown; body?: unknown; example?: unknown };
  helpTitle?: unknown;
  helpBody?: unknown;
  exampleText?: unknown;
}

/**
 * Flatten an adaptor schema into the @ofoq/shared `Question[]` shape that the
 * AI profile / section-suggestion services already consume. Ignores malformed
 * or unknown flows so callers can safely fall back to the NetSuite bank when
 * this returns an empty array.
 */
export function flattenAdaptorSchemaToQuestions(
  schema: { flows?: Array<{ id?: unknown; sections?: Array<{ id?: unknown; label?: unknown; questions?: unknown }> }> } | null | undefined,
): Question[] {
  if (!schema || !Array.isArray(schema.flows)) return [];
  const out: Question[] = [];

  for (const flow of schema.flows) {
    const flowId = String(flow?.id ?? '').toUpperCase() as FlowId;
    if (!VALID_FLOW_IDS.has(flowId)) continue;
    if (!Array.isArray(flow.sections)) continue;

    for (const section of flow.sections) {
      const sectionId = typeof section?.id === 'string' ? section.id : '';
      if (!sectionId) continue;
      if (!Array.isArray(section.questions)) continue;

      let order = 1;
      for (const raw of section.questions as RawQuestion[]) {
        const id = typeof raw.id === 'string' ? raw.id : null;
        const inputType = typeof raw.inputType === 'string' ? raw.inputType : null;
        const label = typeof raw.label === 'string' ? raw.label : null;
        if (!id || !inputType || !label) continue;

        const options = Array.isArray(raw.options)
          ? (raw.options as RawOption[])
              .filter((o) => typeof o?.value === 'string' && typeof o?.label === 'string')
              .map((o) => ({
                value: o.value as string,
                label: o.label as string,
                description: typeof o.description === 'string' ? o.description : '',
              }))
          : undefined;

        const dependsOn = raw.dependsOn && typeof raw.dependsOn.questionId === 'string'
          ? { questionId: raw.dependsOn.questionId, value: raw.dependsOn.value }
          : undefined;

        const helpTitle =
          (raw.help && typeof raw.help.title === 'string' ? raw.help.title : null) ??
          (typeof raw.helpTitle === 'string' ? raw.helpTitle : '');
        const helpBody =
          (raw.help && typeof raw.help.body === 'string' ? raw.help.body : null) ??
          (typeof raw.helpBody === 'string' ? raw.helpBody : '');
        const exampleText =
          (raw.help && typeof raw.help.example === 'string' ? raw.help.example : null) ??
          (typeof raw.exampleText === 'string' ? raw.exampleText : '');

        out.push({
          id,
          flow: flowId,
          section: sectionId,
          order: order++,
          inputType: inputType as Question['inputType'],
          options,
          required: raw.required === true,
          label,
          helpTitle: helpTitle ?? '',
          helpBody: helpBody ?? '',
          exampleText: exampleText ?? '',
          consultantNote: typeof raw.consultantNote === 'string' ? raw.consultantNote : undefined,
          dependsOn,
        });
      }
    }
  }

  return out;
}

/** The wizard key prefix for a given adaptor flow ID — e.g. R2R → "r2r",
 *  PRODUCTION → "mfg". Exported so other code stays in sync with adaptorBridge. */
export function wizardPrefixForFlow(flowId: FlowId): string {
  return FLOW_WIZARD_PREFIX[flowId];
}
