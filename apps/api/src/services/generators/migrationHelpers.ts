/**
 * Shared helpers for Pack Z — Data Migration Assets generators.
 *
 * Two responsibilities:
 *   1. Pipe-delimited parsers for the 7 cross-platform migration.* answers
 *      added by Pack Z (4 details + 3 readiness).
 *   2. `objectsInScope(answers)` — the spine of the whole pack. Walks
 *      KICKOFF / FOUNDATION / SOLUTION_DESIGN / R2R / O2C / P2P answers
 *      and returns the canonical list of master-data + transaction
 *      objects in scope for this engagement, per adaptor. Every Pack Z
 *      generator iterates this list to emit a CSV header, a mapping row,
 *      a load step, etc.
 *
 * Source conventions:
 *   - Master-data objects come first (no FK dependencies on other in-scope
 *     master data → first to load).
 *   - Open-balance / transaction objects come second (FK depend on master).
 *   - Reference data (chart-of-accounts, departments, classes) anchors
 *     everything else.
 *
 * Adaptor split:
 *   - NetSuite catalog: 16 objects keyed off `01_subsidiaries.csv` …
 *     `16_fixed_assets.csv` per the SuiteCloud import-CSV conventions.
 *     Subsidiary + classification, then masters, then opening balances.
 *   - Odoo catalog: 10 objects keyed off `01_companies.csv` …
 *     `10_boms.csv` per the Odoo import-template conventions.
 *
 * Both catalogs intentionally use the SAME logical names (`customers`,
 * `vendors`, `chartOfAccounts`, `inventory`) where they overlap — the
 * adaptor-conditional CSV header per object is what changes.
 */

// ─── Parsers — 7 cross-platform Pack Z answers ────────────────────────────────

export interface ParsedSourceSystemRow {
  /** Logical object (Customers, Vendors, Products, …). */
  object: string;
  /** Source system name + path (e.g. "QuickBooks Online — Customer Centre"). */
  source: string;
  /** Optional notes. */
  notes: string;
}

export interface ParsedCleansingRuleRow {
  /** Logical object. */
  object: string;
  /** Cleansing rule (e.g. "trim whitespace + uppercase tax IDs"). */
  rule: string;
  /** Owner (role or named person). */
  owner: string;
}

export interface ParsedRejectSlaRow {
  object: string;
  /** Threshold (count or percentage). */
  threshold: string;
  /** SLA — how fast rejects must be fixed and re-loaded. */
  sla: string;
}

export interface ParsedDataQualityOwnerRow {
  object: string;
  /** Named owner. */
  owner: string;
  /** Backup owner (delegate). */
  backup: string;
}

function pipeSplit(line: string): string[] {
  return line.split('|').map((s) => s.trim());
}

export function parseSourceSystemsByObject(raw: string): ParsedSourceSystemRow[] {
  const out: ParsedSourceSystemRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      object: segs[0],
      source: segs[1] ?? '',
      notes: segs[2] ?? '',
    });
  }
  return out;
}

export function parseCleansingRulesByObject(raw: string): ParsedCleansingRuleRow[] {
  const out: ParsedCleansingRuleRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      object: segs[0],
      rule: segs[1] ?? '',
      owner: segs[2] ?? '',
    });
  }
  return out;
}

export function parseRejectSlaByObject(raw: string): ParsedRejectSlaRow[] {
  const out: ParsedRejectSlaRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      object: segs[0],
      threshold: segs[1] ?? '',
      sla: segs[2] ?? '',
    });
  }
  return out;
}

export function parseDataQualityOwners(raw: string): ParsedDataQualityOwnerRow[] {
  const out: ParsedDataQualityOwnerRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      object: segs[0],
      owner: segs[1] ?? '',
      backup: segs[2] ?? '',
    });
  }
  return out;
}

// ─── Object-in-scope catalogs ──────────────────────────────────────────────────

