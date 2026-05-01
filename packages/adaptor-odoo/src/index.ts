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

// ─── Pack 3 — L10N_MODULES_BY_COUNTRY ────────────────────────────────────────
//
// Country → canonical Odoo localization module + (optional) e-invoicing
// system + mandate flag. Single source of truth for:
//   - Pack 1 R7  (country-mandates-einvoicing): mandate countries derived
//                 from the einvoicingMandatory flag here, no longer a
//                 hand-written list.
//   - Pack 2 R2  (einvoicing-yes-needs-l10n): country-aware module check
//                 — fires when the licensed l10n doesn't match the
//                 primary country, not just when no l10n is licensed.
//   - Pack 3 R1  (coa-template-required): same country-aware module check.
//   - Pack 3 R2  (einvoicing-mandatory-confirmed): mandate detection.
//   - Pack 3 R3  (einvoicing-system-must-match-country): system name source.
//
// Sources: Odoo Fiscal localizations index (v19), Odoo Apps Store search
// "l10n_", country-specific e-invoicing system names (Italy SDI, Mexico
// CFDI 4.0, Spain Veri*Factu, France PPF, Saudi ZATCA Phase 2, Egypt ETA,
// Brazil NFe, India GSP, Turkey e-Fatura, Germany ZUGFeRD/XRechnung,
// Poland KSeF). Keys are ISO 3166 alpha-2.
export const L10N_MODULES_BY_COUNTRY: Record<string, {
  module: string;
  einvoicingSystem?: string;
  einvoicingMandatory?: boolean;
}> = {
  AE: { module: 'l10n_ae', einvoicingSystem: 'UAE FTA (rolling out)', einvoicingMandatory: false },
  AR: { module: 'l10n_ar', einvoicingSystem: 'AFIP', einvoicingMandatory: true },
  AU: { module: 'l10n_au' },
  BE: { module: 'l10n_be', einvoicingSystem: 'PEPPOL', einvoicingMandatory: false },
  BR: { module: 'l10n_br', einvoicingSystem: 'NFe / NFSe', einvoicingMandatory: true },
  CA: { module: 'l10n_ca' },
  CH: { module: 'l10n_ch' },
  CL: { module: 'l10n_cl', einvoicingSystem: 'SII', einvoicingMandatory: true },
  CO: { module: 'l10n_co', einvoicingSystem: 'DIAN', einvoicingMandatory: true },
  DE: { module: 'l10n_de', einvoicingSystem: 'ZUGFeRD/XRechnung', einvoicingMandatory: true },
  DK: { module: 'l10n_dk', einvoicingSystem: 'NemHandel/PEPPOL', einvoicingMandatory: false },
  EC: { module: 'l10n_ec' },
  EG: { module: 'l10n_eg', einvoicingSystem: 'Egypt ETA', einvoicingMandatory: true },
  ES: { module: 'l10n_es', einvoicingSystem: 'Veri*Factu / SII', einvoicingMandatory: true },
  FR: { module: 'l10n_fr', einvoicingSystem: 'PPF (Public Invoice Portal)', einvoicingMandatory: true },
  GB: { module: 'l10n_uk', einvoicingSystem: 'HMRC MTD', einvoicingMandatory: false },
  IN: { module: 'l10n_in', einvoicingSystem: 'GSP / IRP', einvoicingMandatory: true },
  IT: { module: 'l10n_it', einvoicingSystem: 'SDI (FatturaPA)', einvoicingMandatory: true },
  JP: { module: 'l10n_jp' },
  KE: { module: 'l10n_ke', einvoicingSystem: 'KRA eTIMS', einvoicingMandatory: true },
  KR: { module: 'l10n_kr' },
  KW: { module: 'l10n_gcc' },
  LU: { module: 'l10n_lu' },
  MX: { module: 'l10n_mx', einvoicingSystem: 'CFDI 4.0', einvoicingMandatory: true },
  MY: { module: 'l10n_my', einvoicingSystem: 'MyInvois', einvoicingMandatory: true },
  NG: { module: 'l10n_ng' },
  NL: { module: 'l10n_nl', einvoicingSystem: 'PEPPOL', einvoicingMandatory: false },
  NO: { module: 'l10n_no', einvoicingSystem: 'EHF/PEPPOL', einvoicingMandatory: true },
  NZ: { module: 'l10n_nz' },
  PE: { module: 'l10n_pe', einvoicingSystem: 'SUNAT', einvoicingMandatory: true },
  PH: { module: 'l10n_ph' },
  PL: { module: 'l10n_pl', einvoicingSystem: 'KSeF', einvoicingMandatory: true },
  PT: { module: 'l10n_pt', einvoicingSystem: 'AT / SAF-T', einvoicingMandatory: true },
  QA: { module: 'l10n_gcc' },
  RO: { module: 'l10n_ro', einvoicingSystem: 'e-Factura', einvoicingMandatory: true },
  SA: { module: 'l10n_sa', einvoicingSystem: 'ZATCA Phase 2', einvoicingMandatory: true },
  SG: { module: 'l10n_sg', einvoicingSystem: 'PEPPOL', einvoicingMandatory: false },
  TH: { module: 'l10n_th', einvoicingSystem: 'RD e-Tax', einvoicingMandatory: false },
  TR: { module: 'l10n_tr', einvoicingSystem: 'e-Fatura / GİB', einvoicingMandatory: true },
  US: { module: 'l10n_us' },
  VN: { module: 'l10n_vn', einvoicingSystem: 'GDT', einvoicingMandatory: true },
  ZA: { module: 'l10n_za' },
};

