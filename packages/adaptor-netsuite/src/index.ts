import type {
  PlatformAdaptor,
  QuestionnaireSchema,
  FlowDefinition,
  SectionDefinition,
  QuestionDefinition,
  LicenseModel,
  PhaseModel,
  RulePack,
  OutputGeneratorDefinition,
} from '@ofoq/adaptor-sdk';
import { SDK_VERSION } from '@ofoq/adaptor-sdk';
import {
  r2rQuestions,
  p2pQuestions,
  o2cQuestions,
  mfgQuestions,
  rtnQuestions,
  type Question,
} from '@ofoq/shared';

/**
 * NetSuite adaptor — wraps the existing NetSuite-shaped questions, rules, and
 * generators into the stable PlatformAdaptor SPI. Zero behavior change: the
 * legacy code in @ofoq/shared + @ofoq/rule-engine + apps/api/services/generators
 * continues to work; this file is a thin projection of it.
 *
 * When Phase 1B+ routes runtime evaluation through the adaptor (instead of
 * direct `import { evaluate } from '@ofoq/rule-engine'`), this file becomes the
 * integration seam. For now its job is to expose the metadata so the registry
 * has something to register and the ERP picker has something to list.
 */

function buildSchema(): QuestionnaireSchema {
  const flows: Record<string, FlowDefinition> = {};
  const flowLabels: Record<string, string> = {
    R2R: 'Record-to-Report',
    P2P: 'Procure-to-Pay',
    O2C: 'Order-to-Cash',
    PRODUCTION: 'Manufacturing',
    RETURNS: 'Returns',
  };

  const groupByFlowAndSection = (qs: Question[]): void => {
    for (const q of qs) {
      const flowId = q.flow;
      if (!flows[flowId]) {
        flows[flowId] = {
          id: flowId,
          label: flowLabels[flowId] ?? flowId,
          sections: [],
        };
      }
      let section = flows[flowId].sections.find((s) => s.id === q.section);
      if (!section) {
        section = {
          id: q.section,
          label: humanize(q.section),
          order: flows[flowId].sections.length + 1,
          questions: [],
        };
        flows[flowId].sections.push(section);
      }
      section.questions.push(toQuestionDefinition(q));
    }
  };

  groupByFlowAndSection(r2rQuestions);
  groupByFlowAndSection(p2pQuestions);
  groupByFlowAndSection(o2cQuestions);
  groupByFlowAndSection(mfgQuestions);
  groupByFlowAndSection(rtnQuestions);

  // Sort sections within each flow by the first question's `order` to preserve
  // the author's intended section order.
  for (const flow of Object.values(flows)) {
    flow.sections.sort((a, b) => {
      const aMin = Math.min(...a.questions.map((q, i) => (q as { _order?: number })._order ?? i));
      const bMin = Math.min(...b.questions.map((q, i) => (q as { _order?: number })._order ?? i));
      return aMin - bMin;
    });
  }

  return {
    version: '1.0.0',
    flows: ['R2R', 'P2P', 'O2C', 'PRODUCTION', 'RETURNS']
      .map((id) => flows[id])
      .filter((f): f is FlowDefinition => !!f),
  };
}

function toQuestionDefinition(q: Question): QuestionDefinition {
  return {
    id: q.id,
    inputType: q.inputType as QuestionDefinition['inputType'],
    required: q.required,
    label: q.label,
    help: {
      title: q.helpTitle,
      body: q.helpBody,
      example: q.exampleText,
    },
    options: q.options?.map((o) => ({ value: o.value, label: o.label })),
    dependsOn: q.dependsOn
      ? { questionId: q.dependsOn.questionId, value: q.dependsOn.value }
      : undefined,
    consultantNote: q.consultantNote,
  };
}

