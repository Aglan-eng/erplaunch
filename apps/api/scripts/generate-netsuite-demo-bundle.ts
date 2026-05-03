/**
 * One-shot driver: generate the full NetSuite demo bundle for a
 * canonical OneWorld engagement. Mirrors generate-odoo-demo-bundle.ts.
 *
 * Calls the generators directly with the same data shape that
 * generation.ts builds for adaptorId='netsuite', then writes the output
 * into NSIX/NETSUITE_DEMO_BUNDLE/<ISO>/Documentation/.
 *
 * No DB, no queue, no API — just the pure generator functions exercised
 * with a representative payload. The bundle is the design-partner /
 * pitch artefact and is intentionally NOT committed to git.
 *
 * Run from apps/api:
 *   pnpm --filter @ofoq/api exec tsx scripts/generate-netsuite-demo-bundle.ts
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { generateBRD, generateBRDHtml, type AdaptorContext } from '../src/services/generators/brdGenerator.js';
import { generateKickoff, generateKickoffHtml, type KickoffMember } from '../src/services/generators/kickoffGenerator.js';
import { generateRiskRegister } from '../src/services/generators/riskGenerator.js';
import { generateUATPlan, generateUATPlanHtml } from '../src/services/generators/uatGenerator.js';
import { generateSolutionDoc, generateSolutionDocHtml } from '../src/services/generators/solutionDocGenerator.js';
import { generateTrainingManual, generateTrainingManualHtml } from '../src/services/generators/trainingManualGenerator.js';
import { generateImplementationPlanHtml } from '../src/services/generators/planGenerator.js';
import { generateSdfCustomRecords } from '../src/services/generators/sdfCustomRecordsGenerator.js';
import { generateSdfManifest } from '../src/services/generators/sdfManifestGenerator.js';
import { generateSdfDeploy } from '../src/services/generators/sdfDeployGenerator.js';
import { generatePoApprovalScript } from '../src/services/generators/sdfPoApprovalScriptGenerator.js';
import { generateSdfCustomFields } from '../src/services/generators/sdfCustomFieldsGenerator.js';
import { generateSdfCustomList } from '../src/services/generators/sdfCustomListGenerator.js';
import { generateTransactionForms } from '../src/services/generators/sdfTransactionFormGenerator.js';
import { generateEntryForms } from '../src/services/generators/sdfEntryFormGenerator.js';
import {
  generateSubsidiaries,
  extractCurrenciesFromSubsidiaries,
} from '../src/services/generators/sdfSubsidiaryGenerator.js';
import { generateCurrencies } from '../src/services/generators/sdfCurrencyGenerator.js';
import { generateWorkflows } from '../src/services/generators/sdfWorkflowGenerator.js';
import { generateWorkflowActionScripts } from '../src/services/generators/sdfWorkflowActionScriptGenerator.js';
import { generateSavedSearches } from '../src/services/generators/sdfSavedSearchGenerator.js';
import { generateDashboards } from '../src/services/generators/sdfDashboardGenerator.js';
import { generateRoles } from '../src/services/generators/sdfRoleGenerator.js';
import { generateAccountingPreferences } from '../src/services/generators/sdfAccountingPreferencesGenerator.js';
import { generateCompanyInformation } from '../src/services/generators/sdfCompanyInformationGenerator.js';
import { generateGeneralPreferences } from '../src/services/generators/sdfGeneralPreferencesGenerator.js';
import { generateTaxTypes } from '../src/services/generators/sdfTaxTypeGenerator.js';
import { generateTaxCodes } from '../src/services/generators/sdfTaxCodeGenerator.js';
import { generateTaxSchedules } from '../src/services/generators/sdfTaxScheduleGenerator.js';
import { validateSDFBundle } from '../src/services/generators/sdfValidator.js';
import { generateTestScripts } from '../src/services/generators/testScriptGenerator.js';
import {
  generateSignOffMatrix,
  type SignOffMember,
} from '../src/services/generators/signOffMatrixGenerator.js';
import { generateDefectLogTemplate } from '../src/services/generators/defectLogTemplateGenerator.js';
import { generatePerformanceTestPlan } from '../src/services/generators/performanceTestPlanGenerator.js';
import { generateRegressionTestSuite } from '../src/services/generators/regressionTestSuiteGenerator.js';
import { generatePerRoleTrainingGuides } from '../src/services/generators/perRoleTrainingGuideGenerator.js';
import { generateQuickReferenceCards } from '../src/services/generators/quickReferenceCardGenerator.js';
import { generateTrainingMatrix } from '../src/services/generators/trainingMatrixGenerator.js';
import { generateTrainingSchedule } from '../src/services/generators/trainingScheduleGenerator.js';
import { generateKnowledgeTransferChecklist } from '../src/services/generators/knowledgeTransferChecklistGenerator.js';
import { generateCutoverRunbook } from '../src/services/generators/cutoverRunbookGenerator.js';
import { generateGoNoGoMatrix } from '../src/services/generators/goNoGoMatrixGenerator.js';
import { generateRollbackPlan } from '../src/services/generators/rollbackPlanGenerator.js';
import { generatePostCutoverSmoke } from '../src/services/generators/postCutoverSmokeGenerator.js';
import { generateCutoverCommPlan } from '../src/services/generators/cutoverCommPlanGenerator.js';
import { generateDryRunPlan } from '../src/services/generators/dryRunPlanGenerator.js';
import { generateCutoverTeamRoster } from '../src/services/generators/cutoverTeamRosterGenerator.js';
import { generateHypercarePlan } from '../src/services/generators/hypercarePlanGenerator.js';
import { generateDailyReadinessChecklist } from '../src/services/generators/dailyReadinessChecklistGenerator.js';
import { generateIssueEscalationMatrix } from '../src/services/generators/issueEscalationMatrixGenerator.js';
import { generateWarRoomSop } from '../src/services/generators/warRoomSopGenerator.js';
import { generateTransitionToSupportPlan } from '../src/services/generators/transitionToSupportPlanGenerator.js';
import { generateHypercareKpiDashboard } from '../src/services/generators/hypercareKpiDashboardGenerator.js';
import { generatePowerUserOfficeHours } from '../src/services/generators/powerUserOfficeHoursGenerator.js';
import { generateStabilizationRoadmap } from '../src/services/generators/stabilizationRoadmapGenerator.js';
import { generateLessonsLearned } from '../src/services/generators/lessonsLearnedGenerator.js';
import { generateBenefitsRealizationTracker } from '../src/services/generators/benefitsRealizationTrackerGenerator.js';
import { generateProcessImprovementBacklog } from '../src/services/generators/processImprovementBacklogGenerator.js';
import { generateContinuousImprovementGovernance } from '../src/services/generators/continuousImprovementGovernanceGenerator.js';
import { generateKpiEvolutionPlan } from '../src/services/generators/kpiEvolutionPlanGenerator.js';
import { generatePhaseTwoCharter } from '../src/services/generators/phaseTwoCharterGenerator.js';
// Pack Z — Data Migration Assets (cross-platform).
import { generateCsvImportTemplateBundle } from '../src/services/generators/csvImportTemplateBundleGenerator.js';
import { generateFieldMappingWorkbook } from '../src/services/generators/fieldMappingWorkbookGenerator.js';
import { generateReconciliationQueries } from '../src/services/generators/reconciliationQueriesGenerator.js';
import { generateMigrationCleansingRules } from '../src/services/generators/migrationCleansingRulesGenerator.js';
import { generateMigrationLoadSequencing } from '../src/services/generators/migrationLoadSequencingGenerator.js';
import { generateMigrationRunbook } from '../src/services/generators/migrationRunbookGenerator.js';
import { generateRejectHandlingPlaybook } from '../src/services/generators/rejectHandlingPlaybookGenerator.js';
import { generateDataQualityScorecard } from '../src/services/generators/dataQualityScorecardGenerator.js';
import netsuiteAdaptor from '@ofoq/adaptor-netsuite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/api/scripts → repo root → NSIX/ → NETSUITE_DEMO_BUNDLE/
const NSIX_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// ── Adaptor context — same shape generation.ts builds for adaptorId='netsuite' ──
const adaptor: AdaptorContext = {
  id: 'netsuite',
  name: 'NetSuite',
  editionLabel: 'NetSuite OneWorld',
  consultantQualifier: 'NetSuite',
  nextStepLanguage:
    'the NetSuite build phase using the SDF deployment package generated by ERPLaunch',
  flows: netsuiteAdaptor.schema.flows.map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    sections: f.sections.map((s) => ({
      id: s.id,
      label: s.label,
      order: s.order,
      questions: s.questions.map((q) => ({
        id: q.id,
        label: q.label,
        inputType: q.inputType,
        options: q.options,
      })),
    })),
  })),
};

// ── Demo data — canonical OneWorld engagement (Atlas Industries Group) ──────
const clientName = 'Atlas Industries Group';
const license = {
  edition: 'ONEWORLD',
  modules: [
    'ONEWORLD',
    'ADVANCED_REVENUE',
    'ADVANCED_INVENTORY',
    'MULTI_BOOK',
    'MANUFACTURING',
    'WORK_ORDERS',
    'WIP_ROUTINGS',
  ],
};

const answers: Record<string, unknown> = {
  // Kickoff Pack — universal
  'kickoff.mandate.sponsor': 'Helena Reyes (CFO, Atlas Industries Group)',
  'kickoff.mandate.businessCase':
    'Consolidate the 4 Atlas group subsidiaries (US/UK/AU/DE) onto a single NetSuite OneWorld tenant. ' +
    'Drives ASC 606 / IFRS 15 compliance ahead of the 2027 audit refresh, eliminates the manual ' +
    'multi-currency consolidation that currently takes 3 weeks per quarter, and unblocks the planned ' +
    'expansion into 2 new EU subsidiaries in 2026.',
  'kickoff.mandate.successCriteria':
    'Quarterly consolidation in 5 business days vs current 21 (target: Q1 2027 close)\n' +
    'Single source of truth for revenue recognition across all 4 subs (target: month 3 post-go-live)\n' +
    'Eliminate 90% of manual intercompany journal entries via NetSuite intercompany automation',
  'kickoff.mandate.targetGoLiveDate': '2026-11-15',
  'kickoff.governance.steeringCadence': 'BIWEEKLY',
  'kickoff.governance.workingGroupCadence': 'WEEKLY',
  'kickoff.governance.decisionThresholds':
    '<$25k or in-scope: PM decides\n' +
    '$25k–$100k or scope clarification: Steering\n' +
    '>$100k or scope change: Sponsor + Steering joint approval',
  'kickoff.governance.escalationPath':
    'Hesham Aglan (consultant PM) → Steering Committee (bi-weekly) → Helena Reyes (Sponsor)',
  'kickoff.communication.statusReportCadence': 'WEEKLY',
  'kickoff.communication.statusReportAudience':
    'Helena Reyes — Sponsor / CFO\n' +
    'David Chen — Client PM / VP Finance Transformation\n' +
    'Hesham Aglan — Consultant PM\n' +
    'Sophie Müller — Workstream lead, EU subsidiaries (UK + DE)\n' +
    'Tom Wilson — Workstream lead, US + AU subsidiaries\n' +
    'Priya Patel — Workstream lead, Revenue Recognition (ARM)',
  'kickoff.communication.issueReportingChannel': 'SHARED_DOC',
  'kickoff.communication.stakeholderNotes':
    'Robert Atlas (CEO) — quarterly read-out only; no operational involvement\n' +
    'Marcus Webb (Head of IT) — must be informed before any sandbox refresh or production change\n' +
    'External auditor (KPMG) — read-only access to UAT data; SOX walkthrough required at each major release',

  // NS Pack 1 — Foundation & Account Type
  'ns.foundation.edition': 'ONEWORLD',
  'ns.foundation.suiteSuccessBundle': 'US',
  'ns.foundation.suiteCloudPlus': true,
  'ns.foundation.sandboxAccount': 'BOTH',
  'ns.foundation.fullUserCount': 85,
  'ns.foundation.essUserCount': 240,
  'ns.foundation.customRolesRequired': true,
  'ns.foundation.ssoInScope': true,
  'ns.foundation.primaryCountry': 'US',
  'ns.foundation.fiscalYearStart': '01-01',
  'ns.foundation.multiBookAccounting': true,
  'ns.foundation.advancedRevRecInScope': true,
  'ns.foundation.subsidiaryCount': 4,
  'ns.foundation.subsidiaryList':
    'Atlas Industries Group Inc., US, USD, parent\n' +
    'Atlas Manufacturing UK Ltd., GB, GBP, Atlas Industries Group Inc.\n' +
    'Atlas Trading Pty., AU, AUD, Atlas Industries Group Inc.\n' +
    'Atlas Services GmbH, DE, EUR, Atlas Industries Group Inc.',
  'ns.foundation.multiCurrencyInScope': true,
  'ns.foundation.eliminationEntity': 'Atlas Group Eliminations',

  // NS Pack 2 — Tax Engine (SuiteTax)
  'ns.tax.engine': 'SUITETAX',
  'ns.tax.itemPriceMode': 'EXCLUSIVE',
  'ns.tax.defaultSalesTaxCode': 'CA-Sales-Tax 7.25%',
  'ns.tax.defaultPurchaseTaxCode': 'CA-Use-Tax 7.25%',
  'ns.tax.nexusList':
    'Atlas Industries Group Inc. | US/CA\n' +
    'Atlas Industries Group Inc. | US/NY\n' +
    'Atlas Industries Group Inc. | US/TX\n' +
    'Atlas Manufacturing UK Ltd. | GB\n' +
    'Atlas Trading Pty. | AU\n' +
    'Atlas Services GmbH | DE',
  'ns.tax.taxReportingFramework':
    'US Tax Reports\nUK MTD VAT\nEU SAF-T (Germany)\nAU BAS Reports',
  'ns.tax.einvoicingMandatory': 'YES',
  'ns.tax.einvoicingSuiteApp':
    'Germany: ZUGFeRD/XRechnung — partner SuiteApp\n' +
    'Italy (future EU branch): SDI Localization SuiteApp',
  'ns.tax.withholdingInScope': true,
  'ns.tax.reverseChargeInScope': true,
  'ns.tax.useTaxInScope': true,
  'ns.tax.taxExemptCustomers': true,
  'ns.tax.filingPeriodicity': 'MIXED',
  'ns.tax.multiJurisdictionReporting': true,
  'ns.tax.salesTaxAutomation': true,
  'ns.tax.salesTaxAutomationProvider': 'Avalara AvaTax',

  // Pack D — Tax code matrix. Format: '<jurisdiction>: <type>: <rate>%: <name>'.
  // Starter library auto-supplements common rates for jurisdictions in
  // nexusList (GB Standard/Reduced/Zero, AU GST 10%, DE 19%/7%, etc.) so
  // we only need to declare the US-state-specific lines here.
  'ns.tax.taxCodeMatrix':
    'US/CA: SALES_TAX: 7.25: California State Sales Tax\n' +
    'US/CA: SALES_TAX: 9.5: California Local Sales Tax (LA County)\n' +
    'US/NY: SALES_TAX: 4: New York State Sales Tax\n' +
    'US/NY: SALES_TAX: 8.875: New York City Sales Tax\n' +
    'US/TX: SALES_TAX: 6.25: Texas State Sales Tax\n' +
    'US/TX: SALES_TAX: 8.25: Texas Local Sales Tax (Dallas)\n' +
    'US: USE_TAX: 7.25: California Use Tax (out-of-state purchases)\n' +
    'GB: REVERSE_CHARGE: 0: UK Reverse Charge (intra-EU services)\n' +
    'DE: REVERSE_CHARGE: 0: Germany Reverse Charge (intra-EU)\n' +
    'GB: WITHHOLDING: 20: UK CIS Withholding (construction services)',

  // Pack D — Tax schedule matrix. Wires tax codes to transactions per
  // nexus. Generator finds matching emitted tax code by display-name
  // substring + jurisdiction.
  'ns.tax.taxScheduleMatrix':
    'Sales Order: California State Sales Tax: US/CA\n' +
    'Sales Order: New York State Sales Tax: US/NY\n' +
    'Sales Order: Texas State Sales Tax: US/TX\n' +
    'Invoice: California State Sales Tax: US/CA\n' +
    'Invoice: New York State Sales Tax: US/NY\n' +
    'Purchase Order: California Use Tax: US\n' +
    'Vendor Bill: VAT 20% UK Standard: GB\n' +
    'Vendor Bill: VAT 19% Germany Standard: DE\n' +
    'Sales Order: GST 10% AU Standard: AU\n' +
    'Vendor Bill: GST 10% AU Standard: AU',

  // NS Pack 3 — Localization & SuiteSuccess
  'ns.localization.bundlePerSubsidiary':
    'Atlas Industries Group Inc. | US (SuiteSuccess Wholesale Distribution)\n' +
    'Atlas Manufacturing UK Ltd. | UK (SuiteSuccess Manufacturing)\n' +
    'Atlas Trading Pty. | Australia (SuiteSuccess Wholesale Distribution)\n' +
    'Atlas Services GmbH | Germany (SuiteSuccess Services)',
  'ns.localization.coaCustomScope':
    'Add: 2350-Withholding Tax Payable (DE-only)\n' +
    'Add: 1490-Inventory in Transit (Group)\n' +
    'Rename: 4100 → Wholesale Revenue\n' +
    'Add: 2360-VAT Reverse Charge Output (UK + DE)',
  'ns.localization.countrySpecificGlAccounts': true,
  'ns.localization.fiscalCalendarPerSubsidiary': false,
  'ns.localization.statutoryReports':
    'US: 1099-NEC, 1099-MISC, FBAR, Form 5472\n' +
    'UK: VAT 100, Corporation Tax CT600, P11D\n' +
    'AU: BAS, IAS, FBT, Payroll Tax\n' +
    'DE: USt-VA, ZM (recapitulative statement), ELSTER',
  'ns.localization.taxReportingSuiteApps':
    'US Tax Reports\n' +
    'UK MTD VAT (Making Tax Digital)\n' +
    'EU SAF-T (Germany)\n' +
    'Australia BAS Reports',
  'ns.localization.auditTrailRequired': true,
  'ns.localization.periodLockPerSubsidiary': true,
  'ns.localization.dataResidencyRequired': true,
  'ns.localization.dataResidencyJurisdiction': 'European Union',
  'ns.localization.gdprApplicable': true,
  'ns.localization.dpaSignedWithNetsuite': 'YES',
  'ns.localization.uiLanguages':
    'en — English\n' +
    'de — German\n' +
    'fr — French',
  'ns.localization.languagesPerSubsidiary':
    'Atlas Industries Group Inc. | en\n' +
    'Atlas Manufacturing UK Ltd. | en\n' +
    'Atlas Trading Pty. | en\n' +
    'Atlas Services GmbH | de',
  'ns.localization.localizationSuiteApps':
    'EU SAF-T Germany — partner SuiteApp\n' +
    'Germany ZUGFeRD/XRechnung e-invoicing — partner SuiteApp',
  'ns.localization.customLocalizationDev': false,

  // NS SD Depth Pack — Solution Design — Architecture
  'ns.design.architecturePattern': 'SUITECLOUD_IPAAS',
  'ns.design.customUiScope': 'MODERATE',
  'ns.design.scriptingScope':
    'User Event scripts on Sales Order (subsidiary auto-defaulting + ARM trigger)\n' +
    'Map/Reduce script for monthly accruals across all 4 subsidiaries\n' +
    'RESTlet for Salesforce → NetSuite customer master sync (hourly)\n' +
    'Workflow Action scripts for $25k+ approval routing on POs and Bills\n' +
    'Suitelet for consolidated AR aging dashboard (multi-subsidiary)',
  'ns.design.reportingPlatform': 'MIXED',

  // Pack F — KPI catalog drives the saved-search generator beyond
  // the universal starter library. Format: "<workstream>: <name>: <desc>".
  'ns.design.kpiCatalog':
    'P2P: Open PO Count: count of POs not yet received\n' +
    'P2P: PO Spend by Vendor: total committed spend YTD by vendor\n' +
    'O2C: AR Aging > 60 Days: customer balances over 60 days\n' +
    'O2C: New Customer Adds: customers created in the last 30 days\n' +
    'R2R: Trial Balance by Subsidiary: TB rolled up per subsidiary\n' +
    'R2R: JE Audit Trail: journal entries posted in the last 7 days\n' +
    'MFG: Open Production Orders: assembly builds not yet completed\n' +
    'INV: Lots Expiring 30 Days: items with lot expiry < 30 days out',

  // Pack F — Role-specific dashboards. Each line "<role>: <KPIs>"
  // emits one publisheddashboard XML wired to NetSuite's role-aware
  // Center (ACCOUNTING_CENTER for finance, SALES_CENTER for sales,
  // INVENTORY_CENTER for ops, EXECUTIVE_CENTER for C-suite, etc.).
  'ns.design.roleDashboards':
    'CFO: Trial Balance, AR Aging, Open AR, Top Customers\n' +
    'AP Clerk: Pending Bills, Open PO\n' +
    'AR Clerk: AR Aging, Open AR, Top Customers\n' +
    'Sales Manager: Top Customers, Open Sales Orders, New Customer Adds\n' +
    'Inventory Manager: Inventory Variance, Lots Expiring, Open Production Orders',
  'ns.design.customRecords':
    'Approval Tracker (custom record — captures full chain per transaction)\n' +
    'Vendor Onboarding Request (workflow-driven; replaces current spreadsheet)\n' +
    'Project Milestone (links Project + Sales Order + Revenue Element)\n' +
    'Intercompany Transfer Request (drives auto-mirror on counterpart entity)\n' +
    'Tax Filing Calendar (per nexus, per period; tracks filed/due dates)',

  // Pack K — overlay layer for business fields the smart starter
  // detector doesn't infer. Format: "<record>: <label>: <type>".
  // Type tokens: TEXT / TEXTAREA / CHECKBOX / DATE / CURRENCY / NUMBER /
  // SELECT / EMPLOYEE / TRANSACTION / SUBSIDIARY.
  'ns.design.customRecordExtraFields':
    'Approval Tracker: Approval Tier: SELECT\n' +
    'Approval Tracker: Routed To: EMPLOYEE\n' +
    'Vendor Onboarding Request: Risk Rating: SELECT\n' +
    'Vendor Onboarding Request: Compliance Sign-off: EMPLOYEE\n' +
    'Project Milestone: Deliverable Owner: EMPLOYEE\n' +
    'Project Milestone: Estimated Cost: CURRENCY\n' +
    'Intercompany Transfer Request: Tax Treatment: SELECT\n' +
    'Tax Filing Calendar: Reviewer: EMPLOYEE',
  'ns.design.customFieldsScope':
    'Customer record: 6 custom fields (Tier, Industry, KAM, Renewal Date, Payment Terms Override, Tax Exemption Status)\n' +
    'Sales Order: 8 custom fields (Project Reference, Renewal Type, Margin Override, ARM Trigger, Shipping Priority, EU Reverse-Charge Flag, Subsidiary Source, External Order ID)\n' +
    'Item: 5 custom fields (Tier-Pricing Override, ASC-606 Performance Obligation Type, Standard Cost Variance Account, Subsidiary Restriction, Hazmat Class)\n' +
    'Vendor record: 4 custom fields (1099 Withholding Class, Approved Tier, Audit Score, Last Compliance Review Date)\n' +
    'Employee record: 3 custom fields (Cost Center, Department Hierarchy, Time-Entry Approver Override)',
  'ns.design.masterDataOwnership':
    'Customers: Sales Operations Manager (group level — single master across all 4 subs)\n' +
    'Items: Inventory Manager per subsidiary (federated — each sub owns its catalog)\n' +
    'Vendors: Procurement Manager (group level — shared across subs to leverage volume pricing)\n' +
    'COA: Finance Director (group level — mastered in NetSuite, no external source)\n' +
    'Employees: HR Director per subsidiary (federated — local labour-law compliance)\n' +
    'Tax codes: AvaTax (auto-synced; no manual mastering)',
  'ns.design.referenceDataSources':
    'Currencies: Daily auto-pull from oanda.com via SuiteScript (5 AM UTC)\n' +
    'Tax codes: Avalara AvaTax (real-time lookup at transaction)\n' +
    'COA: Mastered in NetSuite, no external source\n' +
    'Bank accounts: Plaid integration (sync nightly)\n' +
    'Country / state lists: NetSuite native (no external source)\n' +
    'Industry codes: NAICS (mastered in NetSuite, refreshed annually)',
  'ns.design.standardRoleCustomization':
    'A/P Clerk: remove "Approve Bills" permission (split into separate Approver role)\n' +
    'A/R Clerk: add "Manage Customer Refunds" permission, scope to home subsidiary\n' +
    'Sales Manager: add per-subsidiary scoping (currently full-tenant access)\n' +
    'Inventory Manager: add "Adjust Inventory" but cap to ±$5k per single adjustment\n' +
    'Custom Group Auditor role: read-only across all 4 subsidiaries + audit log access\n' +
    'Custom Tax Specialist role: SuiteTax + ZATCA SuiteApp + Tax Reporting Framework only',
  'ns.design.sodMatrixRequired': true,
  'ns.design.fieldLevelSecurity': true,
  'ns.design.auditLogRetentionMonths': 120,
  'ns.design.inboundIntegrations':
    'Salesforce | customer master | hourly | Boomi process\n' +
    'Shopify | sales orders + product catalog | real-time | Celigo connector\n' +
    'Plaid | bank statement reconciliation | nightly | Boomi process\n' +
    'Concur | T&E expense reports | daily batch | RESTlet\n' +
    'ADP | payroll journal entries | bi-weekly | Boomi process\n' +
    'External auditor SFTP | adjustment journal entries | quarterly | manual SFTP + RESTlet ingestion',
  'ns.design.outboundIntegrations':
    'Salesforce | invoice status + balance updates | hourly | Boomi process\n' +
    'Power BI | finance dashboard data extracts | daily | SuiteAnalytics Connect\n' +
    'Avalara | tax-code lookup | real-time | native NetSuite connector\n' +
    'Bank wire systems (UAE/UK/AU/DE) | payment files | per-payment-run | SFTP + custom format per bank\n' +
    'EDI vendors (top-3 customers) | invoice + ASN | per-transaction | iPaaS-mediated EDI 810/856',
  'ns.design.ipaasInScope': 'BOOMI',
  'ns.design.apiGovernance':
    'Rate limit: 600 req/min per integration role (NetSuite default 1000 req/min, leave headroom)\n' +
    'Monitoring: Datadog APM + email alerts on >5% error rate over 15-min window\n' +
    'Retry: exponential backoff up to 3 attempts then dead-letter queue\n' +
    'Authentication: TBA (Token-Based Authentication) only — no user/password integration\n' +
    'Logging: all integration payloads logged to S3 with 30-day retention for debugging',

  // R2R — multi-entity + multi-currency + intercompany. Drives the
  // matching UAT scenarios in buildTestCases (each true-flag triggers
  // one row in the UAT plan).
  'r2r.entities.multiEntity': true,
  'r2r.currencies.isMultiCurrency': true,
  'r2r.currencies.autoExchangeRateUpdate': true,
  'r2r.journalEntries.intercompanyJE': true,
  'r2r.fiscalClose.hardClose': true,
  // P2P — PO approval routing. Drives the SuiteScript UE generator. The
  // legacy approvalThresholds TABLE captures the same intent for the
  // consultant-facing UI; this TEXTAREA is the generator-friendly form
  // that lets ERPLaunch emit a deployable approval script with the
  // actual thresholds wired from day one.
  'p2p.purchasing.usePurchaseOrders': true,
  'p2p.purchasing.poApprovalRequired': true,
  'p2p.receiving.formalReceiving': true,
  'p2p.receiving.threeWayMatch': true,
  'p2p.bills.billApprovalRequired': true,
  'p2p.expenses.employeeExpenses': true,
  'p2p.payments.bankFileExport': true,
  'p2p.purchasing.poApprovalTiers':
    '<$5,000: auto-approve\n' +
    '$5,000-$50,000: Department Manager\n' +
    '$50,000-$250,000: VP Operations\n' +
    '>$250,000: CFO + Steering',

  // O2C — credit limits, multi-currency pricing, fulfilment, ARM.
  'o2c.customers.creditLimits': true,
  'o2c.pricing.foreignCurrencyPricing': true,
  'o2c.salesOrders.soApprovalRequired': true,
  'o2c.fulfillment.pickPackShip': true,
  'o2c.fulfillment.multipleLocations': true,
  'o2c.invoicing.revenueRecognition': true,
  'o2c.collections.dunningLetters': true,

  // MFG — full WIP/Routings + outsourcing + demand planning.
  'mfg.productionFlow.type': 'WIP_ROUTINGS',
  'mfg.productionFlow.trackLabor': true,
  'mfg.bom.multiBom': true,
  'mfg.outsourced.useOutsourced': true,
  'mfg.demand.useDemandPlanning': true,

  // RTN — full RMA + restocking + vendor returns.
  'rtn.customerReturns.useRMA': true,
  'rtn.processing.restockingFees': true,
  'rtn.processing.feePercentage': 15,
  'rtn.vendorReturns.useVendorRMA': true,

  // Pack W — APPROVALS flow. Multi-workflow scope drives the SuiteFlow
  // workflow XMLs + Workflow Action scripts. Atlas covers the full
  // sweep: PO + JE + VB + Expense + SO + 2 record state workflows.
  'ns.approvals.poApprovalInScope': true,
  'ns.approvals.poApprovalTiers':
    '<$5,000: auto-approve\n' +
    '$5,000-$50,000: Department Manager\n' +
    '$50,000-$250,000: VP Operations\n' +
    '>$250,000: CFO + Steering',
  'ns.approvals.jeApprovalInScope': true,
  'ns.approvals.jeApprovalTiers':
    '<$10,000: auto-approve\n' +
    '$10,000-$100,000: Controller\n' +
    '>$100,000: CFO',
  'ns.approvals.vbApprovalInScope': true,
  'ns.approvals.vbApprovalTiers':
    '<$5,000: auto-approve\n' +
    '$5,000-$50,000: AP Manager\n' +
    '>$50,000: CFO',
  'ns.approvals.expenseApprovalInScope': true,
  'ns.approvals.expenseApprovalTiers':
    'Standard: Manager → Director\n' +
    'Over $5,000: Manager → Director → CFO',
  'ns.approvals.soApprovalInScope': true,
  'ns.approvals.soApprovalTrigger':
    'Customer over credit limit\n' +
    'Discount > 15%\n' +
    'Order total > $250,000',
  'ns.approvals.recordStateWorkflowsInScope': true,
  'ns.approvals.recordStateWorkflows':
    'Approval Tracker: New, In Review, Approved, Rejected\n' +
    'Vendor Onboarding Request: Submitted, Under Review, Approved, Active, Suspended',
  'ns.approvals.notificationCadence': 'IMMEDIATE',
  'ns.approvals.escalationDays': 3,

  // Pack T — TESTING flow (cross-platform — same answer keys as Odoo).
  // Atlas exercises 12 scenarios across R2R/P2P/O2C/MFG/RTN + 6 perf
  // benchmarks + 6 regression smoke scenarios + 5 test roles.
  'testing.scope.scenariosPerWorkstream':
    'R2R: Period close: Run month-end close for fiscal period; verify all journals posted across all 4 subsidiaries\n' +
    'R2R: Trial balance: Generate consolidated TB across 4 subsidiaries; verify drilldown to source JEs\n' +
    'R2R: Intercompany JE: Create intercompany journal entry; verify auto-mirror on counterpart entity\n' +
    'P2P: PO approval routing: Create PO at each tier ($5k / $50k / $250k / >$250k); verify correct approver\n' +
    'P2P: PO three-way match: Receive against PO + enter bill; verify match status + GL impact\n' +
    'P2P: Vendor bill approval: Submit bill above $50k; verify CFO approval routing\n' +
    'O2C: SO with deep discount: Create SO with >15% discount; verify SO approval workflow triggers\n' +
    'O2C: Invoice with rev rec: Create invoice with deferred revenue schedule; verify ASC 606 posting\n' +
    'O2C: AR aging dunning: Trigger dunning letter at 60-day overdue; verify customer record + email\n' +
    'MFG: Work order completion: Release WO for WIP item; consume components; complete production; verify variance\n' +
    'MFG: Multi-BOM: Build assembly using alternate BOM revision; verify costing\n' +
    'RTN: Customer RMA: Create RMA against historic invoice; receive return; verify Credit Memo + restocking fee',
  'testing.scope.testRoles':
    'AP Clerk: Test all P2P scenarios (PO + bill + 3-way match)\n' +
    'AR Clerk: Test all O2C scenarios (SO + invoice + dunning + RMA)\n' +
    'Inventory Manager: Test all MFG + RTN scenarios (WO + RMA + adjustments)\n' +
    'Priya Patel (ARM): Sign off on revenue recognition + ASC 606 scenarios\n' +
    'Helena Reyes (CFO): Sign off on consolidated reports + final UAT gate',
  'testing.scope.acceptanceCriteriaTemplate': 'GHERKIN',
  'testing.performance.performanceBenchmarks':
    'PO creation end-to-end: <2 seconds\n' +
    'Trial balance generation across 4 subsidiaries: <30 seconds\n' +
    'Inventory query 50k SKUs: <5 seconds\n' +
    'Period close batch (full reval + ARM + intercompany eliminations): <20 minutes\n' +
    'Consolidated AR aging across all 4 subsidiaries: <8 seconds\n' +
    'Saved search (AR aging > 60 days, full tenant): <6 seconds',
  'testing.performance.loadProfile':
    'Peak: 85 internal users + 240 ESS users (month-end close window)\n' +
    'Steady: 60 internal users + 120 ESS users (daily ops)\n' +
    'Off-peak: 10 internal users (overnight scheduled scripts + integrations)',
  'testing.regression.regressionSmokeScenarios':
    'Login as each role: User can log in + lands on correct center (ACCOUNTING / SALES / etc.)\n' +
    'Create PO + approve: PO routes through approval workflow correctly per amount-tier policy\n' +
    'Create SO + invoice: Invoice generated; ARM schedule attached; AR balance increases\n' +
    'Run TB report: Trial balance balances per subsidiary + consolidated within 30s\n' +
    'Run AR aging > 60 days saved search: returns within 6s with correct count\n' +
    'Trigger PO User Event script: required-approver field populates correctly per tier',
  'testing.regression.defectSeverityLevels': 'STANDARD_4_LEVEL',

  // Pack U — TRAINING flow (cross-platform). Atlas exercises 5 roles
  // across the major workstreams + 3 champions + 4 sessions; HYBRID
  // cascade with LIVE_DEMO assessment.
  'training.curriculum.trainingPerRole':
    'AP Clerk: Vendor Bill Entry, 3-Way Match, Payment Run, Voucher Approval Workflow\n' +
    'AR Clerk: Customer Invoice Creation, Cash Application, Dunning Letters, AR Aging\n' +
    'CFO: Trial Balance Export, Multi-Subsidiary Close, Financial Statements, Multi-Currency Revaluation\n' +
    'Sales Manager: Lead-to-Quote, Sales Order Entry, Pricelist Management, Pipeline Reports\n' +
    'Inventory Manager: Item Master Setup, Cycle Count, Lot/Serial Tracking, Warehouse Transfer',
  'training.curriculum.businessChampions':
    'Sophie Müller: Workstream Lead — EU subsidiaries (UK + DE) — accounting champion\n' +
    'Tom Wilson: Workstream Lead — US + AU subsidiaries — operations champion\n' +
    'Priya Patel: Workstream Lead — Revenue Recognition (ARM) — ARM champion',
  'training.curriculum.cascadeStrategy': 'HYBRID',
  'training.schedule.trainingSessions':
    'P2P End-to-End: 4 hours: AP Clerk + Buyer + Sophie Müller\n' +
    'Multi-Subsidiary Close + ASC 606 Reporting: 4 hours: CFO + Priya Patel + Sophie Müller\n' +
    'O2C + ARM Revenue Recognition: 3 hours: AR Clerk + Sales Manager + Priya Patel\n' +
    'Inventory + WIP Routings + Manufacturing: 4 hours: Inventory Manager + Tom Wilson',
  'training.schedule.deliveryMode': 'HYBRID',
  'training.assessment.assessmentRequired': true,
  'training.assessment.assessmentFormat': 'LIVE_DEMO',

  // Pack V — CUTOVER flow (cross-platform). Atlas exercises BIG_BANG
  // cutover with 48h window, 7-person team across 4 subsidiaries,
  // 3 dry runs.
  'cutover.team.cutoverTeamRoster':
    'Hesham Aglan: Consultant PM (overall command): T-1 → T+5 days continuous\n' +
    'David Chen: Client PM: T-1 → T+5 days\n' +
    'Sarah Chen: Migration lead — financials: T0 → T+2 days continuous\n' +
    'Mostafa Sherif: IT lead — OneWorld + integrations: T-1 → T+2 days\n' +
    'Sophie Müller: Functional lead — EU subsidiaries: T0 → T+5 days\n' +
    'Tom Wilson: Functional lead — US + AU subsidiaries: T0 → T+5 days\n' +
    'Priya Patel: Functional lead — Revenue Recognition / ARM: T0 → T+3 days',
  'cutover.team.dryRunCount': 3,
  'cutover.team.dryRunDates':
    'Dry Run 1: 2026-09-13: Data migration only — extract + transform + load across all 4 subsidiaries\n' +
    'Dry Run 2: 2026-10-04: Full end-to-end with users — multi-currency consolidation focus\n' +
    'Dry Run 3: 2026-10-25: Final rehearsal — identical to production',
  'cutover.decisions.goNoGoCriteria':
    'Migration tie-out: 100% TB match across all 4 subsidiaries\n' +
    'Smoke test pass rate: 100% of P0 scenarios green\n' +
    'No Critical defects open: zero\n' +
    'Performance benchmarks: all met under simulated peak load (per Performance_Test_Plan)\n' +
    'ASC 606 reporting: revenue schedules tie to legacy snapshot per subsidiary\n' +
    'Multi-currency revaluation: reval entries match legacy + variance < $0.01\n' +
    'Custom workflows deployed: all 7 SuiteFlow workflows active + tested',
  'cutover.decisions.goNoGoOwners':
    'Migration data: Sarah Chen (Migration lead)\n' +
    'Functional readiness — financials: Sophie Müller (EU lead)\n' +
    'Functional readiness — operations: Tom Wilson (US/AU lead)\n' +
    'Revenue recognition: Priya Patel (ARM lead)\n' +
    'Technical readiness: Hesham Aglan (Consultant PM)\n' +
    'Final go/no-go: Helena Reyes (CFO / Sponsor)',
  'cutover.decisions.rollbackTriggers':
    'Critical defect found in core finance flow with no workaround\n' +
    'Migration tie-out fails for >1% of records and cannot be reconciled within 2h\n' +
    'NetSuite production unavailable for >30 min during cutover window\n' +
    'ASC 606 revenue recognition consolidation fails to balance and root cause not identified within 4h\n' +
    'SDF deploy fails on any of the 4 subsidiary configurations',
  'cutover.communication.cutoverMilestones':
    'Pre-freeze starts: All users + Sponsor\n' +
    'Cutover begins: Steering + Sponsor + Department Heads + Auditor (KPMG)\n' +
    'Migration complete: Steering + IT\n' +
    'Smoke pass / go declared: All users + Sponsor + Sales channel + Auditor\n' +
    'Day 1 hypercare check-in: Steering + IT\n' +
    'Day 7 hypercare review: Steering + Sponsor\n' +
    'Day 30 hypercare exit: All stakeholders + Auditor sign-off',
  'cutover.communication.escalationContacts':
    'Robert Atlas (Group CEO): only if rollback triggered\n' +
    'NetSuite Customer Care (SuiteCloud Plus): if SDF deploy fails or platform issue exceeds 30 min\n' +
    'Avalara support: if tax-engine integration fails during cutover\n' +
    'Banking partners (US + UK + AU + DE): if intercompany payment files fail\n' +
    'External auditor (KPMG): if SOX walkthrough triggered or ASC 606 issues persist',

  // Pack X — HYPERCARE flow (cross-platform). Atlas exercises a 30-day
  // hypercare with a 5-person team, full STANDARD_4_LEVEL severity,
  // KSA + EU + US business hours coverage.
  'hypercare.team.hypercareLeadName': 'Hesham Aglan',
  'hypercare.team.hypercareTeamRoster':
    'Hesham Aglan | Hypercare Lead — Consultant PM | Mon-Fri 09:00-18:00 GMT (24h on-call rotation T+1 to T+10) | +44-7700-xxx-3001\n' +
    'Sarah Chen | NetSuite Functional Lead — Financials + ARM | Mon-Fri 09:00-18:00 EST | +1-617-xxx-3002\n' +
    'Mostafa Sherif | OneWorld Integration Engineer | Mon-Fri 09:00-18:00 GMT | +44-7700-xxx-3003\n' +
    'Sophie Müller | Power-User Coach — EU subsidiaries (UK + DE) | Mon-Fri 09:00-18:00 CET | +49-30-xxx-3004\n' +
    'Tom Wilson | Power-User Coach — US + AU subsidiaries | Mon-Fri 09:00-18:00 EST + occasional SYD | +1-617-xxx-3005',
  'hypercare.team.sustainmentOwner':
    'Atlas IT Shared Services — David Chen (VP Finance Transformation, transitioning to ongoing IT lead) + 4-person internal team',
  'hypercare.sla.hypercareDurationDays': 30,
  'hypercare.sla.severityDefinitions':
    'S1 | Production halted, no workaround | Period close blocked across any subsidiary, ARM revenue recognition broken, multi-currency consolidation broken\n' +
    'S2 | Major function impaired, workaround exists | Reports broken, batch job failing, integration retry queue growing\n' +
    'S3 | Minor function impaired or single-user | Field validation issue, single user permission gap, workflow misroute on edge case\n' +
    'S4 | Cosmetic or enhancement | Label typo, dashboard color, dropdown sort order',
  'hypercare.sla.responseTimeBySeverity':
    'S1 | 15 minutes | 4 hours\n' +
    'S2 | 1 business hour | 1 business day\n' +
    'S3 | 1 business day | 5 business days\n' +
    'S4 | 5 business days | Backlog (next quarterly review)',
  'hypercare.sla.businessHoursDefinition':
    'Mon-Fri 09:00-18:00 (per timezone of each team member). 24h on-call rotation for S1 incidents during T+1 to T+10. After T+10, S1 on-call only during business hours of any team member.',
  'hypercare.cadence.dailyStandupTime':
    '14:00 GMT daily (08:00 EST / 09:00 EDT / 16:00 CET / 23:00 SYD — covers all team timezones)',
  'hypercare.cadence.weeklyReviewTime':
    'Thu 15:00 GMT (09:00 EST — covers US + EU + Sponsor)',
  'hypercare.cadence.warRoomHours':
    'T+1 to T+10: full team in war-room with timezone overlap maintained 09:00-22:00 GMT (US + EU + AU coverage). T+11 to T+20: war-room 14:00-18:00 GMT (overlap window only). T+21 to T+30: standup-only, async on Teams.',
  'hypercare.cadence.hypercareExitCriteria':
    'Zero S1 open for 5 consecutive business days\n' +
    'Zero S2 open more than 5 business days\n' +
    'First month-end close completed within 5 business days across all 4 subsidiaries\n' +
    'ASC 606 revenue recognition validated for full month with auditor sign-off\n' +
    'Multi-currency revaluation completed correctly for first month-end\n' +
    'Integration retry queue depth < 5 for 5 consecutive business days (all integrations)\n' +
    'User adoption ≥ 90% of named users posting at least 1 transaction in trailing 7 days\n' +
    'Project Sponsor (Helena Reyes) sign-off captured\n' +
    'External auditor (KPMG) interim review passed',

  // Pack Y — STABILIZATION flow (cross-platform). Atlas exercises a
  // 6-person committee, 7-row business case, half-day retro pattern.
  'stabilization.governance.stabilizationOwner':
    'Atlas IT Shared Services — David Chen (Director, Enterprise Systems)',
  'stabilization.governance.governanceCommittee':
    'David Chen | Director, Enterprise Systems | IT chair\n' +
    'Helena Reyes | CFO | Finance + sponsor\n' +
    'Mark Patterson | COO | Operations\n' +
    'Sarah Chen | NetSuite Functional Lead | Consultant continuity\n' +
    'Mostafa Sherif | Integration Engineer | IT delivery\n' +
    'Lara Mansour | NetSuite Account Executive | Vendor',
  'stabilization.governance.decisionCadence':
    'Monthly steering committee (last Thursday), quarterly business review (first month of new quarter), annual board readout',
  'stabilization.governance.changeRequestProcess':
    'Submit via ServiceNow form "NetSuite CR"\n' +
    'Triage at weekly IT-functional huddle (every Monday)\n' +
    'Estimate by consultant lead within 5 business days\n' +
    'Prioritize at monthly steering\n' +
    'Build in next available release wave (2027.1 or 2027.2)\n' +
    'Release with mandatory regression test pack',
  'stabilization.benefits.businessCaseSummary':
    'Close cycle days | 11 | 5 | T+180\n' +
    'Audit prep hours | 600 | 240 | T+270\n' +
    'Manual JE count per period | 250 | 60 | T+180\n' +
    'Days-payable-outstanding | 38 | 45 | T+180\n' +
    'Days-sales-outstanding | 62 | 50 | T+270\n' +
    'Headcount avoided in finance ops | 0 | 4 FTE | T+360\n' +
    'Multi-currency revaluation runtime | 4h | 30min | T+90',
  'stabilization.benefits.benefitsReviewCadence':
    'Quarterly to steering committee, annual to board',
  'stabilization.benefits.benefitsReviewOwner':
    'Helena Reyes (CFO) — accountable; David Chen (IT) — measurement support',
  'stabilization.backlog.deferredFeatures':
    'Bank statement auto-reconciliation | Pilot scope | T+90 enhancement\n' +
    'Approval delegation rules | Pilot scope | T+90 enhancement\n' +
    'Vendor onboarding workflow extension | Phase 2 | T+180\n' +
    'Project costing for capex projects | Phase 2 | T+270\n' +
    'Advanced revenue recognition for SaaS deals | Phase 2 | T+360',
  'stabilization.backlog.knownLimitations':
    'Multi-currency reval batch must be run sequentially per entity | run sequentially | temporary, fixing in 2027.2\n' +
    'UK VAT report does not auto-include reverse-charge transactions | manual reclass JE | permanent, by-design\n' +
    'Australia GST BAS export only quarterly | manual export for monthly internal | permanent',
  'stabilization.backlog.phaseTwoScope':
    'WhatsApp supplier portal | Reduce email volume by ~40% | T+180\n' +
    'Fixed asset module rollout | Replace separate FA spreadsheet, ~80 hrs/period saved | T+270\n' +
    'Intercompany automation enhancement | Eliminate 30+ manual IC entries per period | T+270\n' +
    'Mobile expense capture | Replace legacy expense tool | T+360',
  'stabilization.learning.retroFormat':
    'Half-day workshop with project + business + ops + sponsor (in-person at Atlas HQ Boston)',
  'stabilization.learning.retroDate':
    'T+45 — first Friday of month following hypercare exit (i.e. ~2027-01-30)',
  'stabilization.learning.lessonsLearnedSeed':
    'Scope discipline | Approval delegation deferred late | Reduced finance approval bottleneck risk | Bring delegation forward in phase-two estimating\n' +
    'Data quality | Vendor master had 12% duplicates pre-cutover | Migration window extended 8 hours | Add proactive dedup pass to standard playbook\n' +
    'Sponsor engagement | Helena attended all UAT sign-offs | Approvals moved fast, ambiguity resolved same-day | Replicate exec-attendance pattern for phase 2',

  // ── Pack Z — Data Migration Assets (cross-platform) ─────────────────────────
  // Atlas migrates from a heterogeneous landscape: QuickBooks Online (US +
  // AU subsidiaries), Sage 50 (UK), and legacy Microsoft Dynamics GP (DE).
  // Customer master is partly in Salesforce. Inventory + opening balances
  // are spread across all four sources.
  'migration.details.sourceSystemsByObject':
    'Customers | Salesforce (account object) + QuickBooks Online (Customer Centre) | Salesforce is system-of-record for B2B contacts; QBO holds shipping addresses\n' +
    'Vendors | QuickBooks Online (Vendor Centre) + Sage 50 (UK) + Dynamics GP (DE) | Three sources, single golden record needed; tax IDs live in different fields per source\n' +
    'Items | NetSuite (already loaded for SKU master) + QBO (US/AU pricing) | Pricing varies by subsidiary; load NetSuite-format export\n' +
    'Chart of Accounts | Sage 50 (UK natural account hierarchy is canonical) | Other subsidiaries map to UK chart in COA mapping workbook\n' +
    'Open AR Invoices | QBO + Sage 50 + Dynamics GP | All three need to net against credit memos before extract\n' +
    'Open AP Bills | QBO + Sage 50 + Dynamics GP | Same as AR — three sources, net pre-extract\n' +
    'GL Opening Balances | Consolidated trial balance from current consolidation tool | Source-of-truth is the auditor-signed-off trial balance\n' +
    'Inventory Opening Balances | NetSuite warehouse system + Sage 50 stock module | Two-source reconcile; Sage is canonical for UK',
  'migration.details.cleansingRulesByObject':
    'Customers | Trim whitespace; uppercase tax IDs; split combined billing/shipping into two address rows; merge Salesforce + QBO by tax ID + country | Sarah Chen (consultant — finance lead)\n' +
    'Vendors | Trim whitespace; standardise IBAN format; verify SWIFT codes; flag bank accounts changed in last 90 days for fraud review | Mostafa Sherif (consultant — OneWorld + tax)\n' +
    'Items | Standardise UoM codes (Sage uses imperial in some SKUs); convert prices to USD where ledger requires; flag items with zero historical movement for archive | Tom Wilson (Atlas — US/AU lead)\n' +
    'Chart of Accounts | Map all four sub-charts to UK natural-account canonical; flag any non-mapped accounts to controller; verify hierarchy before export | Helena Reyes (Atlas — CFO sign-off)\n' +
    'Open AR / AP | Net invoices against credit memos in source; flag aged > 365 days for write-off review; convert all amounts to subsidiary base currency | Priya Patel (Atlas — Rev Rec lead)\n' +
    'GL Opening Balances | Trial balance must net to zero per subsidiary; intercompany balances must reconcile to elimination subsidiary; auditor sign-off required | Helena Reyes (Atlas — CFO)\n' +
    'Inventory Opening Balances | Reconcile system-of-record between NetSuite WMS + Sage; capture cycle-count adjustments separately; flag negative on-hand for investigation | Sophie Müller (Atlas — EU lead)',
  'migration.details.rejectSlaByObject':
    'Customers | < 0.5% rejects | 24h re-load\n' +
    'Vendors | < 0.5% rejects | 24h re-load\n' +
    'Items | < 1% rejects | 48h re-load\n' +
    'Chart of Accounts | 0 rejects | 4h re-load (financial)\n' +
    'Open AR Invoices | 0 rejects | 4h re-load (financial — must clear before next dry-run)\n' +
    'Open AP Bills | 0 rejects | 4h re-load (financial — must clear before next dry-run)\n' +
    'GL Opening Balances | 0 rejects | 4h re-load (financial — must clear before sign-off)\n' +
    'Inventory Opening Balances | < 0.5% rejects | 24h re-load',
  'migration.details.historicalDataDepth':
    'Current FY 2026 — full detail (open + closed transactions). FY 2024 + FY 2025 — summary balances + selected high-value transactions only (> $50k or > 90d aged). Older — archived in source systems, not migrated. Auditor briefed on data-retention plan.',
  'migration.readiness.dryRunPassThreshold':
    '99.7% records loaded clean across all objects, 0 financial-object rejects (AR / AP / GL), trial balance nets to zero per subsidiary',
  'migration.readiness.dataQualityOwners':
    'Customers | David Chen | Sophie Müller\n' +
    'Vendors | David Chen | Tom Wilson\n' +
    'Items | Tom Wilson | Sophie Müller\n' +
    'Chart of Accounts | Helena Reyes | David Chen\n' +
    'Open AR / AP | Priya Patel | David Chen\n' +
    'GL Opening Balances | Helena Reyes | David Chen\n' +
    'Inventory Opening Balances | Sophie Müller | Tom Wilson',
  'migration.readiness.migrationCutoffDate':
    '2026-11-13 — last business day before go-live; final source extracts pulled at 18:00 EST',

  // Pack Z — flag fixed assets in scope so the FA template + load step ship.
  'ns.design.fixedAssetsScope':
    '~120 assets across 4 subsidiaries: leasehold improvements, office equipment, R&D lab equipment. Straight-line depreciation, 60-month useful life standard. Auditor sign-off on opening NBV required before load.',
};

const comments = [
  {
    sectionKey: 'edition',
    text: 'OneWorld confirmed; all 4 subsidiaries on a single tenant. SuiteCloud Plus required for Concur/Workday integrations + heavy SuiteScript footprint. Both Full-copy and Release Preview sandboxes — auditor expects sandbox-validated change control.',
  },
  {
    sectionKey: 'subsidiaries',
    text: 'Elimination entity created upfront so Phase 4 build sees the full tree. Multi-currency live from day one (USD base, GBP/AUD/EUR transactional).',
  },
];
const images: unknown[] = [];
const aiAdvice: unknown[] = [];
const conflicts: unknown[] = [];

// ── Output folder ───────────────────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const outRoot = path.join(NSIX_ROOT, 'NETSUITE_DEMO_BUNDLE', ts);
const docDir = path.join(outRoot, 'Documentation');
await fs.mkdir(docDir, { recursive: true });

// Engagement project members — drives kickoff Stakeholder Map + RACI auto-fill.
const members: KickoffMember[] = [
  { name: 'Helena Reyes', role: 'Project Sponsor / CFO', team: 'CLIENT', email: 'helena.reyes@atlas-industries.com' },
  { name: 'David Chen', role: 'Project Manager / VP Finance Transformation', team: 'CLIENT', email: 'david.chen@atlas-industries.com' },
  { name: 'Sophie Müller', role: 'Workstream Lead — EU subsidiaries (UK + DE)', team: 'CLIENT', email: 'sophie.mueller@atlas-industries.com' },
  { name: 'Tom Wilson', role: 'Workstream Lead — US + AU subsidiaries', team: 'CLIENT', email: 'tom.wilson@atlas-industries.com' },
  { name: 'Priya Patel', role: 'Workstream Lead — Revenue Recognition (ARM)', team: 'CLIENT', email: 'priya.patel@atlas-industries.com' },
  { name: 'Hesham Aglan', role: 'Consultant Project Manager', team: 'CONSULTANT', email: 'hesham@erplaunch.io' },
  { name: 'Sarah Chen', role: 'Senior NetSuite Consultant — Financials', team: 'CONSULTANT', email: 'sarah@erplaunch.io' },
  { name: 'Mostafa Sherif', role: 'Senior NetSuite Consultant — OneWorld + Tax', team: 'CONSULTANT', email: 'mostafa.s@erplaunch.io' },
];

// ── Generate ────────────────────────────────────────────────────────────────
const brdData = { clientName, adaptor, license, answers, comments, images, aiAdvice };
const kickoffData = { clientName, adaptor, answers, members };
const sddData = { clientName, adaptor, license, answers, conflicts: conflicts as never[], comments, images, aiAdvice };
const trainingData = { clientName, adaptor, answers, comments, images, aiAdvice };
const uatData = { clientName, adaptor, answers, comments, images, aiAdvice };
const planData = { clientName, adaptor, license, answers, conflicts: conflicts as never[] };
const riskData = { clientName, conflicts: [], warnings: [] };

// ── Pack T — Test Artifacts (cross-platform) ────────────────────────────────
const signoffMembers: SignOffMember[] = members.map((m) => ({
  name: m.name,
  role: m.role,
  team: m.team,
}));
const testScriptsResult = generateTestScripts({
  scenariosPerWorkstream: answers['testing.scope.scenariosPerWorkstream'] as string,
  testRoles: answers['testing.scope.testRoles'] as string,
  acceptanceCriteriaTemplate: answers['testing.scope.acceptanceCriteriaTemplate'] as string,
  adaptorName: 'NetSuite',
});
const signOffResult = generateSignOffMatrix({
  clientName,
  scenariosPerWorkstream: answers['testing.scope.scenariosPerWorkstream'] as string,
  testRoles: answers['testing.scope.testRoles'] as string,
  standardRoleCustomization: answers['ns.design.standardRoleCustomization'] as string,
  members: signoffMembers,
  adaptorName: 'NetSuite',
});
const defectLogResult = generateDefectLogTemplate({
  clientName,
  defectSeverityLevels: answers['testing.regression.defectSeverityLevels'] as string,
  adaptorName: 'NetSuite',
});
const perfPlanResult = generatePerformanceTestPlan({
  clientName,
  performanceBenchmarks: answers['testing.performance.performanceBenchmarks'] as string,
  loadProfile: answers['testing.performance.loadProfile'] as string,
  adaptorName: 'NetSuite',
});
const regressionResult = generateRegressionTestSuite({
  clientName,
  regressionSmokeScenarios: answers['testing.regression.regressionSmokeScenarios'] as string,
  adaptorName: 'NetSuite',
});

// ── Pack U — Training Collateral (cross-platform — runs on NetSuite too) ────
const perRoleResult = generatePerRoleTrainingGuides({
  clientName,
  trainingPerRole: answers['training.curriculum.trainingPerRole'] as string,
  // Atlas seed has Pack C standardRoleCustomization populated — feed it
  // into the supplementary role source so all NS roles declared there
  // get a guide even if not repeated in trainingPerRole.
  standardRoleCustomization: answers['ns.design.standardRoleCustomization'] as string,
  cascadeStrategy: answers['training.curriculum.cascadeStrategy'] as string,
  deliveryMode: answers['training.schedule.deliveryMode'] as string,
  assessmentRequired: answers['training.assessment.assessmentRequired'] === true,
  assessmentFormat: answers['training.assessment.assessmentFormat'] as string,
  adaptorName: 'NetSuite',
});
const qrcResult = generateQuickReferenceCards({
  clientName,
  adaptorName: 'NetSuite',
  poApprovalInScope: answers['ns.approvals.poApprovalInScope'] === true,
  multiCurrencyInScope: answers['ns.foundation.multiCurrencyInScope'] === true,
  mfgInScope: Object.keys(answers).some((k) => k.startsWith('mfg.')),
  inventoryInScope: answers['o2c.fulfillment.pickPackShip'] === true,
  customRecords: answers['ns.design.customRecords'] as string,
});
const trainingMatrixResult = generateTrainingMatrix({
  clientName,
  adaptorName: 'NetSuite',
  trainingPerRole: answers['training.curriculum.trainingPerRole'] as string,
  standardRoleCustomization: answers['ns.design.standardRoleCustomization'] as string,
  // Atlas: full sweep across all NS workstreams.
  r2rInScope: true,
  p2pInScope: true,
  o2cInScope: true,
  invInScope: true,
  mfgInScope: true,
  rtnInScope: true,
});
const trainingScheduleResult = generateTrainingSchedule({
  clientName,
  adaptorName: 'NetSuite',
  trainingSessions: answers['training.schedule.trainingSessions'] as string,
  deliveryMode: answers['training.schedule.deliveryMode'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});
const ktResult = generateKnowledgeTransferChecklist({
  clientName,
  adaptorName: 'NetSuite',
  cascadeStrategy: answers['training.curriculum.cascadeStrategy'] as string,
  workstreamsInScope: ['R2R', 'P2P', 'O2C', 'INV', 'MFG', 'RTN'],
  integrationsList: [
    answers['ns.design.inboundIntegrations'] as string,
    answers['ns.design.outboundIntegrations'] as string,
  ]
    .filter((s) => typeof s === 'string' && s.trim().length > 0)
    .join('\n'),
});

// ── Pack V — Cutover Runbook (cross-platform — runs on NetSuite too) ────────
// Atlas: BIG_BANG cutover, 48h window, 4 subsidiaries.
const cutoverWindowHoursAtlas = 48;
const cutoverPreFreezeDaysAtlas = 3;

const runbookResult = generateCutoverRunbook({
  clientName,
  adaptorName: 'NetSuite',
  cutoverStyle: 'BIG_BANG',
  cutoverWindowHours: cutoverWindowHoursAtlas,
  preFreezeDays: cutoverPreFreezeDaysAtlas,
  cutoverTeamRoster: answers['cutover.team.cutoverTeamRoster'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
  dryRunDates: answers['cutover.team.dryRunDates'] as string,
});
const goNoGoResult = generateGoNoGoMatrix({
  clientName,
  adaptorName: 'NetSuite',
  goNoGoCriteria: answers['cutover.decisions.goNoGoCriteria'] as string,
  goNoGoOwners: answers['cutover.decisions.goNoGoOwners'] as string,
  cutoverWindowHours: cutoverWindowHoursAtlas,
});
const rollbackResult = generateRollbackPlan({
  clientName,
  adaptorName: 'NetSuite',
  rollbackTriggers: answers['cutover.decisions.rollbackTriggers'] as string,
  cutoverStyle: 'BIG_BANG',
});
const atlasCutoverRoles = (answers['training.curriculum.trainingPerRole'] as string)
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.length > 0)
  .map((l) => {
    const idx = l.indexOf(':');
    return idx < 0 ? l : l.slice(0, idx).trim();
  });
const smokeResult = generatePostCutoverSmoke({
  clientName,
  adaptorName: 'NetSuite',
  regressionSmokeScenarios: answers['testing.regression.regressionSmokeScenarios'] as string,
  poApprovalInScope: answers['ns.approvals.poApprovalInScope'] === true,
  vbApprovalInScope: answers['ns.approvals.vbApprovalInScope'] === true,
  ssoInScope: answers['ns.foundation.ssoInScope'] === true,
  multiCurrencyInScope: answers['ns.foundation.multiCurrencyInScope'] === true,
  roles: atlasCutoverRoles,
});
const commPlanResult = generateCutoverCommPlan({
  clientName,
  adaptorName: 'NetSuite',
  cutoverMilestones: answers['cutover.communication.cutoverMilestones'] as string,
  escalationContacts: answers['cutover.communication.escalationContacts'] as string,
  cutoverTeamRoster: answers['cutover.team.cutoverTeamRoster'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
  cutoverWindowHours: cutoverWindowHoursAtlas,
});
const dryRunResult = generateDryRunPlan({
  clientName,
  adaptorName: 'NetSuite',
  dryRunCount: answers['cutover.team.dryRunCount'] as number,
  dryRunDates: answers['cutover.team.dryRunDates'] as string,
  cutoverStyle: 'BIG_BANG',
});
const teamRosterResult = generateCutoverTeamRoster({
  clientName,
  adaptorName: 'NetSuite',
  cutoverTeamRoster: answers['cutover.team.cutoverTeamRoster'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});

// ── Pack X — Hypercare Program (cross-platform — runs on NetSuite too) ──────
const hypercareDurationDaysAtlas =
  (answers['hypercare.sla.hypercareDurationDays'] as number) ?? 30;
const atlasIntegrations = [
  answers['ns.design.inboundIntegrations'] as string,
  answers['ns.design.outboundIntegrations'] as string,
]
  .filter((s) => typeof s === 'string' && s.trim().length > 0)
  .join('\n');

const hypercarePlanResult = generateHypercarePlan({
  clientName,
  adaptorName: 'NetSuite',
  hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string,
  hypercareTeamRoster: answers['hypercare.team.hypercareTeamRoster'] as string,
  sustainmentOwner: answers['hypercare.team.sustainmentOwner'] as string,
  hypercareDurationDays: hypercareDurationDaysAtlas,
  severityDefinitions: answers['hypercare.sla.severityDefinitions'] as string,
  responseTimeBySeverity: answers['hypercare.sla.responseTimeBySeverity'] as string,
  businessHoursDefinition: answers['hypercare.sla.businessHoursDefinition'] as string,
  dailyStandupTime: answers['hypercare.cadence.dailyStandupTime'] as string,
  weeklyReviewTime: answers['hypercare.cadence.weeklyReviewTime'] as string,
  warRoomHours: answers['hypercare.cadence.warRoomHours'] as string,
  hypercareExitCriteria: answers['hypercare.cadence.hypercareExitCriteria'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});
const dailyReadinessResult = generateDailyReadinessChecklist({
  clientName,
  adaptorName: 'NetSuite',
  hypercareDurationDays: hypercareDurationDaysAtlas,
  integrationsList: atlasIntegrations,
});
const escalationMatrixResult = generateIssueEscalationMatrix({
  clientName,
  adaptorName: 'NetSuite',
  hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string,
  severityDefinitions: answers['hypercare.sla.severityDefinitions'] as string,
  responseTimeBySeverity: answers['hypercare.sla.responseTimeBySeverity'] as string,
});
const warRoomResult = generateWarRoomSop({
  clientName,
  adaptorName: 'NetSuite',
  hypercareDurationDays: hypercareDurationDaysAtlas,
  warRoomHours: answers['hypercare.cadence.warRoomHours'] as string,
  hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string,
  dailyStandupTime: answers['hypercare.cadence.dailyStandupTime'] as string,
});
const transitionResult = generateTransitionToSupportPlan({
  clientName,
  adaptorName: 'NetSuite',
  sustainmentOwner: answers['hypercare.team.sustainmentOwner'] as string,
  hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string,
  hypercareDurationDays: hypercareDurationDaysAtlas,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});
const kpiDashboardResult = generateHypercareKpiDashboard({
  clientName,
  adaptorName: 'NetSuite',
  hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string,
  integrationsList: atlasIntegrations,
});
const officeHoursResult = generatePowerUserOfficeHours({
  clientName,
  adaptorName: 'NetSuite',
  hypercareDurationDays: hypercareDurationDaysAtlas,
  hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string,
  workstreamsInScope: ['R2R', 'P2P', 'O2C', 'INV', 'MFG', 'RTN', 'IT'],
});

// ── Pack Y — Stabilization Roadmap (cross-platform — runs on NetSuite) ──────
const stabRoadmapResult = generateStabilizationRoadmap({
  clientName,
  adaptorName: 'NetSuite',
  stabilizationOwner: answers['stabilization.governance.stabilizationOwner'] as string,
  governanceCommittee: answers['stabilization.governance.governanceCommittee'] as string,
  decisionCadence: answers['stabilization.governance.decisionCadence'] as string,
  phaseTwoScope: answers['stabilization.backlog.phaseTwoScope'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});
const lessonsResult = generateLessonsLearned({
  clientName,
  adaptorName: 'NetSuite',
  retroFormat: answers['stabilization.learning.retroFormat'] as string,
  retroDate: answers['stabilization.learning.retroDate'] as string,
  lessonsLearnedSeed: answers['stabilization.learning.lessonsLearnedSeed'] as string,
  stabilizationOwner: answers['stabilization.governance.stabilizationOwner'] as string,
});
const benefitsResult = generateBenefitsRealizationTracker({
  clientName,
  adaptorName: 'NetSuite',
  businessCaseSummary: answers['stabilization.benefits.businessCaseSummary'] as string,
  benefitsReviewCadence: answers['stabilization.benefits.benefitsReviewCadence'] as string,
  benefitsReviewOwner: answers['stabilization.benefits.benefitsReviewOwner'] as string,
});
const processBacklogResult = generateProcessImprovementBacklog({
  clientName,
  adaptorName: 'NetSuite',
  deferredFeatures: answers['stabilization.backlog.deferredFeatures'] as string,
  knownLimitations: answers['stabilization.backlog.knownLimitations'] as string,
  phaseTwoScope: answers['stabilization.backlog.phaseTwoScope'] as string,
});
const governanceResult = generateContinuousImprovementGovernance({
  clientName,
  adaptorName: 'NetSuite',
  governanceCommittee: answers['stabilization.governance.governanceCommittee'] as string,
  decisionCadence: answers['stabilization.governance.decisionCadence'] as string,
  changeRequestProcess: answers['stabilization.governance.changeRequestProcess'] as string,
  stabilizationOwner: answers['stabilization.governance.stabilizationOwner'] as string,
});
const kpiEvolutionResult = generateKpiEvolutionPlan({
  clientName,
  adaptorName: 'NetSuite',
  businessCaseSummary: answers['stabilization.benefits.businessCaseSummary'] as string,
  hypercareDailyStandupTime: answers['hypercare.cadence.dailyStandupTime'] as string,
});
const phaseTwoResult = generatePhaseTwoCharter({
  clientName,
  adaptorName: 'NetSuite',
  phaseTwoScope: answers['stabilization.backlog.phaseTwoScope'] as string,
  deferredFeatures: answers['stabilization.backlog.deferredFeatures'] as string,
  stabilizationOwner: answers['stabilization.governance.stabilizationOwner'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});

const writes: Array<[string, string]> = [
  ['Project_Kickoff.md', generateKickoff(kickoffData)],
  ['Project_Kickoff.html', generateKickoffHtml(kickoffData)],
  ['BRD.md', generateBRD(brdData)],
  ['BRD.html', generateBRDHtml(brdData)],
  ['Risk_Register.md', generateRiskRegister(riskData)],
  ['UAT_Plan.md', generateUATPlan(uatData)],
  ['UAT_Plan.html', generateUATPlanHtml(uatData)],
  ['Solution_Design.md', generateSolutionDoc(sddData)],
  ['Solution_Design.html', generateSolutionDocHtml(sddData)],
  ['Training_Manual.md', generateTrainingManual(trainingData)],
  ['Training_Manual.html', generateTrainingManualHtml(trainingData)],
  ['Implementation_Plan.html', generateImplementationPlanHtml(planData)],
  // Pack T artefacts.
  ['Sign_Off_Matrix.md', signOffResult.markdown],
  ['Sign_Off_Matrix.html', signOffResult.html],
  ['Defect_Log_Template.md', defectLogResult.markdown],
  ['Performance_Test_Plan.md', perfPlanResult.markdown],
  ['Performance_Test_Plan.html', perfPlanResult.html],
  ['Regression_Test_Suite.md', regressionResult.markdown],
  ['Regression_Test_Suite.html', regressionResult.html],
  // Pack U artefacts — cross-cutting docs at the top level.
  ['Training_Matrix.md', trainingMatrixResult.markdown],
  ['Training_Matrix.html', trainingMatrixResult.html],
  ['Training_Schedule.md', trainingScheduleResult.markdown],
  ['Training_Schedule.html', trainingScheduleResult.html],
  ['KT_Checklist.md', ktResult.markdown],
];

for (const [filename, content] of writes) {
  await fs.writeFile(path.join(docDir, filename), content, 'utf8');
  process.stdout.write(`  ✓ ${filename}\n`);
}

// Pack T — Test_Scripts/ subfolder (one TC-*.md per declared scenario).
const testScriptsDir = path.join(docDir, 'Test_Scripts');
if (testScriptsResult.emitted.length > 0) {
  await fs.mkdir(testScriptsDir, { recursive: true });
}
for (const [bundlePath, content] of Object.entries(testScriptsResult.files)) {
  const rel = bundlePath.replace(/^Documentation\//, '');
  const fullPath = path.join(docDir, rel);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ ${rel}\n`);
}

// Pack U — Training/ subfolder (per-role guides + Quick_Reference_Cards/).
if (perRoleResult.emitted.length > 0 || qrcResult.emitted.length > 0) {
  await fs.mkdir(path.join(docDir, 'Training'), { recursive: true });
}
for (const [bundlePath, content] of Object.entries(perRoleResult.files)) {
  const rel = bundlePath.replace(/^Documentation\//, '');
  const fullPath = path.join(docDir, rel);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ ${rel}\n`);
}
for (const [bundlePath, content] of Object.entries(qrcResult.files)) {
  const rel = bundlePath.replace(/^Documentation\//, '');
  const fullPath = path.join(docDir, rel);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ ${rel}\n`);
}

// Pack V — Cutover/ subfolder (7 cutover artefacts).
const cutoverDir = path.join(docDir, 'Cutover');
await fs.mkdir(cutoverDir, { recursive: true });
const cutoverWrites: Array<[string, string]> = [
  ['Cutover_Runbook.md', runbookResult.markdown],
  ['Cutover_Runbook.html', runbookResult.html],
  ['Go_No_Go_Matrix.md', goNoGoResult.markdown],
  ['Rollback_Plan.md', rollbackResult.markdown],
  ['Post_Cutover_Smoke.md', smokeResult.markdown],
  ['Communication_Plan.md', commPlanResult.markdown],
  ['Dry_Run_Plan.md', dryRunResult.markdown],
  ['Cutover_Team_Roster.md', teamRosterResult.markdown],
];
for (const [filename, content] of cutoverWrites) {
  await fs.writeFile(path.join(cutoverDir, filename), content, 'utf8');
  process.stdout.write(`  ✓ Cutover/${filename}\n`);
}

// Pack X — Hypercare/ subfolder (7 hypercare artefacts).
const hypercareDir = path.join(docDir, 'Hypercare');
await fs.mkdir(hypercareDir, { recursive: true });
const hypercareWrites: Array<[string, string]> = [
  ['Hypercare_Plan.md', hypercarePlanResult.markdown],
  ['Daily_Readiness_Checklist.md', dailyReadinessResult.markdown],
  ['Issue_Escalation_Matrix.md', escalationMatrixResult.markdown],
  ['War_Room_SOP.md', warRoomResult.markdown],
  ['Transition_To_Support_Plan.md', transitionResult.markdown],
  ['Hypercare_KPI_Dashboard.md', kpiDashboardResult.markdown],
  ['Power_User_Office_Hours.md', officeHoursResult.markdown],
];
for (const [filename, content] of hypercareWrites) {
  await fs.writeFile(path.join(hypercareDir, filename), content, 'utf8');
  process.stdout.write(`  ✓ Hypercare/${filename}\n`);
}

// Pack Y — Stabilization/ subfolder (7 stabilization artefacts).
const stabilizationDir = path.join(docDir, 'Stabilization');
await fs.mkdir(stabilizationDir, { recursive: true });
const stabilizationWrites: Array<[string, string]> = [
  ['Stabilization_Roadmap.md', stabRoadmapResult.markdown],
  ['Lessons_Learned_Register.md', lessonsResult.markdown],
  ['Benefits_Realization_Tracker.md', benefitsResult.markdown],
  ['Process_Improvement_Backlog.md', processBacklogResult.markdown],
  ['Continuous_Improvement_Governance.md', governanceResult.markdown],
  ['KPI_Evolution_Plan.md', kpiEvolutionResult.markdown],
  ['Phase_Two_Charter.md', phaseTwoResult.markdown],
];
for (const [filename, content] of stabilizationWrites) {
  await fs.writeFile(path.join(stabilizationDir, filename), content, 'utf8');
  process.stdout.write(`  ✓ Stabilization/${filename}\n`);
}

// Pack Z — Data_Migration/ subfolder (7 markdown + Templates/ with N CSVs + README.md).
const dataMigrationDir = path.join(docDir, 'Data_Migration');
const dataMigrationTemplatesDir = path.join(dataMigrationDir, 'Templates');
await fs.mkdir(dataMigrationTemplatesDir, { recursive: true });

const csvBundleResult = generateCsvImportTemplateBundle({
  clientName,
  adaptorName: 'NetSuite',
  answers,
});
const fieldMappingResult = generateFieldMappingWorkbook({
  clientName,
  adaptorName: 'NetSuite',
  answers,
  sourceSystemsByObject: answers['migration.details.sourceSystemsByObject'] as string,
});
const reconQueriesResult = generateReconciliationQueries({
  clientName,
  adaptorName: 'NetSuite',
  answers,
});
const cleansingRulesResult = generateMigrationCleansingRules({
  clientName,
  adaptorName: 'NetSuite',
  cleansingRulesByObject: answers['migration.details.cleansingRulesByObject'] as string,
  dataQualityOwners: answers['migration.readiness.dataQualityOwners'] as string,
});
const loadSequencingResult = generateMigrationLoadSequencing({
  clientName,
  adaptorName: 'NetSuite',
  answers,
});
const migrationRunbookResult = generateMigrationRunbook({
  clientName,
  adaptorName: 'NetSuite',
  answers,
  historicalDataDepth: answers['migration.details.historicalDataDepth'] as string,
  dryRunPassThreshold: answers['migration.readiness.dryRunPassThreshold'] as string,
  migrationCutoffDate: answers['migration.readiness.migrationCutoffDate'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});
const rejectPlaybookResult = generateRejectHandlingPlaybook({
  clientName,
  adaptorName: 'NetSuite',
  rejectSlaByObject: answers['migration.details.rejectSlaByObject'] as string,
});
const dqScorecardResult = generateDataQualityScorecard({
  clientName,
  adaptorName: 'NetSuite',
  answers,
  dryRunPassThreshold: answers['migration.readiness.dryRunPassThreshold'] as string,
  dataQualityOwners: answers['migration.readiness.dataQualityOwners'] as string,
  migrationCutoffDate: answers['migration.readiness.migrationCutoffDate'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});

const dataMigrationWrites: Array<[string, string]> = [
  ['Field_Mapping_Workbook.md', fieldMappingResult.markdown],
  ['Reconciliation_Queries.md', reconQueriesResult.markdown],
  ['Cleansing_Rules.md', cleansingRulesResult.markdown],
  ['Load_Sequencing.md', loadSequencingResult.markdown],
  ['Migration_Runbook.md', migrationRunbookResult.markdown],
  ['Reject_Handling_Playbook.md', rejectPlaybookResult.markdown],
  ['Data_Quality_Scorecard.md', dqScorecardResult.markdown],
];
for (const [filename, content] of dataMigrationWrites) {
  await fs.writeFile(path.join(dataMigrationDir, filename), content, 'utf8');
  process.stdout.write(`  ✓ Data_Migration/${filename}\n`);
}
// Templates/ — one CSV per object in scope + README.md.
for (const [relativePath, content] of Object.entries(csvBundleResult.files)) {
  const fullPath = path.join(dataMigrationDir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ Data_Migration/${relativePath}\n`);
}
await fs.writeFile(
  path.join(dataMigrationTemplatesDir, 'README.md'),
  csvBundleResult.readme,
  'utf8',
);
process.stdout.write(`  ✓ Data_Migration/Templates/README.md\n`);

// ── Real-code generation: SDF bundle ────────────────────────────────────────
// Every NetSuite Account Customization Project needs three things at the
// SDF root for SuiteCloud CLI to deploy it:
//   1. manifest.xml  — declares projecttype + required features
//   2. deploy.xml    — tells SuiteCloud which paths to push
//   3. Objects/      — the actual customisations
//
// Manifest + deploy are emitted unconditionally on NetSuite (any customisation
// — current or future — needs them). Custom records are emitted only when
// the wizard's ns.design.customRecords answer is non-empty. Everything is
// validated together against sdfValidator.ts before writing — we fail the
// bundle build if any emitted XML would be rejected by Oracle SDF, so the
// demo bundle is always deployable.
const sdfRoot = path.join(outRoot, 'SDF');

// Pack A — Subsidiary + Currency XMLs are required for any OneWorld
// engagement. Without them the bundle fails SDF deploy because every
// customrecord / form / script downstream references subsidiary IDs
// that don't exist on the tenant. Currencies are extracted from the
// parsed subsidiary list so they match exactly what's referenced.
const subsidiariesResult = generateSubsidiaries({
  subsidiaryList: answers['ns.foundation.subsidiaryList'] as string | undefined,
  eliminationEntity: answers['ns.foundation.eliminationEntity'] as string | undefined,
});
const currencyCodes = extractCurrenciesFromSubsidiaries(subsidiariesResult.emitted);
const currenciesResult = generateCurrencies({ currencies: currencyCodes });

// Pack W — workflow generators run early so manifest derivation can
// see hasWorkflows. The companion WFA scripts go to SDF/SuiteScripts/
// and don't affect manifest features beyond hasSuiteScripts (already
// driven by the PO UE script).
const workflowsResult = generateWorkflows({ answers });
const wfaScriptsResult = generateWorkflowActionScripts({
  answers,
  firmName: 'NSIX',
  clientName,
});

// Pack F — saved searches + dashboards. Saved searches run first
// because dashboards reference their scriptids for KPI portlet wiring.
const savedSearchesResult = generateSavedSearches({
  kpiCatalogAnswer: answers['ns.design.kpiCatalog'] as string | undefined,
  customRecordsAnswer: answers['ns.design.customRecords'] as string | undefined,
});
const dashboardsResult = generateDashboards({
  roleDashboardsAnswer: answers['ns.design.roleDashboards'] as string | undefined,
  savedSearches: savedSearchesResult.emitted,
});

// Pack C — Roles + AccountConfiguration. Roles use the wizard's
// standardRoleCustomization answer (NS Pack 3 SD); AccountConfiguration
// files are derived from foundation + design flags.
const rolesResult = generateRoles({
  standardRoleCustomization: answers['ns.design.standardRoleCustomization'] as string | undefined,
});
const firstSubsidiary = subsidiariesResult.emitted.find((s) => !s.isElimination);
const baseCurrency = firstSubsidiary?.currency ?? 'USD';
const accountingPreferencesXml = generateAccountingPreferences({
  multiBookAccounting: answers['ns.foundation.multiBookAccounting'] === true,
  advancedRevRecInScope: answers['ns.foundation.advancedRevRecInScope'] === true,
  sodMatrixRequired: answers['ns.design.sodMatrixRequired'] === true,
});
const companyInformationXml = generateCompanyInformation({
  clientName,
  primaryCountry: (answers['ns.foundation.primaryCountry'] as string | undefined) ?? '',
  fiscalYearStart: (answers['ns.foundation.fiscalYearStart'] as string | undefined) ?? '01-01',
  baseCurrency,
});
const generalPreferencesXml = generateGeneralPreferences({
  ssoInScope: answers['ns.foundation.ssoInScope'] === true,
  customRolesRequired: answers['ns.foundation.customRolesRequired'] === true,
  auditLogRetentionMonths:
    typeof answers['ns.design.auditLogRetentionMonths'] === 'number'
      ? (answers['ns.design.auditLogRetentionMonths'] as number)
      : undefined,
});

// Pack D — Tax engine generators run in dependency order: types →
// codes → schedules. Tax codes reference tax type scriptids; tax
// schedules reference tax code scriptids.
const taxTypesResult = generateTaxTypes({
  taxCodeMatrix: answers['ns.tax.taxCodeMatrix'] as string | undefined,
  nexusList: answers['ns.tax.nexusList'] as string | undefined,
  withholdingInScope: answers['ns.tax.withholdingInScope'] === true,
  useTaxInScope: answers['ns.tax.useTaxInScope'] === true,
  reverseChargeInScope: answers['ns.tax.reverseChargeInScope'] === true,
});
const taxCodesResult = generateTaxCodes({
  taxCodeMatrix: answers['ns.tax.taxCodeMatrix'] as string | undefined,
  nexusList: answers['ns.tax.nexusList'] as string | undefined,
});
const taxSchedulesResult = generateTaxSchedules({
  taxScheduleMatrix: answers['ns.tax.taxScheduleMatrix'] as string | undefined,
  taxCodes: taxCodesResult.emitted,
});

// Pack A — Manifest derives feature dependencies from the wizard
// answers (was hardcoded to {CUSTOMRECORDS, SERVERSIDESCRIPTING}).
// Drives SUBSIDIARIES / INTERCOMPANY / MULTICURRENCY / etc. on
// OneWorld engagements so SDF deploy has the right feature gates
// declared.
const poApprovalAnswerForManifest = answers['p2p.purchasing.poApprovalTiers'] as string | undefined;
const willEmitPoScriptManifest = !!(poApprovalAnswerForManifest && poApprovalAnswerForManifest.trim().length > 0);
const customRecordsAnswerForManifest = answers['ns.design.customRecords'] as string | undefined;
const hasCustomRecordsForManifest = !!(customRecordsAnswerForManifest && customRecordsAnswerForManifest.trim().length > 0);
const uiLanguagesRaw = answers['ns.localization.uiLanguages'] as string | undefined;
const uiLanguagesArray =
  typeof uiLanguagesRaw === 'string' && uiLanguagesRaw.trim().length > 0
    ? uiLanguagesRaw.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0)
    : [];

const manifestXml = generateSdfManifest({
  firmName: 'NSIX',
  clientName,
  edition: answers['ns.foundation.edition'] as string | undefined,
  multiCurrencyInScope: answers['ns.foundation.multiCurrencyInScope'] === true,
  multiBookAccounting: answers['ns.foundation.multiBookAccounting'] === true,
  advancedRevRecInScope: answers['ns.foundation.advancedRevRecInScope'] === true,
  customRolesRequired: answers['ns.foundation.customRolesRequired'] === true,
  ssoInScope: answers['ns.foundation.ssoInScope'] === true,
  taxEngine: answers['ns.tax.engine'] as string | undefined,
  hasCustomRecords: hasCustomRecordsForManifest,
  hasSuiteScripts: willEmitPoScriptManifest,
  hasWorkflows: workflowsResult.emitted.length > 0,
  poApprovalInScope: willEmitPoScriptManifest,
  uiLanguages: uiLanguagesArray,
});
const deployXml = generateSdfDeploy();
const customRecordsResult = generateSdfCustomRecords({
  customRecordsAnswer: answers['ns.design.customRecords'] as string | undefined,
  customRecordExtraFieldsAnswer: answers['ns.design.customRecordExtraFields'] as string | undefined,
});

// Pack B — BRD custom-field generator. Parses ns.design.customFieldsScope
// into individual XMLs (custbody / custentity / custitem) with fieldtype
// inferred from a keyword classifier, and auto-adds
// custbody_nsix_required_approver when the PO User Event script is in
// scope (the script writes to that field — without it, runtime blow-up
// on the first non-auto PO).
const poApprovalAnswerForFields = answers['p2p.purchasing.poApprovalTiers'] as string | undefined;
const willEmitPoScript = !!(poApprovalAnswerForFields && poApprovalAnswerForFields.trim().length > 0);
const customFieldsResult = generateSdfCustomFields({
  customFieldsScopeAnswer: answers['ns.design.customFieldsScope'] as string | undefined,
  includePoApprovalRequiredField: willEmitPoScript,
});

// Pack B — companion customlists for SELECT-classified fields. Each
// SELECT field needs a list to reference (audit Fix #4 — every
// customlist must carry at least one customvalue, satisfied by a
// single inactive placeholder).
const selectFieldsCustomLists: Record<string, string> = {};
for (const field of customFieldsResult.emitted) {
  if (field.fieldtype !== 'SELECT' || !field.selectListScriptid) continue;
  selectFieldsCustomLists[`Objects/${field.selectListScriptid}.xml`] = generateSdfCustomList({
    listScriptid: field.selectListScriptid,
    label: field.originalLabel,
  });
}

// Pack H — Custom Forms (Transaction + Entry). Purely derivative from
// Pack B: re-parses the same customFieldsScope and emits one
// transactionform / entryform XML per parent that has at least one
// custom field declared. The PO form auto-includes the
// custbody_nsix_required_approver field when the PO User Event script
// is in scope.
const txnFormsResult = generateTransactionForms({
  customFieldsScope: answers['ns.design.customFieldsScope'] as string | undefined,
  clientName,
  poApprovalInScope: willEmitPoScript,
});
const entryFormsResult = generateEntryForms({
  customFieldsScope: answers['ns.design.customFieldsScope'] as string | undefined,
  clientName,
});

// Single validator pass over the WHOLE SDF bundle so manifest / deploy /
// customrecord / custom-field / customlist / form / subsidiary /
// currency / workflow errors all surface together.
const allSdfFiles: Record<string, string> = {
  'manifest.xml': manifestXml,
  'deploy.xml': deployXml,
  ...subsidiariesResult.files,
  ...currenciesResult.files,
  ...customRecordsResult.files,
  ...customFieldsResult.files,
  ...selectFieldsCustomLists,
  ...txnFormsResult.files,
  ...entryFormsResult.files,
  ...workflowsResult.files,
  ...savedSearchesResult.files,
  ...dashboardsResult.files,
  ...rolesResult.files,
  'AccountConfiguration/accountingpreferences.xml': accountingPreferencesXml,
  'AccountConfiguration/companyinformation.xml': companyInformationXml,
  'AccountConfiguration/generalpreferences.xml': generalPreferencesXml,
  ...taxTypesResult.files,
  ...taxCodesResult.files,
  ...taxSchedulesResult.files,
};
const validation = validateSDFBundle(allSdfFiles);
if (!validation.ok) {
  // eslint-disable-next-line no-console
  console.error(`  ✗ SDF VALIDATION FAILED:`);
  for (const err of validation.errors) {
    // eslint-disable-next-line no-console
    console.error(`    ${err.file}: ${err.rule} — ${err.detail}`);
  }
  process.exit(1);
}

await fs.mkdir(sdfRoot, { recursive: true });
await fs.writeFile(path.join(sdfRoot, 'manifest.xml'), manifestXml, 'utf8');
process.stdout.write(`  ✓ SDF/manifest.xml\n`);
await fs.writeFile(path.join(sdfRoot, 'deploy.xml'), deployXml, 'utf8');
process.stdout.write(`  ✓ SDF/deploy.xml\n`);

for (const [relPath, content] of Object.entries(subsidiariesResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

for (const [relPath, content] of Object.entries(currenciesResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

for (const [relPath, content] of Object.entries(customRecordsResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

for (const [relPath, content] of Object.entries(customFieldsResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

for (const [relPath, content] of Object.entries(selectFieldsCustomLists)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

for (const [relPath, content] of Object.entries(txnFormsResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

for (const [relPath, content] of Object.entries(entryFormsResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

for (const [relPath, content] of Object.entries(workflowsResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

for (const [relPath, content] of Object.entries(wfaScriptsResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

for (const [relPath, content] of Object.entries(savedSearchesResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

for (const [relPath, content] of Object.entries(dashboardsResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

for (const [relPath, content] of Object.entries(rolesResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

// Pack C — AccountConfiguration files. Sit alongside Objects/ as a
// peer directory. The deploy.xml's <configuration><path>~/AccountConfiguration/*</path></configuration>
// block (Pack C deploy update) tells SuiteCloud CLI to push these.
const accountConfigDir = path.join(sdfRoot, 'AccountConfiguration');
await fs.mkdir(accountConfigDir, { recursive: true });
await fs.writeFile(
  path.join(accountConfigDir, 'accountingpreferences.xml'),
  accountingPreferencesXml,
  'utf8',
);
process.stdout.write(`  ✓ SDF/AccountConfiguration/accountingpreferences.xml\n`);
await fs.writeFile(
  path.join(accountConfigDir, 'companyinformation.xml'),
  companyInformationXml,
  'utf8',
);
process.stdout.write(`  ✓ SDF/AccountConfiguration/companyinformation.xml\n`);
await fs.writeFile(
  path.join(accountConfigDir, 'generalpreferences.xml'),
  generalPreferencesXml,
  'utf8',
);
process.stdout.write(`  ✓ SDF/AccountConfiguration/generalpreferences.xml\n`);

for (const [relPath, content] of Object.entries(taxTypesResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}
for (const [relPath, content] of Object.entries(taxCodesResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}
for (const [relPath, content] of Object.entries(taxSchedulesResult.files)) {
  const fullPath = path.join(sdfRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  process.stdout.write(`  ✓ SDF/${relPath}\n`);
}

// ── Real-logic SuiteScript: PO approval User Event ──────────────────────────
// First real-LOGIC SuiteScript file. Reads the wizard's free-text
// p2p.purchasing.poApprovalTiers answer and emits a deployable User Event
// with the parsed thresholds hardcoded into APPROVAL_TIERS. Empty answer
// skips emission; unparseable answer falls back to a TODO placeholder.
const poApprovalAnswer = answers['p2p.purchasing.poApprovalTiers'] as string | undefined;
if (poApprovalAnswer && poApprovalAnswer.trim().length > 0) {
  const scriptBody = generatePoApprovalScript({
    approvalTiers: poApprovalAnswer,
    firmName: 'NSIX',
    clientName,
  });
  const scriptDir = path.join(sdfRoot, 'SuiteScripts');
  await fs.mkdir(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, 'NSIX_UE_PurchaseOrderApproval.js');
  await fs.writeFile(scriptPath, scriptBody, 'utf8');
  process.stdout.write(`  ✓ SDF/SuiteScripts/NSIX_UE_PurchaseOrderApproval.js\n`);
}

// ── Anti-bleed verification ─────────────────────────────────────────────────
// Confirm NetSuite-specific terminology IS present (this is the inverse of
// the Odoo banlist — for NetSuite we expect to see it). Catches any future
// regression where a generator accidentally renders Odoo prose for a
// NetSuite engagement.
const REQUIRED = ['NetSuite'];
let missingTerms = 0;
const brdContent = writes.find(([f]) => f === 'BRD.md')?.[1] ?? '';
for (const term of REQUIRED) {
  if (!brdContent.includes(term)) {
    // eslint-disable-next-line no-console
    console.error(`  ✗ MISSING: BRD.md does not contain "${term}"`);
    missingTerms++;
  }
}

// eslint-disable-next-line no-console
console.log('');
// eslint-disable-next-line no-console
console.log(`  Bundle: ${outRoot}`);
// eslint-disable-next-line no-console
console.log(
  `  Files:  ${writes.length} doc + manifest.xml + deploy.xml + ` +
    `${subsidiariesResult.emitted.length} subsidiary(ies) + ` +
    `${currenciesResult.emitted.length} currency(ies) + ` +
    `${customRecordsResult.emitted.length} customrecord(s) + ` +
    `${customRecordsResult.emitted.length} status customlist(s) + ` +
    `${customFieldsResult.emitted.length} custom field(s) + ` +
    `${Object.keys(selectFieldsCustomLists).length} SELECT companion customlist(s) + ` +
    `${Object.keys(txnFormsResult.files).length} transaction form(s) + ` +
    `${Object.keys(entryFormsResult.files).length} entry form(s) + ` +
    `${workflowsResult.emitted.length} workflow(s) + ` +
    `${wfaScriptsResult.emitted.length} WFA script(s) + ` +
    `${savedSearchesResult.emitted.length} saved search(es) + ` +
    `${dashboardsResult.emitted.length} dashboard(s) + ` +
    `${rolesResult.emitted.length} role(s) + 3 AccountConfiguration files + ` +
    `${taxTypesResult.emitted.length} tax type(s) + ` +
    `${taxCodesResult.emitted.length} tax code(s) + ` +
    `${taxSchedulesResult.emitted.length} tax schedule(s)`,
);
if (missingTerms === 0) {
  // eslint-disable-next-line no-console
  console.log(`  Sanity: ✓ NetSuite terminology present in BRD`);
} else {
  // eslint-disable-next-line no-console
  console.log(`  Sanity: ✗ ${missingTerms} required term(s) missing`);
  process.exit(1);
}
