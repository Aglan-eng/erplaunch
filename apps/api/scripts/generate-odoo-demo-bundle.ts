/**
 * One-shot driver: generate the full Odoo demo bundle for the seeded
 * Sahel Logistics Ltd. engagement. Calls the generators directly with
 * the same data shape that seed-odoo.ts persists, then writes the
 * output into NSIX/ODOO_DEMO_BUNDLE/<ISO>/Documentation/.
 *
 * No DB, no queue, no API — just the pure generator functions exercised
 * with the demo-engagement payload. The bundle is the design-partner
 * artefact and is intentionally NOT committed to git.
 *
 * Run from apps/api:
 *   pnpm --filter @ofoq/api exec tsx scripts/generate-odoo-demo-bundle.ts
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
import { generateOdooConfigurationPlan, generateOdooConfigurationPlanHtml } from '../src/services/generators/odooConfigurationPlanGenerator.js';
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
// Pack ZZ — Integration Runbooks (cross-platform).
import { generateIntegrationCatalog } from '../src/services/generators/integrationCatalogGenerator.js';
import { generateIntegrationRunbookBundle } from '../src/services/generators/integrationRunbookBundleGenerator.js';
import { generateIntegrationHealthDashboard } from '../src/services/generators/integrationHealthDashboardGenerator.js';
import { generateIntegrationReconciliationProcedures } from '../src/services/generators/integrationReconciliationProceduresGenerator.js';
import { generateIntegrationVendorEscalationMatrix } from '../src/services/generators/integrationVendorEscalationMatrixGenerator.js';
import { generateIntegrationTestPlan } from '../src/services/generators/integrationTestPlanGenerator.js';
import { generateIntegrationsIndex } from '../src/services/generators/integrationsIndexGenerator.js';
import odooAdaptor from '@ofoq/adaptor-odoo';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/api/scripts → repo root → NSIX/ → ODOO_DEMO_BUNDLE/
const NSIX_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// ── Adaptor context — same shape generation.ts builds for adaptorId='odoo' ──
// Flows pulled from the live adaptor schema so the BRD's Workstream
// Requirements section actually iterates Foundation / Tax / R2R / etc.
// instead of the old hardcoded NetSuite-only flow list.
const adaptor: AdaptorContext = {
  id: 'odoo',
  name: 'Odoo',
  editionLabel: 'Enterprise',
  consultantQualifier: 'Odoo',
  nextStepLanguage:
    'the Odoo configuration phase using the module install plan and localization package generated by ERPLaunch',
  flows: odooAdaptor.schema.flows.map((f) => ({
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

// ── Demo data — mirror of seed-odoo.ts's Sahel Logistics Ltd. record ────────
const clientName = 'Sahel Logistics Ltd.';
const license = {
  edition: 'ENTERPRISE',
  modules: [
    'BASE_ACCOUNTING', 'BASE_SALES', 'BASE_PURCHASE', 'BASE_INVENTORY',
    'ENTERPRISE_ACCOUNTING', 'ENTERPRISE_STUDIO', 'ENTERPRISE_DOCUMENTS',
    'MRP', 'QUALITY', 'CRM', 'PROJECT', 'TIMESHEETS',
  ],
};
const answers: Record<string, unknown> = {
  // Kickoff Pack — universal
  'kickoff.mandate.sponsor': 'Yousef Al-Rashid (CFO, Sahel Logistics Holding)',
  'kickoff.mandate.businessCase':
    'Replace 3 disconnected QuickBooks instances + spreadsheet inventory with a unified ' +
    'Odoo Enterprise tenant. Drives the 2026 group consolidation plan for the new freight-forwarding ' +
    'entity; required for IFRS audit readiness ahead of the planned Series B raise in Q3 2026.',
  'kickoff.mandate.successCriteria':
    'Close month-end in 5 business days vs current 14 (target: month 6 post-go-live)\n' +
    'Single source of truth for inventory across all 4 warehouses (target: month 1)\n' +
    'Eliminate 80% of manual journal entries by automating intercompany flows (target: month 3)',
  'kickoff.mandate.targetGoLiveDate': '2026-09-01',
  'kickoff.governance.steeringCadence': 'BIWEEKLY',
  'kickoff.governance.workingGroupCadence': 'WEEKLY',
  'kickoff.governance.decisionThresholds':
    '<AED 50k or in-scope: PM decides\n' +
    'AED 50k–AED 200k or scope clarification: Steering\n' +
    '>AED 200k or scope change: Sponsor + Steering joint approval',
  'kickoff.governance.escalationPath':
    'Hesham Aglan (consultant PM) → Steering Committee (bi-weekly) → Yousef Al-Rashid (Sponsor)',
  'kickoff.communication.statusReportCadence': 'WEEKLY',
  'kickoff.communication.statusReportAudience':
    'Yousef Al-Rashid — Sponsor / CFO\n' +
    'Layla Hassan — Client PM / Group Controller\n' +
    'Hesham Aglan — Consultant PM\n' +
    'Mariam Saeed — Workstream lead, Accounting & Tax\n' +
    'Khaled Mansour — Workstream lead, Inventory & Logistics',
  'kickoff.communication.issueReportingChannel': 'SHARED_DOC',
  'kickoff.communication.stakeholderNotes':
    'Tariq Al-Otaibi (Group CEO) — quarterly read-out only; no operational involvement\n' +
    'Sara Mahmoud (Head of IT) — must be informed before any environment change\n' +
    'External auditor (BDO) — read-only access to UAT data refresh window',

  // Pack 1 — Foundation
  'odoo.foundation.deploymentMode': 'ODOOSH',
  'odoo.foundation.edition': 'ENTERPRISE',
  'odoo.foundation.usersInternalY1': 35,
  'odoo.foundation.usersInternalY3': 60,
  'odoo.foundation.portalUsers': true,
  'odoo.foundation.primaryCountry': 'AE',
  'odoo.foundation.otherCountries': 'EG\nSA',
  'odoo.foundation.reportingLanguage': 'en',
  'odoo.foundation.uiLanguages': 'ar\nfr',
  'odoo.foundation.fiscalYearStart': '01-01',
  'odoo.foundation.multiCompany': true,
  'odoo.foundation.entityList': 'Sahel Logistics Holding, AE, AED\nSahel Freight Forwarding, AE, AED',
  'odoo.foundation.intercompanyAuto': true,
  'odoo.foundation.multiCurrency': true,
  'odoo.foundation.reportingCurrency': 'USD',

  // Pack 2 — Tax Engine
  'odoo.tax.salesPriceMode': 'EXCLUDED',
  'odoo.tax.purchasePriceMode': 'EXCLUDED',
  'odoo.tax.defaultSalesTax': 'VAT 5%',
  'odoo.tax.defaultPurchaseTax': 'VAT 5%',
  'odoo.tax.hasExemptCustomers': true,
  'odoo.tax.exemptCategories': 'Free zone clients\nGCC export',
  'odoo.tax.hasReducedRates': false,
  'odoo.tax.reducedRateCategories': '',
  'odoo.tax.reverseCharge': true,
  'odoo.tax.withholding': false,
  'odoo.tax.regionalVariation': false,
  'odoo.tax.fiscalPositions': true,
  'odoo.tax.fiscalPositionList': 'Domestic\nExport — GCC\nFree Zone\nReverse-charge import',
  'odoo.tax.einvoicingRequired': 'NO',
  'odoo.tax.einvoicingSystem': '',
  'odoo.tax.taxFilingPeriodicity': 'QUARTERLY',

  // Pack 3 — Localization & Compliance
  'odoo.localization.coaTemplate': 'l10n_ae (UAE Federal Tax Authority chart of accounts)',
  'odoo.localization.statutoryReports': 'GCC VAT return\nIFRS financial statements\nUAE Economic Substance Regulations report',
  'odoo.localization.languagePackInstall': true,
  'odoo.localization.einvoicingProvider': 'UAE FTA (rolling out)',
  'odoo.localization.einvoicingPhase': 'Phase 1',
  'odoo.localization.einvoicingPilotDone': 'IN_PROGRESS',
  'odoo.localization.einvoicingDigitalCert': 'IN_PROGRESS',
  'odoo.localization.payrollInScope': true,
  'odoo.localization.payrollFrequency': 'MONTHLY',
  'odoo.localization.payrollEndOfService': 'UAE end-of-service gratuity per Article 51 of UAE Labour Law (Federal Decree-Law No. 33 of 2021)',
  'odoo.localization.dataResidencyRequired': true,
  'odoo.localization.dataResidencyJurisdiction': 'UAE / GCC',
  'odoo.localization.gdprApplicable': true,

  // Pack 4 — Accounting & Multi-Company depth
  'odoo.accounting.reportingStandard': 'IFRS',
  'odoo.accounting.tradition': 'ANGLO_SAXON',
  'odoo.accounting.basis': 'ACCRUAL',
  'odoo.accounting.closeCadence': 'MONTHLY',
  'odoo.accounting.lockDatesPolicy': 'TAX_LOCK',
  'odoo.accounting.analyticAxes': 'Cost Centers\nProjects\nDepartments',
  'odoo.accounting.budgetsInScope': true,
  'odoo.accounting.budgetControlMode': 'WARNING',
  'odoo.accounting.consolidationInScope': true,
  'odoo.accounting.bankFeedIntegration': true,
  'odoo.accounting.bankStatementFormat': 'CAMT.053\nMT940',
  'odoo.accounting.reconciliationMethod': 'AUTO_SUGGEST',
  'odoo.accounting.currencyRevalCadence': 'MONTHLY',
  'odoo.accounting.intercompanyValidation': 'AUTO_DRAFT',
  'odoo.accounting.intercompanyCurrencyRule': 'GROUP_CURRENCY',
  'odoo.accounting.transferPricingPolicy': 'COST_PLUS',
  'odoo.accounting.sharedAccountsStrategy': 'CONSOLIDATION_ONLY',

  // Pack 5 — Inventory & Valuation depth
  'odoo.inventory.warehouseCount': 4,
  'odoo.inventory.warehouseTypes': 'Main DC — Jebel Ali\nRetail Store — Dubai Mall\nRetail Store — Mall of the Emirates\nManufacturing Plant — Dubai Industrial Park',
  'odoo.inventory.transferRules': true,
  'odoo.inventory.crossDocking': false,
  'odoo.inventory.valuationMethod': 'FIFO',
  'odoo.inventory.removalStrategy': 'FEFO',
  'odoo.inventory.landedCosts': true,
  'odoo.inventory.negativeStockAllowed': 'NEVER',
  'odoo.inventory.lotsSerialsRequired': true,
  'odoo.inventory.lotProductCategories': 'Pharmaceuticals\nDairy products\nPerishable food',
  'odoo.inventory.serialProductCategories': 'High-value electronics\nMedical devices',
  'odoo.inventory.expirationTracking': true,
  'odoo.inventory.barcodeScanning': true,
  'odoo.inventory.replenishmentStrategy': 'MIXED',
  'odoo.inventory.dropShip': true,
  'odoo.inventory.countMethod': 'BOTH',
  'odoo.inventory.putawayRules': true,

  // Pack 6 — Manufacturing depth
  'odoo.mfg.bomTypes': 'Manufacture\nPhantom (kit explosion at sales)\nSubcontracting (vendor produces)',
  'odoo.mfg.multiLevelBom': true,
  'odoo.mfg.plmInScope': true,
  'odoo.mfg.bomCostMethod': 'COMPONENT_BASED',
  'odoo.mfg.routingRequired': true,
  'odoo.mfg.workCenterCount': 6,
  'odoo.mfg.capacityPlanning': true,
  'odoo.mfg.operationTimeTracking': true,
  'odoo.mfg.qualityPlansRequired': true,
  'odoo.mfg.qualityCheckpoints': 'Receiving (incoming inspection)\nIn-process (during MO)\nFinal (before stock)',
  'odoo.mfg.qualityFailBlocks': 'BLOCK_HARD',
  'odoo.mfg.subcontractingInScope': true,
  'odoo.mfg.subcontractingComponentsTracking': true,
  'odoo.mfg.maintenanceInScope': true,
  'odoo.mfg.maintenanceType': 'BOTH',
  'odoo.mfg.backflushing': false,

  // Pack 7 — Data Migration sizing
  'odoo.migration.customerCount': 8500,
  'odoo.migration.vendorCount': 1200,
  'odoo.migration.productSkuCount': 14500,
  'odoo.migration.openSoCount': 320,
  'odoo.migration.openPoCount': 180,
  'odoo.migration.openArInvoiceCount': 950,
  'odoo.migration.openApBillCount': 410,
  'odoo.migration.inventoryLineCount': 38000,
  'odoo.migration.sourceSystems': 'SAP Business One — accounting + sales since 2019\nExcel spreadsheets — pricing matrices, vendor terms\nCustom Access DB — historical SOs (read-only archive)',
  'odoo.migration.historicalDepthYears': 3,
  'odoo.migration.masterDataOwnership': 'Customers: Sales Director\nVendors: Procurement Manager\nProducts: Inventory Manager\nCOA: CFO',
  'odoo.migration.cutoverStyle': 'PHASED_ENTITY',
  'odoo.migration.preFreezeDays': 3,
  'odoo.migration.cutoverWindowHours': 36,
  'odoo.migration.cleansingScope': 'Deduplicate customers by VAT number\nNormalize product UoM to single base (kg / each)\nDrop orphan SOs older than 18 months\nRetire warehouse locations not used in past 12 months',
  'odoo.migration.postValidationApproach': 'STRATIFIED_SAMPLE',
  'odoo.migration.reconciliationStrategy': 'Trial balance: legacy = Odoo to the cent (per entity)\nAR aging: 30/60/90 buckets match within 0.5%\nInventory: variance < AED 5,000 per SKU at Main DC\nCustomer master: 100% spot-check on top-100 by revenue',
  'odoo.migration.signoffOwner': 'CFO + Project Sponsor (joint sign-off on cutover day)',

  // Pack R restructure — Purchase / Sales / Returns answers (kept).
  // The legacy odoo.company.* / odoo.coa.* / odoo.mrp.* keys were
  // removed because their questions were deleted; their semantic
  // content lives in foundation.* / accounting.* / mfg.* and is
  // already populated higher up.
  'odoo.purchase.approvalTiers': 'DOUBLE',
  'odoo.purchase.threeWayMatch': true,
  'odoo.sales.quoteTemplate': true,
  'odoo.sales.priceListStrategy': 'CUSTOMER_TIER',
  'odoo.invoicing.policy': 'DELIVERED',
  'odoo.returns.policy': 'AUTO_REFUND',

  // Pack 8 — Revenue Apps (POS + eCommerce + Subscriptions). The
  // demo engagement has all three in scope to exercise the full
  // section render. Real engagements may toggle any combination off
  // via the *.inScope flags.
  'odoo.revenue.posInScope': true,
  'odoo.revenue.posType': 'BOTH',
  'odoo.revenue.posTerminalCount': 12,
  'odoo.revenue.posHardware': 'Receipt printer (Epson TM-T20)\nCash drawer\nBarcode scanner (USB)\nPayment terminal (Network International)\nKitchen printer (Epson TM-U220 — hot prep)\nKitchen printer (Epson TM-U220 — cold prep / bar)\nIoT Box',
  'odoo.revenue.posOfflineMode': true,
  'odoo.revenue.ecommerceInScope': true,
  'odoo.revenue.ecommerceSiteCount': 'MULTI_SITE',
  'odoo.revenue.ecommerceLanguages': 'en — English\nar — Arabic\nfr — French',
  'odoo.revenue.ecommercePaymentProviders': 'Stripe\nNetwork International\nTabby (UAE/SA BNPL)\nPayPal',
  'odoo.revenue.ecommerceShippingCarriers': 'DHL\nAramex\nLocal last-mile via custom CSV',
  'odoo.revenue.subscriptionsInScope': true,
  'odoo.revenue.subscriptionFrequencies': 'Monthly\nAnnual\nQuarterly',
  'odoo.revenue.subscriptionAutoRenewal': 'AUTO',
  'odoo.revenue.subscriptionDunningPolicy': 'Retry day 1, day 3, day 7\nSuspend access after 14 days\nCancel after 30 days',
  'odoo.revenue.mrrArrReporting': true,

  // Pack 9 — Operations Apps (HR + Project + CRM). Demo engagement
  // exercises all three with MENA-realistic EOSB rules and a T&M
  // billing setup.
  'odoo.operations.hrInScope': true,
  'odoo.operations.payrollInScope': true,
  'odoo.operations.timeOffInScope': true,
  'odoo.operations.attendanceInScope': true,
  'odoo.operations.endOfServiceRules':
    'UAE: 21 days/year first 5 yrs, 30 days/year after; capped at 2yr salary (Federal Decree-Law No. 33 of 2021)\nSaudi Arabia: 1/2 month/yr first 5 yrs, 1 month/yr after (KSA Labour Law Article 84)\nEgypt: per Article 122 of Egypt labour law',
  'odoo.operations.recruitmentInScope': true,
  'odoo.operations.projectInScope': true,
  'odoo.operations.timesheetsInScope': true,
  'odoo.operations.projectBillingMode': 'TM',
  'odoo.operations.projectProfitability': true,
  'odoo.operations.projectForecasting': true,
  'odoo.operations.crmInScope': true,
  'odoo.operations.crmPipelineStages': 'New\nQualified\nProposal\nNegotiation\nWon / Lost',
  'odoo.operations.crmLeadEnrichmentInScope': true,
  'odoo.operations.crmEmailIntegration': 'Outlook plug-in\nIMAP catch-all (sales@sahel.ae)\nMailchimp sync',

  // Pack T — TESTING flow (cross-platform). Sahel exercises 10
  // scenarios across R2R/P2P/O2C/MFG/INV + 5 perf benchmarks + 5
  // regression smoke scenarios + 5 test roles.
  'testing.scope.scenariosPerWorkstream':
    'R2R: Period close: Run month-end close for fiscal period; verify all journals posted + TB balances per entity\n' +
    'R2R: Trial balance: Generate consolidated TB across both entities; verify drilldown to source JEs\n' +
    'P2P: PO approval routing: Create PO at each tier; verify correct approver routed per double-tier policy\n' +
    'P2P: Three-way match: Enter vendor bill against PO + receipt; verify match status + GL impact\n' +
    'O2C: SO creation with pricelist: Create SO for tier-2 customer; verify wholesale pricelist applied\n' +
    'O2C: Invoice + dunning: Generate invoice from delivered SO; verify follow-up reminder cadence\n' +
    'MFG: Manufacturing order: Create MO for multi-level BOM; consume components; complete production\n' +
    'MFG: Quality check pass/fail: Trigger quality checkpoint mid-MO; verify hard-block on fail\n' +
    'INV: Lot tracking: Receive pharma lot; ship FEFO; verify expiry-date routing\n' +
    'CRM: Lead conversion: Convert lead to opportunity to quote to SO; verify pipeline stages',
  'testing.scope.testRoles':
    'AP Clerk: Test all P2P scenarios (PO + bill + payment)\n' +
    'AR Clerk: Test all O2C scenarios (SO + invoicing + collections)\n' +
    'Inventory Manager: Test all INV + MFG scenarios (lots + serials + expiry)\n' +
    'Mariam Saeed (Group Controller): Sign off on R2R scenarios + period close\n' +
    'Yousef Al-Rashid (CFO): Sign off on consolidated reports + final UAT gate',
  'testing.scope.acceptanceCriteriaTemplate': 'GIVEN_WHEN_THEN',
  'testing.performance.performanceBenchmarks':
    'PO creation: <2 seconds end-to-end\n' +
    'Trial balance generation across 2 entities + 38k inventory lines: <30 seconds\n' +
    'Inventory query 14.5k SKUs with lot expiry filter: <5 seconds\n' +
    'Period close batch (full reval + IFRS adjustments): <15 minutes\n' +
    'Consolidated AR aging across 8.5k customers: <8 seconds',
  'testing.performance.loadProfile':
    'Peak: 35 internal users + 50 portal users (month-end close window)\n' +
    'Steady: 25 internal users + 15 portal users (daily ops)\n' +
    'Off-peak: 5 internal users (overnight batch jobs)',
  'testing.regression.regressionSmokeScenarios':
    'Login as each role: User can log in + lands on correct dashboard\n' +
    'Create PO + approve: PO routes through double-tier approval correctly\n' +
    'Create SO + invoice: Invoice generated with correct pricelist applied\n' +
    'Run TB report: TB balances per entity + consolidated within 30s\n' +
    'Inventory query: 14.5k SKU dataset returns within 5s with filters',
  'testing.regression.defectSeverityLevels': 'STANDARD_4_LEVEL',

  // Pack U — TRAINING flow (cross-platform). Sahel exercises 5 roles
  // across the major Odoo apps + 2 champions + 4 sessions; HYBRID
  // cascade with LIVE_DEMO assessment.
  'training.curriculum.trainingPerRole':
    'AP Clerk: Vendor Bill Entry, 3-Way Match, Payment Run, Bank Reconciliation\n' +
    'AR Clerk: Customer Invoice Creation, Cash Application, Dunning Letters, AR Aging\n' +
    'CFO: Trial Balance Export, Multi-Entity Close, Financial Statements, Currency Revaluation\n' +
    'Inventory Manager: Item Master Setup, Cycle Count, Lot/Serial Tracking, FEFO Removal Strategy\n' +
    'Sales Manager: Lead-to-Quote, Sales Order Entry, Pricelist Management, Pipeline Reports',
  'training.curriculum.businessChampions':
    'Mariam Saeed: Group Controller — Accounting champion\n' +
    'Khaled Mansour: Workstream Lead — Inventory champion',
  'training.curriculum.cascadeStrategy': 'HYBRID',
  'training.schedule.trainingSessions':
    'Accounting End-to-End: 4 hours: AP Clerk + AR Clerk + Mariam Saeed\n' +
    'Multi-Entity Close + IFRS Reporting: 3 hours: CFO + Mariam Saeed\n' +
    'Inventory + Lot Tracking: 4 hours: Inventory Manager + Khaled Mansour\n' +
    'Sales + CRM End-to-End: 3 hours: Sales Manager + Sales team',
  'training.schedule.deliveryMode': 'HYBRID',
  'training.assessment.assessmentRequired': true,
  'training.assessment.assessmentFormat': 'LIVE_DEMO',

  // Pack V — CUTOVER flow (cross-platform). Sahel exercises BIG_BANG
  // cutover with 36h window, 5-person team, 3 dry runs.
  'cutover.team.cutoverTeamRoster':
    'Hesham Aglan: Consultant PM (overall command): T-1 → T+5 days continuous\n' +
    'Layla Hassan: Client PM: T-1 → T+5 days\n' +
    'Aisha Khalid: Migration lead: T0 → T+2 days continuous\n' +
    'Omar Reda: IT lead: T-1 → T+2 days\n' +
    'Mariam Saeed: Functional lead — finance: T0 → T+5 days',
  'cutover.team.dryRunCount': 3,
  'cutover.team.dryRunDates':
    'Dry Run 1: 2026-08-01: Data migration only — extract + transform + load\n' +
    'Dry Run 2: 2026-08-15: Full end-to-end with users\n' +
    'Dry Run 3: 2026-08-22: Final rehearsal — identical to production',
  'cutover.decisions.goNoGoCriteria':
    'Migration tie-out: 100% TB match across both entities\n' +
    'Smoke test pass rate: 100% of P0 scenarios green\n' +
    'No Critical defects open: zero\n' +
    'Performance benchmarks: all met under simulated peak load\n' +
    'IFRS reporting: consolidated TB reconciles to legacy snapshot\n' +
    'Lot tracking: pharma lot history complete + queryable',
  'cutover.decisions.goNoGoOwners':
    'Migration data: Mariam Saeed (Group Controller)\n' +
    'Functional readiness: Layla Hassan (Client PM)\n' +
    'Technical readiness: Hesham Aglan (Consultant PM)\n' +
    'Final go/no-go: Yousef Al-Rashid (CFO / Sponsor)',
  'cutover.decisions.rollbackTriggers':
    'Critical defect found in core finance flow with no workaround\n' +
    'Migration tie-out fails for >1% of records and cannot be reconciled within 2h\n' +
    'System unavailable for >30 min during cutover window\n' +
    'IFRS consolidation fails to balance and root cause not identified within 4h',
  'cutover.communication.cutoverMilestones':
    'Pre-freeze starts: All users + Sponsor\n' +
    'Cutover begins: Steering + Sponsor + Department Heads\n' +
    'Migration complete: Steering + IT\n' +
    'Smoke pass / go declared: All users + Sponsor + Sales channel\n' +
    'Day 1 hypercare check-in: Steering + IT\n' +
    'Day 7 hypercare review: Steering + Sponsor',
  'cutover.communication.escalationContacts':
    'Tariq Al-Otaibi (Group CEO): only if rollback triggered\n' +
    'Odoo Support (OdooSH): if database recovery needed during cutover\n' +
    'Banking partner (Emirates NBD): if intercompany payment files fail\n' +
    'External auditor (BDO): if IFRS consolidation issues persist',

  // Pack X — HYPERCARE flow (cross-platform). Sahel exercises a 14-day
  // hypercare with a 3-person team, STANDARD_4_LEVEL severity, KSA
  // business hours.
  'hypercare.team.hypercareLeadName': 'Aisha Khalid',
  'hypercare.team.hypercareTeamRoster':
    'Aisha Khalid | Hypercare Lead — Odoo Senior Consultant | Sun-Thu 08:00-18:00 GMT+4 | +971-50-xxx-2001\n' +
    'Mariam Saeed | Functional Lead — Group Controller | Sun-Thu 08:00-17:00 GMT+4 | +971-50-xxx-2002\n' +
    'Omar Reda | Inventory + MRP Power-User Coach | Sun-Thu 09:00-17:00 GMT+4 | +971-50-xxx-2003',
  'hypercare.team.sustainmentOwner':
    'Sahel Logistics Internal IT — Sara Mahmoud (Head of IT) + 2-person ops team',
  'hypercare.sla.hypercareDurationDays': 14,
  'hypercare.sla.severityDefinitions':
    'S1 | Production halted, no workaround | Period close blocked, IFRS consolidation broken\n' +
    'S2 | Major function impaired, workaround exists | Lot tracking misaligned, Studio dashboard wrong\n' +
    'S3 | Minor function impaired or single-user | Field validation issue, single user permission gap\n' +
    'S4 | Cosmetic or enhancement | Label typo, dashboard color',
  'hypercare.sla.responseTimeBySeverity':
    'S1 | 30 minutes | 4 hours\n' +
    'S2 | 2 business hours | 1 business day\n' +
    'S3 | 1 business day | 5 business days\n' +
    'S4 | 5 business days | Backlog',
  'hypercare.sla.businessHoursDefinition':
    'Sun-Thu 08:00-17:00 GMT+4 (UAE business hours). Fri-Sat off. After-hours on-call only for S1.',
  'hypercare.cadence.dailyStandupTime': '09:30 GMT+4 daily',
  'hypercare.cadence.weeklyReviewTime': 'Thu 14:00 GMT+4',
  'hypercare.cadence.warRoomHours':
    'T+1 to T+5: full team in war-room 08:00-18:00 GMT+4. T+6 to T+10: war-room 09:00-13:00 GMT+4. T+11 to T+14: standup-only, async on Slack.',
  'hypercare.cadence.hypercareExitCriteria':
    'Zero S1 open for 5 consecutive business days\n' +
    'Zero S2 open more than 5 business days\n' +
    'First month-end IFRS close completed within 5 business days\n' +
    'Lot/serial tracking integrity verified across 14.5k SKUs\n' +
    'User adoption ≥ 85% of named users posting at least 1 transaction in trailing 7 days\n' +
    'Sponsor (Yousef Al-Rashid) sign-off captured',

  // Pack Y — STABILIZATION flow (cross-platform). Sahel exercises a
  // 3-person committee, simpler 5-row business case, single retro
  // session pattern.
  'stabilization.governance.stabilizationOwner':
    'Sahel Logistics Internal IT — Sara Mahmoud (Head of IT)',
  'stabilization.governance.governanceCommittee':
    'Sara Mahmoud | Head of IT | IT chair\n' +
    'Yousef Al-Rashid | CFO | Finance + sponsor\n' +
    'Layla Hassan | Group Controller | Operations + accounting\n' +
    'Aisha Khalid | Senior Odoo Consultant | Vendor continuity',
  'stabilization.governance.decisionCadence':
    'Monthly steering meeting (last Sunday), quarterly business review, annual board readout',
  'stabilization.governance.changeRequestProcess':
    'Submit via internal IT helpdesk\n' +
    'Triage at weekly IT meeting (every Sunday morning)\n' +
    'Estimate by Aisha Khalid (consultant continuity) within 5 business days\n' +
    'Prioritize at monthly steering\n' +
    'Build via OdooSH staging branch\n' +
    'Release after staging UAT + functional lead sign-off',
  'stabilization.benefits.businessCaseSummary':
    'Close cycle days | 8 | 4 | T+90\n' +
    'Manual reconciliations per period | 35 | 10 | T+180\n' +
    'IFRS reporting prep effort | High (manual) | Automated | T+30\n' +
    'Days-sales-outstanding | 55 | 45 | T+180\n' +
    'Lot/serial query response time | 2-4 hours | < 5 minutes | T+60',
  'stabilization.benefits.benefitsReviewCadence':
    'Quarterly to steering committee, annual to board',
  'stabilization.benefits.benefitsReviewOwner':
    'Yousef Al-Rashid (CFO) — accountable; Layla Hassan (Group Controller) — measurement support',
  'stabilization.backlog.deferredFeatures':
    'Advanced demand forecasting | Dataset incomplete pre-cutover | T+90 enhancement\n' +
    'Customer-portal self-service | Pilot scope | T+180\n' +
    'Multi-warehouse routing optimisation | Phase 2 | T+270',
  'stabilization.backlog.knownLimitations':
    'IFRS revaluation must be triggered manually at period end | manual cron trigger | temporary, automating in T+90 enhancement\n' +
    'Lot expiry alerts only fire at 30-day window | configure additional 7/14-day alerts | permanent, by-design',
  'stabilization.backlog.phaseTwoScope':
    'Demand forecasting integration | Reduce stock-out incidents by ~30% | T+180\n' +
    'Customer self-service portal | Reduce inbound CS volume by ~25% | T+180\n' +
    'Mobile field-ops app | Replace paper-based receiving | T+270',
  'stabilization.learning.retroFormat':
    'Half-day workshop with project + business + ops + sponsor (in-person at Sahel HQ)',
  'stabilization.learning.retroDate':
    'T+45 — first Sunday of month following hypercare exit (i.e. ~2026-10-25)',
  'stabilization.learning.lessonsLearnedSeed':
    'Data quality | Vendor master had 9% duplicates pre-cutover | Migration window stretched 4 hours | Add proactive dedup pass to standard playbook\n' +
    'Sponsor engagement | Yousef attended every UAT sign-off | Approvals moved fast, ambiguity resolved same-day | Replicate exec-attendance pattern in phase 2',

  // ── Pack Z — Data Migration Assets (cross-platform) ─────────────────────────
  // Sahel migrates from a legacy Tally + Excel landscape: Tally ERP 9 (AE
  // entity), Excel master files (EG entity), and a Microsoft Access
  // inventory database. No Salesforce — customer master comes from Tally
  // direct. MRP + Quality modules require BOMs to load.
  'migration.details.sourceSystemsByObject':
    'Customers | Tally ERP 9 (AE entity) + Excel customer master (EG entity) | Tally has full transaction history; Excel for EG ledger needs format-normalisation\n' +
    'Vendors | Tally ERP 9 + Excel vendor master | Two sources; consolidate by tax ID + IBAN before extract\n' +
    'Products | Tally + Microsoft Access inventory DB | Access has SKU + UoM + cost; Tally has selling prices; consolidate via product code\n' +
    'Chart of Accounts | Tally ERP 9 (AE — canonical) | Map EG accounts to AE chart in mapping workbook\n' +
    'Open Customer Invoices | Tally + Excel AR ledgers | Net against credit notes in source before extract\n' +
    'Open Vendor Bills | Tally + Excel AP ledgers | Same as AR — net pre-extract\n' +
    'GL Opening Balances | Auditor-signed FY2025 trial balance (per company) | Source-of-truth is the auditor sign-off\n' +
    'Inventory Opening Balances | Microsoft Access inventory database | Reconcile to Tally cost layer; flag negative on-hand\n' +
    'BOMs | Excel master file (production team maintained) | Production team owns master; consolidate routes per workcenter',
  'migration.details.cleansingRulesByObject':
    'Customers | Trim whitespace; uppercase tax IDs; standardise country codes (Tally uses inconsistent abbrevs); merge by tax ID + country | Aisha Khalid (consultant — accounting)\n' +
    'Vendors | Trim whitespace; verify IBAN format; flag bank accounts changed in last 90 days for fraud review | Layla Hassan (Sahel — group controller)\n' +
    'Products | Standardise UoM codes (Tally + Access use different conventions); convert prices to AED ledger; flag zero-movement SKUs for archive | Khaled Mansour (Sahel — inventory lead)\n' +
    'Chart of Accounts | Map EG accounts to AE canonical chart; verify hierarchy before export; flag any non-mapped accounts to controller | Layla Hassan (Sahel — group controller)\n' +
    'Open Customer / Vendor | Net invoices against credit notes; flag aged > 365 days for write-off review; convert to company base currency | Mariam Saeed (Sahel — accounting + tax lead)\n' +
    'GL Opening Balances | Trial balance must net to zero per company; intercompany must reconcile to elimination journal; auditor sign-off required | Yousef Al-Rashid (Sahel — CFO)\n' +
    'Inventory Opening Balances | Reconcile Access vs Tally cost layer; capture cycle-count adjustments separately; flag negative quantities | Khaled Mansour (Sahel — inventory lead)\n' +
    'BOMs | Standardise component product codes; verify UoM consistency vs products master; flag obsolete BOMs for archive | Omar Reda (consultant — inventory + MRP)',
  'migration.details.rejectSlaByObject':
    'Customers | < 0.5% rejects | 24h re-load\n' +
    'Vendors | < 0.5% rejects | 24h re-load\n' +
    'Products | < 1% rejects | 48h re-load\n' +
    'Chart of Accounts | 0 rejects | 4h re-load (financial)\n' +
    'Open Customer Invoices | 0 rejects | 4h re-load (financial — must clear before next dry-run)\n' +
    'Open Vendor Bills | 0 rejects | 4h re-load (financial — must clear before next dry-run)\n' +
    'GL Opening Balances | 0 rejects | 4h re-load (financial — must clear before sign-off)\n' +
    'Inventory Opening Balances | < 0.5% rejects | 24h re-load\n' +
    'BOMs | < 1% rejects | 48h re-load',
  'migration.details.historicalDataDepth':
    'Current FY 2026 — full detail (open + closed transactions). FY 2024 + FY 2025 — summary balances + selected high-value transactions only (> AED 100k or > 90d aged). Older — archived in Tally backup, not migrated. Auditor briefed on retention plan.',
  'migration.readiness.dryRunPassThreshold':
    '99.5% records loaded clean across all objects, 0 financial-object rejects, trial balance nets to zero per company',
  'migration.readiness.dataQualityOwners':
    'Customers | Layla Hassan | Mariam Saeed\n' +
    'Vendors | Layla Hassan | Mariam Saeed\n' +
    'Products | Khaled Mansour | Layla Hassan\n' +
    'Chart of Accounts | Yousef Al-Rashid | Layla Hassan\n' +
    'Open Customer / Vendor | Mariam Saeed | Layla Hassan\n' +
    'GL Opening Balances | Yousef Al-Rashid | Layla Hassan\n' +
    'Inventory Opening Balances | Khaled Mansour | Layla Hassan\n' +
    'BOMs | Omar Reda | Khaled Mansour',
  'migration.readiness.migrationCutoffDate':
    '2026-09-10 — last business day before go-live; final source extracts pulled at 16:00 GST',

  // ── Pack ZZ — Integration Runbooks (cross-platform, KSA-specific) ───────────
  // Sahel runs a KSA-localized integration set: ZATCA Phase 2 e-invoicing
  // (mandatory), SNB bank statement + SARIE payment file, Salla e-commerce
  // (KSA marketplace), Power BI for reporting, native Odoo Sign for
  // contracts. No NetSuite-specific tooling.
  'integrations.catalog.integrationCatalog':
    'ZATCA E-Invoicing Phase 2 | Transactional API | Outbound | Realtime per invoice | Native Odoo KSA localization + ZATCA SDK | Saudi Government (ZATCA)\n' +
    'Saudi National Bank Statement | File drop | Inbound | Daily | SFTP + Odoo bank statement import | SNB\n' +
    'SARIE Payment File | File drop | Outbound | Daily | Odoo SEPA-style payment module + SARIE format export | SAMA\n' +
    'Salla E-commerce Orders | Transactional | Inbound | Realtime via webhook | Odoo Salla connector | Salla\n' +
    'Power BI Reporting | Master-data + Transactional | Outbound | Hourly | PostgreSQL views + Power BI gateway | Microsoft\n' +
    'Native Odoo Sign | Event | Internal | On-demand per SO | OOTB | Odoo SA',
  'integrations.catalog.integrationOwnersByName':
    'ZATCA E-Invoicing Phase 2 | Aisha Khalid | Yousef Al-Rashid\n' +
    'Saudi National Bank Statement | Aisha Khalid | AP clerk\n' +
    'SARIE Payment File | Aisha Khalid | Yousef Al-Rashid\n' +
    'Salla E-commerce Orders | Mariam Saeed | Aisha Khalid\n' +
    'Power BI Reporting | Sara Mahmoud | Aisha Khalid\n' +
    'Native Odoo Sign | Mariam Saeed | Aisha Khalid',
  'integrations.reliability.integrationAuthMethods':
    'ZATCA E-Invoicing Phase 2 | Cryptographic stamp identifier (CSID) per device | Annual ZATCA renewal | Aisha Khalid\n' +
    'Saudi National Bank Statement | SFTP password | 90 days | Sara Mahmoud\n' +
    'SARIE Payment File | SFTP key pair | 180 days | Sara Mahmoud\n' +
    'Salla E-commerce Orders | OAuth 2.0 + webhook signature | 365 days | Mariam Saeed\n' +
    'Power BI Reporting | PostgreSQL service account password | 90 days | Sara Mahmoud',
  'integrations.reliability.integrationMonitoring':
    'ZATCA E-Invoicing Phase 2 | Clearance rate | 100% | 99-100% | < 99%\n' +
    'Saudi National Bank Statement | Daily file received by 08:00 KSA | yes | delayed < 2h | missing or > 2h\n' +
    'SARIE Payment File | File transmission ack | < 30min | 30min-2h | > 2h\n' +
    'Salla E-commerce Orders | Webhook delivery success | > 99% | 95-99% | < 95%\n' +
    'Power BI Reporting | Hourly refresh success | yes | 1 miss | 2+ misses',
  'integrations.reliability.integrationErrorPatterns':
    'ZATCA E-Invoicing Phase 2 | Clearance rejected (validation) | Read ZATCA error code; correct invoice; resubmit; if structural issue page Aisha Khalid\n' +
    "ZATCA E-Invoicing Phase 2 | Clearance timeout | Retry per ZATCA backoff guidance; queue invoice as pending clearance (allowed for limited window per ZATCA rules)\n" +
    'Saudi National Bank Statement | File format change | Compare file vs. last known good; contact SNB; pause auto-import until format adapter updated\n' +
    'SARIE Payment File | Beneficiary IBAN rejected | Page Aisha Khalid; verify IBAN against bank pre-validation; correct vendor master + retry\n' +
    'Salla E-commerce Orders | Currency mismatch | Salla in SAR only; flag and quarantine non-SAR orders\n' +
    'Power BI Reporting | Schema drift | Power BI dataset refresh fails; Sara Mahmoud reviews source view changes; update dataset or rollback',
  'integrations.support.integrationVendorContacts':
    'ZATCA E-Invoicing Phase 2 | https://zatca.gov.sa support portal + 19993 | 24h business | None - government channel only\n' +
    'Saudi National Bank Statement | SNB Corporate Service +966-9200-1000 | 4h business hours | RM Khalid Al-Mutairi\n' +
    'SARIE Payment File | SNB Treasury / SAMA SARIE support | 4h business hours | RM Khalid Al-Mutairi\n' +
    'Salla E-commerce Orders | Salla Merchant Support via dashboard | 8h business | Account manager Tariq Al-Harbi\n' +
    'Power BI Reporting | Microsoft 365 admin support | 8h | TAM via M365 admin center',
  'integrations.support.integrationReconciliation':
    'ZATCA E-Invoicing Phase 2 | Daily clearance vs. invoiced | Aisha Khalid\n' +
    'Saudi National Bank Statement | Daily | AP clerk\n' +
    'SARIE Payment File | Per file + Weekly settlement match | Aisha Khalid\n' +
    'Salla E-commerce Orders | Daily order count + sum | Mariam Saeed\n' +
    'Power BI Reporting | Daily refresh log audit | Sara Mahmoud',
  'integrations.support.integrationCutoverSmokeTests':
    'ZATCA E-Invoicing Phase 2 | Clear 1 test invoice in sandbox | Confirm first 10 production invoices clear within ZATCA SLA\n' +
    "Saudi National Bank Statement | Receive + parse 1 historical SNB file | Confirm first production day's file received by 09:00 KSA\n" +
    'SARIE Payment File | Generate + transmit 1 zero-amount file | Confirm first production payment run cleared\n' +
    'Salla E-commerce Orders | Sync 1 test order | Confirm first 24h of orders reconcile order-for-order',
};
const comments = [
  { sectionKey: 'license', text: 'Enterprise edition confirmed; Studio + Documents required for approval matrix + contract storage. MRP + Quality modules for the two production lines.' },
  { sectionKey: 'r2r.company', text: 'Two legal entities: Sahel Logistics Holding (parent) and Sahel Freight Forwarding (sub). Multi-company enabled to share partners and pricelists. Fiscal year Jan–Dec for both.' },
  { sectionKey: 'o2c.sales', text: 'Pricelist tiers: Wholesale, Retail, Contract. Customers tagged at onboarding. Automated renewal reminders for contract-tier customers go via Studio flow.' },
];
const images: unknown[] = [];
const aiAdvice: unknown[] = [];
const conflicts: unknown[] = [];

// Engagement project members — drives kickoff Stakeholder Map + RACI auto-fill.
const members: KickoffMember[] = [
  { name: 'Yousef Al-Rashid', role: 'Project Sponsor / CFO', team: 'CLIENT', email: 'yousef.al-rashid@sahel-logistics.ae' },
  { name: 'Layla Hassan', role: 'Project Manager / Group Controller', team: 'CLIENT', email: 'layla.hassan@sahel-logistics.ae' },
  { name: 'Mariam Saeed', role: 'Workstream Lead — Accounting & Tax', team: 'CLIENT', email: 'mariam.saeed@sahel-logistics.ae' },
  { name: 'Khaled Mansour', role: 'Workstream Lead — Inventory & Logistics', team: 'CLIENT', email: 'khaled.mansour@sahel-logistics.ae' },
  { name: 'Hesham Aglan', role: 'Consultant Project Manager', team: 'CONSULTANT', email: 'hesham@erplaunch.io' },
  { name: 'Aisha Khalid', role: 'Senior Odoo Consultant — Accounting', team: 'CONSULTANT', email: 'aisha@erplaunch.io' },
  { name: 'Omar Reda', role: 'Senior Odoo Consultant — Inventory & MRP', team: 'CONSULTANT', email: 'omar@erplaunch.io' },
];

// ── Output folder ───────────────────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const outRoot = path.join(NSIX_ROOT, 'ODOO_DEMO_BUNDLE', ts);
const docDir = path.join(outRoot, 'Documentation');
await fs.mkdir(docDir, { recursive: true });

// ── Generate ────────────────────────────────────────────────────────────────
const brdData = { clientName, adaptor, license, answers, comments, images, aiAdvice };
const kickoffData = { clientName, adaptor, answers, members };
const sddData = { clientName, adaptor, license, answers, conflicts: conflicts as never[], comments, images, aiAdvice };
const trainingData = { clientName, adaptor, answers, comments, images, aiAdvice };
const uatData = { clientName, adaptor, answers, comments, images, aiAdvice };
const planData = { clientName, adaptor, license, answers, conflicts: conflicts as never[] };
const configPlanData = { clientName, adaptor, license, answers, comments, images, aiAdvice };
const riskData = { clientName, conflicts: [], warnings: [] };

// ── Pack T — Test Artifacts (cross-platform — runs for Odoo too) ────────────
const signoffMembers: SignOffMember[] = members.map((m) => ({
  name: m.name,
  role: m.role,
  team: m.team,
}));
const testScriptsResult = generateTestScripts({
  scenariosPerWorkstream: answers['testing.scope.scenariosPerWorkstream'] as string,
  testRoles: answers['testing.scope.testRoles'] as string,
  acceptanceCriteriaTemplate: answers['testing.scope.acceptanceCriteriaTemplate'] as string,
  adaptorName: 'Odoo',
});
const signOffResult = generateSignOffMatrix({
  clientName,
  scenariosPerWorkstream: answers['testing.scope.scenariosPerWorkstream'] as string,
  testRoles: answers['testing.scope.testRoles'] as string,
  members: signoffMembers,
  adaptorName: 'Odoo',
});
const defectLogResult = generateDefectLogTemplate({
  clientName,
  defectSeverityLevels: answers['testing.regression.defectSeverityLevels'] as string,
  adaptorName: 'Odoo',
});
const perfPlanResult = generatePerformanceTestPlan({
  clientName,
  performanceBenchmarks: answers['testing.performance.performanceBenchmarks'] as string,
  loadProfile: answers['testing.performance.loadProfile'] as string,
  adaptorName: 'Odoo',
});
const regressionResult = generateRegressionTestSuite({
  clientName,
  regressionSmokeScenarios: answers['testing.regression.regressionSmokeScenarios'] as string,
  adaptorName: 'Odoo',
});

// ── Pack U — Training Collateral (cross-platform — runs on Odoo too) ────────
const perRoleResult = generatePerRoleTrainingGuides({
  clientName,
  trainingPerRole: answers['training.curriculum.trainingPerRole'] as string,
  cascadeStrategy: answers['training.curriculum.cascadeStrategy'] as string,
  deliveryMode: answers['training.schedule.deliveryMode'] as string,
  assessmentRequired: answers['training.assessment.assessmentRequired'] === true,
  assessmentFormat: answers['training.assessment.assessmentFormat'] as string,
  adaptorName: 'Odoo',
});
const qrcResult = generateQuickReferenceCards({
  clientName,
  adaptorName: 'Odoo',
  poApprovalInScope: true,
  multiCurrencyInScope: answers['odoo.foundation.multiCurrency'] === true,
  mfgInScope: Object.keys(answers).some((k) => k.startsWith('odoo.mfg.')),
  inventoryInScope: Object.keys(answers).some((k) => k.startsWith('odoo.inventory.')),
});
const trainingMatrixResult = generateTrainingMatrix({
  clientName,
  adaptorName: 'Odoo',
  trainingPerRole: answers['training.curriculum.trainingPerRole'] as string,
  // Sahel scope: Odoo apps R2R/P2P/O2C/INV/MFG/RTN/CRM/HR — all in.
  r2rInScope: true,
  p2pInScope: true,
  o2cInScope: true,
  invInScope: true,
  mfgInScope: true,
  rtnInScope: true,
  crmInScope: true,
  hrInScope: true,
});
const trainingScheduleResult = generateTrainingSchedule({
  clientName,
  adaptorName: 'Odoo',
  trainingSessions: answers['training.schedule.trainingSessions'] as string,
  deliveryMode: answers['training.schedule.deliveryMode'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});
const ktResult = generateKnowledgeTransferChecklist({
  clientName,
  adaptorName: 'Odoo',
  cascadeStrategy: answers['training.curriculum.cascadeStrategy'] as string,
  workstreamsInScope: ['R2R', 'P2P', 'O2C', 'INV', 'MFG', 'RTN', 'CRM', 'HR'],
});

// ── Pack V — Cutover Runbook (cross-platform — runs on Odoo too) ────────────
const cutoverStyle = (answers['odoo.migration.cutoverStyle'] as string) ?? 'BIG_BANG';
const cutoverWindowHours =
  (answers['odoo.migration.cutoverWindowHours'] as number | undefined) ?? 36;
const cutoverPreFreezeDays = (answers['odoo.migration.preFreezeDays'] as number | undefined) ?? 3;

const runbookResult = generateCutoverRunbook({
  clientName,
  adaptorName: 'Odoo',
  cutoverStyle,
  cutoverWindowHours,
  preFreezeDays: cutoverPreFreezeDays,
  cutoverTeamRoster: answers['cutover.team.cutoverTeamRoster'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
  dryRunDates: answers['cutover.team.dryRunDates'] as string,
});
const goNoGoResult = generateGoNoGoMatrix({
  clientName,
  adaptorName: 'Odoo',
  goNoGoCriteria: answers['cutover.decisions.goNoGoCriteria'] as string,
  goNoGoOwners: answers['cutover.decisions.goNoGoOwners'] as string,
  cutoverWindowHours,
});
const rollbackResult = generateRollbackPlan({
  clientName,
  adaptorName: 'Odoo',
  rollbackTriggers: answers['cutover.decisions.rollbackTriggers'] as string,
  cutoverStyle,
});
const cutoverRoles = (answers['training.curriculum.trainingPerRole'] as string)
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.length > 0)
  .map((l) => {
    const idx = l.indexOf(':');
    return idx < 0 ? l : l.slice(0, idx).trim();
  });
const smokeResult = generatePostCutoverSmoke({
  clientName,
  adaptorName: 'Odoo',
  regressionSmokeScenarios: answers['testing.regression.regressionSmokeScenarios'] as string,
  poApprovalInScope: true,
  multiCurrencyInScope: answers['odoo.foundation.multiCurrency'] === true,
  ssoInScope: false,
  roles: cutoverRoles,
});
const commPlanResult = generateCutoverCommPlan({
  clientName,
  adaptorName: 'Odoo',
  cutoverMilestones: answers['cutover.communication.cutoverMilestones'] as string,
  escalationContacts: answers['cutover.communication.escalationContacts'] as string,
  cutoverTeamRoster: answers['cutover.team.cutoverTeamRoster'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
  cutoverWindowHours,
});
const dryRunResult = generateDryRunPlan({
  clientName,
  adaptorName: 'Odoo',
  dryRunCount: answers['cutover.team.dryRunCount'] as number,
  dryRunDates: answers['cutover.team.dryRunDates'] as string,
  cutoverStyle,
});
const teamRosterResult = generateCutoverTeamRoster({
  clientName,
  adaptorName: 'Odoo',
  cutoverTeamRoster: answers['cutover.team.cutoverTeamRoster'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});

// ── Pack X — Hypercare Program (cross-platform — runs on Odoo too) ──────────
const hypercareDurationDays = (answers['hypercare.sla.hypercareDurationDays'] as number) ?? 14;
const hypercarePlanResult = generateHypercarePlan({
  clientName,
  adaptorName: 'Odoo',
  hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string,
  hypercareTeamRoster: answers['hypercare.team.hypercareTeamRoster'] as string,
  sustainmentOwner: answers['hypercare.team.sustainmentOwner'] as string,
  hypercareDurationDays,
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
  adaptorName: 'Odoo',
  hypercareDurationDays,
});
const escalationMatrixResult = generateIssueEscalationMatrix({
  clientName,
  adaptorName: 'Odoo',
  hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string,
  severityDefinitions: answers['hypercare.sla.severityDefinitions'] as string,
  responseTimeBySeverity: answers['hypercare.sla.responseTimeBySeverity'] as string,
});
const warRoomResult = generateWarRoomSop({
  clientName,
  adaptorName: 'Odoo',
  hypercareDurationDays,
  warRoomHours: answers['hypercare.cadence.warRoomHours'] as string,
  hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string,
  dailyStandupTime: answers['hypercare.cadence.dailyStandupTime'] as string,
});
const transitionResult = generateTransitionToSupportPlan({
  clientName,
  adaptorName: 'Odoo',
  sustainmentOwner: answers['hypercare.team.sustainmentOwner'] as string,
  hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string,
  hypercareDurationDays,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});
const kpiDashboardResult = generateHypercareKpiDashboard({
  clientName,
  adaptorName: 'Odoo',
  hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string,
});
const officeHoursResult = generatePowerUserOfficeHours({
  clientName,
  adaptorName: 'Odoo',
  hypercareDurationDays,
  hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string,
  workstreamsInScope: ['R2R', 'P2P', 'O2C', 'INV', 'MFG', 'RTN', 'CRM', 'HR'],
});

// ── Pack Y — Stabilization Roadmap (cross-platform — runs on Odoo too) ──────
const stabRoadmapResult = generateStabilizationRoadmap({
  clientName,
  adaptorName: 'Odoo',
  stabilizationOwner: answers['stabilization.governance.stabilizationOwner'] as string,
  governanceCommittee: answers['stabilization.governance.governanceCommittee'] as string,
  decisionCadence: answers['stabilization.governance.decisionCadence'] as string,
  phaseTwoScope: answers['stabilization.backlog.phaseTwoScope'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});
const lessonsResult = generateLessonsLearned({
  clientName,
  adaptorName: 'Odoo',
  retroFormat: answers['stabilization.learning.retroFormat'] as string,
  retroDate: answers['stabilization.learning.retroDate'] as string,
  lessonsLearnedSeed: answers['stabilization.learning.lessonsLearnedSeed'] as string,
  stabilizationOwner: answers['stabilization.governance.stabilizationOwner'] as string,
});
const benefitsResult = generateBenefitsRealizationTracker({
  clientName,
  adaptorName: 'Odoo',
  businessCaseSummary: answers['stabilization.benefits.businessCaseSummary'] as string,
  benefitsReviewCadence: answers['stabilization.benefits.benefitsReviewCadence'] as string,
  benefitsReviewOwner: answers['stabilization.benefits.benefitsReviewOwner'] as string,
});
const processBacklogResult = generateProcessImprovementBacklog({
  clientName,
  adaptorName: 'Odoo',
  deferredFeatures: answers['stabilization.backlog.deferredFeatures'] as string,
  knownLimitations: answers['stabilization.backlog.knownLimitations'] as string,
  phaseTwoScope: answers['stabilization.backlog.phaseTwoScope'] as string,
});
const governanceResult = generateContinuousImprovementGovernance({
  clientName,
  adaptorName: 'Odoo',
  governanceCommittee: answers['stabilization.governance.governanceCommittee'] as string,
  decisionCadence: answers['stabilization.governance.decisionCadence'] as string,
  changeRequestProcess: answers['stabilization.governance.changeRequestProcess'] as string,
  stabilizationOwner: answers['stabilization.governance.stabilizationOwner'] as string,
});
const kpiEvolutionResult = generateKpiEvolutionPlan({
  clientName,
  adaptorName: 'Odoo',
  businessCaseSummary: answers['stabilization.benefits.businessCaseSummary'] as string,
  hypercareDailyStandupTime: answers['hypercare.cadence.dailyStandupTime'] as string,
});
const phaseTwoResult = generatePhaseTwoCharter({
  clientName,
  adaptorName: 'Odoo',
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
  ['Configuration_Plan.md', generateOdooConfigurationPlan(configPlanData)],
  ['Configuration_Plan.html', generateOdooConfigurationPlanHtml(configPlanData)],
  // Pack T artefacts.
  ['Sign_Off_Matrix.md', signOffResult.markdown],
  ['Sign_Off_Matrix.html', signOffResult.html],
  ['Defect_Log_Template.md', defectLogResult.markdown],
  ['Performance_Test_Plan.md', perfPlanResult.markdown],
  ['Performance_Test_Plan.html', perfPlanResult.html],
  ['Regression_Test_Suite.md', regressionResult.markdown],
  ['Regression_Test_Suite.html', regressionResult.html],
  // Pack U artefacts — cross-cutting docs at the top level. Per-role
  // guides + QRCs go into Documentation/Training/ subfolders below.
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

// Pack T — Test_Scripts/ subfolder. Generator emits each TC-*.md keyed
// by its full bundle-relative path (Documentation/Test_Scripts/...).
// Strip the Documentation/ prefix, mkdir -p the parent, and write.
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
// Same path-stripping trick as Test_Scripts above.
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
  adaptorName: 'Odoo',
  answers,
});
const fieldMappingResult = generateFieldMappingWorkbook({
  clientName,
  adaptorName: 'Odoo',
  answers,
  sourceSystemsByObject: answers['migration.details.sourceSystemsByObject'] as string,
});
const reconQueriesResult = generateReconciliationQueries({
  clientName,
  adaptorName: 'Odoo',
  answers,
});
const cleansingRulesResult = generateMigrationCleansingRules({
  clientName,
  adaptorName: 'Odoo',
  cleansingRulesByObject: answers['migration.details.cleansingRulesByObject'] as string,
  dataQualityOwners: answers['migration.readiness.dataQualityOwners'] as string,
});
const loadSequencingResult = generateMigrationLoadSequencing({
  clientName,
  adaptorName: 'Odoo',
  answers,
});
const migrationRunbookResult = generateMigrationRunbook({
  clientName,
  adaptorName: 'Odoo',
  answers,
  historicalDataDepth: answers['migration.details.historicalDataDepth'] as string,
  dryRunPassThreshold: answers['migration.readiness.dryRunPassThreshold'] as string,
  migrationCutoffDate: answers['migration.readiness.migrationCutoffDate'] as string,
  targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string,
});
const rejectPlaybookResult = generateRejectHandlingPlaybook({
  clientName,
  adaptorName: 'Odoo',
  rejectSlaByObject: answers['migration.details.rejectSlaByObject'] as string,
});
const dqScorecardResult = generateDataQualityScorecard({
  clientName,
  adaptorName: 'Odoo',
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

// Pack ZZ — Integrations/ subfolder (6 markdown + Runbooks/ with one .md per integration).
const integrationsDir = path.join(docDir, 'Integrations');
const integrationsRunbooksDir = path.join(integrationsDir, 'Runbooks');
await fs.mkdir(integrationsRunbooksDir, { recursive: true });

const integrationsIndexResult = generateIntegrationsIndex({
  clientName,
  adaptorName: 'Odoo',
  answers,
  integrationOwnersByName: answers['integrations.catalog.integrationOwnersByName'] as string,
  integrationVendorContacts: answers['integrations.support.integrationVendorContacts'] as string,
});
const integrationCatalogResult = generateIntegrationCatalog({
  clientName,
  adaptorName: 'Odoo',
  answers,
  integrationOwnersByName: answers['integrations.catalog.integrationOwnersByName'] as string,
  integrationVendorContacts: answers['integrations.support.integrationVendorContacts'] as string,
});
const integrationHealthResult = generateIntegrationHealthDashboard({
  clientName,
  adaptorName: 'Odoo',
  answers,
  integrationMonitoring: answers['integrations.reliability.integrationMonitoring'] as string,
  integrationOwnersByName: answers['integrations.catalog.integrationOwnersByName'] as string,
});
const integrationReconResult = generateIntegrationReconciliationProcedures({
  clientName,
  adaptorName: 'Odoo',
  answers,
  integrationReconciliation: answers['integrations.support.integrationReconciliation'] as string,
  integrationOwnersByName: answers['integrations.catalog.integrationOwnersByName'] as string,
});
const integrationVendorEscResult = generateIntegrationVendorEscalationMatrix({
  clientName,
  adaptorName: 'Odoo',
  answers,
  integrationVendorContacts: answers['integrations.support.integrationVendorContacts'] as string,
  integrationOwnersByName: answers['integrations.catalog.integrationOwnersByName'] as string,
});
const integrationTestPlanResult = generateIntegrationTestPlan({
  clientName,
  adaptorName: 'Odoo',
  answers,
  integrationCutoverSmokeTests: answers['integrations.support.integrationCutoverSmokeTests'] as string,
});
const integrationRunbooksResult = generateIntegrationRunbookBundle({
  clientName,
  adaptorName: 'Odoo',
  answers,
  integrationOwnersByName: answers['integrations.catalog.integrationOwnersByName'] as string,
  integrationAuthMethods: answers['integrations.reliability.integrationAuthMethods'] as string,
  integrationMonitoring: answers['integrations.reliability.integrationMonitoring'] as string,
  integrationErrorPatterns: answers['integrations.reliability.integrationErrorPatterns'] as string,
  integrationVendorContacts: answers['integrations.support.integrationVendorContacts'] as string,
  integrationReconciliation: answers['integrations.support.integrationReconciliation'] as string,
  integrationCutoverSmokeTests: answers['integrations.support.integrationCutoverSmokeTests'] as string,
});

const integrationsWrites: Array<[string, string]> = [
  ['README.md', integrationsIndexResult.markdown],
  ['Integration_Catalog.md', integrationCatalogResult.markdown],
  ['Integration_Health_Dashboard.md', integrationHealthResult.markdown],
  ['Reconciliation_Procedures.md', integrationReconResult.markdown],
  ['Vendor_Escalation_Matrix.md', integrationVendorEscResult.markdown],
  ['Integration_Test_Plan.md', integrationTestPlanResult.markdown],
];
for (const [filename, content] of integrationsWrites) {
  await fs.writeFile(path.join(integrationsDir, filename), content, 'utf8');
  process.stdout.write(`  ✓ Integrations/${filename}\n`);
}
const integrationRunbookWrites: Array<[string, string]> = Object.entries(
  integrationRunbooksResult.files,
);
for (const [filename, content] of integrationRunbookWrites) {
  await fs.writeFile(path.join(integrationsRunbooksDir, filename), content, 'utf8');
  process.stdout.write(`  ✓ Integrations/Runbooks/${filename}\n`);
}

// ── Banlist verification ────────────────────────────────────────────────────
// Scope intentionally limited to the top-level docs + Pack Z's new
// data-migration set + Pack ZZ's integration set. Each prior pack's
// subfolder content (Cutover/, Hypercare/, Stabilization/) is covered
// by its own generator-level unit tests that gate non-leakage.
const BANNED = ['NetSuite', 'SuiteScript', 'SDF', 'subsidiary', 'OneWorld'];
let banlistViolations = 0;
const banlistScans: Array<[string, Array<[string, string]>]> = [
  ['top-level docs', writes],
  ['Data_Migration/', dataMigrationWrites],
  ['Integrations/', integrationsWrites],
  ['Integrations/Runbooks/', integrationRunbookWrites],
];
for (const [folder, scanList] of banlistScans) {
  for (const [filename, content] of scanList) {
    for (const term of BANNED) {
      if (content.includes(term)) {
        // eslint-disable-next-line no-console
        console.error(`  ✗ BANLIST VIOLATION: ${folder}${filename} contains "${term}"`);
        banlistViolations++;
      }
    }
  }
}

// eslint-disable-next-line no-console
console.log('');
// eslint-disable-next-line no-console
console.log(`  Bundle: ${outRoot}`);
// eslint-disable-next-line no-console
console.log(`  Files:  ${writes.length}`);
if (banlistViolations === 0) {
  // eslint-disable-next-line no-console
  console.log(`  Banlist: ✓ none of NetSuite / SuiteScript / SDF / subsidiary / OneWorld appears anywhere`);
} else {
  // eslint-disable-next-line no-console
  console.log(`  Banlist: ✗ ${banlistViolations} violation(s)`);
  process.exit(1);
}