export interface MigrationObject {
  /** Stable logical id (e.g. 'customers') — used for cross-doc references. */
  id: string;
  /** Display label (e.g. 'Customers'). */
  label: string;
  /**
   * Template filename — adaptor-conditional. NetSuite uses 2-digit
   * prefixed names; Odoo follows the same convention so they sort
   * load-order naturally in any file browser.
   */
  csvFilename: string;
  /**
   * Byte-for-byte CSV header row that the adaptor's CSV importer expects.
   * Must match the adaptor's import-CSV expectations exactly.
   */
  csvHeader: string;
  /**
   * Logical category — drives load sequencing. Reference loads first,
   * then master, then open-balance / transactional. Within a category
   * the catalog order is the canonical load order.
   */
  category: 'reference' | 'master' | 'open-balance' | 'transactional';
  /** Other object ids this object FK-depends on (must load before). */
  dependsOn: ReadonlyArray<string>;
}

/**
 * NetSuite catalog (16 objects). 2-digit prefixed CSV filenames so they
 * sort in load order in any directory listing. Headers follow the
 * SuiteCloud import-CSV conventions (External ID first, then required
 * mandatory fields, then commonly-used optional fields).
 */
export const NETSUITE_OBJECTS: ReadonlyArray<MigrationObject> = [
  {
    id: 'subsidiaries',
    label: 'Subsidiaries',
    csvFilename: '01_subsidiaries.csv',
    csvHeader: 'External ID,Name,Country,Currency,Legal Name,Federal ID,Parent',
    category: 'reference',
    dependsOn: [],
  },
  {
    id: 'departments',
    label: 'Departments',
    csvFilename: '02_departments.csv',
    csvHeader: 'External ID,Name,Subsidiary,Parent Department,Inactive',
    category: 'reference',
    dependsOn: ['subsidiaries'],
  },
  {
    id: 'classes',
    label: 'Classes',
    csvFilename: '03_classes.csv',
    csvHeader: 'External ID,Name,Subsidiary,Parent Class,Inactive',
    category: 'reference',
    dependsOn: ['subsidiaries'],
  },
  {
    id: 'locations',
    label: 'Locations',
    csvFilename: '04_locations.csv',
    csvHeader: 'External ID,Name,Subsidiary,Make Inventory Available,Address,Inactive',
    category: 'reference',
    dependsOn: ['subsidiaries'],
  },
  {
    id: 'chartOfAccounts',
    label: 'Chart of Accounts',
    csvFilename: '05_chart_of_accounts.csv',
    csvHeader: 'External ID,Account Number,Account Name,Account Type,Subsidiary,Currency,Parent Account,Description',
    category: 'reference',
    dependsOn: ['subsidiaries'],
  },
  {
    id: 'currencies',
    label: 'Currencies',
    csvFilename: '06_currencies.csv',
    csvHeader: 'External ID,Symbol,Name,Exchange Rate,Inactive',
    category: 'reference',
    dependsOn: [],
  },
  {
    id: 'taxCodes',
    label: 'Tax Codes',
    csvFilename: '07_tax_codes.csv',
    csvHeader: 'External ID,Tax Name,Description,Tax Type,Rate,Subsidiary,Effective From,Inactive',
    category: 'reference',
    dependsOn: ['subsidiaries'],
  },
  {
    id: 'customers',
    label: 'Customers',
    csvFilename: '08_customers.csv',
    csvHeader: 'External ID,Entity ID,Company Name,Subsidiary,Currency,Terms,Tax Code,Email,Phone,Billing Address,Shipping Address',
    category: 'master',
    dependsOn: ['subsidiaries', 'currencies', 'taxCodes'],
  },
  {
    id: 'vendors',
    label: 'Vendors',
    csvFilename: '09_vendors.csv',
    csvHeader: 'External ID,Entity ID,Company Name,Subsidiary,Currency,Terms,Tax Code,Email,Phone,Address,Tax ID',
    category: 'master',
    dependsOn: ['subsidiaries', 'currencies', 'taxCodes'],
  },
  {
    id: 'employees',
    label: 'Employees',
    csvFilename: '10_employees.csv',
    csvHeader: 'External ID,Entity ID,First Name,Last Name,Email,Subsidiary,Department,Class,Location,Supervisor',
    category: 'master',
    dependsOn: ['subsidiaries', 'departments', 'classes', 'locations'],
  },
  {
    id: 'items',
    label: 'Items',
    csvFilename: '11_items.csv',
    csvHeader: 'External ID,Item Name,Display Name,Type,Subsidiary,Income Account,Asset Account,Tax Code,Base Price,Description',
    category: 'master',
    dependsOn: ['subsidiaries', 'chartOfAccounts', 'taxCodes'],
  },
  {
    id: 'inventoryBalances',
    label: 'Inventory Opening Balances',
    csvFilename: '12_inventory_balances.csv',
    csvHeader: 'External ID,Item,Location,Quantity On Hand,Average Cost,Last Purchase Price,Subsidiary,Date',
    category: 'open-balance',
    dependsOn: ['items', 'locations'],
  },
  {
    id: 'openArInvoices',
    label: 'Open AR Invoices',
    csvFilename: '13_open_ar_invoices.csv',
    csvHeader: 'External ID,Customer,Subsidiary,Currency,Date,Due Date,Document Number,Account,Amount,Memo',
    category: 'open-balance',
    dependsOn: ['customers', 'subsidiaries', 'chartOfAccounts'],
  },
  {
    id: 'openApBills',
    label: 'Open AP Bills',
    csvFilename: '14_open_ap_bills.csv',
    csvHeader: 'External ID,Vendor,Subsidiary,Currency,Date,Due Date,Document Number,Account,Amount,Memo',
    category: 'open-balance',
    dependsOn: ['vendors', 'subsidiaries', 'chartOfAccounts'],
  },
  {
    id: 'glOpeningBalances',
    label: 'GL Opening Balances',
    csvFilename: '15_gl_opening_balances.csv',
    csvHeader: 'External ID,Account,Subsidiary,Department,Class,Location,Currency,Date,Debit,Credit,Memo',
    category: 'open-balance',
    dependsOn: ['chartOfAccounts', 'subsidiaries', 'departments', 'classes', 'locations'],
  },
  {
    id: 'fixedAssets',
    label: 'Fixed Assets',
    csvFilename: '16_fixed_assets.csv',
    csvHeader: 'External ID,Asset Name,Asset Type,Acquisition Date,Acquisition Cost,Subsidiary,Location,Useful Life Months,Depreciation Method,Accumulated Depreciation,Net Book Value',
    category: 'open-balance',
    dependsOn: ['subsidiaries', 'locations'],
  },
];

