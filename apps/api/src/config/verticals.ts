// ─── Vertical Registry ────────────────────────────────────────────────────────
// Each vertical defines its own wizard questions, recommended NS modules,
// pre-seeded risks, typical timeline, and data collection template IDs.
// To add a new vertical (e.g. a future OFOQ custom product), add an entry here.

export interface VerticalQuestion {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'boolean';
  options?: string[];
  placeholder?: string;
  required?: boolean;
  section: string; // logical grouping label
}

export interface VerticalModule {
  id: string;
  name: string;
  reason: string;
  required: boolean;
}

export interface VerticalRisk {
  title: string;
  description: string;
  riskScore: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  mitigation: string;
  category: string;
}

export interface VerticalMilestone {
  name: string;
  weekOffset: number;   // weeks from project start
  durationWeeks: number;
  stage: 'DISCOVERY' | 'SCOPING' | 'BUILD' | 'UAT' | 'GO_LIVE';
}

export interface VerticalDefinition {
  id: string;           // e.g. 'POULTRY', 'RETAIL'
  name: string;
  description: string;
  iconId: string;       // lucide icon name
  color: string;        // tailwind bg color
  textColor: string;
  tag?: string;         // e.g. 'OFOQ Custom Solution'
  productUrl?: string;  // link to external product page / docs
  questions: VerticalQuestion[];
  modules: VerticalModule[];
  risks: VerticalRisk[];
  timeline: VerticalMilestone[];
  dataTemplateIds: string[]; // references to dataTemplates.ts
}

// ─────────────────────────────────────────────────────────────────────────────

