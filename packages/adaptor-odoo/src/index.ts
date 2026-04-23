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
    buildR2RFlow(),
    buildP2PFlow(),
    buildO2CFlow(),
    buildProductionFlow(),
    buildReturnsFlow(),
  ],
};

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
    },
    {
      id: 'odoo.mrp.work-centers-require-mrp-module',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.mrp.workCenters', 'odoo.mrp.enabled'],
      message: 'Work centers / routings require the MRP module.',
      resolution: 'Provision the MRP module, or disable the Work Centers question.',
    },
    {
      id: 'odoo.mrp.quality-requires-mrp-and-quality',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.mrp.quality', 'odoo.mrp.enabled'],
      message: 'Quality Control on manufacturing requires both the MRP and Quality modules.',
      resolution: 'Provision the MRP and Quality modules, or disable the Quality Control question.',
    },

    // ── License gaps — Enterprise-only modules ────────────────────────────
    {
      id: 'odoo.studio-is-enterprise-only',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: [],
      message: 'Studio is an Odoo Enterprise-only app; it is not available on Community.',
      resolution: 'Upgrade the edition to Enterprise, or remove the STUDIO module from the license.',
    },
    {
      id: 'odoo.documents-is-enterprise-only',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: [],
      message: 'Documents is an Odoo Enterprise-only app; it is not available on Community.',
      resolution: 'Upgrade the edition to Enterprise, or remove the ENTERPRISE_DOCUMENTS module.',
    },
    {
      id: 'odoo.helpdesk-is-enterprise-only',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: [],
      message: 'Helpdesk is an Odoo Enterprise-only app; it is not available on Community.',
      resolution: 'Upgrade the edition to Enterprise, or remove the HELPDESK module.',
    },

    // ── Config conflicts — sub-settings without parent toggle ─────────────
    {
      id: 'odoo.mrp.sub-settings-without-parent',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['odoo.mrp.enabled', 'odoo.mrp.workCenters', 'odoo.mrp.quality'],
      message: 'Work centers or Quality are enabled while Manufacturing itself is set to No.',
      resolution: 'Either enable Manufacturing or disable the sub-settings — the sub-questions are only meaningful when MRP is on.',
    },

    // ── Data warnings — cross-question sanity checks ──────────────────────
    {
      id: 'odoo.company.multi-company-needs-analytic',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.company.multiCompany', 'odoo.coa.analyticAccounting'],
      message: 'Multi-company installs almost always need analytic accounting for inter-company reporting.',
      resolution: 'Set "Do you need analytic accounting?" to Yes, or document the exception in the Risk Register.',
    },
    {
      id: 'odoo.company.fiscal-year-start-required',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.company.fiscalYearStart'],
      message: 'Fiscal year start (MM-DD) is required before configuration can begin.',
      resolution: 'Confirm the fiscal calendar with the client and record it on the Company & Entities section.',
    },

    // ── Info — best practice nudges ───────────────────────────────────────
    {
      id: 'odoo.sales.tiered-pricelist-needs-customer-tiers',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.sales.priceListStrategy'],
      message: 'Per-customer-tier pricelists require each customer to be tagged with a tier — usually a migration step.',
      resolution: 'Capture the customer tier taxonomy in the Migration Tracker before go-live.',
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