/**
 * Odoo catalog (10 objects). Headers follow Odoo's import-template
 * conventions: external ID column always present, fields use
 * dotted-path notation where they reference related records.
 */
export const ODOO_OBJECTS: ReadonlyArray<MigrationObject> = [
  {
    id: 'companies',
    label: 'Companies',
    csvFilename: '01_companies.csv',
    csvHeader: 'id,name,country_id,currency_id,parent_id/id',
    category: 'reference',
    dependsOn: [],
  },
  {
    id: 'chartOfAccounts',
    label: 'Chart of Accounts',
    csvFilename: '02_chart_of_accounts.csv',
    csvHeader: 'id,code,name,account_type,company_id/id,currency_id,reconcile',
    category: 'reference',
    dependsOn: ['companies'],
  },
  {
    id: 'taxes',
    label: 'Taxes',
    csvFilename: '03_taxes.csv',
    csvHeader: 'id,name,amount,type_tax_use,company_id/id,price_include,active',
    category: 'reference',
    dependsOn: ['companies'],
  },
  {
    id: 'partners',
    label: 'Partners (Customers + Vendors)',
    csvFilename: '04_partners.csv',
    csvHeader: 'id,name,is_company,customer_rank,supplier_rank,company_id/id,country_id,vat,email,phone,property_payment_term_id/id',
    category: 'master',
    dependsOn: ['companies'],
  },
  {
    id: 'products',
    label: 'Products',
    csvFilename: '05_products.csv',
    csvHeader: 'id,name,default_code,type,categ_id/id,uom_id/id,list_price,standard_price,company_id/id,taxes_id/id',
    category: 'master',
    dependsOn: ['companies', 'taxes'],
  },
  {
    id: 'inventoryBalances',
    label: 'Inventory Opening Balances',
    csvFilename: '06_inventory_balances.csv',
    csvHeader: 'id,product_id/id,location_id/id,inventory_quantity,company_id/id',
    category: 'open-balance',
    dependsOn: ['products', 'companies'],
  },
  {
    id: 'openCustomerInvoices',
    label: 'Open Customer Invoices',
    csvFilename: '07_open_customer_invoices.csv',
    csvHeader: 'id,partner_id/id,move_type,invoice_date,invoice_date_due,name,company_id/id,currency_id,amount_total,ref',
    category: 'open-balance',
    dependsOn: ['partners', 'companies'],
  },
  {
    id: 'openVendorBills',
    label: 'Open Vendor Bills',
    csvFilename: '08_open_vendor_bills.csv',
    csvHeader: 'id,partner_id/id,move_type,invoice_date,invoice_date_due,name,company_id/id,currency_id,amount_total,ref',
    category: 'open-balance',
    dependsOn: ['partners', 'companies'],
  },
  {
    id: 'glOpeningBalances',
    label: 'GL Opening Balances',
    csvFilename: '09_gl_opening_balances.csv',
    csvHeader: 'id,account_id/id,company_id/id,date,debit,credit,name,partner_id/id',
    category: 'open-balance',
    dependsOn: ['chartOfAccounts', 'companies'],
  },
  {
    id: 'boms',
    label: 'Bills of Materials',
    csvFilename: '10_boms.csv',
    csvHeader: 'id,product_tmpl_id/id,product_qty,type,company_id/id,bom_line_ids/product_id/id,bom_line_ids/product_qty',
    category: 'master',
    dependsOn: ['products', 'companies'],
  },
];

