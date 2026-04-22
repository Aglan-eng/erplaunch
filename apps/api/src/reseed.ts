/**
 * Full reseed — wipes all project data and inserts a complete, realistic
 * implementation engagement for Al Rashid Food Industries LLC.
 *
 * Run:  npx tsx src/reseed.ts   (from apps/api)
 */
import { createId } from '@paralleldrive/cuid2';
import {
  initDb, getDb,
  findFirmBySlug,
  findUserByEmail,
  createEngagement,
  updateEngagement,
  upsertLicense,
  replacePhases,
  replaceConflicts,
  addMember,
  upsertSectionComment,
  createRisk,
  updateRisk,
  createIssue,
  updateIssue,
  createDecision,
  createMeeting,
  createMigrationItem,
  updateMigrationItem,
  logActivity,
  upsertPortalToken,
  updatePortalSettings,
  createPortalTodo,
  generateMemberInviteTokens,
  createDataCollectionItem,
  updateDataCollectionItem,
} from './db/index.js';
import { evaluate } from '../../../packages/rule-engine/src/evaluate.js';
import type { LicenseProfile, Phase } from '../../../packages/shared/src/types/index.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function d(iso: string) { return iso; }   // date pass-through, explicit labelling

async function wipeEngagementData(db: ReturnType<typeof getDb>, firmId: string) {
  // Get all engagement IDs for this firm
  const engs = await db.execute({ sql: `SELECT id FROM Engagement WHERE firmId = ?`, args: [firmId] });
  const ids = (engs.rows as Record<string, unknown>[]).map(r => r.id as string);
  if (ids.length === 0) return;

  for (const id of ids) {
    await db.execute({ sql: `DELETE FROM ConflictLog       WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM SectionComment    WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM SectionImage      WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM AIAdvice          WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM RiskItem          WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM IssueItem         WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM DecisionItem      WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM MeetingNote       WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM MigrationItem     WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM ActivityLog       WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM ProjectMember     WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM GenerationJob     WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM ClientPortalToken WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM DataCollectionItem WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM DataTemplateSchema WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM Phase             WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM BusinessProfile   WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM LicenseProfile    WHERE engagementId = ?`, args: [id] });
    await db.execute({ sql: `DELETE FROM Engagement        WHERE id = ?`,           args: [id] });
  }
  console.log(`  Wiped ${ids.length} existing engagement(s)`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  await initDb();
  const db = getDb();

  // ── Resolve firm & user ──────────────────────────────────────────────────
  const firm = await findFirmBySlug('ofoq');
  if (!firm) throw new Error('Firm not found — run the original seed first');
  const firmId = firm.id as string;

  const user = await findUserByEmail('consultant@test.ofoq.app');
  if (!user) throw new Error('User not found — run the original seed first');

  console.log('\n🗑  Wiping existing data…');
  await wipeEngagementData(db, firmId);

  // ── Engagement ───────────────────────────────────────────────────────────
  console.log('\n🏭  Creating engagement…');
  const eng = await createEngagement({ firmId, clientName: 'Al Rashid Food Industries LLC' });
  if (!eng) throw new Error('Failed to create engagement');
  const engId = eng.id as string;

  await updateEngagement(engId, {
    status: 'CONFIGURATION',
    startDate: '2025-01-15',
    contractEndDate: '2025-10-31',
  });

  // ── License ──────────────────────────────────────────────────────────────
  console.log('📋  Setting license…');
  const licenseModules = [
    'MANUFACTURING', 'WORK_ORDERS', 'WIP_ROUTINGS',
    'ADVANCED_INVENTORY', 'WMS', 'DEMAND_PLANNING',
    'CRM', 'ADVANCED_PROCUREMENT',
  ];
  await upsertLicense(engId, { edition: 'MID_MARKET', modules: licenseModules });

  // ── Business Profile Answers ─────────────────────────────────────────────
  console.log('📝  Writing business profile answers…');
  const answers: Record<string, unknown> = {
    // R2R — Record to Report
    'r2r.entities.multiEntity':               false,
    'r2r.entities.entityCount':               1,
    'r2r.entities.intercompanyJE':            false,
    'r2r.entities.subsidiaryNames':           [],
    'r2r.segmentation.useDepartments':        true,
    'r2r.segmentation.departmentList':        ['Production', 'Sales', 'Procurement', 'Finance', 'Quality', 'Warehouse'],
    'r2r.segmentation.useClasses':            true,
    'r2r.segmentation.useLocations':          true,
    'r2r.segmentation.locationList':          ['Riyadh Factory', 'Jeddah Warehouse', 'Dammam Distribution'],
    'r2r.accountingPeriods.fiscalYearStart':  'January',
    'r2r.accountingPeriods.periodType':       'MONTHLY',
    'r2r.accountingPeriods.lockClosedPeriods':true,
    'r2r.accountingPeriods.adjustmentPeriods':true,
    'r2r.currencies.baseCurrency':            'SAR',
    'r2r.currencies.isMultiCurrency':         true,
    'r2r.currencies.additionalCurrencies':    ['USD', 'EUR'],
    'r2r.currencies.autoExchangeRateUpdate':  true,
    'r2r.currencies.revaluationRequired':     true,
    'r2r.bankTransactions.bankAccountCount':  4,
    'r2r.bankTransactions.reconciliationFrequency': 'WEEKLY',
    'r2r.bankTransactions.importBankFeeds':   true,
    'r2r.bankTransactions.hasOpeningBalances':true,
    'r2r.bankTransactions.openingBalanceDate':'2025-01-01',
    'r2r.tax.taxRegime':                      'VAT',
    'r2r.tax.vatRate':                        15,
    'r2r.tax.multipleRates':                  false,
    'r2r.tax.taxCodeList':                    ['S15 - Standard 15%', 'Z0 - Zero Rated', 'E0 - Exempt'],
    'r2r.tax.taxRegistrationNumber':          '300194827400003',
    'r2r.journalEntries.manualJEsRequired':   true,
    'r2r.journalEntries.approvalRequired':    true,
    'r2r.journalEntries.approverRoles':       ['Finance Manager', 'CFO'],
    'r2r.journalEntries.recurringJEs':        true,
    'r2r.fiscalClose.hasCloseChecklist':      true,
    'r2r.fiscalClose.closeTaskCount':         12,
    'r2r.fiscalClose.closeApprovalRequired':  true,
    'r2r.fiscalClose.autoLockAfterApproval':  true,
    'r2r.reporting.standardReportsRequired':  true,
    'r2r.reporting.customReportsRequired':    true,
    'r2r.reporting.customReportDescriptions': 'Production cost variance report, Daily sales by SKU, Inventory ageing by location',
    'r2r.reporting.managementPackFrequency':  'MONTHLY',
    'r2r.reporting.consolidationRequired':    false,

    // P2P — Procure to Pay
    'p2p.vendors.hasMultipleVendorTypes':     true,
    'p2p.vendors.vendorCategories':           ['Raw Materials', 'Packaging', 'Maintenance & Repair', 'Services', 'Utilities'],
    'p2p.vendors.defaultPaymentTerms':        'Net 30',
    'p2p.vendors.earlyPaymentDiscount':       true,
    'p2p.vendors.withholding':                true,
    'p2p.vendors.vendorApprovalRequired':     true,
    'p2p.purchasing.usePurchaseOrders':       true,
    'p2p.purchasing.poApprovalRequired':      true,
    'p2p.purchasing.approvalThresholds':      [
      { amount: 10000, currency: 'SAR', approver: 'Procurement Manager' },
      { amount: 100000, currency: 'SAR', approver: 'CFO' },
    ],
    'p2p.purchasing.budgetCheck':             true,
    'p2p.purchasing.blanketPOs':              true,
    'p2p.purchasing.purchaseRequisitions':    true,
    'p2p.receiving.formalReceiving':          true,
    'p2p.receiving.threeWayMatch':            true,
    'p2p.receiving.partialReceipts':          true,
    'p2p.receiving.returnsToVendor':          true,
    'p2p.receiving.serviceReceipts':          true,
    'p2p.bills.billEntryProcess':             'MANUAL',
    'p2p.bills.billApprovalRequired':         true,
    'p2p.bills.billApprovalThresholds':       [
      { amount: 5000, currency: 'SAR', approver: 'Finance Manager' },
    ],
    'p2p.bills.creditNotes':                  true,
    'p2p.bills.recurringBills':               true,
    'p2p.bills.multiCurrencyBills':           true,
    'p2p.payments.paymentMethods':            ['Bank Transfer', 'Cheque', 'SADAD'],
    'p2p.payments.paymentRunFrequency':       'WEEKLY',
    'p2p.payments.bankFileExport':            true,
    'p2p.payments.bankName':                  'Saudi National Bank (SNB)',
    'p2p.payments.paymentApproval':           true,
    'p2p.payments.advancePayments':           true,
    'p2p.expenses.employeeExpenses':          true,
    'p2p.expenses.expenseCategories':         ['Travel', 'Accommodation', 'Meals', 'Entertainment', 'Office Supplies'],
    'p2p.expenses.expenseApproval':           true,
    'p2p.expenses.corporateCards':            false,
    'p2p.expenses.perDiemPolicy':             true,
    'p2p.expenses.mileageReimbursement':      true,

    // O2C — Order to Cash
    'o2c.customers.hasMultipleCustomerTypes': true,
    'o2c.customers.customerCategories':       ['Supermarkets', 'Wholesale Distributors', 'HoReCa', 'Export'],
    'o2c.customers.creditLimits':             true,
    'o2c.customers.defaultPaymentTerms':      'Net 45',
    'o2c.customers.customerApproval':         true,
    'o2c.pricing.multiplePriceLevels':        true,
    'o2c.pricing.priceLevelList':             ['Retail', 'Wholesale', 'Distributor', 'Export'],
    'o2c.pricing.quantityDiscounts':          true,
    'o2c.pricing.promotionalPricing':         true,
    'o2c.pricing.foreignCurrencyPricing':     true,
    'o2c.salesOrders.useSalesOrders':         true,
    'o2c.salesOrders.soApprovalRequired':     true,
    'o2c.salesOrders.soApprovalThresholds':   [{ amount: 50000, currency: 'SAR', approver: 'Sales Manager' }],
    'o2c.salesOrders.quotations':             true,
    'o2c.salesOrders.backOrders':             true,
    'o2c.salesOrders.dropShipping':           false,
    'o2c.fulfillment.usesWarehouse':          true,
    'o2c.fulfillment.multipleLocations':      true,
    'o2c.fulfillment.pickPackShip':           true,
    'o2c.fulfillment.thirdPartyLogistics':    false,
    'o2c.fulfillment.serviceDelivery':        false,
    'o2c.invoicing.invoiceTrigger':           'SHIPMENT',
    'o2c.invoicing.electronicInvoicing':      true,
    'o2c.invoicing.creditMemos':              true,
    'o2c.invoicing.recurringInvoices':        false,
    'o2c.invoicing.revenueRecognition':       false,
    'o2c.collections.arAgingTracking':        true,
    'o2c.collections.agingBuckets':           [30, 60, 90, 120],
    'o2c.collections.dunningLetters':         true,
    'o2c.collections.cashApplication':        true,
    'o2c.collections.badDebtProvision':       true,

    // MFG — Manufacturing
    'mfg.productionFlow.type':                'WIP_ROUTINGS',
    'mfg.productionFlow.trackLabor':          true,
    'mfg.bom.multiBom':                       true,
    'mfg.bom.usePhantoms':                    false,
    'mfg.outsourced.useOutsourced':           true,
    'mfg.outsourced.shipToVendor':            true,
    'mfg.demand.useDemandPlanning':           true,
    'mfg.demand.planningTimeFence':           8,
    'mfg.workOrders.useWorkOrders':           true,
    'mfg.workOrders.autoCreateWO':            false,
    'mfg.workOrders.woApprovalRequired':      true,
    'mfg.workOrders.backflushComponents':     false,
    'mfg.inventory.lotTracking':              true,
    'mfg.inventory.serialTracking':           false,
    'mfg.inventory.multiLocationInventory':   true,
    'mfg.inventory.reorderPoints':            true,
    'mfg.costing.costingMethod':              'AVERAGE_COST',
    'mfg.costing.standardCostVariance':       false,
    'mfg.costing.overheadAllocation':         true,
    'mfg.quality.qualityInspection':          true,
    'mfg.quality.ncr':                        true,

    // RTN — Returns
    'rtn.customerReturns.useRMA':             true,
    'rtn.customerReturns.refundPolicy':       'REFUND_AFTER_RECEIPT',
    'rtn.customerReturns.returnWindow':       30,
    'rtn.customerReturns.returnShippingResponsibility': 'CUSTOMER',
    'rtn.customerReturns.creditNoteAutoGenerate': true,
    'rtn.vendorReturns.useVendorRMA':         true,
    'rtn.processing.inspectionRequired':      true,
    'rtn.processing.restockingFees':          false,
    'rtn.processing.feePercentage':           0,
  };

  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE BusinessProfile SET answers = ?, updatedAt = ? WHERE engagementId = ?`,
    args: [JSON.stringify(answers), now, engId],
  });

  // ── Phases ───────────────────────────────────────────────────────────────
  console.log('📅  Setting phases…');
  await replacePhases(engId, [
    { name: 'Phase 1 — Foundation & Finance',   order: 1, flows: ['R2R'],        trigger: 'REQUIREMENT', status: 'IN_PROGRESS', targetDate: '2025-03-31' },
    { name: 'Phase 2 — Supply Chain',           order: 2, flows: ['P2P', 'RTN'], trigger: 'REQUIREMENT', status: 'PLANNED',     targetDate: '2025-05-31' },
    { name: 'Phase 3 — Sales & Fulfilment',     order: 3, flows: ['O2C'],        trigger: 'REQUIREMENT', status: 'PLANNED',     targetDate: '2025-07-31' },
    { name: 'Phase 4 — Manufacturing & WMS',    order: 4, flows: ['MFG'],        trigger: 'LICENSE',     status: 'PLANNED',     targetDate: '2025-09-30' },
  ] as any);

  // ── Project Members ──────────────────────────────────────────────────────
  console.log('👥  Adding team members…');
  await addMember(engId, { name: 'Khalid Al-Rashid',   role: 'Project Sponsor',        team: 'CLIENT',  email: 'k.alrashid@arfi.sa',      phone: '+966 50 111 2233' });
  await addMember(engId, { name: 'Noura Al-Otaibi',    role: 'IT Project Manager',      team: 'CLIENT',  email: 'n.alotaibi@arfi.sa',      phone: '+966 55 444 5566' });
  await addMember(engId, { name: 'Mohammed Hamdan',    role: 'Finance Manager',         team: 'CLIENT',  email: 'm.hamdan@arfi.sa',        phone: '+966 54 777 8899' });
  await addMember(engId, { name: 'Sara Al-Qahtani',    role: 'Production Supervisor',   team: 'CLIENT',  email: 's.alqahtani@arfi.sa',     phone: '+966 56 222 3344' });
  await addMember(engId, { name: 'Ahmed Mansour',      role: 'Senior Consultant',       team: 'CONSULTANT', email: 'a.mansour@ofoq.ae',    phone: '+971 50 987 6543' });
  await addMember(engId, { name: 'Lina Haddad',        role: 'NetSuite Consultant',     team: 'CONSULTANT', email: 'l.haddad@ofoq.ae',     phone: '+971 55 123 4567' });

  // ── Section Comments ─────────────────────────────────────────────────────
  console.log('💬  Adding section comments…');
  await upsertSectionComment(engId, 'license',
    'Confirmed MID_MARKET edition with manufacturing modules. Client\'s IT team has the Oracle contract signed. WMS add-on approved by CFO on 12-Jan-2025. Demand Planning to be activated before Phase 4 kick-off.');

  await upsertSectionComment(engId, 'r2r.entities',
    'Single legal entity (Al Rashid Food Industries LLC, CR No. 1010234567). No subsidiaries at this time. Future expansion to Oman entity is on the roadmap for 2026 — potential OneWorld upgrade post go-live.');

  await upsertSectionComment(engId, 'r2r.currencies',
    'Base currency SAR. USD used for ingredient imports (mainly US-origin soy and wheat). EUR for European packaging supplier. Auto exchange rate feed from SAMA (Saudi Central Bank) API to be configured by Ahmed.');

  await upsertSectionComment(engId, 'r2r.tax',
    'ZATCA e-invoicing Phase 2 compliance required (Fatoorah integration). Client is registered for VAT since 2018. TRN confirmed. Zero-rated exports need special attention — coordinate with Mohammed on the GL mapping.');

  await upsertSectionComment(engId, 'p2p.purchasing',
    '3-way matching is mandatory per client\'s internal audit policy. Procurement manager Faisal Al-Ghamdi confirmed approval matrix: <10k SAR auto-approve, 10k-100k Procurement Manager, >100k CFO. Blanket POs used for recurring packaging orders.');

  await upsertSectionComment(engId, 'p2p.payments',
    'Client uses SNB online banking. SADAD payments for local utility vendors. Bank file export format: SAP MT940 compatible — needs custom SuiteScript integration. Ahmed to review with SNB technical team in February.');

  await upsertSectionComment(engId, 'o2c.pricing',
    'Four price levels confirmed. Distributor pricing requires quantity breaks (e.g. >500 units = 8% off). Promotional pricing used for Ramadan season promotions. Foreign currency pricing for GCC export customers only.');

  await upsertSectionComment(engId, 'o2c.invoicing',
    'ZATCA Phase 2 e-invoicing required for all B2B invoices. Client wants invoices triggered on shipment confirmation (not order). Credit memos issued for short-weight claims — Noura to document tolerance policy.');

  await upsertSectionComment(engId, 'mfg.productionFlow',
    'Client produces 3 product lines: Bakery Mixes, Dairy Seasonings, and Ready-to-Eat Sauces. All lines use multi-step routing: Mixing → Processing → QC Hold → Packaging → Labelling. WIP & Routings confirmed as the correct model. Lina to map all routing steps from the current ERP (SAP B1).');

  await upsertSectionComment(engId, 'mfg.inventory',
    'Lot tracking is critical for SFDA (Saudi Food & Drug Authority) compliance — batch traceability required. Multi-location: Riyadh Factory (primary), Jeddah WH (distribution), Dammam (cold chain). Reorder points set per SKU/location in current system — Sara to export the full list.');

  await upsertSectionComment(engId, 'mfg.quality',
    'Quality hold bins required at all 3 locations. NCR process: QC inspector raises NCR → QA Manager reviews → disposition (rework/scrap/release). Currently tracked in Excel — migrating to NetSuite QM. Advanced Inventory required for quarantine bin — confirmed in license.');

  await upsertSectionComment(engId, 'rtn.customerReturns',
    '30-day return window. Supermarket customers often return near-expiry stock — RMA must capture lot number and reason code. Credit notes auto-generated on receipt of return. Sara confirmed QC inspection step on all returns before restocking.');

  // ── Risks ────────────────────────────────────────────────────────────────
  console.log('⚠️   Adding risks…');
  const r1 = await createRisk(engId, {
    title: 'ZATCA Phase 2 e-invoicing deadline',
    description: 'Client must be fully compliant with ZATCA Phase 2 (Fatoorah integration) by regulatory mandate. NetSuite\'s native ZATCA connector may require customisation to meet Saudi-specific QR code and XML format requirements.',
    probability: 'HIGH',
    impact: 'HIGH',
    owner: 'Ahmed Mansour',
    mitigation: 'Engage Oracle\'s ZATCA certified partner early. Schedule dedicated sprint for e-invoicing configuration and ZATCA sandbox testing by end of March. Include ZATCA UAT in the Phase 1 exit criteria.',
  });
  await updateRisk(r1.id as string, { status: 'OPEN' });

  const r2 = await createRisk(engId, {
    title: 'SAP Business One data migration quality',
    description: 'Current system (SAP B1) has 8 years of production data with inconsistent item master coding and duplicate vendor records. Data cleansing effort is significantly underestimated by the client.',
    probability: 'HIGH',
    impact: 'HIGH',
    owner: 'Noura Al-Otaibi',
    mitigation: 'Conduct data quality audit by end of January. Agree cleansing responsibility matrix with client. Build a 3-week buffer into the data migration phase. Use NetSuite CSV import tools for staged validation.',
  });
  await updateRisk(r2.id as string, { status: 'OPEN' });

  const r3 = await createRisk(engId, {
    title: 'Key user availability during configuration workshops',
    description: 'Production Supervisor Sara Al-Qahtani is the only resource who understands the full routing configuration. Her availability during Ramadan (March) and the summer holiday period (June-July) is limited.',
    probability: 'MEDIUM',
    impact: 'HIGH',
    owner: 'Khalid Al-Rashid',
    mitigation: 'Front-load all MFG configuration workshops to February. Identify a backup resource (shift supervisor) to shadow Sara. Record all workshop sessions for knowledge transfer.',
  });
  await updateRisk(r3.id as string, { status: 'OPEN' });

  const r4 = await createRisk(engId, {
    title: 'SNB bank file integration complexity',
    description: 'Saudi National Bank payment file format uses a non-standard SARIE format extension. NetSuite\'s standard bank file export may not be directly compatible, requiring a custom SuiteScript.',
    probability: 'MEDIUM',
    impact: 'MEDIUM',
    owner: 'Ahmed Mansour',
    mitigation: 'Obtain SNB SARIE file specification document by end of January. Build and test a custom SuiteScript 2.1 bank file script in Sandbox. Estimated 3 days of development effort.',
  });
  await updateRisk(r4.id as string, { status: 'IN_PROGRESS' });

  const r5 = await createRisk(engId, {
    title: 'Multi-currency revaluation during month-end',
    description: 'With USD and EUR balances, month-end FX revaluation in NetSuite must be correctly mapped to the SAMA-sourced rates. Incorrect revaluation could misstate the financial statements under IFRS.',
    probability: 'LOW',
    impact: 'HIGH',
    owner: 'Mohammed Hamdan',
    mitigation: 'Perform parallel revaluation run in NetSuite Sandbox alongside the current SAP B1 system for January and February periods before go-live. Reconcile outputs before accepting.',
  });
  await updateRisk(r5.id as string, { status: 'OPEN' });

  // ── Issues ───────────────────────────────────────────────────────────────
  console.log('🐛  Adding issues…');
  const i1 = await createIssue(engId, {
    title: 'Item master categorisation not agreed',
    description: 'Client has not finalised the item category/sub-category hierarchy for the 1,240 SKUs in the item master. This is blocking the BOM configuration and the inventory reorder point setup.',
    priority: 'HIGH',
    owner: 'Sara Al-Qahtani',
  });
  await updateIssue(i1.id as string, { status: 'OPEN' });

  const i2 = await createIssue(engId, {
    title: 'VAT zero-rate treatment on export sales not documented',
    description: 'Finance team has not provided the list of export customers who qualify for zero-rated VAT treatment. Without this, the tax engine cannot be configured correctly and ZATCA testing cannot begin.',
    priority: 'HIGH',
    owner: 'Mohammed Hamdan',
  });
  await updateIssue(i2.id as string, { status: 'OPEN' });

  const i3 = await createIssue(engId, {
    title: 'Approval workflow matrix requires VP sign-off',
    description: 'The PO and bill approval thresholds have been drafted but are pending formal sign-off from the VP of Finance (currently travelling). This is blocking the workflow configuration workshop scheduled for 28-Jan.',
    priority: 'MEDIUM',
    owner: 'Khalid Al-Rashid',
  });
  await updateIssue(i3.id as string, { status: 'IN_PROGRESS', resolution: 'Escalated to Khalid. VP sign-off expected by 25-Jan.' });

  // ── Decisions ────────────────────────────────────────────────────────────
  console.log('✅  Adding decisions…');
  await createDecision(engId, {
    title: 'Costing method: Average Cost selected over Standard Cost',
    description: 'Evaluated Standard Cost, Average Cost, and FIFO for the food manufacturing context.',
    decidedBy: 'Mohammed Hamdan, Khalid Al-Rashid',
    decidedAt: '2025-01-20',
    rationale: 'SFDA compliance requires lot-level traceability but not standard cost variance reporting. Average Cost is simpler to maintain and aligns with current SAP B1 costing. Standard cost would require significant BOM cost rollup work and ongoing variance analysis that the Finance team is not resourced to support. FIFO excluded because it complicates month-end with lot-specific costs.',
  });

  await createDecision(engId, {
    title: 'Production flow: WIP & Routings (not Simple Assembly)',
    description: 'Chose between Simple Assembly Builds and full WIP & Routings for production tracking.',
    decidedBy: 'Sara Al-Qahtani, Ahmed Mansour',
    decidedAt: '2025-01-22',
    rationale: 'The Bakery Mixes line has 7 production steps with quality hold points. Simple Assembly cannot capture intermediate WIP values or labour costs per step. WIP & Routings is required for COGS accuracy and for the planned OEE (Overall Equipment Effectiveness) reporting. Work Orders and WIP/Routings modules confirmed in license.',
  });

  await createDecision(engId, {
    title: 'ZATCA integration: Oracle ZATCA Connector (not custom)',
    description: 'Evaluated custom Fatoorah API SuiteScript vs Oracle\'s certified ZATCA connector add-on.',
    decidedBy: 'Noura Al-Otaibi, Ahmed Mansour',
    decidedAt: '2025-01-25',
    rationale: 'Oracle\'s ZATCA connector is pre-certified by ZATCA for Phase 2 compliance and covers the QR code, digital signature, and XML schema requirements out of the box. Custom build would take 4-6 weeks and carries compliance risk. Connector cost (~$3,500/year) is acceptable given the risk reduction. CFO approved the additional spend.',
  });

  await createDecision(engId, {
    title: 'Go-live approach: Phased by business process (not big-bang)',
    description: 'Debated full big-bang go-live vs. phased approach across the 4 defined implementation phases.',
    decidedBy: 'Khalid Al-Rashid, Ahmed Mansour',
    decidedAt: '2025-01-15',
    rationale: 'Manufacturing go-live is highest risk due to lot tracking and SFDA compliance. A phased approach allows the finance team to stabilise on NetSuite for R2R/P2P/O2C before adding the complexity of WIP & Routings. Inventory opening balances for Phase 4 will be taken from NetSuite\'s stabilised inventory module rather than SAP B1.',
  });

  // ── Meetings ─────────────────────────────────────────────────────────────
  console.log('📅  Adding meeting notes…');
  await createMeeting(engId, {
    title: 'Project Kick-off — Al Rashid Food Industries',
    meetingDate: '2025-01-15',
    attendees: ['Khalid Al-Rashid', 'Noura Al-Otaibi', 'Mohammed Hamdan', 'Ahmed Mansour', 'Lina Haddad'],
    notes: 'Formal project kick-off meeting held at client offices in Riyadh. Project charter signed. Implementation timeline reviewed and agreed. Client confirmed availability of key users for each phase. Ahmed walked through the OFOQ Accelerator methodology and wizard tool. Noura raised concern about data migration timelines — agreed to schedule a dedicated data audit workshop for 22-Jan. Khalid confirmed executive sponsorship and commitment to release key resources during configuration workshops.',
    actionItems: [
      { text: 'Schedule data audit workshop for 22-January', owner: 'Noura Al-Otaibi', done: true },
      { text: 'Send project charter countersigned copy to Ahmed', owner: 'Khalid Al-Rashid', done: true },
      { text: 'Provide SAP B1 system access to Lina for data extraction', owner: 'Noura Al-Otaibi', done: false },
      { text: 'Confirm ZATCA TRN and send to Ahmed for sandbox setup', owner: 'Mohammed Hamdan', done: true },
    ],
  });

  await createMeeting(engId, {
    title: 'R2R Configuration Workshop — Chart of Accounts & Tax',
    meetingDate: '2025-01-28',
    attendees: ['Mohammed Hamdan', 'Ahmed Mansour', 'Lina Haddad'],
    notes: 'Reviewed the proposed NetSuite Chart of Accounts structure mapped from SAP B1. Client requested adding a separate account segment for production cost centres (Bakery, Dairy, Sauce lines). Agreed to use the Class dimension rather than separate accounts — reduces COA complexity and enables cross-class reporting. Tax configuration discussed in detail: VAT groups created for Standard (15%), Zero-Rated, and Exempt. ZATCA Phase 2 sandbox credentials shared by Mohammed — ZATCA connector installation scheduled for next week. FX revaluation: SAMA rate feed API key obtained. Ahmed to configure the automated rate import.',
    actionItems: [
      { text: 'Map production cost centres to NetSuite Class dimension', owner: 'Lina Haddad', done: false },
      { text: 'Install ZATCA Oracle connector in Sandbox', owner: 'Ahmed Mansour', done: false },
      { text: 'Configure SAMA FX rate import schedule (daily)', owner: 'Ahmed Mansour', done: false },
      { text: 'Provide complete list of zero-rated export customers', owner: 'Mohammed Hamdan', done: false },
    ],
  });

  await createMeeting(engId, {
    title: 'Data Migration Planning — SAP B1 Extraction Scope',
    meetingDate: '2025-02-04',
    attendees: ['Noura Al-Otaibi', 'Sara Al-Qahtani', 'Lina Haddad'],
    notes: 'Reviewed the data objects in scope for migration from SAP B1. Item master is the highest-risk object: 1,240 active SKUs, many with duplicate records from historical system merges. Agreed that Sara\'s team will cleanse item master in Excel before import. Vendor master has ~340 records — Procurement team to deduplicate and validate bank details. Customer master ~580 records — Sales team to flag inactive accounts for archival. Open POs (approx 95) and open Sales Orders (approx 210) will be migrated as open transactions. Historical AR/AP invoices — first 3 years of history will be loaded as summary journal entries only. Full transaction history stays in SAP B1 for reference.',
    actionItems: [
      { text: 'Export item master from SAP B1 and begin cleansing', owner: 'Sara Al-Qahtani', done: false },
      { text: 'Deduplicate vendor master (target: <320 unique vendors)', owner: 'Noura Al-Otaibi', done: false },
      { text: 'Flag inactive customer accounts (>18 months no activity)', owner: 'Noura Al-Otaibi', done: false },
      { text: 'Prepare data migration templates for all objects', owner: 'Lina Haddad', done: false },
    ],
  });

  // ── Migration Items ──────────────────────────────────────────────────────
  console.log('📦  Adding migration items…');
  const m1 = await createMigrationItem(engId, {
    objectName: 'Item Master (Finished Goods & Raw Materials)',
    source: 'SAP Business One — OITM table',
    recordCount: 1240,
    owner: 'Sara Al-Qahtani',
    notes: 'Includes 840 finished goods, 310 raw materials, 90 packaging items. Significant deduplication required. Item category hierarchy to be aligned with NetSuite item type structure before import.',
  });
  await updateMigrationItem(m1.id as string, { status: 'IN_PROGRESS' });

  const m2 = await createMigrationItem(engId, {
    objectName: 'Vendor Master',
    source: 'SAP Business One — OCRD table (Vendor type)',
    recordCount: 340,
    owner: 'Noura Al-Otaibi',
    notes: 'Post-cleansing target is ~300 unique vendors. Includes bank account details (IBAN) — requires Finance sign-off on each record before import. International vendors require currency assignment.',
  });
  await updateMigrationItem(m2.id as string, { status: 'NOT_STARTED' });

  const m3 = await createMigrationItem(engId, {
    objectName: 'Customer Master',
    source: 'SAP Business One — OCRD table (Customer type)',
    recordCount: 580,
    owner: 'Noura Al-Otaibi',
    notes: 'Includes credit limit and payment term data. ~120 accounts flagged as potentially inactive. Sales Manager to confirm which accounts to archive vs. migrate.',
  });
  await updateMigrationItem(m3.id as string, { status: 'NOT_STARTED' });

  const m4 = await createMigrationItem(engId, {
    objectName: 'Bill of Materials (BOMs)',
    source: 'SAP Business One — Production module + Excel supplements',
    recordCount: 180,
    owner: 'Sara Al-Qahtani',
    notes: '180 active BOMs across 3 product lines. Several BOMs are maintained in Excel rather than SAP B1 — all must be consolidated before import. Phantom assemblies to be mapped as NetSuite phantom items.',
  });
  await updateMigrationItem(m4.id as string, { status: 'NOT_STARTED' });

  const m5 = await createMigrationItem(engId, {
    objectName: 'Routing & Work Centres',
    source: 'Excel (not in SAP B1)',
    recordCount: 24,
    owner: 'Sara Al-Qahtani',
    notes: '6 work centres across the Riyadh factory. 24 unique routings (step sequences). Sara to map each routing to NetSuite Operations and Work Centres. Labour rates per work centre to be confirmed by Finance.',
  });
  await updateMigrationItem(m5.id as string, { status: 'NOT_STARTED' });

  const m6 = await createMigrationItem(engId, {
    objectName: 'Open Purchase Orders',
    source: 'SAP Business One — OPOR table',
    recordCount: 95,
    owner: 'Noura Al-Otaibi',
    notes: 'Only POs with outstanding receipts as of cut-over date. Vendor must exist in NetSuite before PO import. Item master must be clean first — dependency on migration item #1.',
  });
  await updateMigrationItem(m6.id as string, { status: 'NOT_STARTED' });

  const m7 = await createMigrationItem(engId, {
    objectName: 'Inventory Opening Balances (by Lot & Location)',
    source: 'SAP Business One — OIBT table (batch tracking)',
    recordCount: 3200,
    owner: 'Sara Al-Qahtani',
    notes: '3,200 lot-level inventory records across 3 locations. Expiry dates must be migrated accurately for SFDA compliance. Stock count to be performed on cut-over weekend — only post-count quantities will be loaded.',
  });
  await updateMigrationItem(m7.id as string, { status: 'NOT_STARTED' });

  // ── Rule Evaluation → Conflicts ──────────────────────────────────────────
  console.log('⚙️   Running rule evaluation…');
  const licenseForEval: LicenseProfile = {
    id: 'eval', engagementId: engId,
    edition: 'MID_MARKET',
    modules: licenseModules,
    updatedAt: new Date(),
  };
  const phasesForEval: Phase[] = [
    { id: 'p1', engagementId: engId, name: 'Phase 1 — Foundation & Finance',   order: 1, flows: ['R2R'],        trigger: 'REQUIREMENT', status: 'IN_PROGRESS' },
    { id: 'p2', engagementId: engId, name: 'Phase 2 — Supply Chain',           order: 2, flows: ['P2P', 'RTN'], trigger: 'REQUIREMENT', status: 'PLANNED' },
    { id: 'p3', engagementId: engId, name: 'Phase 3 — Sales & Fulfilment',     order: 3, flows: ['O2C'],        trigger: 'REQUIREMENT', status: 'PLANNED' },
    { id: 'p4', engagementId: engId, name: 'Phase 4 — Manufacturing & WMS',    order: 4, flows: ['MFG'],        trigger: 'LICENSE',     status: 'PLANNED' },
  ] as Phase[];

  const { conflicts, warnings, infos } = evaluate({
    answers,
    license: licenseForEval,
    phases: phasesForEval,
  });

  const allConflicts = [...conflicts, ...warnings, ...infos];
  await replaceConflicts(engId, allConflicts.map((c) => ({
    ruleId: c.id, type: c.type, severity: c.severity,
    questionIds: c.questionIds, message: c.message, resolution: c.resolution,
  })));

  console.log(`  → ${conflicts.length} blocking, ${warnings.length} warnings, ${infos.length} infos`);
  if (allConflicts.length > 0) {
    allConflicts.forEach(c => console.log(`     ${c.severity.padEnd(5)} ${c.id}: ${c.message.slice(0, 80)}…`));
  }

  // ── Activity Log ─────────────────────────────────────────────────────────
  await logActivity(engId, firmId, 'ENGAGEMENT_CREATED', 'Engagement seeded via reseed script');
  await logActivity(engId, firmId, 'LICENSE_UPDATED', 'MID_MARKET edition with 8 modules');
  await logActivity(engId, firmId, 'PROFILE_UPDATED', 'Full business profile answers loaded (R2R/P2P/O2C/MFG/RTN)');
  await logActivity(engId, firmId, 'PHASE_UPDATED', '4 phases defined — Foundation, Supply Chain, Sales, Manufacturing');

  // ── Data Collection Items ─────────────────────────────────────────────────
  console.log('📋  Adding data collection items…');
  const dcToday = new Date();
  const dc7  = new Date(dcToday); dc7.setDate(dcToday.getDate() + 7);
  const dc14 = new Date(dcToday); dc14.setDate(dcToday.getDate() + 14);
  const dc21 = new Date(dcToday); dc21.setDate(dcToday.getDate() + 21);
  const dcOverdue = new Date(dcToday); dcOverdue.setDate(dcToday.getDate() - 3);

  const dc1 = await createDataCollectionItem(engId, {
    templateId: 'chart_of_accounts',
    name: 'Chart of Accounts',
    category: 'Finance',
    assignedTo: 'Mohammed Hamdan',
    dueDate: dc7.toISOString().split('T')[0],
  });

  const dc2 = await createDataCollectionItem(engId, {
    templateId: 'vendor_master',
    name: 'Vendor Master List',
    category: 'Procurement',
    assignedTo: 'Mohammed Hamdan',
    dueDate: dcOverdue.toISOString().split('T')[0],
  });

  const dc3 = await createDataCollectionItem(engId, {
    templateId: 'customer_master',
    name: 'Customer Master List',
    category: 'Sales',
    assignedTo: 'Sara Al-Qahtani',
    dueDate: dc14.toISOString().split('T')[0],
  });

  const dc4 = await createDataCollectionItem(engId, {
    templateId: 'item_master',
    name: 'Item Master (Finished Goods)',
    category: 'Inventory',
    assignedTo: 'Sara Al-Qahtani',
    dueDate: dc14.toISOString().split('T')[0],
  });

  const dc5 = await createDataCollectionItem(engId, {
    templateId: 'open_purchase_orders',
    name: 'Open Purchase Orders (SAP export)',
    category: 'Procurement',
    assignedTo: 'Mohammed Hamdan',
    dueDate: dc21.toISOString().split('T')[0],
  });

  const dc6 = await createDataCollectionItem(engId, {
    templateId: 'open_ar',
    name: 'Open Accounts Receivable (aged)',
    category: 'Finance',
    assignedTo: 'Mohammed Hamdan',
    dueDate: dc21.toISOString().split('T')[0],
  });

  const dc7item = await createDataCollectionItem(engId, {
    templateId: 'bom',
    name: 'Bill of Materials (all finished products)',
    category: 'Manufacturing',
    assignedTo: 'Sara Al-Qahtani',
    dueDate: dc21.toISOString().split('T')[0],
  });

  // Set some realistic statuses
  if (dc2?.id) await updateDataCollectionItem(dc2.id as string, { status: 'UPLOADED', uploadedAt: new Date().toISOString() });
  if (dc1?.id) await updateDataCollectionItem(dc1.id as string, { status: 'IN_REVIEW' });

  // ── Client Portal demo setup ──────────────────────────────────────────────
  console.log('🌐  Setting up client portal…');

  // Generate portal token
  const portalToken = await upsertPortalToken(engId);

  // Configure portal settings — show everything for a rich demo
  await updatePortalSettings(engId, {
    showStage: true,
    showTimeline: true,
    showClientTeam: true,
    showConsultantTeam: true,
    showRisks: true,
    showIssues: true,
    showDecisions: true,
    showDataCollection: true,
    showTodos: true,
    showMeetings: true,
    customMessage: 'Welcome to the Al Rashid Food Industries NetSuite Implementation Portal. Use this portal to track project progress, submit required data files, and complete action items assigned to your team.',
  });

  // Generate invite tokens for all CLIENT members (so personalised links work in demo)
  await generateMemberInviteTokens(engId);

  // Seed portal action items (todos visible to the client)
  const today = new Date();
  const in7  = new Date(today); in7.setDate(today.getDate() + 7);
  const in14 = new Date(today); in14.setDate(today.getDate() + 14);
  const in3  = new Date(today); in3.setDate(today.getDate() + 3);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  await createPortalTodo(engId, {
    title: 'Submit signed Chart of Accounts template',
    description: 'Download the CoA template from the Data Collection tab, fill in your account structure, and upload it back. This is required before configuration can begin.',
    dueDate: in3.toISOString().split('T')[0],
    assignedTo: 'Mohammed Hamdan',
    priority: 'HIGH',
  });

  await createPortalTodo(engId, {
    title: 'Provide list of all active vendors with bank details',
    description: 'Export the vendor master from SAP B1 and share via the Data Collection section. Minimum required fields: Vendor Name, Commercial Registration No., IBAN, Currency.',
    dueDate: in7.toISOString().split('T')[0],
    assignedTo: 'Mohammed Hamdan',
    priority: 'HIGH',
  });

  await createPortalTodo(engId, {
    title: 'Confirm go-live date with senior management',
    description: 'The steering committee needs a confirmed go-live target so that the parallel run and UAT schedule can be locked. Please escalate to CEO / CFO for sign-off.',
    dueDate: in7.toISOString().split('T')[0],
    assignedTo: 'Khalid Al-Rashid',
    priority: 'HIGH',
  });

  await createPortalTodo(engId, {
    title: 'Nominate 2 super-users for NetSuite training',
    description: 'We need 2 power users from the Finance team to attend the 3-day NetSuite administrator training. These individuals will support the wider team post go-live.',
    dueDate: in14.toISOString().split('T')[0],
    assignedTo: 'Noura Al-Otaibi',
    priority: 'MEDIUM',
  });

  await createPortalTodo(engId, {
    title: 'Review and approve the system design document',
    description: 'Ofoq will share the System Design Document (SDD) covering the R2R configuration. Please review and provide written sign-off within 5 business days of receipt.',
    dueDate: in14.toISOString().split('T')[0],
    assignedTo: 'Mohammed Hamdan',
    priority: 'MEDIUM',
  });

  await createPortalTodo(engId, {
    title: 'Complete UAT test scenarios for Purchase Orders',
    description: 'Test scripts have been shared. Please execute all 12 P2P test scenarios in the UAT environment and record pass/fail results in the shared spreadsheet.',
    dueDate: yesterday.toISOString().split('T')[0],
    assignedTo: 'Sara Al-Qahtani',
    priority: 'HIGH',
  });

  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  const portalUrl = `${appUrl}/portal/${portalToken}`;

  console.log('\n✅  Reseed complete!');
  console.log('    Client:  Al Rashid Food Industries LLC');
  console.log('    Edition: MID_MARKET');
  console.log('    Modules: MANUFACTURING, WORK_ORDERS, WIP_ROUTINGS, ADVANCED_INVENTORY, WMS, DEMAND_PLANNING, CRM, ADVANCED_PROCUREMENT');
  console.log('    Phases:  4 (Foundation → Supply Chain → Sales → Manufacturing)');
  console.log('    Members: 4 client + 2 Ofoq consultants (team bug fixed → now CONSULTANT)');
  console.log('    Risks:   5  |  Issues: 3  |  Decisions: 4  |  Meetings: 3  |  Migration items: 7');
  console.log('    Data Collection: 7 items (2 with statuses: Uploaded, In Review)');
  console.log('    Portal todos: 6 action items (1 overdue for realism)');
  console.log(`    Conflicts: ${conflicts.length} BLOCK, ${warnings.length} WARN, ${infos.length} INFO`);
  console.log('\n    Login: consultant@test.ofoq.app / password123');
  console.log(`\n🌐  CLIENT PORTAL DEMO URL:`);
  console.log(`    ${portalUrl}`);
  console.log('    (Open this URL in any browser — no login required)');
}

main().catch((e) => { console.error('Reseed failed:', e); process.exit(1); });
