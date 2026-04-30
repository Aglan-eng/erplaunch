import type {
  PlatformAdaptor,
  QuestionnaireSchema,
  FlowDefinition,
  LicenseModel,
  PhaseModel,
  RulePack,
  OutputGeneratorDefinition,
} from '@ofoq/adaptor-sdk';
import { SDK_VERSION } from '@ofoq/adaptor-sdk';

/**
 * Odoo adaptor — first non-NetSuite adaptor, proves the SPI is actually
 * platform-agnostic. Questions mirror a typical Odoo implementation kickoff:
 * company/entity setup, chart of accounts, sales/purchase/inventory/MRP flows,
 * and Community-vs-Enterprise module selection.
 *
 * Scope for Phase 1C:
 *   - Covers the five canonical flow IDs so the UI doesn't branch on adaptor:
 *     R2R (Accounting), P2P (Purchase), O2C (Sales), PRODUCTION (MRP), RETURNS.
 *   - Modules = Odoo "apps". Editions = Community | Enterprise.
 *   - Generators produce documents only for now; XML-RPC connector-push is a
 *     later phase.
 *
 * Anything past Phase 1C (e.g. connector.read against a live Odoo instance,
 * or deep per-module question trees) is out of scope — the goal is to prove
 * the SPI registers, validates, and surfaces cleanly in the ERP picker.
 */

const schema: QuestionnaireSchema = {
  version: '1.0.0',
  flows: [
    // Pack 1 — Foundation gates everything downstream (deployment, edition,
    // geography, multi-entity / multi-currency). Renders first in the
    // wizard so the consultant locks in these decisions before
    // R2R/P2P/O2C/Production/Returns.
    buildFoundationFlow(),
    // Pack 2 — Tax engine. Sits between Foundation and R2R because tax
    // behavior + fiscal positions drive every accounting transaction.
    // The #1 thing implementations get wrong post-go-live, per the
    // research that shaped this pack.
    buildTaxFlow(),
    buildR2RFlow(),
    buildP2PFlow(),
    buildO2CFlow(),
    buildProductionFlow(),
    buildReturnsFlow(),
  ],
};

// ─── Pack 1 — Foundation & Deployment Architecture ───────────────────────────
//
// 15 questions across 4 sections. The R2R "company" section keeps its
// existing odoo.company.multiCompany / currency / fiscalYearStart questions
// for now — Pack 1 introduces parallel odoo.foundation.* questions
// intentionally to stay non-breaking. Duplicate-rationalization is a
// future pack.
function buildFoundationFlow(): FlowDefinition {
  return {
    id: 'FOUNDATION',
    label: 'Project Foundation',
    description: 'Deployment, edition, geography, and entity structure decisions that gate everything downstream.',
    sections: [
      {
        id: 'deployment',
        label: 'Deployment & Licensing',
        order: 1,
        questions: [
          {
            id: 'odoo.foundation.deploymentMode',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Hosting & deployment mode',
            options: [
              { value: 'ONLINE',     label: 'Odoo Online (SaaS — managed by Odoo, no custom code allowed)' },
              { value: 'ODOOSH',     label: 'Odoo.sh (PaaS — managed cloud with Git-based custom modules)' },
              { value: 'SELFHOSTED', label: 'Self-hosted (own server, full control, you manage backups)' },
            ],
          },
          {
            id: 'odoo.foundation.edition',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Edition',
            options: [
              { value: 'COMMUNITY',  label: 'Community' },
              { value: 'ENTERPRISE', label: 'Enterprise' },
            ],
          },
          {
            id: 'odoo.foundation.usersInternalY1',
            inputType: 'NUMBER',
            required: true,
            label: 'Number of internal users at go-live (Year 1)',
            help: {
              title: 'Who counts as an internal user?',
              body: 'Internal users only. Portal users (clients/suppliers given limited access) and Public website visitors do not count toward licensing.',
            },
          },
          {
            id: 'odoo.foundation.usersInternalY3',
            inputType: 'NUMBER',
            required: true,
            label: 'Planned internal users by Year 3',
          },
          {
            id: 'odoo.foundation.portalUsers',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Will external users (clients/suppliers) get Portal access?',
          },
        ],
      },
      {
        id: 'geography',
        label: 'Country & Languages',
        order: 2,
        questions: [
          {
            id: 'odoo.foundation.primaryCountry',
            inputType: 'TEXT',
            required: true,
            label: 'Primary country of operation (ISO 3166 alpha-2 code, e.g., AE, EG, US, FR)',
          },
          {
            id: 'odoo.foundation.otherCountries',
            inputType: 'TEXTAREA',
            required: false,
            label: 'List other countries with legal entities (one per line, ISO codes)',
          },
          {
            id: 'odoo.foundation.reportingLanguage',
            inputType: 'TEXT',
            required: true,
            label: 'Primary reporting language (ISO 639-1, e.g., en, ar, fr)',
          },
          {
            id: 'odoo.foundation.uiLanguages',
            inputType: 'TEXTAREA',
            required: false,
            label: 'Other UI languages required (one per line, ISO codes)',
          },
        ],
      },
      {
        id: 'fiscalcalendar',
        label: 'Fiscal Calendar',
        order: 3,
        questions: [
          {
            id: 'odoo.foundation.fiscalYearStart',
            inputType: 'TEXT',
            required: true,
            label: 'Fiscal year start (MM-DD, e.g., 01-01 or 07-01)',
          },
        ],
      },
      {
        id: 'entities',
        label: 'Multi-Company & Currency',
        order: 4,
        questions: [
          {
            id: 'odoo.foundation.multiCompany',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Multi-company in scope? (one Odoo database, multiple legal entities)',
          },
          {
            id: 'odoo.foundation.entityList',
            inputType: 'TEXTAREA',
            required: false,
            label: 'If yes — list each legal entity: name, country, base currency (one per line)',
          },
          {
            id: 'odoo.foundation.intercompanyAuto',
            inputType: 'BOOLEAN',
            required: false,
            label: 'Automate inter-company transactions? (auto-counterpart of orders/invoices between own entities)',
          },
          {
            id: 'odoo.foundation.multiCurrency',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Multi-currency operations?',
          },
          {
            id: 'odoo.foundation.reportingCurrency',
            inputType: 'TEXT',
            required: false,
            label: 'Group reporting currency (ISO 4217, e.g., USD, EUR, AED) — required if multi-currency',
          },
        ],
      },
    ],
  };
}