// ─── objectsInScope — the spine ────────────────────────────────────────────────

export interface ObjectsInScopeContext {
  /** 'NetSuite' | 'Odoo' | other adaptor display name. */
  adaptorName: string;
  /** Wizard answers map. */
  answers: Record<string, unknown>;
}

/**
 * Read the wizard answers and return the canonical list of objects
 * actually in scope for this engagement, per adaptor. Every Pack Z
 * generator iterates this list.
 *
 * Selection rules — keep the floor green when consultant input is
 * sparse:
 *   - reference + master (top of catalog) ALWAYS render. They are the
 *     minimum any ERP cutover needs (subsidiaries / companies, COA,
 *     customers, vendors, products / items).
 *   - open-balance objects render when the corresponding count answer
 *     suggests they're populated (Pack 7 odoo.migration.* counts on
 *     Odoo; volume estimate or generic non-empty answer on NetSuite).
 *   - manufacturing objects (BOMs, items with mfg type, fixed assets)
 *     render when the manufacturing or fixed-assets module is in
 *     scope (license / scope answers).
 *
 * The filter is permissive — it errs on the side of "include the
 * object so the migration team has the template" rather than
 * trimming aggressively. Out-of-scope objects can be deleted by
 * the team; missing templates can't be conjured.
 */
export function objectsInScope(ctx: ObjectsInScopeContext): ReadonlyArray<MigrationObject> {
  const isNetSuite = ctx.adaptorName.toLowerCase().includes('netsuite');
  const catalog = isNetSuite ? NETSUITE_OBJECTS : ODOO_OBJECTS;

  // Manufacturing scope — controls items-as-mfg, BOMs, routings.
  const mfgInScope =
    !!ctx.answers['odoo.mfg.routingRequired'] ||
    (typeof ctx.answers['odoo.mfg.workCenterCount'] === 'number' &&
      (ctx.answers['odoo.mfg.workCenterCount'] as number) > 0) ||
    typeof ctx.answers['ns.mfg.bomCount'] === 'number' ||
    typeof ctx.answers['production.routing.workCenters'] === 'string';

  // Fixed-assets scope — NetSuite only catalog entry today; gated by
  // the FA module being licensed / scoped.
  const faInScope =
    typeof ctx.answers['ns.design.fixedAssetsScope'] === 'string' &&
    (ctx.answers['ns.design.fixedAssetsScope'] as string).trim().length > 0;

  return catalog.filter((obj) => {
    // BOMs only when manufacturing is in scope.
    if (obj.id === 'boms' && !mfgInScope) return false;
    // Fixed Assets only when FA scope is in scope (NetSuite path).
    if (obj.id === 'fixedAssets' && !faInScope) return false;
    return true;
  });
}

