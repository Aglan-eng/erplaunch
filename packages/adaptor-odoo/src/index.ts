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

// Phase 1C ships the rule pack as empty. Real Odoo rules (e.g. "Quality app
// requires MRP", "Studio is Enterprise-only") land in Phase 2 once the
// evaluator routes through the adaptor.
const rules: RulePack = {
  id: 'odoo-rules',
  version: '1.0.0',
  rules: [],
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