// ─── Pack 2 — Tax Engine ─────────────────────────────────────────────────────
//
// 16 questions across 4 sections. Every Odoo accounting transaction
// reads from this configuration: default tax behavior on sales/purchase
// prices, exempt-customer handling via fiscal positions, withholding,
// regional variation, and country-specific e-invoicing. Per the research
// that shaped this pack, tax engine is the #1 thing implementations get
// wrong post-go-live — gating these decisions early avoids the build-then-
// reconfigure trap.
function buildTaxFlow(): FlowDefinition {
  return {
    id: 'TAX',
    label: 'Tax Engine',
    description: 'Tax behavior, defaults, fiscal positions, withholding, e-invoicing — the configuration surface that drives correct VAT/GST handling.',
    sections: [
      {
        id: 'behavior',
        label: 'Default Tax Behavior',
        order: 1,
        questions: [
          {
            id: 'odoo.tax.salesPriceMode',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Default tax behavior on customer-facing prices',
            options: [
              { value: 'INCLUDED', label: 'Tax-included (B2C, retail, restaurant — price IS final price)' },
              { value: 'EXCLUDED', label: 'Tax-excluded (B2B — tax added on top of price)' },
            ],
          },
          {
            id: 'odoo.tax.purchasePriceMode',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Default tax behavior on supplier-facing prices',
            options: [
              { value: 'INCLUDED', label: 'Included' },
              { value: 'EXCLUDED', label: 'Excluded' },
            ],
          },
          {
            id: 'odoo.tax.defaultSalesTax',
            inputType: 'TEXT',
            required: true,
            label: "Default Sales Tax (rate name + percent, e.g., 'VAT 15%' or 'GST 5%' or 'None')",
          },
          {
            id: 'odoo.tax.defaultPurchaseTax',
            inputType: 'TEXT',
            required: true,
            label: 'Default Purchase Tax (rate name + percent)',
          },
        ],
      },
      {
        id: 'exemptions',
        label: 'Exemptions & Special Categories',
        order: 2,
        questions: [
          {
            id: 'odoo.tax.hasExemptCustomers',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Will any customer be tax-exempt? (export, free zone, NGO, government)',
          },
          {
            id: 'odoo.tax.exemptCategories',
            inputType: 'TEXTAREA',
            required: false,
            label: 'If yes — list tax-exempt customer categories (one per line)',
          },
          {
            id: 'odoo.tax.hasReducedRates',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Are there reduced or zero-rated tax categories? (food, medical, books, exports)',
          },
          {
            id: 'odoo.tax.reducedRateCategories',
            inputType: 'TEXTAREA',
            required: false,
            label: 'If yes — list reduced/zero-rated categories with rates (one per line)',
          },
        ],
      },
      {
        id: 'advanced',
        label: 'Advanced Tax Mechanics',
        order: 3,
        questions: [
          {
            id: 'odoo.tax.reverseCharge',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Reverse-charge mechanism in scope? (cross-border services, import VAT)',
          },
          {
            id: 'odoo.tax.withholding',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Withholding tax in scope? (services, contractor payments, royalties)',
          },
          {
            id: 'odoo.tax.regionalVariation',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Do tax codes vary by region within the country? (state-level GST, provincial VAT)',
          },
          {
            id: 'odoo.tax.fiscalPositions',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Will fiscal positions be needed? (different tax rules per customer/supplier group)',
          },
          {
            id: 'odoo.tax.fiscalPositionList',
            inputType: 'TEXTAREA',
            required: false,
            label: "If yes — list fiscal positions (e.g., 'Domestic', 'Export — GCC', 'Free Zone', 'Reverse-charge EU B2B')",
          },
        ],
      },
      {
        id: 'compliance',
        label: 'Compliance & E-invoicing',
        order: 4,
        questions: [
          {
            id: 'odoo.tax.einvoicingRequired',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Is e-invoicing mandatory in your country?',
            options: [
              { value: 'YES',    label: 'Yes' },
              { value: 'NO',     label: 'No' },
              { value: 'UNSURE', label: 'Unsure — research needed' },
            ],
          },
          {
            id: 'odoo.tax.einvoicingSystem',
            inputType: 'TEXT',
            required: false,
            label: 'If yes — name of the e-invoicing system (e.g., Italy SDI, Mexico CFDI, Spain Veri*Factu, Saudi ZATCA, Egypt ETA, France PPF)',
          },
          {
            id: 'odoo.tax.taxFilingPeriodicity',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Tax filing periodicity',
            options: [
              { value: 'MONTHLY',   label: 'Monthly' },
              { value: 'QUARTERLY', label: 'Quarterly' },
              { value: 'ANNUAL',    label: 'Annual' },
            ],
          },
        ],
      },
    ],
  };
}

