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
    // Kickoff Pack — UNIVERSAL pack (mirrored verbatim in adaptor-odoo).
    // Renders FIRST in the wizard so consultants capture sponsor +
    // governance + comms before any platform-specific decisions. Same
    // 12 questions, same 6 rules in both adaptors. Update both files
    // when changing kickoff content.
    // NS Pack 2 — TAX flow sits between FOUNDATION and R2R because
    // SuiteTax engine, nexus list, and e-invoicing SuiteApps gate
    // every accounting transaction downstream.
    // NS Pack 3 — LOCALIZATION flow sits AFTER TAX and BEFORE R2R.
    // SuiteSuccess country bundles, statutory reporting frameworks,
    // data residency, multi-language UI, and country-specific
    // localization SuiteApps all gate the COA / forms that R2R uses.
    // NS SD Depth Pack — SOLUTION_DESIGN flow sits AFTER LOCALIZATION
    // and BEFORE R2R. Captures architecture pattern, custom UI scope,
    // SuiteScript scope, data model, security/SoD, integration
    // architecture. Closes the lifecycle harness Phase 3 gap (4/10 →
    // 9+) by feeding deeper content into the schema-walking
    // solutionDocGenerator.
    flows: [
      buildKickoffFlow(),
      buildFoundationFlow(),
      buildTaxFlow(),
      buildLocalizationFlow(),
      buildSolutionDesignFlow(),
      ...['R2R', 'P2P', 'O2C', 'PRODUCTION', 'RETURNS']
        .map((id) => flows[id])
        .filter((f): f is FlowDefinition => !!f),
    ],
  };
}

