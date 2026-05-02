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
    // Pack 4 — Accounting & Multi-Company depth. Reporting standards,
    // analytic axes / budgets, bank feeds & reconciliation, and
    // intercompany mechanics. Sits AFTER Localization (so the country
    // COA / e-invoicing decisions are captured first) and BEFORE R2R
    // (so the consultant has standards + analytic axes nailed down
    // before the legacy R2R section's lighter Company/CoA prompts).
    buildAccountingFlow(),
    buildR2RFlow(),
    // Pack 5 — Inventory & Valuation depth. Warehouse structure,
    // valuation method, lot/serial/expiration tracking, replenishment.
    // Sits AFTER R2R (so the GL/CoA decisions feed inventory accounting
    // accounts) and BEFORE P2P (so PO/receiving rules can see the
    // warehouse layout + tracking requirements that drive them).
    buildInventoryFlow(),
    buildP2PFlow(),
    buildO2CFlow(),
    // Pack 6 — Manufacturing depth (flow id MANUFACTURING_DEPTH; the
    // existing PRODUCTION flow keeps its three legacy mrp.* questions
    // for now). Sits AFTER O2C (sales-side BoM visibility captured
    // first) and DIRECTLY BEFORE the existing PRODUCTION flow whose
    // shop-floor execution is shaped by these depth answers.
    buildManufacturingDepthFlow(),
    buildProductionFlow(),
    buildReturnsFlow(),
    // Pack 7 — Data Migration sizing. Volumes, source systems,
    // cutover style, validation. LAST flow in the array — runs after
    // every other flow has captured its scope so the consultant can
    // size the migration with the full engagement context (warehouse
    // count from INVENTORY, multi-company from FOUNDATION, BoM
    // depth from MANUFACTURING_DEPTH, etc.).
    buildMigrationFlow(),
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