function buildR2RFlow(): FlowDefinition {
  return {
    id: 'R2R',
    label: 'Record-to-Report',
    description: 'Company setup, chart of accounts, fiscal periods, reporting.',
    sections: [
      {
        id: 'company',
        label: 'Company & Entities',
        order: 1,
        questions: [
          {
            id: 'odoo.company.multiCompany',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Multiple legal entities / companies on the same Odoo database?',
            help: {
              title: 'Multi-company in Odoo',
              body: 'Odoo supports multi-company out of the box; enabling it changes permissions, intercompany rules, and chart-of-accounts setup.',
            },
          },
          {
            id: 'odoo.company.currency',
            inputType: 'TEXT',
            required: true,
            label: 'Main operating currency (ISO 4217, e.g. "USD", "EUR", "AED")',
          },
          {
            id: 'odoo.company.fiscalYearStart',
            inputType: 'TEXT',
            required: true,
            label: 'Fiscal year start (MM-DD, e.g. "01-01" or "07-01")',
          },
        ],
      },
      {
        id: 'coa',
        label: 'Chart of Accounts',
        order: 2,
        questions: [
          {
            id: 'odoo.coa.template',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Chart of accounts template',
            options: [
              { value: 'LOCALIZATION', label: 'Use the localization package for this country' },
              { value: 'CUSTOM', label: 'Custom — we will upload a CoA' },
            ],
          },
          {
            id: 'odoo.coa.analyticAccounting',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Do you need analytic accounting (cost centers, projects)?',
          },
        ],
      },
    ],
  };
}

function buildP2PFlow(): FlowDefinition {
  return {
    id: 'P2P',
    label: 'Procure-to-Pay',
    description: 'Purchase orders, vendor bills, 3-way match, payments.',
    sections: [
      {
        id: 'purchase',
        label: 'Purchase',
        order: 1,
        questions: [
          {
            id: 'odoo.purchase.approvalTiers',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Purchase order approval workflow',
            options: [
              { value: 'NONE', label: 'No approval required' },
              { value: 'SINGLE', label: 'Single approval above a threshold' },
              { value: 'DOUBLE', label: 'Double approval above a higher threshold' },
            ],
          },
          {
            id: 'odoo.purchase.threeWayMatch',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Require 3-way match (PO → receipt → bill) before posting vendor bills?',
          },
        ],
      },
    ],
  };
}

