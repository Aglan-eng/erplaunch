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
    // NS Pack 1 — FOUNDATION flow renders FIRST so the consultant locks
    // in edition / OneWorld / SuiteSuccess / sandbox / user counts /
    // subsidiary structure before R2R/P2P/O2C/MFG/RTN. Unlike the Odoo
    // adaptor (where R2R/P2P/O2C were NetSuite-cargo-cult and got
    // restructured in Pack R), NetSuite's R2R/P2P/O2C terminology is
    // native — those flows stay.
    flows: [
      buildFoundationFlow(),
      ...['R2R', 'P2P', 'O2C', 'PRODUCTION', 'RETURNS']
        .map((id) => flows[id])
        .filter((f): f is FlowDefinition => !!f),
    ],
  };
}

// ─── NS Pack 1 — Foundation & Account Type ───────────────────────────────────
//
// 16 questions across 4 sections:
//   - edition       (4): NetSuite edition (Starter / Standard / Mid-Market /
//                        Enterprise / OneWorld / Financials First),
//                        SuiteSuccess country bundle, SuiteCloud Plus add-on,
//                        sandbox account.
//   - users         (4): full user count, ESS user count, custom roles,
//                        SSO in scope.
//   - country       (4): primary country, fiscal year start, Multi-Book
//                        Accounting, Advanced Revenue Management (ARM).
//   - subsidiaries  (4): subsidiary count, subsidiary list, multi-currency,
//                        elimination entity (for consolidation).
//
// Sources: NetSuite Editions (Oracle docs), OneWorld + multi-subsidiary,
// SuiteSuccess methodology + country bundles, Multi-Book Accounting
// SuiteApp, Advanced Revenue Management (ARM — ASC 606 / IFRS 15),
// SuiteCloud Plus license tiers.
function buildFoundationFlow(): FlowDefinition {
  return {
    id: 'FOUNDATION',
    label: 'Project Foundation',
    description:
      'NetSuite edition, SuiteSuccess country bundle, account-type and add-ons, user counts, country, subsidiary structure, and fiscal calendar — the decisions that gate everything downstream.',
    sections: [
      {
        id: 'edition',
        label: 'Edition & Account Type',
        order: 1,
        questions: [
          {
            id: 'ns.foundation.edition',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'NetSuite edition',
            options: [
              { value: 'STARTER', label: 'Starter (SuiteSuccess Starter — small business, single subsidiary)' },
              { value: 'STANDARD', label: 'Standard / Limited Edition (single subsidiary, ≤10 full users)' },
              { value: 'MID_MARKET', label: 'Mid-Market (single subsidiary, larger user count, no multi-currency)' },
              { value: 'ENTERPRISE', label: 'Enterprise (single subsidiary, all features except OneWorld)' },
              { value: 'ONEWORLD', label: 'OneWorld (required for multi-subsidiary, multi-currency, multi-language, intercompany)' },
              { value: 'FINANCIALS_FIRST', label: 'SuiteSuccess Financials First (accounting-only entry point)' },
            ],
          },
          {
            id: 'ns.foundation.suiteSuccessBundle',
            inputType: 'TEXT',
            required: true,
            label:
              "SuiteSuccess country bundle (e.g., 'US', 'UK', 'Australia', 'Canada', 'Germany', or 'Custom — no SuiteSuccess')",
            help: {
              title: 'SuiteSuccess country bundles',
              body: 'SuiteSuccess bundles preconfigure COA, tax codes, statutory reports, and forms for a country. Saves 4–8 weeks of base configuration. Custom = build everything from scratch.',
            },
          },
          {
            id: 'ns.foundation.suiteCloudPlus',
            inputType: 'BOOLEAN',
            required: true,
            label: 'SuiteCloud Plus add-on in scope?',
            help: {
              title: 'SuiteCloud Plus',
              body: 'SuiteCloud Plus = more script-governance units, more concurrent integrations, more web-services calls. Required for any non-trivial integration or custom-script footprint.',
            },
          },
          {
            id: 'ns.foundation.sandboxAccount',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Sandbox account in scope? (full-copy or release-preview)',
            options: [
              { value: 'FULL_COPY', label: 'Full-copy sandbox (data + customizations refreshed periodically)' },
              { value: 'RELEASE_PREVIEW', label: 'Release Preview only (early access to upcoming releases, no full data)' },
              { value: 'BOTH', label: 'Both Full-copy + Release Preview' },
              { value: 'NONE', label: 'No sandbox (production-only — strongly discouraged for non-trivial work)' },
            ],
          },
        ],
      },
      {
        id: 'users',
        label: 'Users & Access',
        order: 2,
        questions: [
          {
            id: 'ns.foundation.fullUserCount',
            inputType: 'NUMBER',
            required: true,
            label: 'Full user count at go-live (named users with full UI access)',
          },
          {
            id: 'ns.foundation.essUserCount',
            inputType: 'NUMBER',
            required: true,
            label:
              'Employee Self-Service (ESS) user count (limited UI: time entry, expense reports, leave requests)',
            help: {
              title: 'ESS users',
              body: 'ESS users license at ~10% of full-user cost. Use for distributed workforces where most employees only enter time/expenses.',
            },
          },
          {
            id: 'ns.foundation.customRolesRequired',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Custom roles required beyond the ~50 standard NetSuite roles?',
          },
          {
            id: 'ns.foundation.ssoInScope',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Single Sign-On (SAML / OIDC) in scope?',
          },
        ],
      },
      {
        id: 'country',
        label: 'Country & Fiscal Calendar',
        order: 3,
        questions: [
          {
            id: 'ns.foundation.primaryCountry',
            inputType: 'TEXT',
            required: true,
            label: 'Primary country of operation (ISO 3166 alpha-2 — e.g., US, GB, AU, AE, EG)',
          },
          {
            id: 'ns.foundation.fiscalYearStart',
            inputType: 'TEXT',
            required: true,
            label: "Fiscal year start (MM-DD, e.g., '01-01' or '07-01')",
          },
          {
            id: 'ns.foundation.multiBookAccounting',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Multi-Book Accounting in scope? (parallel ledgers — e.g., IFRS + US GAAP, statutory + management)',
            help: {
              title: 'Multi-Book Accounting',
              body: 'Multi-Book is a paid SuiteApp on top of OneWorld. Allows posting to multiple books from one transaction with different rules per book.',
            },
          },
          {
            id: 'ns.foundation.advancedRevRecInScope',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Advanced Revenue Management (ARM) in scope? (ASC 606 / IFRS 15 revenue recognition)',
          },
        ],
      },
      {
        id: 'subsidiaries',
        label: 'Subsidiary Structure',
        order: 4,
        questions: [
          {
            id: 'ns.foundation.subsidiaryCount',
            inputType: 'NUMBER',
            required: true,
            label: 'Number of legal subsidiaries (use 1 for single-entity engagements)',
          },
          {
            id: 'ns.foundation.subsidiaryList',
            inputType: 'TEXTAREA',
            required: false,
            label:
              'If >1 — list each subsidiary (name, country, base currency, parent — one per line)',
          },
          {
            id: 'ns.foundation.multiCurrencyInScope',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Multi-currency operations? (transactions in non-base currency)',
          },
          {
            id: 'ns.foundation.eliminationEntity',
            inputType: 'TEXT',
            required: false,
            label:
              'Consolidation / elimination entity name (only if subsidiary count > 1; this is the dummy entity that holds intercompany eliminations)',
          },
        ],
      },
    ],
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

    // ── NS Pack 1 — Foundation rules ──────────────────────────────────────

    // R1: Multi-subsidiary deployments require OneWorld. The other
    // editions (Starter, Standard, Mid-Market, Enterprise,
    // Financials First) all support a single subsidiary only.
    {
      id: 'ns.foundation.multi-subsidiary-requires-oneworld',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['ns.foundation.subsidiaryCount', 'ns.foundation.edition'],
      message: 'Multi-subsidiary deployments require NetSuite OneWorld. The selected edition does not support multiple legal subsidiaries.',
      resolution: 'Either upgrade edition to ONEWORLD, or set subsidiaryCount to 1 and document any future entities as a Phase 2 OneWorld migration.',
      when: {
        all: [
          { answerNumberGreaterThan: { questionId: 'ns.foundation.subsidiaryCount', value: 1 } },
          { not: { answerEquals: { questionId: 'ns.foundation.edition', value: 'ONEWORLD' } } },
        ],
      },
    },

    // R2: Multi-currency requires OneWorld. Other editions support a
    // single base currency only.
    {
      id: 'ns.foundation.multi-currency-requires-oneworld',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['ns.foundation.multiCurrencyInScope', 'ns.foundation.edition'],
      message: 'Multi-currency transactions require OneWorld. Other editions support a single base currency only.',
      resolution: 'Upgrade to ONEWORLD, or restrict scope to a single base currency.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.foundation.multiCurrencyInScope' } },
          { not: { answerEquals: { questionId: 'ns.foundation.edition', value: 'ONEWORLD' } } },
        ],
      },
    },

    // R3: Multi-Book Accounting (parallel ledgers — IFRS + US GAAP,
    // statutory + management) requires OneWorld. Multi-Book is a
    // paid SuiteApp on top of OneWorld.
    {
      id: 'ns.foundation.multi-book-requires-oneworld',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['ns.foundation.multiBookAccounting', 'ns.foundation.edition'],
      message: 'Multi-Book Accounting (parallel ledgers — IFRS + US GAAP) requires OneWorld.',
      resolution: 'Upgrade edition to ONEWORLD. Multi-Book is a paid SuiteApp on top of OneWorld; budget the additional license cost.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.foundation.multiBookAccounting' } },
          { not: { answerEquals: { questionId: 'ns.foundation.edition', value: 'ONEWORLD' } } },
        ],
      },
    },

    // R4: Mid-Market / Enterprise / OneWorld engagements without any
    // sandbox is high risk — production-only changes are unsafe and
    // audit findings flag this.
    {
      id: 'ns.foundation.no-sandbox-on-mid-market-or-above',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['ns.foundation.sandboxAccount', 'ns.foundation.edition'],
      message: 'Mid-Market/Enterprise/OneWorld engagements without any sandbox is high risk — production-only changes are unsafe and audit findings flag this.',
      resolution: 'Add Full-copy sandbox at minimum. Sandboxes price as ~10–15% of production license; standard practice for NetSuite implementations above Starter tier.',
      when: {
        all: [
          { answerEquals: { questionId: 'ns.foundation.sandboxAccount', value: 'NONE' } },
          { answerIn: {
            questionId: 'ns.foundation.edition',
            values: ['MID_MARKET', 'ENTERPRISE', 'ONEWORLD'],
          } },
        ],
      },
    },

    // R5: SuiteSuccess Starter restricts the number of custom roles.
    // Adding more than the included roles requires upgrading.
    {
      id: 'ns.foundation.custom-roles-on-starter-restricted',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['ns.foundation.customRolesRequired', 'ns.foundation.edition'],
      message: 'SuiteSuccess Starter restricts the number of custom roles. Adding more than the included roles requires upgrading.',
      resolution: 'Either upgrade to STANDARD/MID_MARKET, or scope custom-role need within the Starter limit (typically 5 custom roles).',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.foundation.customRolesRequired' } },
          { answerEquals: { questionId: 'ns.foundation.edition', value: 'STARTER' } },
        ],
      },
    },

    // R6: SSO works without SuiteCloud Plus, but Plus adds better
    // governance for the related token-based auth and OAuth 2 flows
    // that integrations typically need alongside SSO.
    {
      id: 'ns.foundation.sso-better-with-suitecloud-plus',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['ns.foundation.ssoInScope', 'ns.foundation.suiteCloudPlus'],
      message: 'SSO works without SuiteCloud Plus, but Plus adds better governance for the related token-based auth and OAuth 2 flows that integrations typically need alongside SSO.',
      resolution: 'If non-trivial integration footprint is also in scope, add SuiteCloud Plus. If SSO is the only enterprise-auth requirement, the standard package is sufficient.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.foundation.ssoInScope' } },
          { answerFalsy: { questionId: 'ns.foundation.suiteCloudPlus' } },
        ],
      },
    },

    // R7: Subsidiary count > 1 but no subsidiary details captured.
    // Phase 4 builds the subsidiary tree exactly from this list.
    {
      id: 'ns.foundation.subsidiary-list-required-when-count-gt-one',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['ns.foundation.subsidiaryCount', 'ns.foundation.subsidiaryList'],
      message: 'Subsidiary count > 1 but no subsidiary details captured.',
      resolution: 'List each subsidiary (name, country, base currency, parent). NetSuite Phase 4 builds the subsidiary tree exactly from this list.',
      when: {
        all: [
          { answerNumberGreaterThan: { questionId: 'ns.foundation.subsidiaryCount', value: 1 } },
          { answerFalsy: { questionId: 'ns.foundation.subsidiaryList' } },
        ],
      },
    },

    // R8: Multi-subsidiary engagements need a consolidation/elimination
    // entity to hold intercompany eliminations on consolidated
    // reports. Standard NetSuite OneWorld pattern.
    {
      id: 'ns.foundation.elimination-entity-required-for-consolidation',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['ns.foundation.subsidiaryCount', 'ns.foundation.eliminationEntity'],
      message: 'Multi-subsidiary engagements need a consolidation/elimination entity to hold intercompany eliminations on consolidated reports.',
      resolution: "Name the elimination entity (e.g., 'ACME Group Eliminations'). Standard NetSuite OneWorld pattern; required for clean consolidated financials.",
      when: {
        all: [
          { answerNumberGreaterThan: { questionId: 'ns.foundation.subsidiaryCount', value: 1 } },
          { answerFalsy: { questionId: 'ns.foundation.eliminationEntity' } },
        ],
      },
    },

    // R9: Advanced Revenue Management (ARM, for ASC 606 / IFRS 15) is
    // typically licensed alongside Mid-Market or above. Starter /
    // Standard / Financials First may not include ARM.
    {
      id: 'ns.foundation.advanced-revrec-recommends-mid-market-or-above',
      type: 'LICENSE_GAP',
      severity: 'WARN',
      questionIds: ['ns.foundation.advancedRevRecInScope', 'ns.foundation.edition'],
      message: 'Advanced Revenue Management (ARM, for ASC 606 / IFRS 15) is typically licensed alongside Mid-Market or above. Starter/Standard may not include ARM.',
      resolution: 'Confirm ARM is included in the contract, or upgrade edition. ARM without proper licensing is a contract risk and a commit-blocker for revenue recognition.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.foundation.advancedRevRecInScope' } },
          { answerIn: {
            questionId: 'ns.foundation.edition',
            values: ['STARTER', 'STANDARD', 'FINANCIALS_FIRST'],
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