function humanize(id: string): string {
  // "entities" → "Entities"; "multi_currency" → "Multi currency";
  // "multiEntity" → "Multi entity".
  return id
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const license: LicenseModel = {
  defaultEditionId: 'MID_MARKET',
  editions: [
    { id: 'STARTER', label: 'Starter', includesModules: [] },
    {
      id: 'MID_MARKET',
      label: 'Mid-Market',
      includesModules: ['ADVANCED_REVENUE', 'ADVANCED_INVENTORY'],
    },
    {
      id: 'ONEWORLD',
      label: 'OneWorld',
      includesModules: ['ONEWORLD', 'ADVANCED_REVENUE', 'ADVANCED_INVENTORY'],
    },
  ],
  modules: [
    { id: 'ONEWORLD', label: 'OneWorld', description: 'Multi-entity consolidation.' },
    { id: 'MANUFACTURING', label: 'Manufacturing', description: 'Core manufacturing records.' },
    { id: 'WORK_ORDERS', label: 'Work Orders' },
    { id: 'WIP_ROUTINGS', label: 'WIP / Routings' },
    { id: 'WMS', label: 'Warehouse Management' },
    { id: 'ADVANCED_INVENTORY', label: 'Advanced Inventory' },
    { id: 'DEMAND_PLANNING', label: 'Demand Planning' },
    { id: 'ADVANCED_PROCUREMENT', label: 'Advanced Procurement' },
    { id: 'ADVANCED_REVENUE', label: 'Advanced Revenue Management' },
    { id: 'FIXED_ASSETS', label: 'Fixed Assets' },
    { id: 'MULTI_BOOK', label: 'Multi-Book Accounting' },
    { id: 'SUITE_COMMERCE', label: 'SuiteCommerce' },
  ],
};

const phases: PhaseModel = {
  defaultPhases: [
    { id: 'discovery', label: 'Discovery', order: 1, trigger: 'REQUIREMENT' },
    { id: 'scoping', label: 'Scoping', order: 2, trigger: 'REQUIREMENT' },
    { id: 'build', label: 'Build', order: 3, trigger: 'REQUIREMENT' },
    { id: 'uat', label: 'UAT', order: 4, trigger: 'REQUIREMENT' },
    { id: 'go_live', label: 'Go Live', order: 5, trigger: 'REQUIREMENT' },
  ],
};

// Rule catalog — IDs + metadata only. Actual evaluation continues to happen
// via @ofoq/rule-engine's evaluate() for Phase 1A; routing through the adaptor
// is Phase 2+ work. This object exists so the adaptor shape is complete and
// downstream tooling (e.g. the ERP picker) can say "LIC, R2R, P2P, O2C, MFG,
// RTN rule packs included".
const rules: RulePack = {
  id: 'netsuite-rules',
  version: '1.0.0',
  rules: [],
};

const generators: OutputGeneratorDefinition[] = [
  { id: 'brd', label: 'Business Requirements Document', kind: 'document', outputMime: 'application/pdf' },
  { id: 'solution-doc', label: 'Solution Design Document', kind: 'document', outputMime: 'application/pdf' },
  { id: 'sdf', label: 'SuiteCloud Development Framework Package', kind: 'workflow', outputMime: 'application/zip' },
  { id: 'suitescript', label: 'SuiteScript Bundle', kind: 'script', outputMime: 'application/javascript' },
  { id: 'uat', label: 'UAT Test Scripts', kind: 'document', outputMime: 'application/zip' },
  { id: 'training-manual', label: 'End-User Training Manual', kind: 'document', outputMime: 'application/pdf' },
  { id: 'plan', label: 'Implementation Plan', kind: 'document', outputMime: 'application/pdf' },
  { id: 'risk', label: 'Risk Register', kind: 'document', outputMime: 'application/pdf' },
];

export const netsuiteAdaptor: PlatformAdaptor = {
  manifest: {
    id: 'netsuite',
    name: 'NetSuite',
    tagline: 'Oracle NetSuite ERP — cloud-native, OneWorld-ready',
    version: '1.0.0',
    vendor: 'Oracle',
    capabilities: ['document', 'script', 'workflow', 'license.gating', 'phase.planning'],
    minSdk: SDK_VERSION,
    sourceKind: 'built-in',
  },
  schema: buildSchema(),
  license,
  phases,
  rules,
  generators,
};

export default netsuiteAdaptor;