// ─── Pack 4 — Accounting & Multi-Company depth ───────────────────────────────
//
// 16 questions across 4 sections:
//   - standards     (5): reporting standard, accounting tradition, basis,
//                        close cadence, lock-dates policy.
//   - analytic      (4): analytic axes, budgets, budget control, consolidation.
//   - bankrecon     (4): bank feed integration, statement format,
//                        reconciliation method, currency revaluation cadence.
//   - intercompany  (4): intercompany validation, currency rule, transfer
//                        pricing policy, shared accounts strategy.
//
// Sources: Odoo 19 Accounting docs (lock dates, anglo-saxon vs continental,
// multi-currency revaluation, bank statement reconciliation), IFRS 1 / US
// GAAP guidance on cash vs accrual, OECD Transfer Pricing Guidelines (2022).
function buildAccountingFlow(): FlowDefinition {
  return {
    id: 'ACCOUNTING',
    label: 'Accounting & Multi-Company',
    description:
      'Reporting standards, analytic axes, bank feeds & reconciliation, and inter-company / multi-currency mechanics that drive the ledger configuration.',
    sections: [
      {
        id: 'standards',
        label: 'Reporting & Standards',
        order: 1,
        questions: [
          {
            id: 'odoo.accounting.reportingStandard',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Primary reporting standard',
            help: {
              title: 'Reporting standard',
              body: 'Drives the chart of accounts shape, depreciation policies, and disclosure requirements. IFRS is accrual-only by design.',
            },
            options: [
              { value: 'IFRS', label: 'IFRS' },
              { value: 'US_GAAP', label: 'US GAAP' },
              { value: 'LOCAL_GAAP', label: 'Local GAAP' },
              { value: 'OTHER', label: 'Other' },
            ],
          },
          {
            id: 'odoo.accounting.tradition',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Accounting tradition',
            help: {
              title: 'Anglo-Saxon vs Continental',
              body: 'Anglo-Saxon recognises COGS at delivery; Continental recognises expenses at purchase. Affects the stock-valuation account flow and several P&L mappings in Odoo.',
            },
            options: [
              { value: 'ANGLO_SAXON', label: 'Anglo-Saxon (COGS at delivery)' },
              { value: 'CONTINENTAL', label: 'Continental (expense at purchase)' },
            ],
          },
          {
            id: 'odoo.accounting.basis',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Accounting basis',
            options: [
              { value: 'ACCRUAL', label: 'Accrual' },
              { value: 'CASH', label: 'Cash' },
            ],
          },
          {
            id: 'odoo.accounting.closeCadence',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Period close cadence',
            options: [
              { value: 'MONTHLY', label: 'Monthly' },
              { value: 'QUARTERLY', label: 'Quarterly' },
              { value: 'BOTH', label: 'Both monthly + quarterly' },
            ],
          },
          {
            id: 'odoo.accounting.lockDatesPolicy',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Lock-dates policy',
            help: {
              title: 'Odoo lock dates',
              body: 'Tax lock prevents changes to tax-relevant entries; full lock prevents any entry on or before the lock date.',
            },
            options: [
              { value: 'NONE', label: 'None — no automatic lock' },
              { value: 'TAX_LOCK', label: 'Tax lock only' },
              { value: 'FULL_LOCK', label: 'Full lock after each close' },
            ],
          },
        ],
      },
      {
        id: 'analytic',
        label: 'Analytic Accounting & Budgets',
        order: 2,
        questions: [
          {
            id: 'odoo.accounting.analyticAxes',
            inputType: 'TEXTAREA',
            required: false,
            label: 'Analytic axes (one per line — e.g. Cost Centers, Projects, Departments)',
            help: {
              title: 'Analytic accounting in Odoo',
              body: 'Each axis becomes an analytic plan; tags on that plan map to cost centers / projects / departments. List the axes you need to report against.',
            },
          },
          {
            id: 'odoo.accounting.budgetsInScope',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Are budgets in scope (budget vs actual reporting)?',
          },
          {
            id: 'odoo.accounting.budgetControlMode',
            inputType: 'SINGLE_SELECT',
            required: false,
            label: 'Budget control mode',
            dependsOn: { questionId: 'odoo.accounting.budgetsInScope', value: true },
            options: [
              { value: 'INFORMATIONAL', label: 'Informational only — no enforcement' },
              { value: 'WARNING', label: 'Warn when an entry exceeds budget' },
              { value: 'BLOCKING', label: 'Block entries that exceed budget' },
            ],
          },
          {
            id: 'odoo.accounting.consolidationInScope',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Is multi-entity consolidation in scope?',
          },
        ],
      },
      {
        id: 'bankrecon',
        label: 'Bank Feeds & Reconciliation',
        order: 3,
        questions: [
          {
            id: 'odoo.accounting.bankFeedIntegration',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Will Odoo pull bank statements via an automated feed?',
            help: {
              title: 'Bank feeds in Odoo',
              body: 'Native bank-feed integrations (Plaid, Yodlee, Salt Edge, Ponto) are an Enterprise feature. Self-hosted Enterprise instances need a connector account with the provider.',
            },
          },
          {
            id: 'odoo.accounting.bankStatementFormat',
            inputType: 'TEXT',
            required: false,
            label: 'Bank statement format(s) to import (e.g. CAMT.053, MT940, OFX, CSV)',
          },
          {
            id: 'odoo.accounting.reconciliationMethod',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Reconciliation method',
            options: [
              { value: 'MANUAL', label: 'Manual — user matches each line' },
              { value: 'AUTO_SUGGEST', label: 'Auto-suggest matches, user confirms' },
              { value: 'AUTO_RULES', label: 'Auto-apply matching rules' },
            ],
          },
          {
            id: 'odoo.accounting.currencyRevalCadence',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Currency revaluation cadence',
            help: {
              title: 'Foreign-currency revaluation',
              body: 'Required when multi-currency is enabled — open AR/AP balances in foreign currency need revaluation entries at each period close.',
            },
            options: [
              { value: 'NONE', label: 'None' },
              { value: 'MONTHLY', label: 'Monthly' },
              { value: 'QUARTERLY', label: 'Quarterly' },
              { value: 'ON_DEMAND', label: 'On demand' },
            ],
          },
        ],
      },
      {
        id: 'intercompany',
        label: 'Inter-Company Mechanics',
        order: 4,
        questions: [
          {
            id: 'odoo.accounting.intercompanyValidation',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Inter-company document validation',
            help: {
              title: 'Mirror-document validation',
              body: 'Auto-validate posts the mirror invoice/bill in the counterpart company immediately. Auto-draft creates a draft for review. Manual creates nothing — the user creates the counterpart by hand.',
            },
            options: [
              { value: 'MANUAL', label: 'Manual — no mirror documents' },
              { value: 'AUTO_DRAFT', label: 'Auto-create draft mirror documents' },
              { value: 'AUTO_VALIDATE', label: 'Auto-create AND validate mirror documents' },
              { value: 'NA', label: 'Not applicable (single entity)' },
            ],
          },
          {
            id: 'odoo.accounting.intercompanyCurrencyRule',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Inter-company currency rule',
            options: [
              { value: 'BUYER_CURRENCY', label: "Buyer's currency" },
              { value: 'SELLER_CURRENCY', label: "Seller's currency" },
              { value: 'GROUP_CURRENCY', label: 'Group reporting currency' },
              { value: 'NA', label: 'Not applicable (single entity)' },
            ],
          },
          {
            id: 'odoo.accounting.transferPricingPolicy',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Transfer-pricing policy',
            help: {
              title: 'Transfer pricing',
              body: 'OECD-aligned policies for inter-company transactions. Affects how the consultant configures price-lists and analytic mappings between entities.',
            },
            options: [
              { value: 'COST_PLUS', label: 'Cost-plus markup' },
              { value: 'MARKET', label: 'Market price (arm\'s length)' },
              { value: 'FIXED_MARGIN', label: 'Fixed margin' },
              { value: 'NA', label: 'Not applicable (single entity)' },
            ],
          },
          {
            id: 'odoo.accounting.sharedAccountsStrategy',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Shared chart-of-accounts strategy',
            options: [
              { value: 'PER_COMPANY', label: 'Per-company chart of accounts' },
              { value: 'SHARED', label: 'Shared chart of accounts across companies' },
              { value: 'CONSOLIDATION_ONLY', label: 'Per-company, mapped only at consolidation' },
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

// ─── Pack 5 — Inventory & Valuation depth ────────────────────────────────────
//
// 17 questions across 4 sections:
//   - warehouses  (4): warehouse count, types, transfer rules, cross-docking.
//   - valuation   (4): valuation method, removal strategy, landed costs,
//                      negative-stock policy.
//   - tracking    (5): lots/serials, lot categories, serial categories,
//                      expiration dates, barcode scanning.
//   - operations  (4): replenishment strategy, drop-ship, count method,
//                      putaway rules.
//
// Sources: Odoo 19 Inventory docs (warehouse structure, valuation
// methods, removal strategies), IAS 2 LIFO prohibition (IFRS Foundation),
// Odoo Landed Costs (Enterprise feature flag), Odoo Barcode app /
// IoT Box documentation.
function buildInventoryFlow(): FlowDefinition {
  return {
    id: 'INVENTORY',
    label: 'Inventory & Valuation',
    description:
      'Warehouse structure, valuation method, lot/serial tracking, replenishment strategy, and removal rules — the configuration that determines whether inventory accounting and operations actually behave correctly.',
    sections: [
      {
        id: 'warehouses',
        label: 'Warehouse Structure',
        order: 1,
        questions: [
          {
            id: 'odoo.inventory.warehouseCount',
            inputType: 'NUMBER',
            required: true,
            label:
              'Number of physical warehouses (storage, retail, manufacturing — count any location with putaway rules)',
          },
          {
            id: 'odoo.inventory.warehouseTypes',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Warehouse types in scope (one per line — e.g., 'Main DC', 'Retail Store - Dubai Mall', 'Manufacturing Plant', 'Drop-ship Hub', 'Quarantine')",
          },
          {
            id: 'odoo.inventory.transferRules',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Inter-warehouse transfer rules required? (replenishment from main DC to stores, kitting between locations, etc.)',
          },
          {
            id: 'odoo.inventory.crossDocking',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Cross-docking in scope? (receive at one warehouse, ship out same-day without putaway)',
          },
        ],
      },
      {
        id: 'valuation',
        label: 'Valuation & Costing',
        order: 2,
        questions: [
          {
            id: 'odoo.inventory.valuationMethod',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Inventory valuation method',
            help: {
              title: 'Inventory valuation in Odoo',
              body: 'Set per product category. FIFO is the IFRS default; AVCO is common in commodities; Standard for stable supplier pricing.',
            },
            options: [
              { value: 'STANDARD', label: 'Standard Price (manually set, variances posted to P&L)' },
              { value: 'AVCO', label: 'Average Cost (weighted average of all receipts)' },
              { value: 'FIFO', label: 'FIFO (cost flows in receipt order — typical for IFRS)' },
            ],
          },
          {
            id: 'odoo.inventory.removalStrategy',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Default removal strategy (which physical units leave the warehouse first when picking)',
            options: [
              { value: 'FIFO', label: 'FIFO — oldest received first' },
              { value: 'LIFO', label: 'LIFO — newest received first (rare; banned under IFRS)' },
              { value: 'FEFO', label: 'FEFO — first expiring first (requires expiration tracking)' },
              { value: 'CLOSEST', label: 'Closest Location — minimize picker travel' },
            ],
          },
          {
            id: 'odoo.inventory.landedCosts',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Landed costs in scope? (allocate freight, customs, insurance into product cost)',
            help: {
              title: 'Landed Costs',
              body: 'Landed Costs is Odoo Enterprise-only. Community installations cost-allocate via journal entries.',
            },
          },
          {
            id: 'odoo.inventory.negativeStockAllowed',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Allow negative stock? (transactions proceed even when on-hand is below zero)',
            options: [
              { value: 'NEVER', label: 'Never (recommended for production)' },
              { value: 'MIGRATION_ONLY', label: 'During data migration only' },
              { value: 'ALLOWED', label: 'Always allowed (rare; high accounting risk)' },
            ],
          },
        ],
      },
      {
        id: 'tracking',
        label: 'Lot / Serial / Expiration Tracking',
        order: 3,
        questions: [
          {
            id: 'odoo.inventory.lotsSerialsRequired',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Lot or serial number tracking required for any product?',
          },
          {
            id: 'odoo.inventory.lotProductCategories',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "If yes — list product categories that need lot tracking (one per line — e.g., 'Pharmaceuticals', 'Dairy products', 'Electronic components')",
            dependsOn: { questionId: 'odoo.inventory.lotsSerialsRequired', value: true },
          },
          {
            id: 'odoo.inventory.serialProductCategories',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Product categories that need unique serial numbers (one per line — e.g., 'High-value electronics', 'Vehicles', 'Medical devices')",
            dependsOn: { questionId: 'odoo.inventory.lotsSerialsRequired', value: true },
          },
          {
            id: 'odoo.inventory.expirationTracking',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Expiration date tracking required? (drives FEFO removal, recall workflows, dunning of expired stock)',
          },
          {
            id: 'odoo.inventory.barcodeScanning',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Barcode scanning in receiving / picking workflows?',
          },
        ],
      },
      {
        id: 'operations',
        label: 'Replenishment & Operations',
        order: 4,
        questions: [
          {
            id: 'odoo.inventory.replenishmentStrategy',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Primary replenishment strategy',
            options: [
              { value: 'MIN_MAX', label: 'Min-Max reordering rules (auto PO when stock hits min)' },
              { value: 'MTO', label: 'Make-to-Order (procure on each sales order)' },
              { value: 'MTS', label: 'Make-to-Stock (forecast-driven; common for FMCG)' },
              { value: 'MIXED', label: 'Mixed (different rules per product category)' },
            ],
          },
          {
            id: 'odoo.inventory.dropShip',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Drop-ship in scope? (supplier ships directly to customer, never enters your warehouse)',
          },
          {
            id: 'odoo.inventory.countMethod',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Inventory count method',
            options: [
              { value: 'CYCLE', label: 'Cycle counting (rolling — count subset weekly/monthly)' },
              { value: 'ANNUAL', label: 'Annual physical count only' },
              { value: 'BOTH', label: 'Cycle counting + annual physical' },
            ],
          },
          {
            id: 'odoo.inventory.putawayRules',
            inputType: 'BOOLEAN',
            required: true,
            label:
              "Putaway rules required? (smart placement on receipt — e.g., 'paint goes to hazmat zone', 'fast-movers near pick face')",
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

// ─── Pack 6 — Manufacturing depth ────────────────────────────────────────────
//
// 16 questions across 4 sections:
//   - bom         (4): BoM types, multi-level BoMs, PLM, BoM cost method.
//   - routing     (4): routing required, work-center count, capacity
//                      planning, operation time tracking.
//   - quality     (3): quality plans required, checkpoints, fail blocks.
//   - operations  (5): subcontracting, subcontracting component tracking,
//                      maintenance, maintenance type, backflushing.
//
// Naming note: flow id is MANUFACTURING_DEPTH (not MANUFACTURING) to
// coexist with the existing PRODUCTION flow's three legacy mrp.*
// questions. A later refactor pack will collapse the two; this pack
// intentionally keeps both alive to stay non-breaking.
//
// Sources: Odoo 19 MRP docs (BoM types — Manufacture / Phantom /
// Subcontracting / Kit), Quality module, Subcontracting feature,
// PLM (Enterprise — ECO workflows + BoM revisions), Maintenance
// module, backflushing in MO completion flow.
function buildManufacturingDepthFlow(): FlowDefinition {
  return {
    id: 'MANUFACTURING_DEPTH',
    label: 'Manufacturing — Depth',
    description:
      "BoM architecture, routing & work centers, quality control plans, subcontracting, PLM, and maintenance integration. The configuration that determines whether the manufacturing layer actually models the client's shop floor.",
    sections: [
      {
        id: 'bom',
        label: 'BoM Architecture',
        order: 1,
        questions: [
          {
            id: 'odoo.mfg.bomTypes',
            inputType: 'TEXTAREA',
            required: true,
            label:
              "BoM types in use (one per line — 'Manufacture', 'Phantom (kit explosion at sales)', 'Subcontracting (vendor produces)', 'Kit (sells as bundle, no MO)')",
            help: {
              title: 'Multiple BoM types per instance',
              body: 'Different products can have different BoM types in the same Odoo instance. List each type the client uses.',
            },
          },
          {
            id: 'odoo.mfg.multiLevelBom',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Multi-level BoMs in scope? (sub-assemblies — a BoM where a component is itself a manufactured product with its own BoM)',
          },
          {
            id: 'odoo.mfg.plmInScope',
            inputType: 'BOOLEAN',
            required: true,
            label: 'PLM (Product Lifecycle Management) in scope for BoM versioning + ECO workflows?',
            help: {
              title: 'Odoo PLM (Enterprise)',
              body: 'Odoo PLM is Enterprise-only. Use for engineering-change orders, BoM revisions with approval workflows, and obsolete-product retirement.',
            },
          },
          {
            id: 'odoo.mfg.bomCostMethod',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'BoM cost method',
            options: [
              { value: 'COMPONENT_BASED', label: 'Component-based (sum of component costs at MO time — typical)' },
              { value: 'STANDARD_FIXED', label: 'Fixed standard cost per BoM (variance posted to P&L)' },
              { value: 'REAL_TIME', label: 'Real-time (recompute on every component cost change)' },
            ],
          },
        ],
      },
      {
        id: 'routing',
        label: 'Routing & Work Centers',
        order: 2,
        questions: [
          {
            id: 'odoo.mfg.routingRequired',
            inputType: 'BOOLEAN',
            required: true,
            label:
              "Routing required? (define operation sequence — e.g., 'Cut → Weld → Paint → QC')",
          },
          {
            id: 'odoo.mfg.workCenterCount',
            inputType: 'NUMBER',
            required: false,
            label:
              'Approximate number of work centers (count distinct stations / cells / machines that perform operations)',
          },
          {
            id: 'odoo.mfg.capacityPlanning',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Work-center capacity planning required? (load leveling, finite vs infinite capacity, schedule visibility)',
          },
          {
            id: 'odoo.mfg.operationTimeTracking',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Operator time tracking on operations? (start/stop per work order; feeds analytic + payroll)',
          },
        ],
      },
      {
        id: 'quality',
        label: 'Quality Control',
        order: 3,
        questions: [
          {
            id: 'odoo.mfg.qualityPlansRequired',
            inputType: 'BOOLEAN',
            required: true,
            label: 'Quality control plans required?',
          },
          {
            id: 'odoo.mfg.qualityCheckpoints',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "If yes — checkpoints in scope (one per line — 'Receiving (incoming inspection)', 'In-process (during MO)', 'Final (before stock)', 'Sampling vs 100%')",
            dependsOn: { questionId: 'odoo.mfg.qualityPlansRequired', value: true },
          },
          {
            id: 'odoo.mfg.qualityFailBlocks',
            inputType: 'SINGLE_SELECT',
            required: false,
            label: 'Does a quality FAIL block the production order?',
            dependsOn: { questionId: 'odoo.mfg.qualityPlansRequired', value: true },
            options: [
              { value: 'BLOCK_HARD', label: 'Hard block — MO cannot complete until quality passes' },
              { value: 'BLOCK_SOFT', label: 'Soft block — MO can complete with a quality alert raised' },
              { value: 'NO_BLOCK', label: 'No block — quality is informational only' },
            ],
          },
        ],
      },
      {
        id: 'operations',
        label: 'Subcontracting & Maintenance',
        order: 4,
        questions: [
          {
            id: 'odoo.mfg.subcontractingInScope',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Subcontracting in scope? (a vendor performs the manufacturing — Odoo creates an MO that the subcontractor fulfils)',
          },
          {
            id: 'odoo.mfg.subcontractingComponentsTracking',
            inputType: 'BOOLEAN',
            required: false,
            label:
              'If yes — track components shipped to subcontractor as separate inventory location?',
            dependsOn: { questionId: 'odoo.mfg.subcontractingInScope', value: true },
          },
          {
            id: 'odoo.mfg.maintenanceInScope',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Maintenance integration in scope? (preventive + corrective maintenance on work centers / equipment)',
          },
          {
            id: 'odoo.mfg.maintenanceType',
            inputType: 'SINGLE_SELECT',
            required: false,
            label: 'If yes — maintenance scope',
            dependsOn: { questionId: 'odoo.mfg.maintenanceInScope', value: true },
            options: [
              { value: 'PREVENTIVE', label: 'Preventive only (scheduled)' },
              { value: 'CORRECTIVE', label: 'Corrective only (break-fix)' },
              { value: 'BOTH', label: 'Both preventive and corrective' },
            ],
          },
          {
            id: 'odoo.mfg.backflushing',
            inputType: 'BOOLEAN',
            required: true,
            label:
              'Backflushing on MO completion? (auto-consume components when MO is marked done; vs explicit issue transactions)',
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

// ─── Pack 7 — Data Migration sizing ──────────────────────────────────────────
//
// 19 questions across 4 sections:
//   - volumes      (8): customers, vendors, SKUs, open SOs / POs / AR / AP,
//                       inventory line count.
//   - sources      (3): source systems, historical depth, master-data ownership.
//   - cutover      (4): cutover style, parallel-run days, pre-freeze, window.
//   - validation   (4): cleansing scope, post-validation approach,
//                       reconciliation strategy, sign-off owner.
//
// Drives the migration-phase scope, timeline, and risk register. The
// consultant's #1 source of post-go-live regret per the research that
// shaped this pack — without these questions the BRD cannot honestly
// price the migration phase.
//
// Sources: Odoo Implementation Methodology (opening balances + migration
// approach), ERP cutover style benchmarks (big bang vs phased vs
// parallel — practitioner consensus), master-data ownership patterns
// (industry best practice for ERP migrations).
function buildMigrationFlow(): FlowDefinition {
  return {
    id: 'MIGRATION',
    label: 'Data Migration',
    description:
      'Volume sizing, source systems, historical depth, cutover style, and reconciliation strategy. Drives the migration-phase scope, timeline, and risk register.',
    sections: [
      {
        id: 'volumes',
        label: 'Migration Volumes',
        order: 1,
        questions: [
          {
            id: 'odoo.migration.customerCount',
            inputType: 'NUMBER',
            required: true,
            label: 'Customers to migrate (active records — exclude long-dormant)',
          },
          {
            id: 'odoo.migration.vendorCount',
            inputType: 'NUMBER',
            required: true,
            label: 'Vendors to migrate (active suppliers and service providers)',
          },
          {
            id: 'odoo.migration.productSkuCount',
            inputType: 'NUMBER',
            required: true,
            label: 'Products / SKUs to migrate',
          },
          {
            id: 'odoo.migration.openSoCount',
            inputType: 'NUMBER',
            required: true,
            label: 'Open sales orders at cutover (estimate — not invoiced yet)',
          },
          {
            id: 'odoo.migration.openPoCount',
            inputType: 'NUMBER',
            required: true,
            label: 'Open purchase orders at cutover (estimate — not received yet)',
          },
          {
            id: 'odoo.migration.openArInvoiceCount',
            inputType: 'NUMBER',
            required: true,
            label: 'Open AR invoices (issued, not yet paid)',
          },
          {
            id: 'odoo.migration.openApBillCount',
            inputType: 'NUMBER',
            required: true,
            label: 'Open AP bills (received from vendors, not yet paid)',
          },
          {
            id: 'odoo.migration.inventoryLineCount',
            inputType: 'NUMBER',
            required: true,
            label:
              'Inventory snapshot — total stock lines across all warehouses (qty per SKU per location)',
          },
        ],
      },
      {
        id: 'sources',
        label: 'Source Systems & History',
        order: 2,
        questions: [
          {
            id: 'odoo.migration.sourceSystems',
            inputType: 'TEXTAREA',
            required: true,
            label:
              "Source system(s) — list each with brief description (e.g., 'QuickBooks Online — accounting since 2018', 'Excel spreadsheets — inventory + customer master', 'Custom MS Access — sales orders')",
          },
          {
            id: 'odoo.migration.historicalDepthYears',
            inputType: 'NUMBER',
            required: true,
            label:
              'Historical transaction depth to migrate (years — 0 = opening balances only, 3 = trial balance + last 3 years of transactions)',
          },
          {
            id: 'odoo.migration.masterDataOwnership',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Master data ownership — who validates each object (customers / vendors / products / COA). One per line, e.g., 'Customers: Sales Director', 'Products: Inventory Manager'",
          },
        ],
      },
      {
        id: 'cutover',
        label: 'Cutover Strategy',
        order: 3,
        questions: [
          {
            id: 'odoo.migration.cutoverStyle',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Cutover style',
            options: [
              { value: 'BIG_BANG', label: 'Big bang (single weekend / week — all modules + entities go live together)' },
              { value: 'PHASED_MODULE', label: 'Phased by module (Accounting first, then Inventory, then Sales, etc.)' },
              { value: 'PHASED_ENTITY', label: 'Phased by entity (one company at a time — common in groups)' },
              { value: 'PARALLEL_RUN', label: 'Parallel run (legacy + Odoo run together for N weeks before retiring legacy)' },
            ],
          },
          {
            id: 'odoo.migration.parallelRunDays',
            inputType: 'NUMBER',
            required: false,
            label: 'If parallel run — duration in days',
            dependsOn: { questionId: 'odoo.migration.cutoverStyle', value: 'PARALLEL_RUN' },
          },
          {
            id: 'odoo.migration.preFreezeDays',
            inputType: 'NUMBER',
            required: true,
            label: 'Pre-migration freeze period (days during which legacy is read-only before cutover snapshot)',
          },
          {
            id: 'odoo.migration.cutoverWindowHours',
            inputType: 'NUMBER',
            required: true,
            label: 'Cutover execution window (total hours from snapshot to go-live signoff)',
          },
        ],
      },
      {
        id: 'validation',
        label: 'Validation & Reconciliation',
        order: 4,
        questions: [
          {
            id: 'odoo.migration.cleansingScope',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Pre-migration data cleansing scope (one per line — e.g., 'Deduplicate customers by VAT number', 'Normalize product UoM to single base', 'Drop orphan SOs older than 2 years')",
          },
          {
            id: 'odoo.migration.postValidationApproach',
            inputType: 'SINGLE_SELECT',
            required: true,
            label: 'Post-migration validation approach',
            options: [
              { value: 'SAMPLE', label: 'Sample check (random subset across each object type)' },
              { value: 'STRATIFIED_SAMPLE', label: 'Stratified sample (high-value records 100%, others sampled)' },
              { value: 'FULL_CHECK', label: 'Full check (every record validated — only feasible for small datasets)' },
              { value: 'BUSINESS_RULE', label: 'Business-rule validation (TB tie-out, AR/AP aging match, inventory variance threshold)' },
            ],
          },
          {
            id: 'odoo.migration.reconciliationStrategy',
            inputType: 'TEXTAREA',
            required: false,
            label:
              "Reconciliation strategy (one per line — e.g., 'Trial balance: legacy = Odoo to the cent', 'AR aging: 30/60/90 buckets match within 0.5%', 'Inventory: variance < $X per SKU')",
          },
          {
            id: 'odoo.migration.signoffOwner',
            inputType: 'TEXT',
            required: true,
            label: 'Migration sign-off owner (who approves go/no-go on cutover day)',
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

    // ── Pack 4 — Accounting & Multi-Company depth rules ───────────────────

    // R1: Cash basis is incompatible with IFRS — IFRS Conceptual Framework
    // explicitly mandates accrual recognition. The rule fires only on
    // IFRS because US GAAP / Local GAAP have narrower exceptions where
    // cash basis is acceptable for small entities.
    {
      id: 'odoo.accounting.cash-basis-conflicts-with-ifrs',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['odoo.accounting.basis', 'odoo.accounting.reportingStandard'],
      message: 'Cash basis accounting is incompatible with IFRS — IFRS Conceptual Framework requires the accrual basis.',
      resolution: 'Switch basis to Accrual, or document the IFRS exception (rare — usually only for cash-flow disclosures).',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.accounting.basis', value: 'CASH' } },
          { answerEquals: { questionId: 'odoo.accounting.reportingStandard', value: 'IFRS' } },
        ],
      },
    },

    // R2: Multi-currency requires a periodic FX revaluation cadence.
    // Open AR/AP balances in foreign currency must be revalued at each
    // close to keep the GL aligned with current rates. Fires when
    // multiCurrency=true AND cadence is NONE or unset.
    {
      id: 'odoo.accounting.multi-currency-needs-reval-cadence',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['odoo.foundation.multiCurrency', 'odoo.accounting.currencyRevalCadence'],
      message: 'Multi-currency is enabled but no periodic foreign-currency revaluation cadence is set — open balances will drift from current rates.',
      resolution: 'Set currencyRevalCadence to MONTHLY or QUARTERLY (or ON_DEMAND if revaluation is triggered manually each close).',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.foundation.multiCurrency' } },
          { any: [
            { answerEquals: { questionId: 'odoo.accounting.currencyRevalCadence', value: 'NONE' } },
            { answerFalsy:  { questionId: 'odoo.accounting.currencyRevalCadence' } },
          ] },
        ],
      },
    },

    // R3: Budgets in scope but no analytic axes captured. Odoo budgets
    // are scoped to analytic plans/tags — without at least one axis,
    // there's nothing to budget against beyond the GL account itself.
    {
      id: 'odoo.accounting.budgets-need-analytic-axes',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.accounting.budgetsInScope', 'odoo.accounting.analyticAxes'],
      message: 'Budgets are in scope but no analytic axes are captured. Odoo budgets are scoped to analytic plans — without an axis, budget vs actual is meaningless beyond the GL.',
      resolution: 'List the analytic axes (e.g. Cost Centers, Projects, Departments) on the Analytic Accounting & Budgets section.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.accounting.budgetsInScope' } },
          { answerFalsy:  { questionId: 'odoo.accounting.analyticAxes' } },
        ],
      },
    },

    // R4: Consolidation needs a real multi-entity setup. Either
    // multiCompany=false (no companies to consolidate) OR multiCompany
    // =true but entityList is empty (companies not enumerated). Both
    // are blocking: without entities you cannot configure consolidation.
    {
      id: 'odoo.accounting.consolidation-needs-multi-entity',
      type: 'CONFIG_CONFLICT',
      severity: 'BLOCK',
      questionIds: ['odoo.accounting.consolidationInScope', 'odoo.foundation.multiCompany', 'odoo.foundation.entityList'],
      message: 'Consolidation is in scope but the engagement does not have a real multi-entity setup (multiCompany=false or entities not listed).',
      resolution: 'Set multiCompany=true and list each legal entity in the entities field, or disable consolidation.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.accounting.consolidationInScope' } },
          { any: [
            { answerFalsy: { questionId: 'odoo.foundation.multiCompany' } },
            { answerFalsy: { questionId: 'odoo.foundation.entityList' } },
          ] },
        ],
      },
    },

    // R5: Native bank-feed integrations (Plaid, Yodlee, Salt Edge,
    // Ponto) are an Odoo Enterprise feature. Community has no
    // bank-feed connectors — the consultant has to import statements
    // by file. Fires hard when bankFeedIntegration=true on Community.
    {
      id: 'odoo.accounting.bank-feeds-need-enterprise',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.accounting.bankFeedIntegration', 'odoo.foundation.edition'],
      message: 'Automated bank feeds (Plaid, Yodlee, Salt Edge, Ponto) are an Odoo Enterprise feature. Community has no native bank-feed connectors.',
      resolution: 'Upgrade edition to Enterprise, or set bankFeedIntegration=false and plan for file-based statement import (CAMT.053 / MT940 / OFX / CSV).',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.accounting.bankFeedIntegration' } },
          { answerEquals: { questionId: 'odoo.foundation.edition', value: 'COMMUNITY' } },
        ],
      },
    },

    // R6: Self-hosted Enterprise can use bank-feed integrations but
    // typically needs a connector account with the provider (the
    // user, not Odoo S.A., contracts the bank-data provider).
    // INFO-level reminder so the consultant captures it as a Phase 1
    // dependency.
    {
      id: 'odoo.accounting.bank-feeds-on-selfhosted-needs-connector',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.accounting.bankFeedIntegration', 'odoo.foundation.deploymentMode'],
      message: 'Self-hosted Odoo bank feeds require a separate connector account with the bank-data provider (Plaid, Yodlee, Salt Edge, Ponto) — Odoo S.A. only contracts the provider on Online / Odoo.sh.',
      resolution: 'Add bank-data provider account procurement as a Phase 1 dependency in the implementation plan.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.accounting.bankFeedIntegration' } },
          { answerEquals: { questionId: 'odoo.foundation.deploymentMode', value: 'SELFHOSTED' } },
        ],
      },
    },

    // R7: Auto-validate on inter-company documents skips human review.
    // Counterpart entity gets a posted journal entry as soon as the
    // source is validated — fine when both books are tightly governed,
    // but risky when periods may need adjustment in one entity but
    // not the other. WARN nudges the consultant to confirm.
    {
      id: 'odoo.accounting.intercompany-auto-validate-risk',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['odoo.accounting.intercompanyValidation'],
      message: 'Auto-validating mirror inter-company documents skips human review and posts to the counterpart entity immediately. This is risky when one entity may need a period adjustment that the other does not.',
      resolution: 'Consider AUTO_DRAFT — drafts mirror documents for review, then validate on confirmation. Document the decision in the Solution Design.',
      when: {
        answerEquals: { questionId: 'odoo.accounting.intercompanyValidation', value: 'AUTO_VALIDATE' },
      },
    },

    // R8: Transfer-pricing policy without multiple entities is
    // meaningless — there are no inter-company transactions to
    // price. Fires when policy is a real OECD policy (COST_PLUS /
    // MARKET / FIXED_MARGIN) AND multiCompany=false.
    {
      id: 'odoo.accounting.transfer-pricing-without-multi-entity',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['odoo.accounting.transferPricingPolicy', 'odoo.foundation.multiCompany'],
      message: 'A transfer-pricing policy is set but the engagement is single-entity. Transfer pricing only applies to inter-company transactions.',
      resolution: 'Set transferPricingPolicy to NA, OR enable multiCompany and list the entities.',
      when: {
        all: [
          { answerIn: {
            questionId: 'odoo.accounting.transferPricingPolicy',
            values: ['COST_PLUS', 'MARKET', 'FIXED_MARGIN'],
          } },
          { answerFalsy: { questionId: 'odoo.foundation.multiCompany' } },
        ],
      },
    },

    // R9: Monthly close with no lock-dates policy is a known leak —
    // entries can be back-dated into closed periods, breaking
    // reconciliations and audit trails. INFO-level nudge to enable
    // at least TAX_LOCK on monthly closers.
    {
      id: 'odoo.accounting.lockdates-recommended-for-monthly-close',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.accounting.closeCadence', 'odoo.accounting.lockDatesPolicy'],
      message: 'Monthly close cadence without an Odoo lock-dates policy lets entries back-date into closed periods and breaks reconciliations.',
      resolution: 'Set lockDatesPolicy to TAX_LOCK (minimum) or FULL_LOCK after each monthly close.',
      when: {
        all: [
          { answerIn: {
            questionId: 'odoo.accounting.closeCadence',
            values: ['MONTHLY', 'BOTH'],
          } },
          { answerEquals: { questionId: 'odoo.accounting.lockDatesPolicy', value: 'NONE' } },
        ],
      },
    },

    // ── Pack 5 — Inventory & Valuation depth rules ────────────────────────

    // R1: LIFO is prohibited under IFRS (IAS 2 §25). Fires hard so
    // the consultant cannot sign off an IFRS engagement with LIFO
    // removal. US GAAP still permits LIFO, so the rule is gated on
    // reportingStandard=IFRS.
    {
      id: 'odoo.inventory.lifo-banned-under-ifrs',
      type: 'CONFIG_CONFLICT',
      severity: 'BLOCK',
      questionIds: ['odoo.inventory.removalStrategy', 'odoo.accounting.reportingStandard'],
      message: 'LIFO is not permitted under IFRS (IAS 2 §25). The engagement reports under IFRS but selected LIFO removal.',
      resolution: 'Switch removalStrategy to FIFO (IFRS-standard) or FEFO (if expiration-tracked). LIFO is only legal under US GAAP.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.inventory.removalStrategy', value: 'LIFO' } },
          { answerEquals: { questionId: 'odoo.accounting.reportingStandard', value: 'IFRS' } },
        ],
      },
    },

    // R2: FEFO (First Expiring First Out) is meaningless without
    // expiration-date tracking — Odoo has nothing to sort by.
    // Blocks rather than warns because a FEFO setup without
    // expirations is broken at the operational level.
    {
      id: 'odoo.inventory.fefo-needs-expiration-tracking',
      type: 'CONFIG_CONFLICT',
      severity: 'BLOCK',
      questionIds: ['odoo.inventory.removalStrategy', 'odoo.inventory.expirationTracking'],
      message: 'FEFO (First Expiring First Out) requires expiration date tracking. The engagement selected FEFO but disabled expiration tracking.',
      resolution: 'Enable expirationTracking, OR change removalStrategy to FIFO.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.inventory.removalStrategy', value: 'FEFO' } },
          { answerFalsy: { questionId: 'odoo.inventory.expirationTracking' } },
        ],
      },
    },

    // R3: Lot/serial tracking flagged required but neither category
    // list is populated — the wizard cannot drive product-category
    // configuration in Phase 4 without at least one category.
    {
      id: 'odoo.inventory.lots-required-no-categories-listed',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: [
        'odoo.inventory.lotsSerialsRequired',
        'odoo.inventory.lotProductCategories',
        'odoo.inventory.serialProductCategories',
      ],
      message: 'Lot/serial tracking flagged required but no product categories are listed.',
      resolution: 'List the product categories that need lot tracking, the ones that need unique serial numbers, or both. Otherwise the wizard cannot drive product-category configuration in Phase 4.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.inventory.lotsSerialsRequired' } },
          { answerFalsy:  { questionId: 'odoo.inventory.lotProductCategories' } },
          { answerFalsy:  { questionId: 'odoo.inventory.serialProductCategories' } },
        ],
      },
    },

    // R4: Multiple warehouses without inter-warehouse transfer rules
    // means stock gets trapped at the receiving location.
    {
      id: 'odoo.inventory.multi-warehouse-needs-transfer-rules',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['odoo.inventory.warehouseCount', 'odoo.inventory.transferRules'],
      message: 'Multiple warehouses are in scope but inter-warehouse transfer rules are disabled. Stock will become trapped at one location.',
      resolution: "Enable transferRules and capture the transfer flows in warehouseTypes (e.g., 'Main DC → Retail Stores: weekly replenishment').",
      when: {
        all: [
          { answerNumberGreaterThan: { questionId: 'odoo.inventory.warehouseCount', value: 1 } },
          { answerFalsy: { questionId: 'odoo.inventory.transferRules' } },
        ],
      },
    },

    // R5: Landed Costs (allocate freight/customs/insurance into
    // product cost) is an Odoo Enterprise feature. Community has no
    // landed-costs module — the consultant has to allocate via
    // manual journal entries.
    {
      id: 'odoo.inventory.landed-costs-need-enterprise',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.inventory.landedCosts', 'odoo.foundation.edition'],
      message: 'Landed Costs (allocating freight, customs, insurance into product cost) is an Odoo Enterprise feature.',
      resolution: 'Either upgrade edition to Enterprise, or disable landedCosts and plan to allocate via manual journal entries posted to inventory accounts.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.inventory.landedCosts' } },
          { answerEquals: { questionId: 'odoo.foundation.edition', value: 'COMMUNITY' } },
        ],
      },
    },

    // R6: Make-to-Order on manufactured items requires the MRP
    // module. INFO-level reminder because MTO works for purchased
    // items without MRP — the consultant just needs to confirm the
    // mix.
    {
      id: 'odoo.inventory.mto-without-mrp',
      type: 'LICENSE_GAP',
      severity: 'INFO',
      questionIds: ['odoo.inventory.replenishmentStrategy'],
      message: 'Make-to-Order is in scope but the MRP module is not provisioned. MTO works for purchased items, but for manufactured items it requires MRP.',
      resolution: 'If the client manufactures any product, add MRP to license.modules. If MTO is purchase-only (e.g., custom-spec direct-from-supplier), this is acceptable.',
      when: {
        all: [
          { answerIn: {
            questionId: 'odoo.inventory.replenishmentStrategy',
            values: ['MTO', 'MIXED'],
          } },
          { licenseMissingModule: 'MRP' },
        ],
      },
    },

    // R7: Negative stock under Anglo-Saxon accounting produces
    // negative COGS journal entries when shipment posts before
    // receipt. Audit-trail nightmare. WARN nudges the consultant
    // to lock down to NEVER (or MIGRATION_ONLY) for production.
    {
      id: 'odoo.inventory.negative-stock-with-anglo-saxon',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['odoo.inventory.negativeStockAllowed', 'odoo.accounting.tradition'],
      message: "Allowing negative stock under Anglo-Saxon accounting produces negative COGS journal entries when the stock 'shipment' is posted before the receipt. Audit-trail nightmare.",
      resolution: 'Disallow negative stock (set NEVER) for production accounts. If migration cleanup requires it, set MIGRATION_ONLY and lock back to NEVER post-cutover.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.inventory.negativeStockAllowed', value: 'ALLOWED' } },
          { answerEquals: { questionId: 'odoo.accounting.tradition', value: 'ANGLO_SAXON' } },
        ],
      },
    },

    // R8: Drop-ship requires both BASE_PURCHASE and BASE_SALES — the
    // supplier PO is created from the customer SO. Either missing
    // breaks the workflow.
    {
      id: 'odoo.inventory.dropship-needs-purchase-and-sales',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.inventory.dropShip'],
      message: 'Drop-ship requires both Purchase and Sales modules — the supplier PO is created from the customer SO.',
      resolution: 'Add both BASE_PURCHASE and BASE_SALES to license.modules.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.inventory.dropShip' } },
          { any: [
            { licenseMissingModule: 'BASE_PURCHASE' },
            { licenseMissingModule: 'BASE_SALES' },
          ] },
        ],
      },
    },

    // R9: Barcode scanning needs hardware: Odoo Barcode app on
    // tablets (Enterprise), or USB scanners on receiving stations.
    // INFO-level reminder so the consultant captures the hardware
    // approach in the implementation plan.
    {
      id: 'odoo.inventory.barcode-needs-app-or-iot',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.inventory.barcodeScanning'],
      message: 'Barcode scanning requires either the Odoo Barcode app (Enterprise) installed on tablets, or USB barcode scanners on receiving stations.',
      resolution: 'Confirm hardware approach in the implementation plan: tablet count + Barcode app licenses, OR list of fixed scanning stations and supported scanner models. Allocate ~1 person-day per scanning station for setup.',
      when: { answerTruthy: { questionId: 'odoo.inventory.barcodeScanning' } },
    },

    // ── Pack 6 — Manufacturing depth rules ────────────────────────────────

    // R1: Routing requires at least one work center to be configured.
    // The DSL doesn't expose a "less than" operator directly so we use
    // NOT(answerNumberGreaterThan ≥ 1) — i.e. fire when the count is
    // missing OR is 0. answerNumberGreaterThan returns false for
    // unset values, which is what we want.
    {
      id: 'odoo.mfg.routing-needs-work-centers',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.mfg.routingRequired', 'odoo.mfg.workCenterCount'],
      message: 'Routing is required but no work centers are listed — routing cannot be configured without at least one work center.',
      resolution: "Capture the work-center count and types. If the client doesn't have distinct work centers, set routingRequired=false and use simple BoMs without operations.",
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.mfg.routingRequired' } },
          { not: { answerNumberGreaterThan: { questionId: 'odoo.mfg.workCenterCount', value: 0 } } },
        ],
      },
    },

    // R2: Quality plans need the QUALITY module. Quality integrates
    // with both Inventory (incoming/outgoing checks) and MRP
    // (in-process checks).
    {
      id: 'odoo.mfg.quality-needs-quality-module',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.mfg.qualityPlansRequired'],
      message: 'Quality control plans are in scope but the Quality module is not provisioned.',
      resolution: 'Add QUALITY to license.modules. Note: Quality integrates with both Inventory (incoming/outgoing checks) and MRP (in-process checks).',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.mfg.qualityPlansRequired' } },
          { licenseMissingModule: 'QUALITY' },
        ],
      },
    },

    // R3: Subcontracting in Odoo 17+ is a feature inside MRP — there
    // is no separate subcontracting module. So MRP must be licensed.
    {
      id: 'odoo.mfg.subcontracting-needs-module',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.mfg.subcontractingInScope'],
      message: 'Subcontracting requires the MRP module — the subcontracting flow is built on top of standard manufacturing orders.',
      resolution: 'Add MRP to license.modules. Subcontracting itself is a feature within MRP; no separate module is needed in Odoo 17+.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.mfg.subcontractingInScope' } },
          { licenseMissingModule: 'MRP' },
        ],
      },
    },

    // R4: PLM (Product Lifecycle Management — ECO workflows, BoM
    // revisions) is Odoo Enterprise-only. Community has no PLM
    // module — manual versioning only.
    {
      id: 'odoo.mfg.plm-is-enterprise-only',
      type: 'LICENSE_GAP',
      severity: 'BLOCK',
      questionIds: ['odoo.mfg.plmInScope', 'odoo.foundation.edition'],
      message: 'PLM (Product Lifecycle Management — ECO workflows, BoM revisions) is an Odoo Enterprise feature.',
      resolution: 'Either upgrade edition to Enterprise, or disable plmInScope and manage BoM revisions manually (with version notes in product description). Manual versioning is workable for <100 BoMs; not at scale.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.mfg.plmInScope' } },
          { answerEquals: { questionId: 'odoo.foundation.edition', value: 'COMMUNITY' } },
        ],
      },
    },

    // R5: Maintenance integration needs the MAINTENANCE module.
    // Required for both preventive schedules and corrective work-order
    // routing from quality alerts.
    {
      id: 'odoo.mfg.maintenance-needs-module',
      type: 'LICENSE_GAP',
      severity: 'WARN',
      questionIds: ['odoo.mfg.maintenanceInScope'],
      message: 'Maintenance integration is in scope but the Maintenance module is not provisioned.',
      resolution: 'Add MAINTENANCE to license.modules. Required for both preventive maintenance schedules and corrective work-order routing from quality alerts.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.mfg.maintenanceInScope' } },
          { licenseMissingModule: 'MAINTENANCE' },
        ],
      },
    },

    // R6: Multi-level BoMs technically work on Community but the
    // advanced auto-replenish + schedule-cascade features are
    // Enterprise. INFO-level — confirms the client's complexity
    // tolerance rather than blocking.
    {
      id: 'odoo.mfg.multi-level-bom-on-community-rough-edge',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.mfg.multiLevelBom', 'odoo.foundation.edition'],
      message: 'Multi-level BoMs work on Community but advanced features (auto-replenish sub-assemblies, schedule cascade) require Enterprise.',
      resolution: "Confirm client's complexity tolerance. If sub-assembly replenishment is manual today, Community is fine. If they expect auto-cascade, Enterprise is needed.",
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.mfg.multiLevelBom' } },
          { answerEquals: { questionId: 'odoo.foundation.edition', value: 'COMMUNITY' } },
        ],
      },
    },

    // R7: Standard fixed cost on BoMs is most natural under Anglo-Saxon
    // accounting (variance posts to P&L on receipt). Continental +
    // standard cost is workable but less common — auditors often ask
    // for explicit reconciliation.
    {
      id: 'odoo.mfg.standard-cost-needs-anglo-saxon-alignment',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.mfg.bomCostMethod', 'odoo.accounting.tradition'],
      message: 'Standard fixed cost on BoMs is most natural in Anglo-Saxon accounting (variance posts to P&L). The engagement uses Continental — confirm cost variance posting flow.',
      resolution: 'Document expected cost-variance journals in Solution Design. Continental + standard cost is workable but less common; auditors often ask for explicit reconciliation.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.mfg.bomCostMethod', value: 'STANDARD_FIXED' } },
          { answerEquals: { questionId: 'odoo.accounting.tradition', value: 'CONTINENTAL' } },
        ],
      },
    },

    // R8: Backflushing auto-consumes components on MO completion. With
    // lot tracking, Odoo picks lots based on removal strategy — operators
    // don't get to choose, and FEFO/FIFO conflicts can produce inventory
    // variance. INFO-level nudge to confirm the operations team is OK
    // with that.
    {
      id: 'odoo.mfg.backflushing-with-lots-creates-noise',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.mfg.backflushing', 'odoo.inventory.lotsSerialsRequired'],
      message: "Backflushing auto-consumes components on MO completion. With lot tracking, Odoo picks lots based on removal strategy — operators don't get to choose, and FEFO/FIFO conflicts can produce inventory variance.",
      resolution: 'Either disable backflushing for lot-tracked products (force explicit component issue), OR confirm the removal strategy is acceptable for the operations team.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.mfg.backflushing' } },
          { answerTruthy: { questionId: 'odoo.inventory.lotsSerialsRequired' } },
        ],
      },
    },

    // R9: Subcontracting without component tracking means consigned
    // inventory at the subcontractor is invisible — risk of unrecorded
    // WIP, lost components, and audit issues.
    {
      id: 'odoo.mfg.subcontracting-needs-component-tracking',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.mfg.subcontractingInScope', 'odoo.mfg.subcontractingComponentsTracking'],
      message: 'Subcontracting without component tracking means consigned inventory at the subcontractor is invisible — risk of unrecorded WIP, lost components, and audit issues.',
      resolution: 'Enable subcontractingComponentsTracking and configure a per-subcontractor inventory location. Standard practice in Odoo subcontracting setups.',
      when: {
        all: [
          { answerTruthy: { questionId: 'odoo.mfg.subcontractingInScope' } },
          { answerFalsy:  { questionId: 'odoo.mfg.subcontractingComponentsTracking' } },
        ],
      },
    },

    // ── Pack 7 — Data Migration sizing rules ──────────────────────────────

    // R1: Big-bang cutover with 50k+ customers is high risk —
    // historical Odoo migrations at this scale typically choose
    // phased or parallel.
    {
      id: 'odoo.migration.large-customer-count-with-big-bang',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.migration.customerCount', 'odoo.migration.cutoverStyle'],
      message: 'Big-bang cutover with 50k+ customers is high risk — historical Odoo migrations at this scale typically choose phased or parallel.',
      resolution: 'Consider PHASED_ENTITY (one company at a time) or PARALLEL_RUN (3–4 weeks). If big-bang stays, add explicit volume-load testing in pre-cutover plan and budget 2–3 dry runs.',
      when: {
        all: [
          { answerNumberGreaterThan: { questionId: 'odoo.migration.customerCount', value: 50000 } },
          { answerEquals: { questionId: 'odoo.migration.cutoverStyle', value: 'BIG_BANG' } },
        ],
      },
    },

    // R2: Parallel run cutover style needs a duration. Fires when
    // PARALLEL_RUN is selected AND parallelRunDays is unset, 0, or
    // negative. NOT(answerNumberGreaterThan>0) covers all three.
    {
      id: 'odoo.migration.parallel-run-needs-duration',
      type: 'DATA_WARNING',
      severity: 'BLOCK',
      questionIds: ['odoo.migration.cutoverStyle', 'odoo.migration.parallelRunDays'],
      message: 'Parallel run cutover style selected but no duration specified.',
      resolution: 'Capture parallel-run duration in days. Typical durations: 14 days (small implementations), 28–60 days (mid/large), longer for risk-averse industries.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.migration.cutoverStyle', value: 'PARALLEL_RUN' } },
          { not: { answerNumberGreaterThan: { questionId: 'odoo.migration.parallelRunDays', value: 0 } } },
        ],
      },
    },

    // R3: Customer migration in scope but no source system listed —
    // cannot plan extraction without knowing where data comes from.
    {
      id: 'odoo.migration.no-source-system',
      type: 'DATA_WARNING',
      severity: 'BLOCK',
      questionIds: ['odoo.migration.customerCount', 'odoo.migration.sourceSystems'],
      message: 'Customer migration in scope but source system(s) not specified — cannot plan extraction without knowing where data comes from.',
      resolution: 'List each source system with a brief description (legacy ERP name + version, spreadsheet locations, manual data, etc.).',
      when: {
        all: [
          { answerNumberGreaterThan: { questionId: 'odoo.migration.customerCount', value: 0 } },
          { answerFalsy: { questionId: 'odoo.migration.sourceSystems' } },
        ],
      },
    },

    // R4: Inventory snapshot of 50k+ lines without cleansing scope —
    // orphan SKUs, zero-qty lines, and obsolete locations will pollute
    // Odoo from day one.
    {
      id: 'odoo.migration.large-inventory-needs-cleansing',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.migration.inventoryLineCount', 'odoo.migration.cleansingScope'],
      message: 'Inventory snapshot of 50k+ lines without cleansing scope — orphan SKUs, zero-qty lines, and obsolete locations will pollute Odoo from day one.',
      resolution: 'Document cleansing rules: drop zero-qty lines older than X days, dedup SKU master by manufacturer code, retire warehouse locations not used in past N months. Cleansing typically reduces inventory line count by 20–40%.',
      when: {
        all: [
          { answerNumberGreaterThan: { questionId: 'odoo.migration.inventoryLineCount', value: 50000 } },
          { answerFalsy: { questionId: 'odoo.migration.cleansingScope' } },
        ],
      },
    },

    // R5: Migrating more than 5 years of history but source system not
    // detailed — older data often lives in archived databases or
    // backup tapes which adds weeks to migration prep.
    {
      id: 'odoo.migration.deep-history-needs-source-detail',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.migration.historicalDepthYears', 'odoo.migration.sourceSystems'],
      message: 'Migrating more than 5 years of history but source system not detailed — older data often lives in archived databases or backup tapes.',
      resolution: 'Specify per source: which years are in primary database, which are in archive, which are in cold backup. Cold backup data adds weeks to migration prep.',
      when: {
        all: [
          { answerNumberGreaterThan: { questionId: 'odoo.migration.historicalDepthYears', value: 5 } },
          { answerFalsy: { questionId: 'odoo.migration.sourceSystems' } },
        ],
      },
    },

    // R6: Big-bang cutover across multi-entity is high risk — coordinated
    // freeze across entities, country-specific tax filing windows, and
    // timezone differences make synchronization fragile.
    //
    // Implementation note: spec calls for "3 or more entries in
    // entityList", but the rule DSL has no line-count operator.
    // Pragmatic version: fires when big-bang + multi-company + entityList
    // populated (not empty). The 3-entity threshold becomes a future
    // refinement when the SDK gains a line-count condition.
    {
      id: 'odoo.migration.big-bang-multi-entity-risk',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['odoo.migration.cutoverStyle', 'odoo.foundation.multiCompany', 'odoo.foundation.entityList'],
      message: 'Big-bang cutover across multiple legal entities is high risk — coordinated freeze across entities, country-specific tax filing windows, and timezone differences make synchronization fragile.',
      resolution: 'Strongly consider PHASED_ENTITY. If big-bang stays, document per-entity rollback criteria and assign one cutover commander per entity.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.migration.cutoverStyle', value: 'BIG_BANG' } },
          { answerTruthy: { questionId: 'odoo.foundation.multiCompany' } },
          { answerTruthy: { questionId: 'odoo.foundation.entityList' } },
        ],
      },
    },

    // R7: Pre-migration freeze of less than 2 days while open
    // transactions exist — high risk of in-flight orders/bills falling
    // through cutover gaps. NOT(answerNumberGreaterThan>=2) ⇒
    // NOT(answerNumberGreaterThan>1) covers 0, 1, and unset.
    {
      id: 'odoo.migration.short-freeze-with-open-transactions',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.migration.preFreezeDays', 'odoo.migration.openSoCount', 'odoo.migration.openPoCount'],
      message: 'Pre-migration freeze of less than 2 days while open transactions exist — high risk of in-flight orders/bills falling through cutover gaps.',
      resolution: 'Extend freeze to at least 2 business days. Use the freeze to: lock new transaction entry, clear pending approvals, reconcile open SOs/POs, and run a final extraction snapshot.',
      when: {
        all: [
          { not: { answerNumberGreaterThan: { questionId: 'odoo.migration.preFreezeDays', value: 1 } } },
          { any: [
            { answerNumberGreaterThan: { questionId: 'odoo.migration.openSoCount', value: 0 } },
            { answerNumberGreaterThan: { questionId: 'odoo.migration.openPoCount', value: 0 } },
          ] },
        ],
      },
    },

    // R8: Multi-warehouse engagement with 1000+ SKUs requires a
    // per-warehouse inventory snapshot, but inventoryLineCount is
    // zero or unset — migration scripts need this number to provision
    // Odoo stock.quant rows.
    {
      id: 'odoo.migration.snapshot-required-for-multi-warehouse',
      type: 'DATA_WARNING',
      severity: 'WARN',
      questionIds: ['odoo.migration.productSkuCount', 'odoo.inventory.warehouseCount', 'odoo.migration.inventoryLineCount'],
      message: 'Multi-warehouse engagement with 1000+ SKUs requires a per-warehouse inventory snapshot, but inventoryLineCount is zero / unset.',
      resolution: 'Capture inventory line count = sum across (SKU × warehouse × location) at cutover snapshot. Migration scripts need this number to provision Odoo stock.quant rows.',
      when: {
        all: [
          { answerNumberGreaterThan: { questionId: 'odoo.migration.productSkuCount', value: 1000 } },
          { answerNumberGreaterThan: { questionId: 'odoo.inventory.warehouseCount', value: 1 } },
          { not: { answerNumberGreaterThan: { questionId: 'odoo.migration.inventoryLineCount', value: 0 } } },
        ],
      },
    },

    // R9: 100% post-migration validation isn't realistic at 5k+
    // customers — typical full-check rate is 200–400 records per
    // validator-day.
    {
      id: 'odoo.migration.full-check-not-feasible-at-scale',
      type: 'DATA_WARNING',
      severity: 'INFO',
      questionIds: ['odoo.migration.postValidationApproach', 'odoo.migration.customerCount'],
      message: "100% post-migration validation isn't realistic at 5k+ customers — typical full-check rate is 200–400 records per validator-day.",
      resolution: 'Switch to STRATIFIED_SAMPLE (high-value/regulated records 100%, remainder sampled) or BUSINESS_RULE (automated TB tie-out, aging match, inventory variance threshold). Reserve FULL_CHECK for migrations under 2k records.',
      when: {
        all: [
          { answerEquals: { questionId: 'odoo.migration.postValidationApproach', value: 'FULL_CHECK' } },
          { answerNumberGreaterThan: { questionId: 'odoo.migration.customerCount', value: 5000 } },
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