function buildO2CFlow(): FlowDefinition {
  return {
    id: 'O2C',
    label: 'Order-to-Cash',
    description: 'Sales orders, deliveries, invoices, customer payments.',
    sections: [
      {
        id: 'sales',
        label: 'Sales',
        order: 1,
        questions: [
          {
            id: 'odoo.sales.quoteTemplate',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Do you need branded quotation templates (Sales > Quotation Templates)?',
          },
          {
            id: 'odoo.sales.priceListStrategy',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Pricelist strategy',
            options: [
              { value: 'SINGLE', label: 'Single pricelist for all customers' },
              { value: 'CUSTOMER_TIER', label: 'Per-customer-tier pricelists' },
              { value: 'CURRENCY', label: 'Per-currency pricelists' },
            ],
          },
        ],
      },
      {
        id: 'invoicing',
        label: 'Invoicing',
        order: 2,
        questions: [
          {
            id: 'odoo.invoicing.policy',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Invoicing policy on sales orders',
            options: [
              { value: 'ORDERED', label: 'Invoiced quantity = ordered quantity' },
              { value: 'DELIVERED', label: 'Invoiced quantity = delivered quantity' },
            ],
          },
        ],
      },
    ],
  };
}

function buildProductionFlow(): FlowDefinition {
  return {
    id: 'PRODUCTION',
    label: 'Manufacturing',
    description: 'BOMs, routings, manufacturing orders, quality control.',
    sections: [
      {
        id: 'mrp',
        label: 'Manufacturing Apps',
        order: 1,
        questions: [
          {
            id: 'odoo.mrp.enabled',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Will this Odoo install handle production / manufacturing orders?',
          },
          {
            id: 'odoo.mrp.workCenters',
            inputType: 'BOOLEAN',
            required: false,
            label: 'Use work centers and routings (enables MRP II)?',
            dependsOn: { questionId: 'odoo.mrp.enabled', value: true },
          },
          {
            id: 'odoo.mrp.quality',
            inputType: 'BOOLEAN',
            required: false,
            label: 'Enable Quality Control checks on manufacturing operations?',
            dependsOn: { questionId: 'odoo.mrp.enabled', value: true },
          },
        ],
      },
    ],
  };
}

function buildReturnsFlow(): FlowDefinition {
  return {
    id: 'RETURNS',
    label: 'Returns',
    description: 'Return merchandise authorizations, refunds, restocking.',
    sections: [
      {
        id: 'returns',
        label: 'Returns & Refunds',
        order: 1,
        questions: [
          {
            id: 'odoo.returns.policy',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Default return policy',
            options: [
              { value: 'NONE', label: 'Returns handled manually — no automation' },
              { value: 'AUTO_REFUND', label: 'Automatically issue credit note on return' },
              { value: 'RESTOCK_FEE', label: 'Apply restocking fee on returns' },
            ],
          },
        ],
      },
    ],
  };
}

const license: LicenseModel = {
  defaultEditionId: 'ENTERPRISE',
  editions: [
    {
      id: 'COMMUNITY',
      label: 'Community',
      includesModules: ['BASE_ACCOUNTING', 'BASE_SALES', 'BASE_PURCHASE', 'BASE_INVENTORY'],
    },
    {
      id: 'ENTERPRISE',
      label: 'Enterprise',
      includesModules: [
        'BASE_ACCOUNTING',
        'BASE_SALES',
        'BASE_PURCHASE',
        'BASE_INVENTORY',
        'ENTERPRISE_ACCOUNTING',
        'ENTERPRISE_STUDIO',
        'ENTERPRISE_DOCUMENTS',
      ],
    },
  ],
  modules: [
    { id: 'BASE_ACCOUNTING', label: 'Accounting (Community)' },
    { id: 'BASE_SALES', label: 'Sales' },
    { id: 'BASE_PURCHASE', label: 'Purchase' },
    { id: 'BASE_INVENTORY', label: 'Inventory' },
    { id: 'ENTERPRISE_ACCOUNTING', label: 'Full Accounting (Enterprise)', description: 'Adds bank sync, follow-ups, budgets, consolidation.' },
    { id: 'ENTERPRISE_STUDIO', label: 'Studio', description: 'Low-code customization (Enterprise only).' },
    { id: 'ENTERPRISE_DOCUMENTS', label: 'Documents', description: 'Enterprise document management.' },
    { id: 'MRP', label: 'Manufacturing (MRP)' },
    { id: 'MRP_PLM', label: 'PLM (Product Lifecycle Management)' },
    { id: 'QUALITY', label: 'Quality' },
    { id: 'MAINTENANCE', label: 'Maintenance' },
    { id: 'CRM', label: 'CRM' },
    { id: 'HR', label: 'HR' },
    { id: 'PROJECT', label: 'Project' },
    { id: 'TIMESHEETS', label: 'Timesheets' },
    { id: 'HELPDESK', label: 'Helpdesk', description: 'Enterprise app.' },
    { id: 'ECOMMERCE', label: 'eCommerce' },
    { id: 'POINT_OF_SALE', label: 'Point of Sale' },
  ],
};