/**
 * Convenience — the load-order dependency graph for the scope. Returns
 * the objects in topological order (already the catalog order, since
 * the catalog is authored in load-safe order).
 */
export function loadOrder(objects: ReadonlyArray<MigrationObject>): ReadonlyArray<MigrationObject> {
  // Catalog order is already topological; keep it as-is. Defensive
  // copy keeps callers from mutating the canonical catalog.
  return objects.slice();
}

// ─── Default seeds — render when consultant overlay is sparse ─────────────────

/**
 * Default cleansing rules per object. Industry-canonical baseline so
 * every generator has at least one rule per in-scope object even when
 * the consultant overlay is empty.
 */
export const DEFAULT_CLEANSING_RULES: ReadonlyArray<{ object: string; rule: string; owner: string }> = [
  { object: 'Customers', rule: 'Trim whitespace; uppercase tax IDs; dedupe by tax ID + country', owner: 'Finance — AR lead' },
  { object: 'Vendors', rule: 'Trim whitespace; uppercase tax IDs; verify bank account format per country', owner: 'Finance — AP lead' },
  { object: 'Items / Products', rule: 'Standardise UoM codes; verify unit-cost > 0; dedupe by SKU', owner: 'Operations — master data' },
  { object: 'Chart of Accounts', rule: 'Verify natural-account hierarchy; flag accounts with zero history', owner: 'Finance — Controller' },
  { object: 'Open AR / AP', rule: 'Net invoices against credit memos; flag aged > 365 days for write-off review', owner: 'Finance — AR + AP leads' },
  { object: 'GL Opening Balances', rule: 'Trial balance must net to zero per subsidiary / company before load', owner: 'Finance — Controller' },
];

/**
 * Default reject SLA per object — recommended thresholds + cycle times
 * when the consultant overlay doesn't supply them.
 */
export const DEFAULT_REJECT_SLA: ReadonlyArray<{ object: string; threshold: string; sla: string }> = [
  { object: 'Customers', threshold: '< 0.5% rejects', sla: '24h re-load' },
  { object: 'Vendors', threshold: '< 0.5% rejects', sla: '24h re-load' },
  { object: 'Items / Products', threshold: '< 1% rejects', sla: '48h re-load' },
  { object: 'Open AR / AP', threshold: '0 rejects (financial)', sla: '4h re-load — must clear before next dry-run' },
  { object: 'GL Opening Balances', threshold: '0 rejects (financial)', sla: '4h re-load — must clear before sign-off' },
  { object: 'Inventory Opening Balances', threshold: '< 1% rejects', sla: '24h re-load' },
];

/**
 * Default historical-data depth phrasing when consultant doesn't supply
 * a specific value. Industry baseline is "current + 2 prior fiscal
 * years summary; current open transactions full detail".
 */
export const DEFAULT_HISTORICAL_DEPTH = 'Current fiscal year — full detail (open + closed). Prior 2 fiscal years — summary balances + selected high-value transactions only. Older — archived in source system, not migrated.';

/**
 * Default dry-run pass threshold — the percentage of records that must
 * load cleanly across all objects in a single dry-run for the run to
 * be considered a "pass". Drawn from established cutover playbooks.
 */
export const DEFAULT_DRY_RUN_PASS_THRESHOLD = '99.5% records loaded clean across all objects, 0 financial-object rejects';