export const VERTICALS: VerticalDefinition[] = [

  // ─── OFOQ Poultry Solution ─────────────────────────────────────────────────
  {
    id: 'POULTRY',
    name: 'Poultry Management',
    description: 'OFOQ\'s custom NetSuite solution for poultry integrators — covers flock management, hatchery, grow-out, processing, and feed operations.',
    iconId: 'Bird',
    color: 'bg-amber-50',
    textColor: 'text-amber-700',
    tag: 'OFOQ Custom Solution',
    productUrl: 'https://ofoq.com/solutions/poultry',
    questions: [
      { key: 'poultry_operations', label: 'Which operations are in scope?', type: 'multiselect', options: ['Hatchery', 'Grow-out / Contract Farming', 'Processing Plant', 'Feed Mill', 'Live Bird Sales', 'Retail / Distribution'], section: 'Operations Scope', required: true },
      { key: 'poultry_species', label: 'Species managed', type: 'multiselect', options: ['Broilers', 'Layers', 'Breeders', 'Turkeys', 'Ducks'], section: 'Operations Scope', required: true },
      { key: 'flock_count', label: 'Average active flocks at any time', type: 'select', options: ['< 50', '50–200', '200–500', '500–1,000', '1,000+'], section: 'Scale' },
      { key: 'grower_count', label: 'Number of contract growers', type: 'text', placeholder: 'e.g. 120', section: 'Scale' },
      { key: 'feed_mill_owned', label: 'Does the company own a feed mill?', type: 'boolean', section: 'Feed Operations' },
      { key: 'feed_formulation', label: 'Feed formulation system currently in use', type: 'text', placeholder: 'e.g. BRILL, in-house', section: 'Feed Operations' },
      { key: 'processing_capacity', label: 'Processing capacity (birds/day)', type: 'text', placeholder: 'e.g. 60,000', section: 'Processing' },
      { key: 'halal_certified', label: 'Halal certification required?', type: 'boolean', section: 'Processing' },
      { key: 'cold_chain', label: 'Cold chain / temperature monitoring required?', type: 'boolean', section: 'Processing' },
      { key: 'mortality_tracking', label: 'How is mortality currently tracked?', type: 'select', options: ['Paper / manual', 'Spreadsheet', 'Standalone system', 'ERP'], section: 'Current State' },
      { key: 'medication_tracking', label: 'Medication and vaccination tracking requirements', type: 'textarea', placeholder: 'Describe traceability needs, regulatory requirements...', section: 'Compliance' },
      { key: 'traceability_required', label: 'Lot/batch traceability to retail required?', type: 'boolean', section: 'Compliance' },
      { key: 'integrations_poultry', label: 'External systems to integrate', type: 'multiselect', options: ['LIMS / Lab system', 'Weighbridge / Scale', 'Feed formulation software', 'Hatchery management system', 'Cold storage WMS', 'Government traceability portal'], section: 'Integrations' },
    ],
    modules: [
      { id: 'flock_mgmt', name: 'Flock & Grow-out Management', reason: 'Core module for tracking flocks from placement to processing', required: true },
      { id: 'grower_settlement', name: 'Contract Grower Settlement', reason: 'Calculate and pay grower settlements based on performance metrics', required: true },
      { id: 'hatchery', name: 'Hatchery Management', reason: 'Egg setting, candling, hatch results, chick placement tracking', required: false },
      { id: 'feed_mill', name: 'Feed Mill & Formulation', reason: 'Feed orders, raw material procurement, batch manufacturing', required: false },
      { id: 'processing', name: 'Processing Plant Operations', reason: 'Kill, chill, cut-up, packaging, yield tracking', required: false },
      { id: 'ns_wms', name: 'NetSuite WMS', reason: 'Cold storage and finished goods warehouse management', required: false },
      { id: 'ns_manufacturing', name: 'NetSuite Manufacturing', reason: 'BOM and work orders for feed production and processing', required: false },
      { id: 'ns_quality', name: 'Quality Management', reason: 'LIMS integration, rejection tracking, compliance records', required: false },
    ],
    risks: [
      { title: 'Feed formulation integration complexity', description: 'Connecting third-party feed formulation system to NS BOM/purchasing can be technically complex', riskScore: 'HIGH', mitigation: 'Map integration points in scoping; plan for middleware if API is unavailable', category: 'Technical' },
      { title: 'Grower settlement calculation accuracy', description: 'Incorrect settlement formulas can damage grower relationships and create legal exposure', riskScore: 'HIGH', mitigation: 'Run parallel settlements for 2 cycles before cutover; get grower sign-off on formula setup', category: 'Business' },
      { title: 'Flock performance data migration', description: 'Historical flock data may be in disparate formats or paper records', riskScore: 'MEDIUM', mitigation: 'Agree on historical data cut-off date; only migrate open flocks at go-live', category: 'Data' },
      { title: 'Regulatory / traceability compliance', description: 'Local food safety authority may require specific traceability record formats', riskScore: 'MEDIUM', mitigation: 'Engage regulatory consultant early; confirm OFOQ module covers local requirements', category: 'Compliance' },
      { title: 'User adoption in processing plant', description: 'Plant floor staff may resist moving from paper/standalone to NS', riskScore: 'MEDIUM', mitigation: 'Dedicated plant floor training sessions; simplified data entry screens', category: 'Change Management' },
    ],
    timeline: [
      { name: 'Discovery & Vertical Scoping', weekOffset: 0, durationWeeks: 3, stage: 'DISCOVERY' },
      { name: 'Poultry Module Configuration Design', weekOffset: 3, durationWeeks: 4, stage: 'SCOPING' },
      { name: 'Grower & Flock Setup', weekOffset: 7, durationWeeks: 5, stage: 'BUILD' },
      { name: 'Feed & Processing Configuration', weekOffset: 10, durationWeeks: 6, stage: 'BUILD' },
      { name: 'Integrations Build', weekOffset: 14, durationWeeks: 4, stage: 'BUILD' },
      { name: 'UAT — Flock Cycle End-to-End', weekOffset: 18, durationWeeks: 4, stage: 'UAT' },
      { name: 'Parallel Settlement Run', weekOffset: 20, durationWeeks: 3, stage: 'UAT' },
      { name: 'Go-Live & Hypercare', weekOffset: 23, durationWeeks: 4, stage: 'GO_LIVE' },
    ],
    dataTemplateIds: ['chart_of_accounts', 'vendors', 'customers', 'items', 'opening_balances', 'growers', 'flocks_active', 'medication_records'],
  },

  // ─── Retail ────────────────────────────────────────────────────────────────
  {
    id: 'RETAIL',
    name: 'Retail & Omnichannel',
    description: 'Standard NetSuite implementation for retail businesses with POS, e-commerce, and multi-location inventory needs.',
    iconId: 'ShoppingCart',
    color: 'bg-pink-50',
    textColor: 'text-pink-700',
    questions: [
      { key: 'retail_channels', label: 'Sales channels in scope', type: 'multiselect', options: ['Physical stores', 'E-commerce (own site)', 'Marketplace (Amazon, Noon, etc.)', 'B2B / wholesale', 'Mobile app'], section: 'Channel Scope', required: true },
      { key: 'store_count', label: 'Number of store locations', type: 'text', placeholder: 'e.g. 15', section: 'Channel Scope' },
      { key: 'pos_system', label: 'Current POS system', type: 'text', placeholder: 'e.g. Oracle MICROS, Lightspeed, custom', section: 'Current State' },
      { key: 'pos_integration', label: 'POS integration approach', type: 'select', options: ['Replace with SuiteCommerce POS', 'Integrate existing POS', 'New NS-certified POS partner'], section: 'Integrations' },
      { key: 'sku_count', label: 'Approximate SKU count', type: 'select', options: ['< 1,000', '1,000–10,000', '10,000–50,000', '50,000+'], section: 'Scale' },
      { key: 'ecommerce_platform', label: 'E-commerce platform', type: 'select', options: ['SuiteCommerce', 'Shopify', 'WooCommerce', 'Magento', 'Other'], section: 'Integrations' },
      { key: 'loyalty_program', label: 'Loyalty / rewards program required?', type: 'boolean', section: 'Features' },
      { key: 'promotions_complexity', label: 'Promotions and pricing complexity', type: 'select', options: ['Simple (fixed discounts)', 'Moderate (tiered, buy X get Y)', 'Complex (AI-driven, dynamic)'], section: 'Features' },
    ],
    modules: [
      { id: 'suite_commerce', name: 'SuiteCommerce / SCA', reason: 'Native NS e-commerce and POS platform', required: false },
      { id: 'ns_inventory', name: 'Multi-Location Inventory', reason: 'Track stock across stores and warehouses', required: true },
      { id: 'ns_wms', name: 'NetSuite WMS', reason: 'Warehouse fulfillment for e-commerce orders', required: false },
      { id: 'ns_planning', name: 'Demand Planning', reason: 'Replenishment planning for seasonal retail', required: false },
      { id: 'ns_pos', name: 'POS Integration', reason: 'Real-time sales and inventory sync from stores', required: true },
    ],
    risks: [
      { title: 'POS data migration and cutover', description: 'Transitioning live POS systems risks sales downtime', riskScore: 'HIGH', mitigation: 'Phased store rollout; maintain fallback POS procedure for first week', category: 'Technical' },
      { title: 'Item / SKU data quality', description: 'Retail item masters are often messy with duplicate or incomplete records', riskScore: 'HIGH', mitigation: 'Dedicate a data cleanse sprint before migration; enforce mandatory fields', category: 'Data' },
      { title: 'Promotions engine configuration', description: 'Complex pricing rules are time-consuming to configure and test', riskScore: 'MEDIUM', mitigation: 'Prioritize top 20% of promotions for go-live; migrate remainder post-launch', category: 'Scope' },
    ],
    timeline: [
      { name: 'Discovery & Channel Mapping', weekOffset: 0, durationWeeks: 2, stage: 'DISCOVERY' },
      { name: 'Scoping & Design', weekOffset: 2, durationWeeks: 3, stage: 'SCOPING' },
      { name: 'Core NS Build', weekOffset: 5, durationWeeks: 6, stage: 'BUILD' },
      { name: 'POS & E-com Integration', weekOffset: 9, durationWeeks: 5, stage: 'BUILD' },
      { name: 'UAT', weekOffset: 14, durationWeeks: 3, stage: 'UAT' },
      { name: 'Store Pilot Go-Live', weekOffset: 17, durationWeeks: 2, stage: 'GO_LIVE' },
      { name: 'Full Rollout', weekOffset: 19, durationWeeks: 3, stage: 'GO_LIVE' },
    ],
    dataTemplateIds: ['chart_of_accounts', 'customers', 'vendors', 'items', 'opening_balances', 'inventory_locations', 'price_levels'],
  },

  // ─── Manufacturing ─────────────────────────────────────────────────────────
  {
    id: 'MANUFACTURING',
    name: 'Manufacturing',
    description: 'NetSuite implementation for discrete and process manufacturers — BOMs, routings, work orders, and shop floor.',
    iconId: 'Factory',
    color: 'bg-orange-50',
    textColor: 'text-orange-700',
    questions: [
      { key: 'mfg_type', label: 'Manufacturing type', type: 'select', options: ['Discrete (make-to-order)', 'Process / batch', 'Repetitive / assembly', 'Mixed mode'], section: 'Manufacturing Profile', required: true },
      { key: 'bom_levels', label: 'BOM depth (levels)', type: 'select', options: ['1–2 levels (simple)', '3–5 levels', '5+ levels (complex)'], section: 'Manufacturing Profile' },
      { key: 'work_centre_count', label: 'Number of work centres / machines', type: 'text', placeholder: 'e.g. 24', section: 'Scale' },
      { key: 'shop_floor_control', label: 'Shop floor data capture required?', type: 'boolean', section: 'Features' },
      { key: 'quality_inspections', label: 'In-process quality inspections required?', type: 'boolean', section: 'Features' },
      { key: 'mrp_required', label: 'MRP / production planning scope', type: 'select', options: ['Basic (manual WOs)', 'MRP-driven replenishment', 'Full APS'], section: 'Features' },
    ],
    modules: [
      { id: 'ns_manufacturing', name: 'NetSuite Manufacturing', reason: 'Core BOM, routing, and work order management', required: true },
      { id: 'ns_planning', name: 'Supply Chain Planning / MRP', reason: 'Material requirements planning and production scheduling', required: false },
      { id: 'ns_quality', name: 'Quality Management', reason: 'In-process and receiving inspections, non-conformance tracking', required: false },
      { id: 'ns_wms', name: 'WMS', reason: 'Raw material and finished goods warehouse', required: false },
    ],
    risks: [
      { title: 'BOM migration accuracy', description: 'Inaccurate BOMs cause incorrect costing and production shortages', riskScore: 'CRITICAL', mitigation: 'Engineering sign-off on each BOM before upload; spot-check via test WOs', category: 'Data' },
      { title: 'Routing and capacity modelling', description: 'Work centre capacity setup is complex and affects scheduling accuracy', riskScore: 'HIGH', mitigation: 'Start with simplified routings; add capacity constraints in phase 2', category: 'Scope' },
    ],
    timeline: [
      { name: 'Discovery', weekOffset: 0, durationWeeks: 3, stage: 'DISCOVERY' },
      { name: 'BOM & Routing Design', weekOffset: 3, durationWeeks: 4, stage: 'SCOPING' },
      { name: 'Core Manufacturing Build', weekOffset: 7, durationWeeks: 8, stage: 'BUILD' },
      { name: 'UAT', weekOffset: 15, durationWeeks: 4, stage: 'UAT' },
      { name: 'Go-Live', weekOffset: 19, durationWeeks: 3, stage: 'GO_LIVE' },
    ],
    dataTemplateIds: ['chart_of_accounts', 'vendors', 'customers', 'items', 'bom_headers', 'bom_components', 'work_centres', 'opening_balances'],
  },

  // ─── Distribution ──────────────────────────────────────────────────────────
  {
    id: 'DISTRIBUTION',
    name: 'Distribution & 3PL',
    description: 'NetSuite for wholesale distributors and third-party logistics — multi-warehouse, lot tracking, and carrier integrations.',
    iconId: 'Package',
    color: 'bg-blue-50',
    textColor: 'text-blue-700',
    questions: [
      { key: 'warehouse_count', label: 'Number of warehouses / DCs', type: 'text', placeholder: 'e.g. 4', section: 'Operations', required: true },
      { key: 'lot_serial_tracking', label: 'Lot / serial number tracking required?', type: 'boolean', section: 'Operations' },
      { key: 'three_pl_clients', label: 'Number of 3PL client accounts (if applicable)', type: 'text', placeholder: '0 if not 3PL', section: 'Scale' },
      { key: 'carrier_integrations', label: 'Carrier integrations needed', type: 'multiselect', options: ['Aramex', 'DHL', 'FedEx', 'SMSA', 'Other local'], section: 'Integrations' },
      { key: 'edi_required', label: 'EDI with suppliers/customers required?', type: 'boolean', section: 'Integrations' },
    ],
    modules: [
      { id: 'ns_wms', name: 'NetSuite WMS', reason: 'Bin-level warehouse management and directed putaway/picking', required: true },
      { id: 'ns_inventory', name: 'Multi-Location Inventory', reason: 'Stock visibility across all warehouses', required: true },
      { id: 'ship_central', name: 'ShipCentral / Carrier Integration', reason: 'Label printing and shipment booking via carriers', required: false },
    ],
    risks: [
      { title: 'Lot tracking data gaps', description: 'Historical lot data may be incomplete, affecting expiry and recall traceability', riskScore: 'HIGH', mitigation: 'Open lots only at go-live; historical lots as reference data', category: 'Data' },
      { title: 'Carrier API availability', description: 'Some regional carriers lack stable APIs, requiring manual workarounds', riskScore: 'MEDIUM', mitigation: 'Confirm API availability in discovery; budget for CSV-based fallback', category: 'Technical' },
    ],
    timeline: [
      { name: 'Discovery', weekOffset: 0, durationWeeks: 2, stage: 'DISCOVERY' },
      { name: 'WMS & Warehouse Design', weekOffset: 2, durationWeeks: 4, stage: 'SCOPING' },
      { name: 'Core Build', weekOffset: 6, durationWeeks: 7, stage: 'BUILD' },
      { name: 'UAT', weekOffset: 13, durationWeeks: 3, stage: 'UAT' },
      { name: 'Go-Live', weekOffset: 16, durationWeeks: 2, stage: 'GO_LIVE' },
    ],
    dataTemplateIds: ['chart_of_accounts', 'vendors', 'customers', 'items', 'inventory_locations', 'opening_balances', 'lot_numbers'],
  },

  // ─── Professional Services ─────────────────────────────────────────────────
  {
    id: 'SERVICES',
    name: 'Professional Services',
    description: 'NetSuite for service businesses — project accounting, resource management, billing milestones, and PSA.',
    iconId: 'Briefcase',
    color: 'bg-violet-50',
    textColor: 'text-violet-700',
    questions: [
      { key: 'billing_model', label: 'Primary billing model', type: 'select', options: ['Time & Materials', 'Fixed price', 'Milestone-based', 'Retainer', 'Mixed'], section: 'Commercial Model', required: true },
      { key: 'resource_count', label: 'Number of billable resources', type: 'text', placeholder: 'e.g. 80', section: 'Scale' },
      { key: 'timesheet_required', label: 'Timesheet system required?', type: 'boolean', section: 'Features' },
      { key: 'psa_module', label: 'Project tracking approach', type: 'select', options: ['NS Projects (basic)', 'OpenAir (full PSA)', 'Third-party PM tool integration'], section: 'Features' },
      { key: 'revenue_recognition', label: 'Revenue recognition standard', type: 'select', options: ['ASC 606 / IFRS 15', 'Percentage of completion', 'Completed contract', 'Simple invoice date'], section: 'Financial' },
    ],
    modules: [
      { id: 'ns_projects', name: 'NetSuite Projects', reason: 'Project budgeting, task management, and billing schedules', required: true },
      { id: 'openair', name: 'OpenAir PSA', reason: 'Full PSA with resource scheduling, utilization, and advanced billing', required: false },
      { id: 'rev_rec', name: 'Advanced Revenue Management', reason: 'ASC 606 / IFRS 15 compliant revenue recognition', required: false },
    ],
    risks: [
      { title: 'Revenue recognition complexity', description: 'Multi-element arrangements under ASC 606 can be complex to configure', riskScore: 'HIGH', mitigation: 'Engage NS rev rec specialist; document all contract types before build', category: 'Financial' },
      { title: 'Timesheet adoption', description: 'Consultants resistant to structured timesheet entry can undermine project profitability data', riskScore: 'MEDIUM', mitigation: 'Involve team leads in UAT; set up automated weekly reminders', category: 'Change Management' },
    ],
    timeline: [
      { name: 'Discovery', weekOffset: 0, durationWeeks: 2, stage: 'DISCOVERY' },
      { name: 'Project & Billing Design', weekOffset: 2, durationWeeks: 3, stage: 'SCOPING' },
      { name: 'Core Build', weekOffset: 5, durationWeeks: 6, stage: 'BUILD' },
      { name: 'UAT', weekOffset: 11, durationWeeks: 3, stage: 'UAT' },
      { name: 'Go-Live', weekOffset: 14, durationWeeks: 2, stage: 'GO_LIVE' },
    ],
    dataTemplateIds: ['chart_of_accounts', 'customers', 'vendors', 'employees', 'open_projects', 'opening_balances'],
  },

  // ─── Non-profit ────────────────────────────────────────────────────────────
  {
    id: 'NONPROFIT',
    name: 'Non-Profit & NGO',
    description: 'NetSuite for non-profit organizations — fund accounting, grant management, donor tracking, and program reporting.',
    iconId: 'Heart',
    color: 'bg-green-50',
    textColor: 'text-green-700',
    questions: [
      { key: 'fund_count', label: 'Number of funds / programs', type: 'text', placeholder: 'e.g. 12', section: 'Fund Accounting', required: true },
      { key: 'grant_management', label: 'Grant management required?', type: 'boolean', section: 'Programs' },
      { key: 'donor_count', label: 'Approximate donor records', type: 'select', options: ['< 500', '500–5,000', '5,000–50,000', '50,000+'], section: 'Scale' },
      { key: 'netsuite_edition', label: 'NetSuite edition', type: 'select', options: ['NS Non-Profit (NNSP)', 'Standard NS with fund accounting config', 'NS Social Impact'], section: 'Licensing' },
    ],
    modules: [
      { id: 'ns_nonprofit', name: 'NetSuite for Non-Profits', reason: 'Fund accounting, grant tracking, and program financial management', required: true },
      { id: 'ns_projects', name: 'Projects / Program Management', reason: 'Track program budgets vs actuals per grant', required: false },
      { id: 'crm', name: 'CRM / Donor Management', reason: 'Track donor relationships and giving history', required: false },
    ],
    risks: [
      { title: 'Fund segmentation design', description: 'Incorrect fund structure causes reporting errors that can affect grant compliance', riskScore: 'HIGH', mitigation: 'Involve finance director and auditors in fund design workshop', category: 'Financial' },
    ],
    timeline: [
      { name: 'Discovery', weekOffset: 0, durationWeeks: 2, stage: 'DISCOVERY' },
      { name: 'Fund Accounting Design', weekOffset: 2, durationWeeks: 3, stage: 'SCOPING' },
      { name: 'Build', weekOffset: 5, durationWeeks: 5, stage: 'BUILD' },
      { name: 'UAT', weekOffset: 10, durationWeeks: 3, stage: 'UAT' },
      { name: 'Go-Live', weekOffset: 13, durationWeeks: 2, stage: 'GO_LIVE' },
    ],
    dataTemplateIds: ['chart_of_accounts', 'funds', 'donors', 'vendors', 'grants', 'opening_balances'],
  },
];

export function getVertical(id: string): VerticalDefinition | undefined {
  return VERTICALS.find((v) => v.id === id);
}
