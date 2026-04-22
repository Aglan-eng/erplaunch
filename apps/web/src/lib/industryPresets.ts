/**
 * Industry presets — common default answers by vertical.
 * Values are shallow-merged into the wizard answer store (existing answers take precedence).
 */

export interface IndustryPreset {
  id: string;
  label: string;
  iconId: string;            // lucide icon name
  color: string;             // tailwind bg color for the icon badge
  textColor: string;         // tailwind text color for the icon
  description: string;       // one-liner shown in preset card
  /** 2-3 sentence explanation of why this preset exists and who it's for */
  longDescription?: string;
  /** Key NetSuite features/modules this preset pre-configures */
  keyFeatures?: string[];
  /** NetSuite modules/add-ons typically required for this vertical */
  nsModules?: string[];
  /** Consultant guidance: what to verify or customise after applying */
  consultantNotes?: string[];
  answers: Record<string, unknown>;
  isCustom?: boolean;        // user-created preset
}

/** Sections used for preview grouping */
export const PRESET_SECTIONS: Record<string, string> = {
  r2r: 'Record to Report',
  p2p: 'Procure to Pay',
  o2c: 'Order to Cash',
  mfg: 'Manufacturing',
};

export function getAnswerSection(key: string): string {
  const prefix = key.split('.')[0];
  return PRESET_SECTIONS[prefix] ?? 'Other';
}

