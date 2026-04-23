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

// Rule catalog (Phase 15): declarative ports of the NetSuite rule engine's
// license-level checks. These are duplicated metadata today — the legacy
// `@ofoq/rule-engine`'s `evaluateLicense()` still fires for NetSuite
// engagements and remains authoritative. Adding them here so they surface
// in the AdaptorPanel rule count + can be evaluated by the generic
// `evaluateAdaptorRules()` evaluator. The dual-dispatch plan (remove the
// legacy rule bodies one-at-a-time once behavior is proven identical)
// lands in Phase 16+; see ADR 0005 for the migration strategy.
const rules: RulePack = {
  id: 'netsuite-rules',
  version: '1.0.0',
  rules: [
    // ── Edition-module compatibility ────────────────────────────────────────
    {
      id: 'LIC-001',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: [],
      message: 'One or more modules selected are not available on the Starter edition.',
      resolution: 'Upgrade the license to Mid-Market or OneWorld, or remove the incompatible modules from the license profile.',
      when: {
        all: [
          { licenseEditionIn: ['STARTER'] },
          { licenseHasAnyModule: [
            'ONEWORLD', 'MANUFACTURING', 'WMS', 'WORK_ORDERS', 'WIP_ROUTINGS',
            'ADVANCED_INVENTORY', 'DEMAND_PLANNING', 'ADVANCED_PROCUREMENT', 'PSA',
          ] },
        ],
      },
    },
    {
      id: 'LIC-002',
      type: 'LICENSE_GAP',
      severity: 'WARN',
      questionIds: [],
      message: 'SuiteCommerce is available on Starter but is limited to basic storefront functionality; Advanced features require Mid-Market or OneWorld.',
      resolution: 'Confirm the required e-commerce feature set with the client. Upgrade to Mid-Market if SuiteCommerce Advanced features are needed.',
      when: {
        all: [
          { licenseEditionIn: ['STARTER'] },
          { licenseHasModule: 'ECOMMERCE' },
        ],
      },
    },

    // ── OneWorld edition/module consistency ─────────────────────────────────
    {
      id: 'LIC-003',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: [],
      message: 'The OneWorld module requires the OneWorld edition. Multi-entity and multi-subsidiary features are not available on Starter or Mid-Market editions.',
      resolution: 'Upgrade the license edition to OneWorld, or remove the OneWorld module if multi-entity is not required.',
      when: {
        all: [
          { licenseHasModule: 'ONEWORLD' },
          { licenseEditionNotIn: ['ONEWORLD'] },
        ],
      },
    },
    {
      id: 'LIC-004',
      type: 'LICENSE_GAP',
      severity: 'WARN',
      questionIds: [],
      message: 'The OneWorld edition is selected but the OneWorld module is not included in the license profile. Multi-entity features will not be activated.',
      resolution: 'Add the OneWorld module to the license profile to enable multi-entity configuration.',
      when: {
        all: [
          { licenseEditionIn: ['ONEWORLD'] },
          { licenseMissingModule: 'ONEWORLD' },
        ],
      },
    },

    // ── Module-to-module dependencies ───────────────────────────────────────
    {
      id: 'LIC-005',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: [],
      message: 'The Warehouse Management (WMS) module requires Advanced Inventory. Bin management, multi-location transfers, and barcode-driven workflows all depend on it.',
      resolution: 'Add the Advanced Inventory module to the license profile alongside WMS.',
      when: {
        all: [
          { licenseHasModule: 'WMS' },
          { licenseMissingModule: 'ADVANCED_INVENTORY' },
        ],
      },
    },
    {
      id: 'LIC-006',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: [],
      message: 'The Demand Planning module requires Advanced Inventory. Forecast-driven replenishment depends on the multi-location inventory data from Advanced Inventory.',
      resolution: 'Add the Advanced Inventory module to the license profile alongside Demand Planning.',
      when: {
        all: [
          { licenseHasModule: 'DEMAND_PLANNING' },
          { licenseMissingModule: 'ADVANCED_INVENTORY' },
        ],
      },
    },
    {
      id: 'LIC-007',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: [],
      message: 'The WIP/Routings module requires Work Orders. Routing steps, operation sequences, and labour capture are all attached to Work Order records.',
      resolution: 'Add the Work Orders module to the license profile alongside WIP/Routings.',
      when: {
        all: [
          { licenseHasModule: 'WIP_ROUTINGS' },
          { licenseMissingModule: 'WORK_ORDERS' },
        ],
      },
    },
    {
      id: 'LIC-008',
      type: 'LICENSE_GAP',
      severity: 'WARN',
      questionIds: [],
      message: 'The Manufacturing module typically requires Work Orders for BOM-driven production. Without Work Orders only Assembly Builds are supported, lacking routing + labour capture.',
      resolution: 'Add the Work Orders module to enable full manufacturing functionality, or confirm Assembly Builds alone are sufficient.',
      when: {
        all: [
          { licenseHasModule: 'MANUFACTURING' },
          { licenseMissingModule: 'WORK_ORDERS' },
        ],
      },
    },

    // ── R2R license-gap rules (answer × license) ────────────────────────────
    {
      id: 'R2R-001',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['r2r.entities.multiEntity'],
      message: 'Multi-entity configuration requires the OneWorld module, which is not included in the current license.',
      resolution: 'Add the OneWorld module to the license profile, or disable multi-entity mode.',
      when: {
        all: [
          { answerEquals: { questionId: 'r2r.entities.multiEntity', value: true } },
          { licenseMissingModule: 'ONEWORLD' },
        ],
      },
    },
    {
      id: 'R2R-002',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['r2r.currencies.isMultiCurrency'],
      message: 'Multi-currency is not supported on the Starter edition.',
      resolution: 'Upgrade the license to Mid-Market or OneWorld, or disable multi-currency.',
      when: {
        all: [
          { answerEquals: { questionId: 'r2r.currencies.isMultiCurrency', value: true } },
          { licenseEditionIn: ['STARTER'] },
        ],
      },
    },
    {
      id: 'R2R-008',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['r2r.journalEntries.intercompanyJE'],
      message: 'Intercompany journal entries require the OneWorld module, which is not included in the current license.',
      resolution: 'Add the OneWorld module to the license profile, or disable intercompany journal entries.',
      when: {
        all: [
          { answerEquals: { questionId: 'r2r.journalEntries.intercompanyJE', value: true } },
          { licenseMissingModule: 'ONEWORLD' },
        ],
      },
    },
    {
      id: 'R2R-005',
      type: 'CONFIG_CONFLICT',
      severity: 'BLOCK',
      questionIds: ['r2r.accountingPeriods.fiscalYearStart'],
      message: 'The fiscal year start must be one of January through December.',
      resolution: 'Select a valid calendar month for the fiscal year start.',
      when: {
        all: [
          { answerTruthy: { questionId: 'r2r.accountingPeriods.fiscalYearStart' } },
          { not: {
            answerIn: {
              questionId: 'r2r.accountingPeriods.fiscalYearStart',
              values: [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December',
              ],
            },
          } },
        ],
      },
    },
  ],
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