// ─── Kickoff Pack — UNIVERSAL (mirrored verbatim in adaptor-odoo) ────────────
//
// 12 questions across 3 sections + 6 universal rules. Both adaptors get
// the same flow because project-kickoff content (sponsor, charter, RACI,
// governance, comms) is platform-agnostic. The kickoffGenerator in
// apps/api produces a consolidated Project_Kickoff.{md,html} document
// from these answers, adaptor-aware via AdaptorContext so prose flexes
// per platform. Update BOTH adaptor index.ts files when changing kickoff
// content.
//
// Sources: PMI / PMBOK project charter standard; standard ERP-
// implementation kickoff agenda (consensus across SuiteSuccess, SAP
// Activate, Oracle Cloud Implementation Methodology, Odoo methodology);
// RACI matrix conventions (one Accountable per activity; never two).
function buildKickoffFlow(): FlowDefinition {
  return {
    id: 'KICKOFF',
    label: 'Project Kickoff',
    description:
      'Mandate, governance, and communication — the foundational agreements that frame the project before Discovery starts.',
    sections: [
      {
        id: 'mandate',
        label: 'Project Mandate',
        order: 1,
        questions: [
          {
            id: 'kickoff.mandate.sponsor',
            inputType: 'TEXT',
            required: true,
            label: 'Project sponsor — name, title, organization (the single accountable executive)',
          },
          {
            id: 'kickoff.mandate.businessCase',
            inputType: 'TEXTAREA',
            required: true,
            label:
              'Business case — one paragraph: why is this project happening now? what business outcome does it enable?',
          },
          {
            id: 'kickoff.mandate.successCriteria',
            inputType: 'TEXTAREA',
            required: true,
            label:
              "Top 3 success criteria, measurable (one per line — e.g., 'Close month-end in 5 business days vs current 12', 'Eliminate 80% of manual journal entries', 'Single source of truth for inventory across all 4 warehouses')",
          },
          {
            id: 'kickoff.mandate.targetGoLiveDate',
            inputType: 'TEXT',
            required: true,
            label: "Target go-live date (YYYY-MM-DD or 'TBD')",
          },
        ],
      },
      {
        id: 'governance',
        label: 'Governance & Decision-Making',
        order: 2,
        questions: [
          {
            id: 'kickoff.governance.steeringCadence',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Steering committee cadence',
            options: [
              { value: 'WEEKLY', label: 'Weekly' },
              { value: 'BIWEEKLY', label: 'Bi-weekly (typical for mid-market implementations)' },
              { value: 'MONTHLY', label: 'Monthly (typical for small / phased)' },
              { value: 'AD_HOC', label: 'Ad-hoc (high risk — recommend converting to scheduled cadence)' },
            ],
          },
          {
            id: 'kickoff.governance.workingGroupCadence',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Working group / project board cadence',
            options: [
              { value: 'DAILY', label: 'Daily standup' },
              { value: 'WEEKLY', label: 'Weekly' },
              { value: 'BIWEEKLY', label: 'Bi-weekly' },
            ],
          },
          {
            id: 'kickoff.governance.decisionThresholds',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Decision authority thresholds (one per line — e.g., '<$10k: PM decides', '$10k–$50k: Steering', '>$50k or scope change: Sponsor + Steering')",
          },
          {
            id: 'kickoff.governance.escalationPath',
            inputType: 'TEXT',
            required: true,
            label:
              "Escalation path — named individual(s) when issues are unresolved at working-group level (e.g., 'Sarah Chen (consultant PM) → Steering Committee → Project Sponsor')",
          },
        ],
      },
      {
        id: 'communication',
        label: 'Communication Plan',
        order: 3,
        questions: [
          {
            id: 'kickoff.communication.statusReportCadence',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Status report cadence to client team',
            options: [
              { value: 'WEEKLY', label: 'Weekly' },
              { value: 'BIWEEKLY', label: 'Bi-weekly' },
              { value: 'MONTHLY', label: 'Monthly' },
            ],
          },
          {
            id: 'kickoff.communication.statusReportAudience',
            inputType: 'TEXTAREA',
            required: true,
            label: 'Status report distribution list (one per line — name + role)',
          },
          {
            id: 'kickoff.communication.issueReportingChannel',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Primary issue/risk reporting channel',
            options: [
              { value: 'EMAIL', label: 'Email to PM' },
              { value: 'SHARED_DOC', label: 'Shared issue log (Google Sheet / Notion / Jira)' },
              { value: 'WORKING_GROUP', label: 'Surface at working-group meeting' },
              { value: 'MIXED', label: 'Mixed — different channels per severity' },
            ],
          },
          {
            id: 'kickoff.communication.stakeholderNotes',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Stakeholder map notes — anyone NOT in the engagement team list who needs visibility (e.g., 'CFO Maria Khan — quarterly read-out only', 'IT Director Ahmed — must be informed before any environment change')",
          },
        ],
      },
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

// ─── NS Pack 2 — Tax Engine (SuiteTax) ───────────────────────────────────────
//
// 16 questions across 4 sections:
//   - engine     (4): tax engine (SuiteTax / Legacy), item price mode
//                     (inclusive / exclusive / mixed), default sales /
//                     purchase tax codes.
//   - nexus      (4): nexus list per subsidiary, Tax Reporting Framework
//                     country bundles, e-invoicing mandate flag,
//                     e-invoicing SuiteApp(s) per country.
//   - specials   (4): withholding tax, reverse-charge, US use tax,
//                     tax-exempt customers.
//   - filing     (4): filing periodicity, multi-jurisdiction reporting,
//                     sales-tax automation (Avalara/Vertex/Sovos),
//                     automation provider name.
//
// Sources: NetSuite SuiteTax docs (mandatory for new accounts since
// 2020), NetSuite Nexus configuration, Tax Reporting Framework country
// bundles, NetSuite Withholding Tax SuiteApp, NetSuite Avalara AvaTax
// integration, country e-invoicing partner SuiteApps (Italy SDI, Mexico
// CFDI, Spain SII / Veri*Factu, Saudi ZATCA, Egypt ETA).
function buildTaxFlow(): FlowDefinition {
  return {
    id: 'TAX',
    label: 'Tax Engine',
    description:
      'SuiteTax engine selection, nexus structure per subsidiary, default tax behavior, e-invoicing SuiteApps, withholding, and tax-filing/reporting framework.',
    sections: [
      {
        id: 'engine',
        label: 'Tax Engine & Default Behavior',
        order: 1,
        questions: [
          {
            id: 'ns.tax.engine',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Tax engine',
            options: [
              { value: 'SUITETAX', label: 'SuiteTax (modern engine — required for new accounts since 2020; recommended for all new implementations)' },
              { value: 'LEGACY', label: 'Legacy tax engine (only if migrating an existing legacy customer who has not switched yet)' },
            ],
          },
          {
            id: 'ns.tax.itemPriceMode',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Default item pricing — tax-inclusive or tax-exclusive?',
            options: [
              { value: 'INCLUSIVE', label: 'Tax-inclusive (B2C — final price includes tax; common in EU/UK/AU retail)' },
              { value: 'EXCLUSIVE', label: 'Tax-exclusive (B2B — tax added at invoicing; common in US, MENA B2B)' },
              { value: 'MIXED', label: 'Mixed (different per item or per subsidiary)' },
            ],
          },
          {
            id: 'ns.tax.defaultSalesTaxCode',
            inputType: 'TEXT',
            required: true,
            label:
              "Default Sales Tax Code (rate name + percent — e.g., 'VAT 5% UAE', 'GST 10% AU', 'CA-Sales-Tax 7.25%', 'None')",
          },
          {
            id: 'ns.tax.defaultPurchaseTaxCode',
            inputType: 'TEXT',
            required: true,
            label: 'Default Purchase Tax Code',
          },
        ],
      },
      {
        id: 'nexus',
        label: 'Nexus & Compliance',
        order: 2,
        questions: [
          {
            id: 'ns.tax.nexusList',
            inputType: 'TEXTAREA',
            required: true,
            label:
              "Nexus list — one per line, format: '<subsidiary> | <country>/<state-or-region>' (e.g., 'Atlas US Inc. | US/CA', 'Atlas US Inc. | US/NY', 'Atlas UK Ltd. | GB', 'Atlas DE GmbH | DE')",
            help: {
              title: 'Nexus = a tax jurisdiction',
              body: 'Each subsidiary in OneWorld can have multiple nexuses (e.g., a US subsidiary with sales tax obligations in CA, NY, and TX). Each nexus has its own tax codes and reports.',
            },
          },
          {
            id: 'ns.tax.taxReportingFramework',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Tax Reporting Framework country bundles needed (one per line — e.g., 'US Tax Reports', 'UK MTD VAT', 'EU SAF-T', 'Saudi ZATCA Reports', 'Custom — no SuiteApp')",
            help: {
              title: 'Tax Reporting Framework SuiteApps',
              body: 'NetSuite ships country-specific Tax Reporting Framework SuiteApps that produce statutory reports per nexus (UK MTD, IT VAT return, etc.). Without one, tax reporting must be manually built.',
            },
          },
          {
            id: 'ns.tax.einvoicingMandatory',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Is e-invoicing mandatory in any of the listed countries?',
            options: [
              { value: 'YES', label: 'Yes' },
              { value: 'NO', label: 'No' },
              { value: 'UNSURE', label: 'Unsure — research needed' },
            ],
          },
          {
            id: 'ns.tax.einvoicingSuiteApp',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "If yes — e-invoicing SuiteApp(s) per country (one per line — e.g., 'Italy: Electronic Invoicing for Italy SuiteApp', 'Mexico: Mexico Compliance SuiteApp', 'Spain: SII Localization', 'Saudi: ZATCA via partner SuiteApp', 'Egypt: Custom build — no SuiteApp')",
            dependsOn: { questionId: 'ns.tax.einvoicingMandatory', value: 'YES' },
          },
        ],
      },
      {
        id: 'specials',
        label: 'Special Tax Mechanics',
        order: 3,
        questions: [
          {
            id: 'ns.tax.withholdingInScope',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Withholding Tax in scope? (services, contractor payments, royalties, cross-border)',
            help: {
              title: 'Withholding Tax SuiteApp',
              body: "Requires the 'Withholding Tax' SuiteApp from NetSuite. Configures WHT codes per nexus + customer/vendor.",
            },
          },
          {
            id: 'ns.tax.reverseChargeInScope',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Reverse-charge mechanism in scope? (cross-border services, EU intra-community, import VAT)',
          },
          {
            id: 'ns.tax.useTaxInScope',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Use Tax in scope? (US-specific — self-assessed tax on out-of-state purchases)',
          },
          {
            id: 'ns.tax.taxExemptCustomers',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Will any customer be tax-exempt? (export, government, NGO, resale certificate holders)',
          },
        ],
      },
      {
        id: 'filing',
        label: 'Tax Filing & Automation',
        order: 4,
        questions: [
          {
            id: 'ns.tax.filingPeriodicity',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Tax filing periodicity (most common — varies by nexus)',
            options: [
              { value: 'MONTHLY', label: 'Monthly' },
              { value: 'QUARTERLY', label: 'Quarterly' },
              { value: 'ANNUAL', label: 'Annual' },
              { value: 'MIXED', label: 'Mixed by nexus' },
            ],
          },
          {
            id: 'ns.tax.multiJurisdictionReporting',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Multi-jurisdiction reporting required? (file tax returns in 2+ states/countries)',
          },
          {
            id: 'ns.tax.salesTaxAutomation',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Sales-tax automation provider in scope? (third-party engine that calculates and files automatically)',
          },
          {
            id: 'ns.tax.salesTaxAutomationProvider',
            inputType: 'TEXT',
            required: false,
            label: "If yes — provider name (e.g., 'Avalara AvaTax', 'Vertex O Series', 'Sovos GTD')",
            dependsOn: { questionId: 'ns.tax.salesTaxAutomation', value: true },
            help: {
              title: 'NetSuite-shipped connectors',
              body: 'Common for US engagements with multi-state nexus (10+ jurisdictions). NetSuite ships connectors for Avalara, Vertex, Sovos.',
            },
          },
        ],
      },
    ],
  };
}

// ─── NS Pack 3 — Localization & SuiteSuccess ─────────────────────────────────
//
// 16 questions across 4 sections:
//   - bundles          (4): SuiteSuccess bundle per subsidiary, COA
//                           customization scope, country-specific GL
//                           accounts, fiscal calendar per subsidiary.
//   - statutory        (4): statutory reports per country, Tax Reporting
//                           Framework SuiteApps, audit trail, period lock
//                           per subsidiary.
//   - datasovereignty  (4): data residency required, jurisdiction, GDPR /
//                           equivalent, DPA signed with NetSuite.
//   - languages        (4): UI languages, languages per subsidiary,
//                           localization SuiteApps, custom localization
//                           dev required.
//
// Allow-list for R5 (data residency may not be supported): the supported
// NetSuite data center jurisdictions. Variants (full names + codes)
// match what consultants typically type.
const NETSUITE_SUPPORTED_RESIDENCY_JURISDICTIONS = [
  'US', 'United States', 'USA',
  'EU', 'Europe', 'European Union',
  'AU', 'Australia',
];

function buildLocalizationFlow(): FlowDefinition {
  return {
    id: 'LOCALIZATION',
    label: 'Localization & SuiteSuccess',
    description:
      'SuiteSuccess country bundles per subsidiary, COA customization, statutory reporting frameworks, data residency / GDPR, multi-language UI, and country-specific localization SuiteApps beyond what SuiteSuccess covers.',
    sections: [
      {
        id: 'bundles',
        label: 'SuiteSuccess Bundles & Country COA',
        order: 1,
        questions: [
          {
            id: 'ns.localization.bundlePerSubsidiary',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "SuiteSuccess country bundle per subsidiary (one per line — '<subsidiary> | <bundle>'; use 'Custom — no bundle' for subsidiaries built without SuiteSuccess)",
            help: {
              title: 'SuiteSuccess country bundles',
              body: 'SuiteSuccess preconfigures COA, tax codes, statutory reports, and forms for a country. Saves 4–8 weeks of base configuration per country. Custom = build everything from scratch (specialized engagements only).',
            },
          },
          {
            id: 'ns.localization.coaCustomScope',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Custom COA modifications planned beyond what SuiteSuccess provides? (one per line — 'Add: 2350-Withholding Tax Payable', 'Rename: 1100 → Cash & Equivalents', 'Remove: 1500-Office Supplies (consolidate into 1490)')",
            help: {
              title: 'COA customization',
              body: 'Common — every implementation tweaks the bundled COA. Capture changes here so Phase 4 builds them as a configuration task, not a discovery surprise.',
            },
          },
          {
            id: 'ns.localization.countrySpecificGlAccounts',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Country-specific GL accounts required? (e.g., Egypt ETA-mandated accounts, KSA ZATCA-mandated accounts, India GST-input/output accounts)',
          },
          {
            id: 'ns.localization.fiscalCalendarPerSubsidiary',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Different fiscal calendars per subsidiary? (e.g., US sub on 01-01, UK sub on 04-06, AU sub on 07-01)',
          },
        ],
      },
      {
        id: 'statutory',
        label: 'Statutory Reporting per Country',
        order: 2,
        questions: [
          {
            id: 'ns.localization.statutoryReports',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Statutory reports per country (one per line — '<country>: <report names>'; e.g., 'US: 1099-NEC, 1099-MISC, FBAR', 'UK: VAT 100, Corporation Tax CT600, P11D', 'AU: BAS, IAS, FBT', 'DE: USt-VA, ZM, ELSTER')",
          },
          {
            id: 'ns.localization.taxReportingSuiteApps',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Tax Reporting Framework SuiteApps to activate (one per line — 'US Tax Reports', 'UK MTD VAT (Making Tax Digital)', 'EU SAF-T', 'Australia BAS', 'Saudi ZATCA Reports', 'Italy IVA Reports')",
            help: {
              title: 'Tax Reporting Framework SuiteApps',
              body: 'Country-specific Tax Reporting Framework SuiteApps from NetSuite. Without one, statutory reports must be built manually from Saved Searches — typically 4–6 weeks per country. Activate the SuiteApp instead where available.',
            },
          },
          {
            id: 'ns.localization.auditTrailRequired',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Audit trail requirements? (SOX, GDPR Article 30 records of processing, country-specific audit log retention)',
          },
          {
            id: 'ns.localization.periodLockPerSubsidiary',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Period lock dates per subsidiary (different lock cadences for different country regulatory requirements)',
          },
        ],
      },
      {
        id: 'datasovereignty',
        label: 'Data Residency & Privacy',
        order: 3,
        questions: [
          {
            id: 'ns.localization.dataResidencyRequired',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Are there legal data-residency requirements? (data must reside in a specific country/region — e.g., Saudi PDPL, China DSL, Russia)',
          },
          {
            id: 'ns.localization.dataResidencyJurisdiction',
            inputType: 'TEXT',
            required: false,
            label:
              "If yes — required jurisdiction (e.g., 'Saudi Arabia', 'European Union', 'Australia')",
            dependsOn: { questionId: 'ns.localization.dataResidencyRequired', value: true },
            help: {
              title: 'NetSuite data center regions',
              body: "NetSuite has data centers in US (multiple regions), EU (Dublin/Amsterdam), Australia (Sydney). Data residency requirements outside these regions may not be servable on standard NetSuite — confirm with NetSuite Account Centre.",
            },
          },
          {
            id: 'ns.localization.gdprApplicable',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'GDPR or equivalent applicable? (UAE PDPL, Saudi PDPL, Brazil LGPD, India DPDP, etc.)',
          },
          {
            id: 'ns.localization.dpaSignedWithNetsuite',
            inputType: 'SINGLE_SELECT',
            required: false,
            label: 'DPA (Data Processing Agreement) signed with NetSuite/Oracle for the relevant jurisdictions?',
            dependsOn: { questionId: 'ns.localization.gdprApplicable', value: true },
            options: [
              { value: 'YES', label: 'Yes — DPA signed and on file' },
              { value: 'IN_PROGRESS', label: 'In progress — DPA being negotiated' },
              { value: 'NO', label: 'No — not yet started' },
              { value: 'N_A', label: 'Not applicable' },
            ],
          },
        ],
      },
      {
        id: 'languages',
        label: 'Languages & Localization SuiteApps',
        order: 4,
        questions: [
          {
            id: 'ns.localization.uiLanguages',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "UI languages required (one per line, ISO 639-1 codes — e.g., 'en — English', 'ar — Arabic', 'fr — French', 'de — German', 'es — Spanish', 'zh — Chinese')",
          },
          {
            id: 'ns.localization.languagesPerSubsidiary',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "If multi-subsidiary — primary language per subsidiary (one per line — '<subsidiary> | <language>')",
          },
          {
            id: 'ns.localization.localizationSuiteApps',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Other country-specific localization SuiteApps beyond SuiteSuccess and Tax Reporting Framework (one per line — e.g., 'Egypt ETA SuiteApp (partner)', 'Saudi ZATCA Phase 2 SuiteApp (partner)', 'India GSTN connector', 'Mexico Compliance SuiteApp')",
          },
          {
            id: 'ns.localization.customLocalizationDev',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Custom localization development required? (for countries without SuiteApp coverage — e.g., e-invoicing for an unsupported country, country-specific WHT calculation)',
          },
        ],
      },
    ],
  };
}

// ─── NS SD Depth Pack — Solution Design — Architecture ───────────────────────
//
// 16 questions across 4 sections:
//   - approach       (4): architecture pattern (SuiteCloud / iPaaS /
//                         Hybrid / Multi-platform), custom UI scope,
//                         SuiteScript scope, reporting platform.
//   - datamodel      (4): custom records, custom fields scope, master
//                         data ownership, reference data sources.
//   - security       (4): standard role customization, SoD matrix,
//                         field-level security, audit log retention.
//   - integrations   (4): inbound integrations, outbound integrations,
//                         iPaaS in scope, API governance.
//
// Closes the lifecycle harness Phase 3 (Solution Design) gap from
// 4/10 to 9+. Root cause was content (NetSuite adaptor lacked deeper
// architecture-layer questions), not generator code — the schema-
// walking solutionDocGenerator emits less per-adaptor when there's
// less to walk. This pack adds the missing depth.
//
// Sources: NetSuite SuiteCloud Platform docs (governance, script
// types, web services limits); Custom Records / Custom Fields
// limits per edition; SuiteAnalytics Connect docs; iPaaS comparison
// (Boomi / Celigo / MuleSoft / Workato); Audit Trail retention
// policies; SOX SoD matrix conventions.
function buildSolutionDesignFlow(): FlowDefinition {
  return {
    id: 'SOLUTION_DESIGN',
    label: 'Solution Design — Architecture',
    description:
      'Architecture approach, customization scope, data model + master-data ownership, security/SoD framework, integration architecture, and reporting platform — the design-phase decisions that turn requirements into a buildable system.',
    sections: [
      {
        id: 'approach',
        label: 'Architecture Approach',
        order: 1,
        questions: [
          {
            id: 'ns.design.architecturePattern',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Architecture pattern',
            options: [
              { value: 'SUITECLOUD_ONLY', label: 'SuiteCloud-only (NetSuite native — UE / CS / SS / RESTlets, no external systems)' },
              { value: 'SUITECLOUD_IPAAS', label: 'SuiteCloud + iPaaS (NetSuite + Boomi / Celigo / MuleSoft / Workato for integrations)' },
              { value: 'HYBRID_CUSTOM', label: 'Hybrid (NetSuite + custom-built middleware + bespoke integrations)' },
              { value: 'MULTI_PLATFORM', label: 'Multi-platform (NetSuite + Salesforce / Workday / others — multi-cloud orchestration)' },
            ],
          },
          {
            id: 'ns.design.customUiScope',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Custom UI scope',
            options: [
              { value: 'NONE', label: 'None (vanilla NetSuite UI only)' },
              { value: 'MINIMAL', label: 'Minimal (a few User Event field hides / form tweaks)' },
              { value: 'MODERATE', label: 'Moderate (Client Scripts on key forms, custom buttons, Suitelet pages)' },
              { value: 'HEAVY', label: 'Heavy (extensive Suitelet pages, custom dashboards, multi-screen workflows)' },
            ],
          },
          {
            id: 'ns.design.scriptingScope',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "SuiteScript scope (one per line — e.g., 'User Event scripts on Sales Order', 'Map/Reduce for monthly accruals', 'RESTlet for external API ingestion', 'Workflow Action scripts for approval routing')",
          },
          {
            id: 'ns.design.reportingPlatform',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Reporting platform',
            options: [
              { value: 'SAVED_SEARCHES', label: 'Saved Searches + dashboards (vanilla NetSuite)' },
              { value: 'SUITEANALYTICS', label: 'SuiteAnalytics Workbook (visual analytics inside NetSuite)' },
              { value: 'CONNECT_TO_BI', label: 'SuiteAnalytics Connect → external BI (Power BI / Tableau / Looker)' },
              { value: 'MIXED', label: 'Mixed — Saved Searches for ops, BI for executive reporting' },
            ],
          },
        ],
      },
      {
        id: 'datamodel',
        label: 'Data Model & Master Data',
        order: 2,
        questions: [
          {
            id: 'ns.design.customRecords',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Custom record types in scope (one per line — e.g., 'Approval Tracker (custom record)', 'Vendor Onboarding Request', 'Project Milestone')",
          },
          {
            id: 'ns.design.customFieldsScope',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Custom field scope summary (one per line — e.g., 'Customer record: 4 custom fields (Tier, Industry, KAM, Renewal date)', 'Sales Order: 6 custom fields', 'Item: 3 custom fields')",
            help: {
              title: 'Custom field design intent',
              body: 'Capture the high-level count + purpose. Phase 4 builds the exact field definitions; this captures the design intent.',
            },
          },
          {
            id: 'ns.design.masterDataOwnership',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Master data ownership matrix — who owns each major object across subsidiaries (one per line — e.g., 'Customers: Sales Operations Manager (group)', 'Items: Inventory Manager per subsidiary', 'COA: Finance Director (group, mastered)')",
          },
          {
            id: 'ns.design.referenceDataSources',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Reference data sources — where does each come from (one per line — e.g., 'Currencies: Daily auto-pull from oanda.com', 'Tax codes: Avalara AvaTax', 'COA: Mastered in NetSuite, no external source')",
          },
        ],
      },
      {
        id: 'security',
        label: 'Security & Roles',
        order: 3,
        questions: [
          {
            id: 'ns.design.standardRoleCustomization',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Standard role customization scope (one per line — list each standard NetSuite role that needs tweaks — e.g., 'A/P Clerk: remove Approve Bills permission', 'Sales Manager: add subsidiary scoping', 'Custom Auditor role: read-only across all subsidiaries')",
          },
          {
            id: 'ns.design.sodMatrixRequired',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Segregation of Duties (SoD) matrix required? (typical for SOX-compliant entities, public companies, regulated industries)',
          },
          {
            id: 'ns.design.fieldLevelSecurity',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Field-level security required? (mask salary, SSN, banking details from non-authorized roles)',
          },
          {
            id: 'ns.design.auditLogRetentionMonths',
            inputType: 'NUMBER',
            required: true,
            label:
              'Audit log retention (months) — how long must field-change history be retrievable?',
            help: {
              title: 'NetSuite audit retention',
              body: "NetSuite stores ~84 months (7 years) by default. Longer retention requires periodic extracts to a data lake / archive — capture as a design decision now.",
            },
          },
        ],
      },
      {
        id: 'integrations',
        label: 'Integration Architecture',
        order: 4,
        questions: [
          {
            id: 'ns.design.inboundIntegrations',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Inbound integrations (one per line — '<source system> | <data> | <frequency> | <method>'; e.g., 'Shopify | sales orders | real-time | RESTlet', 'Bank | statements | nightly | SFTP CSV', 'Salesforce | customer master | hourly | Boomi')",
          },
          {
            id: 'ns.design.outboundIntegrations',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Outbound integrations (one per line — '<target system> | <data> | <frequency> | <method>')",
          },
          {
            id: 'ns.design.ipaasInScope',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'iPaaS in scope?',
            options: [
              { value: 'NONE', label: 'None — NetSuite native integration only' },
              { value: 'BOOMI', label: 'Boomi' },
              { value: 'CELIGO', label: 'Celigo (NetSuite-specialized)' },
              { value: 'MULESOFT', label: 'MuleSoft / Anypoint' },
              { value: 'WORKATO', label: 'Workato' },
              { value: 'OTHER', label: 'Other iPaaS — specify in Q4.4' },
            ],
          },
          {
            id: 'ns.design.apiGovernance',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "API governance approach (one per line — rate limits, monitoring, error handling — e.g., 'Rate limit: 600 req/min per integration role', 'Monitoring: Datadog + email alerts on >5% error rate', 'Retry: exponential backoff up to 3 attempts then dead-letter queue')",
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

    // ── NS Pack 2 — Tax Engine (SuiteTax) rules ───────────────────────────

    // R1: Legacy tax engine selected on what looks like a new SuiteSuccess
    // account. NetSuite has required SuiteTax for new accounts since 2020.
    //
    // Implementation note: spec calls for "suiteSuccessBundle does NOT
    // contain 'Custom'". The DSL has no string-contains operator, so the
    // pragmatic version fires whenever suiteSuccessBundle is truthy.
    // False-positive case (consultant typed "Custom — no SuiteSuccess")
    // is rare and the WARN-level prompt is dismissable.
    {
      id: 'ns.tax.legacy-engine-on-new-account',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['ns.tax.engine', 'ns.foundation.suiteSuccessBundle'],
      message: 'Legacy tax engine selected on what looks like a new SuiteSuccess account. NetSuite has required SuiteTax for all new accounts since 2020 — Legacy is only for migrations of existing pre-2020 customers.',
      resolution: 'Switch engine to SUITETAX unless this is a documented migration of an existing legacy customer. Legacy on a new account is unlikely to provision.',
      when: {
        all: [
          { answerEquals: { questionId: 'ns.tax.engine', value: 'LEGACY' } },
          { answerTruthy: { questionId: 'ns.foundation.suiteSuccessBundle' } },
        ],
      },
    },

    // R2: Multi-subsidiary OneWorld engagement but no nexus list — each
    // subsidiary needs at least one nexus for the tax engine to function.
    {
      id: 'ns.tax.oneworld-multi-sub-needs-nexus-list',
      type: 'CONFIG_CONFLICT',
      severity: 'BLOCK',
      questionIds: ['ns.foundation.subsidiaryCount', 'ns.tax.nexusList'],
      message: 'Multi-subsidiary OneWorld engagement but no nexus list captured. Each subsidiary needs at least one nexus for tax engine to function.',
      resolution: "Capture the nexus per subsidiary in the format '<subsidiary> | <country>/<state>'. Each subsidiary needs at least its country of registration; many need multiple.",
      when: {
        all: [
          { answerNumberGreaterThan: { questionId: 'ns.foundation.subsidiaryCount', value: 1 } },
          { answerFalsy: { questionId: 'ns.tax.nexusList' } },
        ],
      },
    },

    // R3: E-invoicing flagged mandatory but no SuiteApp specified per
    // country. NetSuite e-invoicing requires a NetSuite-shipped SuiteApp
    // (Italy SDI, Mexico CFDI, Spain SII), a partner SuiteApp, or a
    // custom build.
    {
      id: 'ns.tax.einvoicing-yes-needs-suiteapp',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['ns.tax.einvoicingMandatory', 'ns.tax.einvoicingSuiteApp'],
      message: 'E-invoicing flagged as mandatory but no SuiteApp specified per country. NetSuite e-invoicing requires either a NetSuite-shipped SuiteApp (Italy SDI, Mexico CFDI, Spain SII), a partner SuiteApp, or a custom build.',
      resolution: "List the country and corresponding SuiteApp or 'Custom' approach. Custom builds require dedicated development budget — typically 6–12 weeks per country for first build.",
      when: {
        all: [
          { answerEquals: { questionId: 'ns.tax.einvoicingMandatory', value: 'YES' } },
          { answerFalsy: { questionId: 'ns.tax.einvoicingSuiteApp' } },
        ],
      },
    },

    // R4: Withholding Tax requires the 'Withholding Tax' SuiteApp from
    // NetSuite — separate from standard SuiteTax. BLOCK because the
    // SuiteApp must be in the contract.
    {
      id: 'ns.tax.withholding-needs-suiteapp',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['ns.tax.withholdingInScope'],
      message: "Withholding Tax requires the 'Withholding Tax' SuiteApp from NetSuite. Standard SuiteTax does NOT include withholding — it's a separate paid SuiteApp.",
      resolution: 'Confirm Withholding Tax SuiteApp is in the contract. Add the SuiteApp license cost to budget. Phase 4 builds nexus-by-nexus WHT code configuration.',
      when: { answerTruthy: { questionId: 'ns.tax.withholdingInScope' } },
    },

    // R5: Use Tax is a US-specific concept (self-assessment on out-of-
    // state purchases). Flagging it for a non-US engagement usually
    // means a misclick.
    {
      id: 'ns.tax.use-tax-only-in-us',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['ns.tax.useTaxInScope', 'ns.foundation.primaryCountry'],
      message: "Use Tax flagged in scope but primary country is not US. Use Tax is a US-specific concept (self-assessment on out-of-state purchases when seller didn't collect sales tax).",
      resolution: 'Confirm Use Tax is genuinely needed (rare outside US). If primary country is US and the engagement is multi-state, Use Tax is correct. Otherwise, set to false.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.tax.useTaxInScope' } },
          { not: { answerEquals: { questionId: 'ns.foundation.primaryCountry', value: 'US' } } },
        ],
      },
    },

    // R6: Sales-tax automation provider needs the nexus list to map
    // jurisdictions. Avalara AvaTax onboarding requires the full nexus
    // map up front.
    {
      id: 'ns.tax.automation-needs-nexus-list',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['ns.tax.salesTaxAutomation', 'ns.tax.nexusList'],
      message: 'Sales-tax automation provider (Avalara/Vertex/Sovos) is in scope but no nexus list captured. The provider needs the nexus list to map jurisdictions.',
      resolution: 'Capture nexus list before connector configuration in Phase 4. Avalara AvaTax onboarding requires the full nexus map up front.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.tax.salesTaxAutomation' } },
          { answerFalsy: { questionId: 'ns.tax.nexusList' } },
        ],
      },
    },

    // R7: Multi-jurisdiction reporting needs at least 2 nexuses.
    //
    // Implementation note: spec calls for "fewer than 2 entries", but
    // the DSL has no line-count operator. Pragmatic fallback: fire on
    // empty nexusList only. The 1-nexus edge case is a future
    // enhancement once the SDK gains a line-count condition.
    {
      id: 'ns.tax.multi-jurisdiction-needs-multiple-nexuses',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['ns.tax.multiJurisdictionReporting', 'ns.tax.nexusList'],
      message: 'Multi-jurisdiction reporting flagged but no nexuses listed. Multi-jurisdiction by definition needs 2+ nexuses.',
      resolution: 'Add nexuses to the list, or set multiJurisdictionReporting to false.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.tax.multiJurisdictionReporting' } },
          { answerFalsy: { questionId: 'ns.tax.nexusList' } },
        ],
      },
    },

    // R8: Tax-exempt customers require exemption certificate management.
    // INFO-level reminder so the consultant captures the approach in
    // the implementation plan (standard NetSuite fields vs Avalara
    // CertCapture).
    {
      id: 'ns.tax.exempt-customers-need-certificate-management',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['ns.tax.taxExemptCustomers'],
      message: 'Tax-exempt customers require exemption certificate management — uploading certificates per customer, expiry tracking, audit trail. Standard NetSuite has fields for this; Avalara has a more complete certificate manager.',
      resolution: 'If using Avalara — Avalara CertCapture is a separate paid module. If standard NetSuite is sufficient, Phase 4 builds the customer-record fields and an expiry-tracking saved search. Allocate ~3 person-days for the Phase-4 setup.',
      when: { answerTruthy: { questionId: 'ns.tax.taxExemptCustomers' } },
    },

    // R9: Reverse-charge typically applies to cross-border or intra-
    // community transactions. Single-subsidiary editions don't usually
    // need reverse-charge — confirm intent.
    {
      id: 'ns.tax.reverse-charge-typical-on-oneworld',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['ns.tax.reverseChargeInScope', 'ns.foundation.edition'],
      message: "Reverse-charge typically applies to cross-border or intra-community transactions. Single-subsidiary editions don't usually need reverse-charge — confirm this is intentional.",
      resolution: 'If reverse-charge is genuinely needed (e.g., a UK single-sub buying digital services from EU vendors), this is correct. Otherwise consider whether OneWorld and a separate VAT subsidiary makes more sense for the scale.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.tax.reverseChargeInScope' } },
          { not: { answerEquals: { questionId: 'ns.foundation.edition', value: 'ONEWORLD' } } },
        ],
      },
    },

    // ── NS Pack 3 — Localization & SuiteSuccess rules ─────────────────────

    // R1: Custom bundle (no SuiteSuccess) on Mid-Market+ adds 4–8 weeks
    // of base configuration per affected subsidiary.
    //
    // Implementation note: spec calls for "bundlePerSubsidiary contains
    // 'Custom'" — DSL has no string-contains operator. Pragmatic
    // fallback: fire whenever multi-subsidiary paid-edition engagement
    // has any populated bundle list. Over-broad but WARN-level so
    // dismissable when all listed bundles are real SuiteSuccess names.
    // The 'contains Custom' check is a future enhancement once the
    // SDK gains a string-contains condition.
    {
      id: 'ns.localization.custom-bundle-on-mid-market-or-above-warn',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['ns.localization.bundlePerSubsidiary', 'ns.foundation.edition'],
      message: 'Custom bundle (no SuiteSuccess) on Mid-Market or above edition typically adds 4–8 weeks of base configuration per affected subsidiary. Confirm this is intentional.',
      resolution: 'If a SuiteSuccess country bundle exists for this country, strongly prefer it — the cost difference is typically negligible vs the time saved. Custom is correct only for countries without bundle coverage or specialized verticals.',
      when: {
        all: [
          { answerNumberGreaterThan: { questionId: 'ns.foundation.subsidiaryCount', value: 1 } },
          { answerTruthy: { questionId: 'ns.localization.bundlePerSubsidiary' } },
          { answerIn: {
            questionId: 'ns.foundation.edition',
            values: ['MID_MARKET', 'ENTERPRISE', 'ONEWORLD'],
          } },
        ],
      },
    },

    // R2: Multi-subsidiary OneWorld engagement but no per-subsidiary
    // SuiteSuccess bundle list captured.
    {
      id: 'ns.localization.bundle-list-must-cover-all-subsidiaries',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['ns.foundation.subsidiaryCount', 'ns.localization.bundlePerSubsidiary'],
      message: 'Multi-subsidiary OneWorld engagement but no per-subsidiary SuiteSuccess bundle list captured.',
      resolution: "List each subsidiary with its SuiteSuccess bundle (or 'Custom — no bundle'). NetSuite Phase 4 provisions one subsidiary at a time using the listed bundle.",
      when: {
        all: [
          { answerNumberGreaterThan: { questionId: 'ns.foundation.subsidiaryCount', value: 1 } },
          { answerFalsy: { questionId: 'ns.localization.bundlePerSubsidiary' } },
        ],
      },
    },

    // R3: Statutory reports listed but no Tax Reporting Framework
    // SuiteApp activated. Manual build = 4–6 weeks per country.
    {
      id: 'ns.localization.statutory-reports-need-framework',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['ns.localization.statutoryReports', 'ns.localization.taxReportingSuiteApps'],
      message: 'Statutory reports listed but no Tax Reporting Framework SuiteApps activated. Without a framework SuiteApp, statutory reports must be built manually from Saved Searches — typically 4–6 weeks per country.',
      resolution: 'Either (a) activate the corresponding Tax Reporting Framework SuiteApp per country (recommended; saves weeks), OR (b) document the manual-build approach explicitly with timeline and budget impact.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.localization.statutoryReports' } },
          { answerFalsy: { questionId: 'ns.localization.taxReportingSuiteApps' } },
        ],
      },
    },

    // R4: GDPR Article 28 requires a written DPA with the processor
    // before personal data is processed. Fires when GDPR is applicable
    // AND DPA is NO or unset.
    {
      id: 'ns.localization.gdpr-needs-dpa',
      type: 'CONFIG_CONFLICT',
      severity: 'BLOCK',
      questionIds: ['ns.localization.gdprApplicable', 'ns.localization.dpaSignedWithNetsuite'],
      message: 'GDPR or equivalent privacy regulation applicable but no DPA signed with NetSuite. GDPR Article 28 requires a written DPA with the processor before personal data is processed.',
      resolution: "Add DPA negotiation as a Phase 1 dependency in the implementation plan. NetSuite's standard DPA template is available from Oracle Legal — typically 2–4 weeks to negotiate and sign.",
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.localization.gdprApplicable' } },
          { any: [
            { answerEquals: { questionId: 'ns.localization.dpaSignedWithNetsuite', value: 'NO' } },
            { answerFalsy: { questionId: 'ns.localization.dpaSignedWithNetsuite' } },
          ] },
        ],
      },
    },

    // R5: Data residency required in a jurisdiction outside NetSuite's
    // supported regions (US / EU / Australia).
    //
    // Implementation note: spec calls for "does not match common
    // NetSuite regions". DSL has no regex/contains, so we use
    // NOT(answerIn(allowlist)) against a curated list of common
    // jurisdiction strings (codes + full names). Anything outside the
    // allow-list fires the WARN, including "Saudi Arabia", "China",
    // "Russia", "India", etc.
    {
      id: 'ns.localization.data-residency-may-not-be-supported',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['ns.localization.dataResidencyRequired', 'ns.localization.dataResidencyJurisdiction'],
      message: "Data residency required in a jurisdiction that may not be served by NetSuite's data centers. NetSuite has US, EU, and Australia regions; other jurisdictions (Saudi Arabia, China, Russia) may require alternative hosting or are not supported.",
      resolution: 'Confirm with NetSuite Account Centre BEFORE contract signature whether the required residency is achievable. If not, NetSuite may not be the right ERP for this engagement.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.localization.dataResidencyRequired' } },
          { answerTruthy: { questionId: 'ns.localization.dataResidencyJurisdiction' } },
          { not: { answerIn: {
            questionId: 'ns.localization.dataResidencyJurisdiction',
            values: NETSUITE_SUPPORTED_RESIDENCY_JURISDICTIONS,
          } } },
        ],
      },
    },

    // R6: Multiple UI languages typically need OneWorld.
    //
    // Implementation note: spec calls for "uiLanguages contains 2 or
    // more languages". DSL has no line-count operator. Pragmatic
    // fallback: use languagesPerSubsidiary as the proxy signal — that
    // field only gets populated for genuine multi-language engagements.
    // Less noisy than firing on any populated uiLanguages field.
    {
      id: 'ns.localization.multi-language-needs-oneworld',
      type: 'LICENSE_GAP',
      severity: 'WARN',
      questionIds: ['ns.localization.languagesPerSubsidiary', 'ns.foundation.edition'],
      message: "Multiple UI languages required but edition isn't OneWorld. NetSuite multi-language is typically a OneWorld feature — single-subsidiary editions support one UI language.",
      resolution: 'Upgrade edition to ONEWORLD if multiple languages are genuinely required, OR restrict scope to a single UI language.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.localization.languagesPerSubsidiary' } },
          { not: { answerEquals: { questionId: 'ns.foundation.edition', value: 'ONEWORLD' } } },
        ],
      },
    },

    // R7: Country-specific GL accounts flagged but no COA modification
    // scope captured.
    {
      id: 'ns.localization.coa-custom-modifications-need-scope',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['ns.localization.coaCustomScope', 'ns.localization.countrySpecificGlAccounts'],
      message: 'Country-specific GL accounts flagged but no COA modification scope captured.',
      resolution: 'List the specific accounts to add/rename/remove per country. Phase 4 builds them as a one-shot bulk-update task; without the list, this work surfaces as scope creep mid-build.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.localization.countrySpecificGlAccounts' } },
          { answerFalsy: { questionId: 'ns.localization.coaCustomScope' } },
        ],
      },
    },

    // R8: Different fiscal calendars per subsidiary requires OneWorld.
    {
      id: 'ns.localization.fiscal-calendar-per-subsidiary-needs-oneworld',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['ns.localization.fiscalCalendarPerSubsidiary', 'ns.foundation.edition'],
      message: 'Different fiscal calendars per subsidiary requires OneWorld. Single-subsidiary editions have one fiscal calendar.',
      resolution: 'Upgrade edition to ONEWORLD, OR align all entities to a single fiscal calendar.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.localization.fiscalCalendarPerSubsidiary' } },
          { not: { answerEquals: { questionId: 'ns.foundation.edition', value: 'ONEWORLD' } } },
        ],
      },
    },

    // R9: Custom localization development typically needs more script
    // governance than standard SuiteCloud allocates. INFO-level
    // recommendation for SuiteCloud Plus.
    {
      id: 'ns.localization.custom-localization-dev-needs-suitecloud-plus',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['ns.localization.customLocalizationDev', 'ns.foundation.suiteCloudPlus'],
      message: 'Custom localization development typically requires more script governance than the standard SuiteCloud package allocates. SuiteCloud Plus add-on is recommended.',
      resolution: 'Add SuiteCloud Plus to license. Custom localization typically needs UE scripts, SS scripts, and RESTlets — script governance ceiling on standard SuiteCloud will be hit quickly during build.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.localization.customLocalizationDev' } },
          { answerFalsy: { questionId: 'ns.foundation.suiteCloudPlus' } },
        ],
      },
    },

    // ── Kickoff Pack — UNIVERSAL rules (mirrored verbatim in adaptor-odoo,
    //                                    except R5 adaptor-specific multi-
    //                                    entity check) ──
    //
    // R5 note: spec's "tight timeline on OneWorld" — NetSuite-native
    // vocabulary. Mirrored Odoo variant uses odoo.foundation.multiCompany.
    // Same rule id (kickoff.tight-timeline-on-multi-entity) so the
    // message and resolution stay identical across both adaptors.
    //
    // The "<8 weeks from today" date-math constraint from the spec is
    // dropped — DSL has no date arithmetic. Pragmatic version fires
    // whenever a target go-live is set on a multi-entity engagement,
    // prompting the consultant to confirm-or-dismiss the timeline.

    // R1: Every project requires a single accountable sponsor.
    {
      id: 'kickoff.mandate.sponsor-required',
      type: 'DATA_WARNING',
      severity: 'BLOCK',
      questionIds: ['kickoff.mandate.sponsor'],
      message: 'Every project requires a single accountable sponsor. Without one, scope decisions stall.',
      resolution: 'Name the sponsor — typically the C-level executive whose budget or operational scope owns the outcome.',
      when: { answerFalsy: { questionId: 'kickoff.mandate.sponsor' } },
    },

    // R2: Measurable success criteria are the project's evaluation
    // baseline.
    {
      id: 'kickoff.mandate.success-criteria-required',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['kickoff.mandate.successCriteria'],
      message: "No measurable success criteria captured. Without them, the project can't be objectively evaluated at go-live.",
      resolution: "Capture at least 3 measurable criteria. Soft language ('improve', 'better') doesn't count — use numbers and timeframes.",
      when: { answerFalsy: { questionId: 'kickoff.mandate.successCriteria' } },
    },

    // R3: Monthly or ad-hoc steering on a non-trivial implementation is
    // too sparse — issues compound between meetings.
    {
      id: 'kickoff.governance.steering-cadence-monthly-warn',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['kickoff.governance.steeringCadence'],
      message: 'Monthly or ad-hoc steering on a non-trivial implementation is too sparse — issues compound between meetings.',
      resolution: 'Bi-weekly steering is the standard for mid-market. Reserve monthly for very small / phased rollouts. Ad-hoc is high risk.',
      when: {
        any: [
          { answerEquals: { questionId: 'kickoff.governance.steeringCadence', value: 'MONTHLY' } },
          { answerEquals: { questionId: 'kickoff.governance.steeringCadence', value: 'AD_HOC' } },
        ],
      },
    },

    // R4: Without an escalation path, decisions stall indefinitely when
    // working group cannot resolve.
    {
      id: 'kickoff.governance.escalation-path-required',
      type: 'DATA_WARNING',
      severity: 'BLOCK',
      questionIds: ['kickoff.governance.escalationPath'],
      message: 'No escalation path defined. When working-group cannot resolve, decisions stall indefinitely.',
      resolution: 'Name the path explicitly: PM → Steering → Sponsor. Names, not just roles.',
      when: { answerFalsy: { questionId: 'kickoff.governance.escalationPath' } },
    },

    // R5: Tight timeline on a multi-entity engagement. NetSuite variant —
    // fires when targetGoLiveDate is set AND ns.foundation.edition=ONEWORLD.
    {
      id: 'kickoff.tight-timeline-on-multi-entity',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['kickoff.mandate.targetGoLiveDate', 'ns.foundation.edition'],
      message: 'Multi-entity implementations rarely complete in under 8 weeks — multi-subsidiary configuration + tax engine setup typically takes 6–12 weeks alone.',
      resolution: 'Push target to at least 12 weeks, or scope the first go-live to a single subsidiary with phased entity rollout.',
      when: {
        all: [
          { answerTruthy: { questionId: 'kickoff.mandate.targetGoLiveDate' } },
          { answerEquals: { questionId: 'ns.foundation.edition', value: 'ONEWORLD' } },
        ],
      },
    },

    // R6: Status reports without a known audience never get read.
    {
      id: 'kickoff.communication.audience-empty',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['kickoff.communication.statusReportAudience'],
      message: 'Status report audience not captured. Status reports without a known audience never get read.',
      resolution: 'List names + roles — typically project sponsor, client PM, consultant PM, and 2–3 workstream leads from each side.',
      when: { answerFalsy: { questionId: 'kickoff.communication.statusReportAudience' } },
    },

    // ── NS SD Depth Pack — Solution Design rules ──────────────────────────

    // R1: Heavy custom UI scope without SuiteCloud Plus exceeds the
    // standard governance ceiling.
    {
      id: 'ns.design.heavy-customui-needs-suitecloud-plus',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['ns.design.customUiScope', 'ns.foundation.suiteCloudPlus'],
      message: 'Heavy custom UI scope typically exceeds the script-governance ceiling on standard SuiteCloud. Without SuiteCloud Plus, scripts will hit governance limits during peak load.',
      resolution: 'Add SuiteCloud Plus to license. The cost is dwarfed by the engineering pain of working around governance limits in heavily-customized environments.',
      when: {
        all: [
          { answerEquals: { questionId: 'ns.design.customUiScope', value: 'HEAVY' } },
          { answerFalsy: { questionId: 'ns.foundation.suiteCloudPlus' } },
        ],
      },
    },

    // R2: RESTlets consume web-services calls — typically need
    // SuiteCloud Plus for non-trivial integration footprint.
    //
    // Implementation note: spec calls for "scriptingScope contains
    // 'RESTlet'". DSL has no string-contains operator. Pragmatic
    // fallback: fire whenever scriptingScope is populated (consultant
    // listing any scripting work) AND SuiteCloud Plus is missing.
    // Over-broad but WARN-level so dismissable; the resolution
    // language already invites the consultant to confirm intent.
    {
      id: 'ns.design.restlets-need-suitecloud-plus',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['ns.design.scriptingScope', 'ns.foundation.suiteCloudPlus'],
      message: 'RESTlet-based integrations consume web-services calls. Standard SuiteCloud has tight limits on concurrent web-services calls; SuiteCloud Plus raises them substantially.',
      resolution: 'Add SuiteCloud Plus if any non-trivial integration footprint is in scope. Without it, expect throttling under realistic transaction volume.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.design.scriptingScope' } },
          { answerFalsy: { questionId: 'ns.foundation.suiteCloudPlus' } },
        ],
      },
    },

    // R3: SoD matrix without custom roles is a SOX audit finding.
    // Standard NetSuite roles cannot enforce most SoD rules.
    {
      id: 'ns.design.sod-needs-custom-roles',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['ns.design.sodMatrixRequired', 'ns.foundation.customRolesRequired'],
      message: 'Segregation of Duties matrix required but no custom roles flagged in NS Pack 1 Foundation. Standard NetSuite roles cannot enforce most SoD rules — they need to be tailored.',
      resolution: 'Set foundation.customRolesRequired to true and capture the role tweaks in ns.design.standardRoleCustomization. SoD without custom roles is a SOX audit finding.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.design.sodMatrixRequired' } },
          { answerFalsy: { questionId: 'ns.foundation.customRolesRequired' } },
        ],
      },
    },

    // R4: External BI / Mixed reporting platforms require
    // SuiteAnalytics Connect (paid SuiteApp).
    {
      id: 'ns.design.external-bi-needs-suiteanalytics-connect',
      type: 'LICENSE_GAP',
      severity: 'INFO',
      questionIds: ['ns.design.reportingPlatform'],
      message: "External BI integration requires SuiteAnalytics Connect (paid SuiteApp). Confirm it's in the NetSuite contract.",
      resolution: 'Verify SuiteAnalytics Connect license is included. Without it, external BI tools cannot query NetSuite data — they can only consume saved-search exports.',
      when: {
        any: [
          { answerEquals: { questionId: 'ns.design.reportingPlatform', value: 'CONNECT_TO_BI' } },
          { answerEquals: { questionId: 'ns.design.reportingPlatform', value: 'MIXED' } },
        ],
      },
    },

    // R5: Inbound integrations require either RESTlet (NetSuite native)
    // or iPaaS — neither is implied by SuiteCloud-only architecture.
    {
      id: 'ns.design.inbound-integrations-need-method',
      type: 'CONFIG_CONFLICT',
      severity: 'BLOCK',
      questionIds: ['ns.design.inboundIntegrations', 'ns.design.architecturePattern'],
      message: 'Inbound integrations listed but architecture pattern is SuiteCloud-only. Inbound integrations require either RESTlet (NetSuite native) or iPaaS — neither is implied by SuiteCloud-only.',
      resolution: 'Either change architecturePattern to SUITECLOUD_IPAAS / HYBRID_CUSTOM / MULTI_PLATFORM, or remove the inbound integrations from scope.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.design.inboundIntegrations' } },
          { answerEquals: { questionId: 'ns.design.architecturePattern', value: 'SUITECLOUD_ONLY' } },
        ],
      },
    },

    // R6: iPaaS marked OTHER but no governance/provider details
    // captured. iPaaS-specific governance varies meaningfully.
    {
      id: 'ns.design.ipaas-name-required-when-other',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['ns.design.ipaasInScope', 'ns.design.apiGovernance'],
      message: "iPaaS marked 'Other' but no governance/provider details captured.",
      resolution: 'Specify the iPaaS provider name and capture the API governance approach. iPaaS-specific governance varies meaningfully — Boomi atom limits differ from Celigo flow limits, etc.',
      when: {
        all: [
          { answerEquals: { questionId: 'ns.design.ipaasInScope', value: 'OTHER' } },
          { answerFalsy: { questionId: 'ns.design.apiGovernance' } },
        ],
      },
    },

    // R7: Audit log retention beyond 84 months requires periodic
    // extracts to a data lake / archive.
    {
      id: 'ns.design.long-audit-retention-needs-extract-strategy',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['ns.design.auditLogRetentionMonths'],
      message: "Audit log retention beyond 84 months (7 years) exceeds NetSuite's standard retention. Long retention requires periodic extracts to a data lake / archive.",
      resolution: 'Plan a Phase 4 task: scheduled SuiteScript that extracts audit log to S3 / Azure Blob / similar. Allocate ~2 person-days for setup. Without this, history older than 7 years is lost.',
      when: {
        answerNumberGreaterThan: { questionId: 'ns.design.auditLogRetentionMonths', value: 84 },
      },
    },

    // R8: Heavy custom-record footprint on a small edition risks
    // hitting custom-field-per-record limits.
    //
    // Implementation note: spec calls for "customRecords contains 10
    // or more lines". DSL has no line-count operator. Pragmatic
    // fallback: fire whenever customRecords is populated AND edition
    // is small. WARN-level so the consultant can dismiss for trivial
    // (<10 record) lists.
    {
      id: 'ns.design.heavy-custom-records-on-small-edition',
      type: 'LICENSE_GAP',
      severity: 'WARN',
      questionIds: ['ns.design.customRecords', 'ns.foundation.edition'],
      message: 'Heavy custom-record footprint on a small edition. Custom records consume custom-field-per-record limits; small editions have tighter limits.',
      resolution: 'Either consolidate custom records into fewer richer ones, or upgrade edition. Custom-record limits on Starter/Standard hit faster than expected.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.design.customRecords' } },
          { answerIn: {
            questionId: 'ns.foundation.edition',
            values: ['STARTER', 'STANDARD', 'FINANCIALS_FIRST'],
          } },
        ],
      },
    },

    // R9: Field-level security (masking salary / SSN / banking)
    // requires custom roles to enforce.
    {
      id: 'ns.design.field-level-security-needs-custom-roles',
      type: 'CONFIG_CONFLICT',
      severity: 'BLOCK',
      questionIds: ['ns.design.fieldLevelSecurity', 'ns.foundation.customRolesRequired'],
      message: 'Field-level security (masking salary / SSN / banking) requires custom roles to enforce. Foundation pack has customRolesRequired === false.',
      resolution: 'Set customRolesRequired to true. Phase 4 builds the custom roles with appropriate field-level permission overrides.',
      when: {
        all: [
          { answerTruthy: { questionId: 'ns.design.fieldLevelSecurity' } },
          { answerFalsy: { questionId: 'ns.foundation.customRolesRequired' } },
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