/** Countries where e-invoicing is mandatory (or in active rollout treated
 *  as such). Derived from L10N_MODULES_BY_COUNTRY; used by Pack 1 R7 +
 *  Pack 3 R2 to gate the relevant rules. */
const EINVOICING_MANDATE_COUNTRIES: string[] = Object.entries(L10N_MODULES_BY_COUNTRY)
  .filter(([, v]) => v.einvoicingMandatory)
  .map(([cc]) => cc);

/** Countries that have a known e-invoicing system name. Subset of
 *  EINVOICING_MANDATE_COUNTRIES plus a few non-mandatory rollouts. */
const KNOWN_EINVOICING_SYSTEM_COUNTRIES: string[] = Object.entries(L10N_MODULES_BY_COUNTRY)
  .filter(([, v]) => Boolean(v.einvoicingSystem))
  .map(([cc]) => cc);

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
    // Pack 3 — Localization & Compliance. Country → COA / e-invoicing /
    // payroll / data-residency. Sits AFTER Tax (so einvoicingRequired
    // is captured first) and BEFORE R2R (so the COA template feeds
    // into ledger setup).
    buildLocalizationFlow(),
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

// ─── Pack 3 — Localization & Compliance ──────────────────────────────────────
//
// 13 questions across 4 sections. Country drives the l10n_<country>
// module which drives the COA template, tax engine, statutory reports,
// and (in 11+ countries) mandatory e-invoicing. Pack 1 captured
// primaryCountry; Pack 2 captured einvoicingRequired/einvoicingSystem.
// This pack converts those answers into hard requirements + flags
// missing compliance modules.
function buildLocalizationFlow(): FlowDefinition {
  return {
    id: 'LOCALIZATION',
    label: 'Localization & Compliance',
    description: 'Country-specific accounting templates, statutory reports, e-invoicing systems, and tax filing format requirements.',
    sections: [
      {
        id: 'coatemplate',
        label: 'Country COA & Statutory',
        order: 1,
        questions: [
          {
            id: 'odoo.localization.coaTemplate',
            inputType: 'TEXT',
            required: false,
            label: 'Chart of accounts template (auto-recommended from primaryCountry; override if you know the client wants a non-standard COA)',
            help: {
              title: 'COA template format',
              body: 'Format: l10n_<country_code> (e.g., l10n_ae for UAE, l10n_eg for Egypt, l10n_us for US, l10n_fr for France). Leave blank to accept the default for the primary country.',
            },
          },
          {
            id: 'odoo.localization.statutoryReports',
            inputType: 'TEXTAREA',
            required: false,
            label: "Statutory reports required (one per line, e.g. 'Egypt VAT return', 'GCC VAT', 'GAAP financial statements', 'IFRS', 'SAF-T')",
          },
          {
            id: 'odoo.localization.languagePackInstall',
            inputType: 'BOOLEAN',
            required: false,
            label: 'Install country-specific language pack? (e.g., l10n_ae installs Arabic UI elements + RTL templates)',
          },
        ],
      },
      {
        id: 'einvoicing',
        label: 'E-Invoicing System',
        order: 2,
        questions: [
          {
            id: 'odoo.localization.einvoicingProvider',
            inputType: 'TEXT',
            required: false,
            label: 'E-invoicing system / provider (auto-suggested from primaryCountry; e.g. Italy SDI, Mexico CFDI 4.0, Spain Veri*Factu, France PPF, Saudi ZATCA, Egypt ETA, Brazil NFe, India GSP, Turkey e-Fatura, Germany ZUGFeRD/XRechnung, Poland KSeF)',
          },
          {
            id: 'odoo.localization.einvoicingPhase',
            inputType: 'TEXT',
            required: false,
            label: 'Implementation phase (Phase 1 = clearance via tax authority, Phase 2 = peer-to-peer with QR/cryptographic stamp, etc.)',
          },
          {
            id: 'odoo.localization.einvoicingPilotDone',
            inputType: 'SINGLE_SELECT',
            required: false,
            label: 'Has the client completed sandbox/pilot certification with the tax authority?',
            options: [
              { value: 'YES',         label: 'Yes' },
              { value: 'IN_PROGRESS', label: 'In progress' },
              { value: 'NO',          label: 'No' },
              { value: 'N_A',         label: 'Not applicable' },
            ],
          },
          {
            id: 'odoo.localization.einvoicingDigitalCert',
            inputType: 'SINGLE_SELECT',
            required: false,
            label: 'Does the client have a valid digital certificate / signing key for e-invoicing?',
            options: [
              { value: 'YES',         label: 'Yes' },
              { value: 'IN_PROGRESS', label: 'Being procured' },
              { value: 'NO',          label: 'No / unsure' },
              { value: 'N_A',         label: 'Not applicable' },
            ],
          },
        ],
      },
      {
        id: 'payroll',
        label: 'Country-Specific Payroll',
        order: 3,
        questions: [
          {
            id: 'odoo.localization.payrollInScope',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Is country-specific payroll in scope? (Odoo provides l10n_<country>_hr_payroll modules for ~30 countries)',
          },
          {
            id: 'odoo.localization.payrollFrequency',
            inputType: 'SINGLE_SELECT',
            required: false,
            label: 'If yes — payroll frequency',
            options: [
              { value: 'MONTHLY',  label: 'Monthly' },
              { value: 'BIWEEKLY', label: 'Bi-weekly' },
              { value: 'WEEKLY',   label: 'Weekly' },
              { value: 'OTHER',    label: 'Other / mixed' },
            ],
          },
          {
            id: 'odoo.localization.payrollEndOfService',
            inputType: 'TEXTAREA',
            required: false,
            label: 'End-of-service / gratuity / severance schemes specific to this country?',
          },
        ],
      },
      {
        id: 'datasovereignty',
        label: 'Data Sovereignty & Residency',
        order: 4,
        questions: [
          {
            id: 'odoo.localization.dataResidencyRequired',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Are there legal data-residency requirements? (data must reside in a specific country/region)',
          },
          {
            id: 'odoo.localization.dataResidencyJurisdiction',
            inputType: 'TEXT',
            required: false,
            label: "If yes — required jurisdiction (e.g., 'Saudi Arabia', 'EU', 'UAE')",
          },
          {
            id: 'odoo.localization.gdprApplicable',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Is GDPR (or local equivalent — UAE PDPL, Saudi PDPL, Brazil LGPD, etc.) applicable?',
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

    // R7: country-mandated e-invoicing. Pack 3 update — country list now
    // derived from L10N_MODULES_BY_COUNTRY (entries with
    // einvoicingMandatory=true) instead of a hand-written 11-country
    // string array. Single source of truth: add a country to that map
    // with mandate=true and this rule fires for it automatically.
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
          values: EINVOICING_MANDATE_COUNTRIES,
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

    // R2: e-invoicing required but the country's localisation module isn't
    // licensed. Pack 3 update — replaces the 23-module hardcoded list with
    // a country-aware lookup. The trigger is now per-country: for each
    // ISO code in L10N_MODULES_BY_COUNTRY, fire when
    //   primaryCountry === <code> AND license is missing
    //   L10N_MODULES_BY_COUNTRY[<code>].module
    // Encoded as a 43-way OR because the DSL has no dynamic module-name
    // composition. Auto-derived from the lookup map at module load time
    // so adding a new country to L10N_MODULES_BY_COUNTRY automatically
    // extends the rule.
    {
      id: 'odoo.tax.einvoicing-yes-needs-l10n',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.tax.einvoicingRequired', 'odoo.foundation.primaryCountry'],
      message: "E-invoicing is mandatory but the country's localization module isn't in the license.",
      resolution: 'Add the l10n_<country> module that matches primaryCountry — see L10N_MODULES_BY_COUNTRY for the canonical name.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.tax.einvoicingRequired', value: 'YES' } },
          { any: Object.entries(L10N_MODULES_BY_COUNTRY).map(([cc, info]) => ({
            all: [
              { answerEquals: { questionId: 'odoo.foundation.primaryCountry', value: cc } },
              { licenseMissingModule: info.module },
            ],
          })) },
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

    // ── Pack 3 — Localization & Compliance rules ──────────────────────────

    // R1: COA template required. The country's l10n_<country> module
    // must be in the license, OR the consultant must have typed an l10n
    // hint into odoo.localization.coaTemplate (we approximate "contains
    // l10n" as "any non-empty value" since the DSL has no string-contains
    // operator). Encoded as the same 43-way per-country OR pattern used
    // in Pack 2 R2 — auto-derived from L10N_MODULES_BY_COUNTRY so adding
    // a country extends the rule automatically.
    {
      id: 'odoo.localization.coa-template-required',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.foundation.primaryCountry', 'odoo.localization.coaTemplate'],
      message: 'No country COA template (l10n_<country>) is in the module list. Odoo requires a localization module to drive the chart of accounts and tax engine for the primary country.',
      resolution: 'Add l10n_<countryCodeLower> to license modules — see L10N_MODULES_BY_COUNTRY for the canonical name.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.foundation.primaryCountry' } },
          { answerFalsy:  { questionId: 'odoo.localization.coaTemplate' } },
          { any: Object.entries(L10N_MODULES_BY_COUNTRY).map(([cc, info]) => ({
            all: [
              { answerEquals: { questionId: 'odoo.foundation.primaryCountry', value: cc } },
              { licenseMissingModule: info.module },
            ],
          })) },
        ],
      },
    },

    // R2: Country mandates e-invoicing but the engagement marked it
    // 'NO'. Mandate set is derived from L10N_MODULES_BY_COUNTRY entries
    // with einvoicingMandatory=true.
    {
      id: 'odoo.localization.einvoicing-mandatory-confirmed',
      type: 'CONFIG_CONFLICT',
      severity: 'BLOCK',
      questionIds: ['odoo.foundation.primaryCountry', 'odoo.tax.einvoicingRequired'],
      message: "E-invoicing is mandatory in the primary country but the engagement marked it 'NO'.",
      resolution: 'Confirm the legal status — if mandatory, set einvoicingRequired to YES and capture the e-invoicing system in localization.einvoicingProvider. Reference: L10N_MODULES_BY_COUNTRY for the official system name.',
      when: {
        all: [
          { answerIn: {
            questionId: 'odoo.foundation.primaryCountry',
            values: EINVOICING_MANDATE_COUNTRIES,
          } },
          { answerEquals: { questionId: 'odoo.tax.einvoicingRequired', value: 'NO' } },
        ],
      },
    },

    // R3: country has a known e-invoicing system AND einvoicingProvider
    // is empty. The DSL has no string-contains operator so we can't
    // assert "provider field equals the canonical system name"; instead
    // we surface a WARN whenever the consultant left the field blank
    // for a country that has a known system. If they typed anything
    // (even slightly off), we trust them.
    {
      id: 'odoo.localization.einvoicing-system-must-match-country',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.foundation.primaryCountry', 'odoo.localization.einvoicingProvider'],
      message: "The e-invoicing system in localization.einvoicingProvider doesn't match the canonical system for the primary country.",
      resolution: 'Confirm the right provider — see L10N_MODULES_BY_COUNTRY for the canonical name.',
      when: {
        all: [
          { answerIn: {
            questionId: 'odoo.foundation.primaryCountry',
            values: KNOWN_EINVOICING_SYSTEM_COUNTRIES,
          } },
          { answerFalsy: { questionId: 'odoo.localization.einvoicingProvider' } },
        ],
      },
    },

    // R4: e-invoicing requires a digital certificate. Fires when
    // einvoicingRequired=YES AND digitalCert is NO or unset (consultant
    // hasn't captured the answer yet).
    {
      id: 'odoo.localization.einvoicing-needs-digital-cert',
      type: 'DATA_WARNING',
      severity: 'BLOCK',
      questionIds: ['odoo.tax.einvoicingRequired', 'odoo.localization.einvoicingDigitalCert'],
      message: "E-invoicing requires a valid digital certificate / signing key. The client doesn't have one (or status is unknown).",
      resolution: 'Add digital certificate procurement as a Phase 1 dependency in the implementation plan. Most countries require client-side procurement directly with the tax authority — start early.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.tax.einvoicingRequired', value: 'YES' } },
          { any: [
            { answerEquals: { questionId: 'odoo.localization.einvoicingDigitalCert', value: 'NO' } },
            { answerFalsy:  { questionId: 'odoo.localization.einvoicingDigitalCert' } },
          ] },
        ],
      },
    },

    // R5: e-invoicing pilot completion. Fires when einvoicingRequired
    // =YES AND pilotDone is NO / IN_PROGRESS / unset. Most jurisdictions
    // require sandbox certification before go-live and it's often the
    // longest single dependency (4-8 weeks).
    {
      id: 'odoo.localization.einvoicing-needs-pilot-completion',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.tax.einvoicingRequired', 'odoo.localization.einvoicingPilotDone'],
      message: 'E-invoicing typically requires sandbox/pilot certification with the tax authority before go-live. The client has not completed it.',
      resolution: 'Add tax-authority pilot certification as an explicit prerequisite for go-live. This is often the longest single dependency in regulated geographies (4–8 weeks).',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.tax.einvoicingRequired', value: 'YES' } },
          { any: [
            { answerEquals: { questionId: 'odoo.localization.einvoicingPilotDone', value: 'NO' } },
            { answerEquals: { questionId: 'odoo.localization.einvoicingPilotDone', value: 'IN_PROGRESS' } },
            { answerFalsy:  { questionId: 'odoo.localization.einvoicingPilotDone' } },
          ] },
        ],
      },
    },

    // R6: country-specific payroll in scope but no HR / PAYROLL module
    // licensed. Spec wanted a per-country l10n_<country>_hr_payroll
    // check too, but Odoo doesn't ship a payroll module for every
    // country and the DSL has no dynamic module-name composition.
    // Pragmatic version: fire when payroll is in scope AND neither HR
    // nor PAYROLL is licensed — the consultant gets a clear nudge
    // either way.
    {
      id: 'odoo.localization.payroll-needs-l10n-hr-payroll',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.localization.payrollInScope', 'odoo.foundation.primaryCountry'],
      message: 'Country-specific payroll is in scope but neither the HR module nor the country payroll module (l10n_<country>_hr_payroll) is in the license.',
      resolution: 'Add HR and the country-specific payroll module to license.modules. Note: not all countries have an Odoo payroll module — confirm availability for primaryCountry.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.localization.payrollInScope' } },
          { not: { licenseHasAnyModule: ['HR', 'PAYROLL'] } },
        ],
      },
    },

    // R7: data residency requirements + Odoo Online deployment is
    // incompatible because Online hosts data in Belgium / EU. Fires
    // hard so the consultant doesn't book hosting that violates the
    // residency mandate.
    {
      id: 'odoo.localization.data-residency-blocks-online',
      type: 'CONFIG_CONFLICT',
      severity: 'BLOCK',
      questionIds: ['odoo.localization.dataResidencyRequired', 'odoo.foundation.deploymentMode'],
      message: 'Data residency is required but Odoo Online hosts data in Belgium / EU — you cannot guarantee residency in another jurisdiction on Online.',
      resolution: 'Switch to Self-hosted (you control the region) or Odoo.sh (confirm available regions support the required jurisdiction). Self-hosted is the safer option for strict residency mandates.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.localization.dataResidencyRequired' } },
          { answerEquals: { questionId: 'odoo.foundation.deploymentMode', value: 'ONLINE' } },
        ],
      },
    },

    // R8: GDPR (or equivalent) + portal users. Surfaces the standard
    // ~5 person-day pack of work for consent banners, DSAR endpoints,
    // and account deletion flows.
    {
      id: 'odoo.localization.gdpr-needs-portal-config',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.localization.gdprApplicable', 'odoo.foundation.portalUsers'],
      message: 'GDPR (or equivalent) requires explicit consent capture, data subject access (DSAR), and right-to-be-forgotten workflows for portal users.',
      resolution: 'Plan for portal consent banner, data export endpoint, and account deletion flow as Configuration-phase tasks. Allocate ~5 person-days.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.localization.gdprApplicable' } },
          { answerTruthy: { questionId: 'odoo.foundation.portalUsers' } },
        ],
      },
    },

    // R9: e-invoicing Phase 2 (peer-to-peer with QR codes / cryptographic
    // stamps) requires the Accounting engine for invoice generation.
    // The DSL has no string-contains operator so we match against the
    // common Phase 2 strings exactly. Misses freeform variants like
    // 'Phase 2 - Peer-to-peer'; the consultant typically writes one of
    // the canonical strings.
    {
      id: 'odoo.localization.einvoicing-phase2-needs-base-modules',
      type: 'LICENSE_GAP',
      severity: 'WARN',
      questionIds: ['odoo.localization.einvoicingPhase', 'odoo.foundation.primaryCountry'],
      message: "E-invoicing Phase 2 (peer-to-peer with QR codes / cryptographic stamps) is in scope but the Accounting module isn't provisioned.",
      resolution: 'Add Accounting (Community or Enterprise) to license.modules — Phase 2 e-invoicing depends on the Accounting engine for invoice generation.',
      when: {
        all: [
          { answerIn: {
            questionId: 'odoo.localization.einvoicingPhase',
            values: ['Phase 2', 'phase 2', 'P2P'],
          } },
          { not: { licenseHasAnyModule: ['BASE_ACCOUNTING', 'ENTERPRISE_ACCOUNTING'] } },
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