const phases: PhaseModel = {
  defaultPhases: [
    { id: 'discovery', label: 'Discovery', order: 1, trigger: 'REQUIREMENT' },
    { id: 'configuration', label: 'Configuration', order: 2, trigger: 'REQUIREMENT' },
    { id: 'data_migration', label: 'Data Migration', order: 3, trigger: 'REQUIREMENT' },
    { id: 'training', label: 'Training', order: 4, trigger: 'REQUIREMENT' },
    { id: 'uat', label: 'UAT', order: 5, trigger: 'REQUIREMENT' },
    { id: 'go_live', label: 'Go Live', order: 6, trigger: 'REQUIREMENT' },
  ],
};

// Phase 10: real rule definitions for Odoo. These are declarative metadata
// (id, type, severity, questionIds, message, resolution) describing the
// cross-answer constraints a consultant should respect when scoping an
// Odoo implementation. The rule engine today only evaluates the NetSuite
// pack, so these rules surface to consultants via the AdaptorPanel rule
// count and ship as a catalog for any future cross-adaptor evaluator — they
// are not yet enforced automatically during profile edits.
const rules: RulePack = {
  id: 'odoo-rules',
  version: '1.0.0',
  rules: [
    // ── License gaps — required modules for enabled features ──────────────
    {
      id: 'odoo.mrp.requires-mrp-module',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.mrp.enabled'],
      message: 'Manufacturing is enabled but the MRP module is not provisioned.',
      resolution: 'Add "MRP" to the Licensed Modules list or set Manufacturing to No.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.mrp.enabled' } },
          { licenseMissingModule: 'MRP' },
        ],
      },
    },
    {
      id: 'odoo.mrp.work-centers-require-mrp-module',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.mrp.workCenters', 'odoo.mrp.enabled'],
      message: 'Work centers / routings require the MRP module.',
      resolution: 'Provision the MRP module, or disable the Work Centers question.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.mrp.workCenters' } },
          { licenseMissingModule: 'MRP' },
        ],
      },
    },
    {
      id: 'odoo.mrp.quality-requires-mrp-and-quality',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.mrp.quality', 'odoo.mrp.enabled'],
      message: 'Quality Control on manufacturing requires both the MRP and Quality modules.',
      resolution: 'Provision the MRP and Quality modules, or disable the Quality Control question.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.mrp.quality' } },
          { any: [
            { licenseMissingModule: 'MRP' },
            { licenseMissingModule: 'QUALITY' },
          ] },
        ],
      },
    },

    // ── License gaps — Enterprise-only modules ────────────────────────────
    {
      id: 'odoo.studio-is-enterprise-only',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: [],
      message: 'Studio is an Odoo Enterprise-only app; it is not available on Community.',
      resolution: 'Upgrade the edition to Enterprise, or remove the STUDIO module from the license.',
      when: {
        all: [
          { licenseHasModule: 'ENTERPRISE_STUDIO' },
          { licenseEditionNotIn: ['ENTERPRISE'] },
        ],
      },
    },
    {
      id: 'odoo.documents-is-enterprise-only',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: [],
      message: 'Documents is an Odoo Enterprise-only app; it is not available on Community.',
      resolution: 'Upgrade the edition to Enterprise, or remove the ENTERPRISE_DOCUMENTS module.',
      when: {
        all: [
          { licenseHasModule: 'ENTERPRISE_DOCUMENTS' },
          { licenseEditionNotIn: ['ENTERPRISE'] },
        ],
      },
    },
    {
      id: 'odoo.helpdesk-is-enterprise-only',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: [],
      message: 'Helpdesk is an Odoo Enterprise-only app; it is not available on Community.',
      resolution: 'Upgrade the edition to Enterprise, or remove the HELPDESK module.',
      when: {
        all: [
          { licenseHasModule: 'HELPDESK' },
          { licenseEditionNotIn: ['ENTERPRISE'] },
        ],
      },
    },

    // ── Config conflicts — sub-settings without parent toggle ─────────────
    {
      id: 'odoo.mrp.sub-settings-without-parent',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['odoo.mrp.enabled', 'odoo.mrp.workCenters', 'odoo.mrp.quality'],
      message: 'Work centers or Quality are enabled while Manufacturing itself is set to No.',
      resolution: 'Either enable Manufacturing or disable the sub-settings — the sub-questions are only meaningful when MRP is on.',
      when: {
        all: [
          { answerFalsy: { questionId: 'odoo.mrp.enabled' } },
          { any: [
            { answerTruthy: { questionId: 'odoo.mrp.workCenters' } },
            { answerTruthy: { questionId: 'odoo.mrp.quality' } },
          ] },
        ],
      },
    },

    // ── Data warnings — cross-question sanity checks ──────────────────────
    {
      id: 'odoo.company.multi-company-needs-analytic',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.company.multiCompany', 'odoo.coa.analyticAccounting'],
      message: 'Multi-company installs almost always need analytic accounting for inter-company reporting.',
      resolution: 'Set "Do you need analytic accounting?" to Yes, or document the exception in the Risk Register.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.company.multiCompany' } },
          { answerFalsy: { questionId: 'odoo.coa.analyticAccounting' } },
        ],
      },
    },
    {
      id: 'odoo.company.fiscal-year-start-required',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.company.fiscalYearStart'],
      message: 'Fiscal year start (MM-DD) is required before configuration can begin.',
      resolution: 'Confirm the fiscal calendar with the client and record it on the Company & Entities section.',
      when: { answerFalsy: { questionId: 'odoo.company.fiscalYearStart' } },
    },

    // ── Info — best practice nudges ───────────────────────────────────────
    {
      id: 'odoo.sales.tiered-pricelist-needs-customer-tiers',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.sales.priceListStrategy'],
      message: 'Per-customer-tier pricelists require each customer to be tagged with a tier — usually a migration step.',
      resolution: 'Capture the customer tier taxonomy in the Migration Tracker before go-live.',
      when: { answerEquals: { questionId: 'odoo.sales.priceListStrategy', value: 'CUSTOMER_TIER' } },
    },

    // ── Pack 1 — Foundation rules ─────────────────────────────────────────
    //
    // R2 from the spec is intentionally NOT added here — there is already
    // odoo.studio-is-enterprise-only above that handles Edition × Studio.
    // Foundation does not duplicate it.

    // R1: Odoo Online does not allow custom modules. For now the
    // "custom-modules" trigger fires when ENTERPRISE_STUDIO is in the
    // license (Studio output is custom XML and is the most common path
    // a consultant takes to ship custom code on Odoo). Future packs can
    // extend this with a richer "any module flagged custom" check.
    {
      id: 'odoo.foundation.online-disallows-custom-modules',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.foundation.deploymentMode'],
      message: 'Odoo Online does not allow custom modules or Studio-exported XML.',
      resolution: 'Pick Odoo.sh if you want managed hosting with custom modules, or Self-hosted if you want full control.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.foundation.deploymentMode', value: 'ONLINE' } },
          { licenseHasModule: 'ENTERPRISE_STUDIO' },
        ],
      },
    },

    // R3: Odoo.sh is Enterprise-only.
    {
      id: 'odoo.foundation.odoosh-requires-enterprise',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.foundation.deploymentMode', 'odoo.foundation.edition'],
      message: 'Odoo.sh is Enterprise-only. Community is not supported on Odoo.sh.',
      resolution: 'Switch deployment to Self-hosted (Community) or upgrade edition to Enterprise.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.foundation.deploymentMode', value: 'ODOOSH' } },
          { licenseEditionIn: ['COMMUNITY'] },
        ],
      },
    },

    // R4: multi-company without entities. Implementation note — the spec
    // calls for "fewer than 2 entities listed", but the rule DSL doesn't
    // expose a line-count operator yet, so for now we fire on the empty
    // case. The 1-entity edge case is a future enhancement once the SDK
    // grows a line-count condition.
    {
      id: 'odoo.foundation.multi-company-needs-entities',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.foundation.multiCompany', 'odoo.foundation.entityList'],
      message: 'Multi-company is set to true but no entities are listed.',
      resolution: 'List each legal entity (name, country, base currency) in the entities field, or set multi-company to false.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.foundation.multiCompany' } },
          { answerFalsy: { questionId: 'odoo.foundation.entityList' } },
        ],
      },
    },

    // R5: multi-currency without reporting currency.
    {
      id: 'odoo.foundation.multi-currency-needs-reporting-currency',
      type: 'DATA_WARNING',
      severity: 'BLOCK',
      questionIds: ['odoo.foundation.multiCurrency', 'odoo.foundation.reportingCurrency'],
      message: 'Multi-currency is enabled but no group reporting currency is specified.',
      resolution: 'Pick the group reporting currency (ISO 4217) — required for consolidation and exchange-rate revaluation.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.foundation.multiCurrency' } },
          { answerFalsy: { questionId: 'odoo.foundation.reportingCurrency' } },
        ],
      },
    },

    // R6: Online deployment cost warning at scale (Y3 > 50 users).
    {
      id: 'odoo.foundation.online-cost-warning-at-scale',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.foundation.deploymentMode', 'odoo.foundation.usersInternalY3'],
      message: 'At 50+ internal users on Odoo Online, per-user cost typically exceeds Odoo.sh or Self-hosted total cost.',
      resolution: 'Revisit deployment-mode decision before contract signature. Run a 3-year TCO comparison.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.foundation.deploymentMode', value: 'ONLINE' } },
          { answerNumberGreaterThan: { questionId: 'odoo.foundation.usersInternalY3', value: 50 } },
        ],
      },
    },

    // R7: country-mandated e-invoicing. Spec wanted a COMPLIANCE_INFO type
    // but the SDK ConflictType union doesn't have that yet — DATA_WARNING
    // with severity INFO carries the same semantics. Pack 3 (Localization)
    // can graduate this to a dedicated type if the SDK is extended.
    {
      id: 'odoo.foundation.country-mandates-einvoicing',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.foundation.primaryCountry'],
      message: 'E-invoicing is mandatory or in active rollout in this country.',
      resolution: 'Pack 3 (Localization) will gate the relevant l10n_<country> module as required and flag specific e-invoicing systems (Italy SDI, Mexico CFDI, Spain Veri*Factu, etc.).',
      when: {
        answerIn: {
          questionId: 'odoo.foundation.primaryCountry',
          values: ['IT', 'MX', 'ES', 'FR', 'SA', 'EG', 'BR', 'IN', 'TR', 'DE', 'PL'],
        },
      },
    },

    // ── Pack 2 — Tax Engine rules ─────────────────────────────────────────

    // R1: Sales / Purchase price modes diverge. Margin reporting on
    // inter-flow transactions (dropship, intercompany) becomes
    // inconsistent. Expressed as the OR of the two asymmetric pairs
    // because the rule DSL doesn't have a direct cross-question
    // inequality operator.
    {
      id: 'odoo.tax.price-mode-mismatch',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['odoo.tax.salesPriceMode', 'odoo.tax.purchasePriceMode'],
      message: 'Sales and Purchase price modes differ. Margin reporting on inter-flow transactions (e.g., dropship, intercompany) will be inconsistent.',
      resolution: 'Align both to the same mode unless this is intentional and documented in fiscal positions.',
      when: {
        any: [
          { all: [
            { answerEquals: { questionId: 'odoo.tax.salesPriceMode',    value: 'INCLUDED' } },
            { answerEquals: { questionId: 'odoo.tax.purchasePriceMode', value: 'EXCLUDED' } },
          ] },
          { all: [
            { answerEquals: { questionId: 'odoo.tax.salesPriceMode',    value: 'EXCLUDED' } },
            { answerEquals: { questionId: 'odoo.tax.purchasePriceMode', value: 'INCLUDED' } },
          ] },
        ],
      },
    },

    // R2: e-invoicing required but no localisation module licensed. The
    // ideal trigger is "no l10n_<primaryCountry-lowercased> module" but
    // the DSL has no dynamic module-name composition. The current
    // approximation: fire when none of the e-invoicing-mandate-country
    // l10n modules is in the license. Misses cases where the customer
    // licensed l10n_us but is in IT — but Pack 1's R7 already flags
    // those primary-country values, so the consultant is unlikely to
    // miss the country/module mismatch in practice.
    {
      id: 'odoo.tax.einvoicing-yes-needs-l10n',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.tax.einvoicingRequired', 'odoo.foundation.primaryCountry'],
      message: 'E-invoicing is mandatory but the country localization module is not in the module list.',
      resolution: 'Add l10n_<country> to the license modules. Pack 3 (Localization) provides the country-to-module mapping.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.tax.einvoicingRequired', value: 'YES' } },
          { not: {
            licenseHasAnyModule: [
              'l10n_it', 'l10n_mx', 'l10n_es', 'l10n_fr', 'l10n_sa',
              'l10n_eg', 'l10n_br', 'l10n_in', 'l10n_tr', 'l10n_de',
              'l10n_pl', 'l10n_us', 'l10n_uk', 'l10n_ae', 'l10n_ca',
              'l10n_au', 'l10n_ch', 'l10n_jo', 'l10n_kw', 'l10n_qa',
              'l10n_bh', 'l10n_om', 'l10n_generic_coa',
            ],
          } },
        ],
      },
    },

    // R3: Reverse-charge requires Accounting (Community BASE_ACCOUNTING
    // or Enterprise ENTERPRISE_ACCOUNTING).
    {
      id: 'odoo.tax.reverse-charge-needs-base-accounting',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.tax.reverseCharge'],
      message: 'Reverse-charge requires Accounting (Community or Enterprise) — base accounting module not provisioned.',
      resolution: 'Add Accounting module to the license.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.tax.reverseCharge' } },
          { not: { licenseHasAnyModule: ['BASE_ACCOUNTING', 'ENTERPRISE_ACCOUNTING'] } },
        ],
      },
    },

    // R4: Withholding-tax — reminder to ensure the chart-of-accounts
    // template includes withholding accounts. Cross-cuts with the COA
    // template question; we surface as a WARN whenever withholding is
    // checked, regardless of COA template, because both LOCALIZATION
    // and CUSTOM templates need to be verified.
    {
      id: 'odoo.tax.withholding-needs-coa-accounts',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.tax.withholding', 'odoo.coa.template'],
      message: "Withholding tax requires dedicated chart-of-accounts entries (typically a 'Withholding Tax Payable' liability and a 'Withholding Tax Receivable' asset).",
      resolution: 'Confirm the COA template includes withholding accounts, or add them during Configuration phase before first transaction.',
      when: { answerTruthy: { questionId: 'odoo.tax.withholding' } },
    },

    // R5: Fiscal positions flagged but list is empty.
    {
      id: 'odoo.tax.fiscal-positions-need-list',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.tax.fiscalPositions', 'odoo.tax.fiscalPositionList'],
      message: 'Fiscal positions flagged true but no positions are listed.',
      resolution: 'List the specific fiscal positions in the field, or set fiscalPositions to false.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.tax.fiscalPositions' } },
          { answerFalsy: { questionId: 'odoo.tax.fiscalPositionList' } },
        ],
      },
    },

    // R6: Tax-included sales pricing is typical for retail / POS /
    // restaurant / eCommerce. If none of those are licensed, gently
    // nudge the consultant to confirm the choice — it's a legitimate
    // configuration but more often a misclick by a B2B-only firm.
    {
      id: 'odoo.tax.b2c-mode-on-services-only',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.tax.salesPriceMode'],
      message: 'Tax-included pricing is typical for retail/POS/restaurant/eCommerce. None of those modules are in scope.',
      resolution: 'Confirm tax-included is intentional for this engagement; for B2B-only deals, tax-excluded is standard.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.tax.salesPriceMode', value: 'INCLUDED' } },
          { not: { licenseHasAnyModule: ['POINT_OF_SALE', 'ECOMMERCE'] } },
        ],
      },
    },

    // R7: Regional tax variation usually needs multiple fiscal positions
    // (one per region/state). Same line-count limitation as Pack 1's R4
    // — for now we fire on the empty-list case. The "< 2 entries"
    // edge case is a future enhancement once the SDK gains a
    // line-count operator.
    {
      id: 'odoo.tax.regional-variation-needs-multiple-tax-codes',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.tax.regionalVariation', 'odoo.tax.fiscalPositionList'],
      message: 'Regional tax variation typically requires multiple fiscal positions (one per region/state).',
      resolution: 'Add fiscal positions matching the regions, or document why a single position covers all regions.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.tax.regionalVariation' } },
          { answerFalsy:  { questionId: 'odoo.tax.fiscalPositionList' } },
        ],
      },
    },

    // R8: Exempt customers without fiscal positions enabled. Standard
    // Odoo pattern is one 'Exempt' fiscal position that maps default
    // taxes to zero. Without fiscal positions, the consultant has to
    // override taxes per-customer, which is brittle.
    {
      id: 'odoo.tax.exempt-customers-need-fiscal-position',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.tax.hasExemptCustomers', 'odoo.tax.fiscalPositions'],
      message: "Tax-exempt customers are typically handled via fiscal positions (one position 'Exempt' that maps default taxes to zero).",
      resolution: "Enable fiscal positions and add an 'Exempt' fiscal position, OR document the alternative approach (e.g., tax overrides on customer master).",
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.tax.hasExemptCustomers' } },
          { answerFalsy:  { questionId: 'odoo.tax.fiscalPositions' } },
        ],
      },
    },
  ],
};