/** Built-in system presets */
export const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    id: 'retail',
    label: 'Retail & eCommerce',
    iconId: 'ShoppingCart',
    color: 'bg-pink-100',
    textColor: 'text-pink-600',
    description: 'Multi-location retail, POS integration, inventory replenishment',
    longDescription: 'Designed for retailers and online sellers managing multiple store locations or sales channels. Pre-configures inventory replenishment, multi-price levels, and online order intake. Best for companies with a large number of end customers and frequent, lower-value transactions.',
    keyFeatures: [
      'Multi-price levels for different customer tiers (trade vs. retail)',
      'Online order intake + automatic invoicing on fulfillment',
      'Multi-warehouse / multi-location inventory tracking',
      '3-way PO matching for stock replenishment from suppliers',
    ],
    nsModules: ['NetSuite Base', 'Multi-Location Inventory (MLI)', 'SuiteCommerce / Connector (if eCommerce)', 'Advanced Inventory (optional)'],
    consultantNotes: [
      'Confirm whether POS system needs to integrate — if yes, add a connector question',
      'Ask about loyalty programs or gift cards — these need custom scripting',
      'Verify if the client uses consignment stock — this preset does not cover it',
      'Check if bin/location management is needed within each warehouse',
    ],
    answers: {
      // R2R
      'r2r.entities.numEntities': '1-5',
      'r2r.entities.multiCurrency': false,
      'r2r.entities.consolidation': false,
      'r2r.segmentation.departments': true,
      'r2r.segmentation.locations': true,
      'r2r.accountingPeriods.periodType': 'MONTHLY',
      // P2P
      'p2p.vendors.approxVendorCount': '51-200',
      'p2p.purchasing.poRequired': true,
      'p2p.purchasing.threeWayMatch': true,
      'p2p.receiving.warehouseReceipts': true,
      // O2C
      'o2c.customers.approxCustomerCount': '1001-5000',
      'o2c.pricing.multiPriceLevel': true,
      'o2c.salesOrders.onlineOrders': true,
      'o2c.fulfillment.multiWarehouse': true,
      'o2c.invoicing.autoInvoice': true,
      // MFG — not typical for retail
      'mfg.productionFlow.inScope': false,
    },
  },
  {
    id: 'manufacturing',
    label: 'Manufacturing',
    iconId: 'Factory',
    color: 'bg-orange-100',
    textColor: 'text-orange-600',
    description: 'Discrete or process manufacturing, BOM, work orders, costing',
    longDescription: 'For companies that build or assemble finished goods from raw materials or sub-components. Covers the full production cycle — from Bill of Materials through work orders, routing, and finished-goods costing. Use for automotive parts, electronics, furniture, machinery, and similar discrete manufacturers.',
    keyFeatures: [
      'Multi-level Bills of Materials (BOM) for complex assemblies',
      'Work orders with routings (operations sequences through work centres)',
      'Standard costing for accurate COGS and variance reporting',
      'Quality control at receiving and finished goods inspection',
      'Multi-warehouse with bin management for WIP and FG locations',
    ],
    nsModules: ['NetSuite Manufacturing (WO)', 'Advanced Manufacturing (for routings)', 'Multi-Location Inventory', 'Quality Management (optional add-on)'],
    consultantNotes: [
      'Clarify discrete vs. process manufacturing — process uses Process Manufacturing module, not standard WO',
      'Ask about make-to-order vs. make-to-stock — affects demand planning setup',
      'Confirm if the client needs shop floor data collection (barcode scanning)',
      'Standard costing requires a cost rollup process — schedule a dedicated session to explain this',
      'Ask about by-products or co-products if any food/chemical production is involved',
    ],
    answers: {
      'r2r.entities.numEntities': '1-5',
      'r2r.entities.multiCurrency': false,
      'r2r.segmentation.departments': true,
      'r2r.accountingPeriods.periodType': 'MONTHLY',
      // MFG
      'mfg.productionFlow.inScope': true,
      'mfg.bom.multilevelBom': true,
      'mfg.workOrders.routingRequired': true,
      'mfg.costing.standardCosting': true,
      'mfg.inventory.multiWarehouse': true,
      'mfg.quality.inScope': true,
      // P2P
      'p2p.vendors.approxVendorCount': '51-200',
      'p2p.purchasing.poRequired': true,
      'p2p.purchasing.threeWayMatch': true,
      'p2p.receiving.warehouseReceipts': true,
      // O2C
      'o2c.customers.approxCustomerCount': '201-1000',
      'o2c.salesOrders.onlineOrders': false,
    },
  },
  {
    id: 'distribution',
    label: 'Wholesale Distribution',
    iconId: 'Package',
    color: 'bg-blue-100',
    textColor: 'text-blue-600',
    description: 'High-volume ordering, multi-warehouse, drop-ship, lot/serial tracking',
    longDescription: 'For wholesale distributors selling in bulk to resellers, retailers, or other businesses. Focuses on high-volume order management, flexible pricing by customer tier, and efficient warehouse operations including drop-shipping and lot/serial traceability.',
    keyFeatures: [
      'Customer-tier pricing (trade price, volume discounts)',
      'Drop-ship orders fulfilled directly from supplier to end customer',
      'Lot and serial number tracking for full supply chain traceability',
      'Multi-warehouse with replenishment alerts',
      '3-way PO match to control inbound receipts',
    ],
    nsModules: ['NetSuite Base', 'Multi-Location Inventory', 'Lot/Serial Tracking', 'Demand Planning (optional)'],
    consultantNotes: [
      'Confirm if they need consignment inventory — requires custom setup beyond this preset',
      'Ask about returns/RMA process — distribution has high return volume',
      'Verify credit limits and order holds for customers — common requirement',
      'Check if they use third-party logistics (3PL) — needs a WMS connector',
      'Lot tracking must be enabled at item level — help client categorise which items need it',
    ],
    answers: {
      'r2r.entities.numEntities': '1-5',
      'r2r.entities.multiCurrency': false,
      'r2r.segmentation.departments': true,
      'r2r.accountingPeriods.periodType': 'MONTHLY',
      // P2P
      'p2p.vendors.approxVendorCount': '201-500',
      'p2p.purchasing.poRequired': true,
      'p2p.purchasing.threeWayMatch': true,
      'p2p.receiving.warehouseReceipts': true,
      // O2C
      'o2c.customers.approxCustomerCount': '1001-5000',
      'o2c.pricing.multiPriceLevel': true,
      'o2c.salesOrders.dropShip': true,
      'o2c.fulfillment.multiWarehouse': true,
      'o2c.fulfillment.lotSerial': true,
      'o2c.invoicing.autoInvoice': false,
      // MFG — typically light assembly only
      'mfg.productionFlow.inScope': false,
    },
  },
  {
    id: 'services',
    label: 'Professional Services',
    iconId: 'Briefcase',
    color: 'bg-violet-100',
    textColor: 'text-violet-600',
    description: 'Project-based billing, timesheets, expense reports, deferred revenue',
    longDescription: 'For consulting firms, agencies, IT services, and other companies that bill for time and expertise. Revenue is project-based and often recognised over time (deferred), requiring tight control over project budgets, timesheet approvals, and milestone-based invoicing.',
    keyFeatures: [
      'Project-based billing — fixed fee, time & materials, or milestone',
      'Employee timesheet submission and approval workflow',
      'Expense reports with multi-level approval',
      'Deferred revenue recognition (ASC 606 / IFRS 15 compliant)',
      'Progress billing against project budgets',
      'Dunning / collections for outstanding invoices',
    ],
    nsModules: ['NetSuite Base', 'SuiteProjects (PSA)', 'Expense Management', 'Advanced Revenue Management (ARM) for deferred revenue', 'OneWorld if multi-entity'],
    consultantNotes: [
      'ARM (deferred revenue) requires a separate revenue arrangement setup — plan extra days for this',
      'Timesheet approval workflows need to match the client\'s org structure exactly',
      'Ask if they use subcontractors — their time needs to flow through vendor bills, not timesheets',
      'Multi-currency is pre-enabled — confirm which currencies are needed',
      'Confirm if project resource management / utilisation reporting is needed (adds SuiteProjects scope)',
    ],
    answers: {
      'r2r.entities.numEntities': '1-5',
      'r2r.entities.multiCurrency': true,
      'r2r.segmentation.departments': true,
      'r2r.segmentation.projects': true,
      'r2r.accountingPeriods.periodType': 'MONTHLY',
      'r2r.reporting.deferredRevenue': true,
      // P2P
      'p2p.vendors.approxVendorCount': '1-50',
      'p2p.purchasing.poRequired': false,
      'p2p.expenses.employeeExpenses': true,
      // O2C
      'o2c.customers.approxCustomerCount': '201-1000',
      'o2c.pricing.projectBilling': true,
      'o2c.salesOrders.projectOrders': true,
      'o2c.invoicing.progressBilling': true,
      'o2c.collections.dunning': true,
      // MFG — out of scope
      'mfg.productionFlow.inScope': false,
    },
  },
  {
    id: 'nonprofit',
    label: 'Non-Profit',
    iconId: 'Heart',
    color: 'bg-green-100',
    textColor: 'text-green-600',
    description: 'Grant management, fund accounting, program tracking, donor management',
    longDescription: 'For NGOs, charities, foundations, and public sector organisations. Fund accounting separates restricted and unrestricted funds, grant tracking ensures spending stays within funder rules, and program tracking shows impact by activity area. Key difference from commercial: revenue is donations & grants, not invoices.',
    keyFeatures: [
      'Fund accounting — restricted vs. unrestricted fund separation',
      'Grant management with budget vs. actual by grant',
      'Program / project tracking for activity-based reporting',
      'Donor management (contacts with giving history)',
      'Streamlined AP — most payments are operational, low PO volume',
    ],
    nsModules: ['NetSuite for Non-Profits edition (or standard with customisation)', 'Fund Accounting configuration', 'SuiteProjects for grant tracking (optional)'],
    consultantNotes: [
      'Non-Profit edition has different chart of accounts structure — confirm with client if they use IFRS for NPOs or local GAAP',
      'Grant budgets must be configured carefully — overspend reports are critical for auditors',
      'Ask about donor receipting requirements — some countries require specific tax receipt formats',
      'Confirm if they receive government grants with reimbursement billing (changes O2C setup significantly)',
      'Board reporting is usually the #1 requirement — understand the key financial statements they present quarterly',
    ],
    answers: {
      'r2r.entities.numEntities': '1-5',
      'r2r.entities.multiCurrency': false,
      'r2r.segmentation.departments': true,
      'r2r.segmentation.funds': true,
      'r2r.segmentation.grants': true,
      'r2r.accountingPeriods.periodType': 'MONTHLY',
      // P2P
      'p2p.vendors.approxVendorCount': '1-50',
      'p2p.purchasing.poRequired': false,
      // O2C
      'o2c.customers.approxCustomerCount': '1-200',
      // MFG — out of scope
      'mfg.productionFlow.inScope': false,
    },
  },
  {
    id: 'poultry',
    label: 'Poultry & Food Processing',
    iconId: 'Bird',
    color: 'bg-amber-100',
    textColor: 'text-amber-600',
    description: 'Lot/batch traceability, cold chain, processing work orders, HACCP compliance',
    longDescription: 'For poultry farms, slaughterhouses, and further-processing facilities. The most critical requirement is end-to-end lot traceability — every product must be traceable from live bird intake through slaughter, cut/pack, cold storage, and delivery. HACCP/food safety compliance drives the quality control setup.',
    keyFeatures: [
      'Lot-level traceability from raw intake to finished product delivery',
      'Multi-level BOM for cut/pack and further processing lines',
      'Work orders with routing for slaughter → cut → pack workflow',
      'Cold chain multi-warehouse with bin/location management',
      'Quality control at receiving (bird intake) and finished goods',
      'Yield reporting — planned vs. actual production output',
    ],
    nsModules: ['NetSuite Manufacturing', 'Advanced Manufacturing', 'Multi-Location Inventory', 'Lot Tracking (mandatory)', 'Quality Management'],
    consultantNotes: [
      'Yield/by-product tracking is critical — chicken processing produces multiple co-products (breast, legs, offal, etc.). This needs careful BOM design',
      'Cold chain: confirm temperature zones and whether bin-level tracking is needed within cold rooms',
      'HACCP critical control points need to be mapped to QC inspection steps',
      'Ask about live bird contracts vs. spot purchases — affects P2P setup',
      'Export sales may require lot-level certification per shipment — design the O2C pick/pack to capture this',
      'Weight-based pricing is common — confirm if billing is by kg rather than quantity',
    ],
    answers: {
      // R2R
      'r2r.entities.numEntities': '1-5',
      'r2r.entities.multiCurrency': false,
      'r2r.segmentation.departments': true,
      'r2r.segmentation.locations': true,
      'r2r.accountingPeriods.periodType': 'MONTHLY',
      // P2P — raw material purchasing (feed, livestock, packaging)
      'p2p.vendors.approxVendorCount': '51-200',
      'p2p.purchasing.poRequired': true,
      'p2p.purchasing.threeWayMatch': true,
      'p2p.receiving.warehouseReceipts': true,
      // O2C — B2B wholesale with lot/serial traceability
      'o2c.customers.approxCustomerCount': '201-1000',
      'o2c.pricing.multiPriceLevel': true,
      'o2c.salesOrders.onlineOrders': false,
      'o2c.fulfillment.multiWarehouse': true,
      'o2c.fulfillment.lotSerial': true,
      'o2c.invoicing.autoInvoice': false,
      // MFG — slaughter / cut / pack / further processing lines
      'mfg.productionFlow.inScope': true,
      'mfg.bom.multilevelBom': true,
      'mfg.workOrders.routingRequired': true,
      'mfg.costing.standardCosting': true,
      'mfg.inventory.multiWarehouse': true,
      'mfg.quality.inScope': true,
    },
  },
  {
    id: 'food_beverage',
    label: 'Food & Beverage',
    iconId: 'ChefHat',
    color: 'bg-lime-100',
    textColor: 'text-lime-700',
    description: 'Recipe/formula management, batch production, expiry/shelf-life tracking, food safety',
    longDescription: 'For food and beverage manufacturers using recipe or formula-based production — dairy, bakery, beverages, sauces, snacks. Key differences from generic manufacturing: variable batch yields, shelf-life/expiry tracking, and food safety compliance. Average costing is often preferred over standard due to ingredient price volatility.',
    keyFeatures: [
      'Recipe/formula BOM with batch quantity scaling',
      'Expiry date and shelf-life tracking on all finished goods',
      'Lot traceability for ingredient-to-finished-product recall',
      'Quality control at ingredient receiving and finished goods release',
      'Multi-warehouse with cold/dry/ambient zone management',
    ],
    nsModules: ['NetSuite Manufacturing', 'Advanced Manufacturing', 'Multi-Location Inventory', 'Lot/Serial Tracking', 'Quality Management', 'Process Manufacturing (if applicable)'],
    consultantNotes: [
      'Average costing is pre-set (not standard) — ingredient prices fluctuate daily, making standard variance reports misleading',
      'Expiry dates must be captured at item receipt level — set this expectation with the client upfront',
      'Ask about allergen management — some clients need allergen declarations on production records',
      'Check GS1 barcode labelling requirements for supermarket supply chains',
      'Seasonal recipes are common — ask if recipe versions change by season or raw material availability',
      'Confirm batch size range — small artisan batches vs. large production runs affect routing design',
    ],
    answers: {
      // R2R
      'r2r.entities.numEntities': '1-5',
      'r2r.entities.multiCurrency': false,
      'r2r.segmentation.departments': true,
      'r2r.segmentation.locations': true,
      'r2r.accountingPeriods.periodType': 'MONTHLY',
      // P2P
      'p2p.vendors.approxVendorCount': '51-200',
      'p2p.purchasing.poRequired': true,
      'p2p.purchasing.threeWayMatch': true,
      'p2p.receiving.warehouseReceipts': true,
      // O2C
      'o2c.customers.approxCustomerCount': '201-1000',
      'o2c.pricing.multiPriceLevel': true,
      'o2c.salesOrders.onlineOrders': false,
      'o2c.fulfillment.multiWarehouse': true,
      'o2c.fulfillment.lotSerial': true,
      'o2c.invoicing.autoInvoice': false,
      // MFG — recipe/batch production
      'mfg.productionFlow.inScope': true,
      'mfg.bom.multilevelBom': true,
      'mfg.workOrders.routingRequired': true,
      'mfg.costing.standardCosting': false,
      'mfg.inventory.multiWarehouse': true,
      'mfg.quality.inScope': true,
    },
  },
  {
    id: 'pharma',
    label: 'Pharma / Life Sciences',
    iconId: 'FlaskConical',
    color: 'bg-teal-100',
    textColor: 'text-teal-600',
    description: 'Batch/lot compliance, serialization, GxP validation, FDA regulatory requirements',
    longDescription: 'For pharmaceutical manufacturers, medical device companies, and life sciences organisations subject to FDA 21 CFR Part 11, EU GMP, or similar regulations. Every process must be validated, every transaction auditable. The implementation itself is subject to Computer System Validation (CSV) — plan for 30-40% more effort than a standard manufacturing project.',
    keyFeatures: [
      'Batch/lot compliance with full genealogy traceability',
      'GxP-validated workflows for production and QC release',
      'Serialisation support for track-and-trace (where required)',
      'Full audit trail on all transactions (21 CFR Part 11)',
      'Certificate of Analysis (CoA) generation per batch',
      'Multi-currency for international distribution',
    ],
    nsModules: ['NetSuite Manufacturing', 'Advanced Manufacturing', 'Quality Management', 'Lot Tracking (mandatory)', 'Multi-Location Inventory', 'OneWorld (if multi-entity)', 'SuiteProjects for validation project tracking'],
    consultantNotes: [
      'Computer System Validation (CSV) is mandatory — the client will need IQ/OQ/PQ documentation. Ofoq must provide system specification documents. Add 3-4 weeks to the project timeline.',
      'Electronic signatures (21 CFR Part 11) need SuiteCloud configuration — not out-of-the-box',
      'Batch records must be immutable — custom scripts may be needed to lock records after release',
      'Ask about Change Control — any system change post go-live requires a formal change request in regulated environments',
      'Cold chain GDP compliance may be required for distribution (2-8°C, 15-25°C zones)',
      'Confirm if serialisation is required (item-level) or batch-level traceability only',
      'Plan a separate GxP Training session for the client\'s quality team before UAT',
    ],
    answers: {
      // R2R
      'r2r.entities.numEntities': '1-5',
      'r2r.entities.multiCurrency': true,
      'r2r.segmentation.departments': true,
      'r2r.segmentation.locations': true,
      'r2r.accountingPeriods.periodType': 'MONTHLY',
      // P2P
      'p2p.vendors.approxVendorCount': '51-200',
      'p2p.purchasing.poRequired': true,
      'p2p.purchasing.threeWayMatch': true,
      'p2p.receiving.warehouseReceipts': true,
      // O2C — typically B2B distributor/hospital channels
      'o2c.customers.approxCustomerCount': '201-1000',
      'o2c.pricing.multiPriceLevel': true,
      'o2c.salesOrders.onlineOrders': false,
      'o2c.fulfillment.multiWarehouse': true,
      'o2c.fulfillment.lotSerial': true,
      'o2c.invoicing.autoInvoice': false,
      'o2c.collections.dunning': true,
      // MFG — batch manufacturing, strict QC
      'mfg.productionFlow.inScope': true,
      'mfg.bom.multilevelBom': true,
      'mfg.workOrders.routingRequired': true,
      'mfg.costing.standardCosting': true,
      'mfg.inventory.multiWarehouse': true,
      'mfg.quality.inScope': true,
    },
  },
  {
    id: 'construction',
    label: 'Construction & Real Estate',
    iconId: 'Building',
    color: 'bg-slate-100',
    textColor: 'text-slate-600',
    description: 'Project-based costing, subcontractor management, retention tracking, progress billing',
    longDescription: 'For construction contractors, developers, and real estate companies managing large projects with multiple subcontractors. Revenue recognition is typically based on percentage-of-completion or over-time methods. The key challenge is tracking costs against project budgets while managing retention, variation orders, and milestone-based billing.',
    keyFeatures: [
      'Project-based cost tracking with budget vs. actual by cost code',
      'Subcontractor management with retention and variation tracking',
      'Progress billing / milestone invoicing against project contracts',
      'Multi-entity for separate companies per project (JVs)',
      'Equipment allocation and depreciation tracking',
    ],
    nsModules: ['NetSuite Base', 'SuiteProjects (PSA)', 'OneWorld (if multi-entity JVs)', 'Advanced Revenue Management (ARM)', 'Fixed Assets'],
    consultantNotes: [
      'Progress billing typically uses percentage-of-completion — requires ARM or custom revenue recognition',
      'Retention tracking (5-10% withheld) needs a dedicated liability account and aging',
      'Ask about variation orders (change orders) — these modify project scope and budget mid-project',
      'Equipment costs allocated to projects need custom scripts or Advanced Intercompany Journal Entries',
      'Confirm if the client operates Joint Ventures — each JV may need its own subsidiary',
    ],
    answers: {
      'r2r.entities.numEntities': '1-5',
      'r2r.entities.multiCurrency': true,
      'r2r.segmentation.departments': true,
      'r2r.segmentation.projects': true,
      'r2r.accountingPeriods.periodType': 'MONTHLY',
      'r2r.reporting.deferredRevenue': true,
      'p2p.vendors.approxVendorCount': '201-500',
      'p2p.purchasing.poRequired': true,
      'p2p.purchasing.threeWayMatch': true,
      'p2p.receiving.warehouseReceipts': true,
      'o2c.customers.approxCustomerCount': '1-200',
      'o2c.pricing.projectBilling': true,
      'o2c.invoicing.progressBilling': true,
      'o2c.collections.dunning': true,
      'mfg.productionFlow.inScope': false,
    },
  },
  {
    id: 'trading',
    label: 'Trading & Import/Export',
    iconId: 'Ship',
    color: 'bg-cyan-100',
    textColor: 'text-cyan-600',
    description: 'Multi-currency trading, landed cost, letter of credit, customs clearance',
    longDescription: 'For trading companies importing and exporting goods across borders. The critical challenge is accurate landed cost calculation (freight, insurance, customs, duties) to determine true item cost. Multi-currency is essential since purchases and sales happen in different currencies. Common in the GCC region for companies importing goods from Asia/Europe for local distribution.',
    keyFeatures: [
      'Multi-currency purchasing and sales in different currencies',
      'Landed cost calculation including freight, insurance, customs duties',
      'Letter of Credit (LC) tracking and bank guarantee management',
      'Import/export documentation and customs clearance tracking',
      'Consignment and in-transit inventory tracking',
    ],
    nsModules: ['NetSuite Base', 'OneWorld (if multi-entity)', 'Multi-Currency', 'Landed Cost', 'Multi-Location Inventory'],
    consultantNotes: [
      'Landed cost allocation method varies — confirm if by value, weight, quantity, or custom formula',
      'Letter of Credit tracking usually requires custom records — NetSuite has no native LC module',
      'Ask about foreign exchange hedging — may need custom FX gain/loss reporting',
      'Import duties and VAT on import affect cash flow — design a clear process for duty payment recording',
      'In-transit inventory needs a dedicated location or custom status field',
      'Confirm Incoterms used (FOB, CIF, etc.) — affects when ownership and risk transfer',
    ],
    answers: {
      'r2r.entities.numEntities': '1-5',
      'r2r.entities.multiCurrency': true,
      'r2r.segmentation.departments': true,
      'r2r.segmentation.locations': true,
      'r2r.accountingPeriods.periodType': 'MONTHLY',
      'p2p.vendors.approxVendorCount': '51-200',
      'p2p.purchasing.poRequired': true,
      'p2p.purchasing.threeWayMatch': true,
      'p2p.receiving.warehouseReceipts': true,
      'o2c.customers.approxCustomerCount': '201-1000',
      'o2c.pricing.multiPriceLevel': true,
      'o2c.fulfillment.multiWarehouse': true,
      'o2c.fulfillment.lotSerial': false,
      'o2c.invoicing.autoInvoice': false,
      'mfg.productionFlow.inScope': false,
    },
  },
  {
    id: 'healthcare',
    label: 'Healthcare & Clinics',
    iconId: 'Stethoscope',
    color: 'bg-rose-100',
    textColor: 'text-rose-600',
    description: 'Patient billing, insurance claims, multi-location clinics, inventory for medical supplies',
    longDescription: 'For hospitals, clinic chains, and healthcare service providers. Revenue comes from patient billing (direct and insurance) with complex pricing schedules. Multi-location management is critical for clinic chains. Inventory management covers medical supplies, pharmaceuticals, and equipment across locations.',
    keyFeatures: [
      'Patient billing with insurance vs. self-pay split',
      'Multi-location clinic/branch management',
      'Medical supply inventory with expiry tracking',
      'Service-based revenue with department-level reporting',
      'Vendor management for pharmaceutical and medical supply procurement',
    ],
    nsModules: ['NetSuite Base', 'Multi-Location Inventory', 'Lot Tracking (for pharma supplies)', 'OneWorld (if multi-entity group)'],
    consultantNotes: [
      'Patient billing often integrates with a Hospital Information System (HIS) — confirm integration scope',
      'Insurance receivables have complex aging with different payment timelines by insurer',
      'Medical supplies may need temperature-controlled storage tracking',
      'Confirm regulatory requirements for financial reporting (MOHAP, DHA depending on emirate)',
      'Ask about capitation contracts vs. fee-for-service billing models',
    ],
    answers: {
      'r2r.entities.numEntities': '1-5',
      'r2r.entities.multiCurrency': false,
      'r2r.segmentation.departments': true,
      'r2r.segmentation.locations': true,
      'r2r.accountingPeriods.periodType': 'MONTHLY',
      'p2p.vendors.approxVendorCount': '51-200',
      'p2p.purchasing.poRequired': true,
      'p2p.purchasing.threeWayMatch': true,
      'p2p.receiving.warehouseReceipts': true,
      'o2c.customers.approxCustomerCount': '1001-5000',
      'o2c.pricing.multiPriceLevel': true,
      'o2c.fulfillment.multiWarehouse': true,
      'o2c.fulfillment.lotSerial': true,
      'o2c.invoicing.autoInvoice': true,
      'o2c.collections.dunning': true,
      'mfg.productionFlow.inScope': false,
    },
  },
];