const generators: OutputGeneratorDefinition[] = [
  { id: 'brd', label: 'Business Requirements Document', kind: 'document', outputMime: 'application/pdf' },
  { id: 'solution-doc', label: 'Solution Design Document', kind: 'document', outputMime: 'application/pdf' },
  { id: 'odoo-config-checklist', label: 'Odoo Configuration Checklist', kind: 'document', outputMime: 'application/pdf' },
  { id: 'training-manual', label: 'End-User Training Manual', kind: 'document', outputMime: 'application/pdf' },
  { id: 'uat', label: 'UAT Test Scripts', kind: 'document', outputMime: 'application/zip' },
  { id: 'plan', label: 'Implementation Plan', kind: 'document', outputMime: 'application/pdf' },
  { id: 'risk', label: 'Risk Register', kind: 'document', outputMime: 'application/pdf' },
];

export const odooAdaptor: PlatformAdaptor = {
  manifest: {
    id: 'odoo',
    name: 'Odoo',
    tagline: 'Open-source ERP — Community + Enterprise',
    version: '1.0.0',
    vendor: 'Odoo SA',
    capabilities: ['document', 'license.gating', 'phase.planning'],
    minSdk: SDK_VERSION,
    sourceKind: 'built-in',
  },
  schema,
  license,
  phases,
  rules,
  generators,
};

export default odooAdaptor;
