// ─── Data Collection Template Registry ───────────────────────────────────────
// Defines every Excel template the system can offer.
// Each template has a column schema used for AI validation.

export type FieldType = 'text' | 'number' | 'date' | 'email' | 'select' | 'boolean' | 'currency';

export interface TemplateField {
  key: string;
  label: string;          // Excel column header
  type: FieldType;
  required: boolean;
  options?: string[];     // for 'select' type — valid values
  maxLength?: number;
  description?: string;
  example?: string;
}

export interface DataTemplate {
  id: string;
  name: string;
  category: 'financial' | 'master' | 'transactional' | 'vertical';
  description: string;
  estimatedRows?: string; // e.g. '200–500 rows'
  fields: TemplateField[];
  validationRules?: string[]; // plain language rules for AI validation
  verticalId?: string;   // if set, only shown for that vertical
  sheetName: string;     // Excel sheet name to generate
}

// ─────────────────────────────────────────────────────────────────────────────

export const DATA_TEMPLATES: DataTemplate[] = [

  // ─── Financial ─────────────────────────────────────────────────────────────
  {
    id: 'chart_of_accounts',
    name: 'Chart of Accounts',
    category: 'financial',
    sheetName: 'Chart of Accounts',
    description: 'Full list of general ledger accounts to be created in NetSuite.',
    estimatedRows: '100–400 rows',
    fields: [
      { key: 'account_number', label: 'Account Number', type: 'text', required: true, maxLength: 20, example: '1010' },
      { key: 'account_name', label: 'Account Name', type: 'text', required: true, maxLength: 100, example: 'Cash - Main Bank' },
      { key: 'account_type', label: 'Account Type', type: 'select', required: true, options: ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset', 'Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long-term Liability', 'Equity', 'Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense'] },
      { key: 'currency', label: 'Currency', type: 'text', required: false, example: 'SAR', description: 'Leave blank for base currency' },
      { key: 'description', label: 'Description', type: 'text', required: false, maxLength: 200 },
      { key: 'parent_account', label: 'Parent Account Number', type: 'text', required: false, description: 'For sub-accounts — must match Account Number of parent row' },
      { key: 'department_restricted', label: 'Department Restricted?', type: 'boolean', required: false },
      { key: 'active', label: 'Active (Y/N)', type: 'boolean', required: true },
    ],
    validationRules: [
      'Account numbers must be unique — flag any duplicates',
      'Account Type must be one of the allowed values',
      'Parent Account Number, if provided, must reference an existing Account Number in the same file',
      'Sub-accounts must have a valid parent — warn if parent does not exist',
      'At least one Bank account should exist for a complete chart',
      'Income and Expense accounts should exist for P&L reporting',
    ],
  },

  {
    id: 'opening_balances',
    name: 'Opening Balances',
    category: 'financial',
    sheetName: 'Opening Balances',
    description: 'Trial balance figures as at the agreed cutover date.',
    estimatedRows: '100–400 rows',
    fields: [
      { key: 'account_number', label: 'Account Number', type: 'text', required: true, description: 'Must match Chart of Accounts' },
      { key: 'account_name', label: 'Account Name', type: 'text', required: true },
      { key: 'debit', label: 'Debit Amount', type: 'currency', required: false },
      { key: 'credit', label: 'Credit Amount', type: 'currency', required: false },
      { key: 'currency', label: 'Currency', type: 'text', required: false },
      { key: 'department', label: 'Department', type: 'text', required: false },
      { key: 'subsidiary', label: 'Subsidiary', type: 'text', required: false },
    ],
    validationRules: [
      'Total debits must equal total credits (trial balance must balance) — flag the difference if not',
      'Account numbers must exist in the Chart of Accounts file',
      'No row should have both Debit and Credit filled — flag these',
      'No row should have both Debit and Credit blank — flag these',
      'Currency values must be numeric — flag text entries',
    ],
  },

  // ─── Master Data ───────────────────────────────────────────────────────────
  {
    id: 'customers',
    name: 'Customer Master',
    category: 'master',
    sheetName: 'Customers',
    description: 'All customer records to be imported into NetSuite.',
    estimatedRows: '200–2,000 rows',
    fields: [
      { key: 'customer_id', label: 'Customer ID / Code', type: 'text', required: true, maxLength: 30, example: 'CUST-0001' },
      { key: 'company_name', label: 'Company Name', type: 'text', required: true, maxLength: 100 },
      { key: 'contact_name', label: 'Primary Contact Name', type: 'text', required: false },
      { key: 'email', label: 'Email', type: 'email', required: false },
      { key: 'phone', label: 'Phone', type: 'text', required: false },
      { key: 'billing_address', label: 'Billing Address', type: 'text', required: false },
      { key: 'city', label: 'City', type: 'text', required: false },
      { key: 'country', label: 'Country Code', type: 'text', required: false, example: 'SA', maxLength: 2 },
      { key: 'currency', label: 'Currency', type: 'text', required: false, example: 'SAR' },
      { key: 'payment_terms', label: 'Payment Terms', type: 'text', required: false, example: 'Net 30' },
      { key: 'credit_limit', label: 'Credit Limit', type: 'currency', required: false },
      { key: 'tax_id', label: 'VAT / Tax Registration Number', type: 'text', required: false },
      { key: 'customer_category', label: 'Category / Classification', type: 'text', required: false },
      { key: 'active', label: 'Active (Y/N)', type: 'boolean', required: true },
    ],
    validationRules: [
      'Customer IDs must be unique — flag duplicates',
      'Email addresses must be valid format where provided',
      'Country code must be 2-letter ISO code where provided',
      'Credit limit must be a positive number where provided',
      'Active field must be Y or N',
    ],
  },

  {
    id: 'vendors',
    name: 'Vendor Master',
    category: 'master',
    sheetName: 'Vendors',
    description: 'All vendor / supplier records to be imported into NetSuite.',
    estimatedRows: '100–500 rows',
    fields: [
      { key: 'vendor_id', label: 'Vendor ID / Code', type: 'text', required: true, maxLength: 30, example: 'VND-0001' },
      { key: 'company_name', label: 'Company / Vendor Name', type: 'text', required: true, maxLength: 100 },
      { key: 'contact_name', label: 'Primary Contact Name', type: 'text', required: false },
      { key: 'email', label: 'Email', type: 'email', required: false },
      { key: 'phone', label: 'Phone', type: 'text', required: false },
      { key: 'address', label: 'Address', type: 'text', required: false },
      { key: 'country', label: 'Country Code', type: 'text', required: false, maxLength: 2 },
      { key: 'currency', label: 'Currency', type: 'text', required: false },
      { key: 'payment_terms', label: 'Payment Terms', type: 'text', required: false },
      { key: 'bank_account', label: 'Bank Account Number', type: 'text', required: false },
      { key: 'iban', label: 'IBAN', type: 'text', required: false },
      { key: 'tax_id', label: 'VAT / Tax Registration Number', type: 'text', required: false },
      { key: 'expense_account', label: 'Default Expense Account', type: 'text', required: false, description: 'Account number from Chart of Accounts' },
      { key: 'active', label: 'Active (Y/N)', type: 'boolean', required: true },
    ],
    validationRules: [
      'Vendor IDs must be unique — flag duplicates',
      'Email addresses must be valid format where provided',
      'Country code must be 2-letter ISO code where provided',
      'IBAN format should be validated where provided',
      'Expense Account, if provided, must reference Chart of Accounts',
    ],
  },

  {
    id: 'items',
    name: 'Item / Product Master',
    category: 'master',
    sheetName: 'Items',
    description: 'Products, services, and inventory items to be set up in NetSuite.',
    estimatedRows: '500–10,000 rows',
    fields: [
      { key: 'item_id', label: 'Item ID / SKU', type: 'text', required: true, maxLength: 50 },
      { key: 'item_name', label: 'Item Name', type: 'text', required: true, maxLength: 100 },
      { key: 'item_type', label: 'Item Type', type: 'select', required: true, options: ['Inventory Item', 'Non-Inventory Item', 'Service', 'Assembly', 'Kit', 'Lot Numbered Inventory', 'Serialized Inventory'] },
      { key: 'description', label: 'Description', type: 'text', required: false, maxLength: 500 },
      { key: 'unit_of_measure', label: 'Unit of Measure', type: 'text', required: true, example: 'EA, KG, LTR, BOX' },
      { key: 'purchase_price', label: 'Purchase Price', type: 'currency', required: false },
      { key: 'sales_price', label: 'Sales Price', type: 'currency', required: false },
      { key: 'income_account', label: 'Income Account', type: 'text', required: false },
      { key: 'cogs_account', label: 'COGS Account', type: 'text', required: false },
      { key: 'inventory_account', label: 'Inventory Account', type: 'text', required: false, description: 'Required for Inventory Item types' },
      { key: 'tax_code', label: 'Tax Code / VAT Category', type: 'text', required: false },
      { key: 'weight', label: 'Weight (kg)', type: 'number', required: false },
      { key: 'barcode', label: 'Barcode / UPC', type: 'text', required: false },
      { key: 'active', label: 'Active (Y/N)', type: 'boolean', required: true },
    ],
    validationRules: [
      'Item IDs must be unique — flag duplicates',
      'Item Type must be one of the allowed values',
      'Inventory Item types must have an Inventory Account',
      'Income and COGS accounts should be present for items that will be sold/purchased',
      'Unit of Measure must be filled for all rows',
      'Purchase Price and Sales Price must be numeric where provided',
    ],
  },

  {
    id: 'employees',
    name: 'Employee Master',
    category: 'master',
    sheetName: 'Employees',
    description: 'Employee records for expense reporting, payroll integration, and resource planning.',
    estimatedRows: '50–500 rows',
    fields: [
      { key: 'employee_id', label: 'Employee ID', type: 'text', required: true },
      { key: 'first_name', label: 'First Name', type: 'text', required: true },
      { key: 'last_name', label: 'Last Name', type: 'text', required: true },
      { key: 'email', label: 'Work Email', type: 'email', required: true },
      { key: 'job_title', label: 'Job Title', type: 'text', required: false },
      { key: 'department', label: 'Department', type: 'text', required: false },
      { key: 'location', label: 'Work Location', type: 'text', required: false },
      { key: 'hire_date', label: 'Hire Date', type: 'date', required: false },
      { key: 'ns_role', label: 'NetSuite Role', type: 'text', required: false, description: 'Role to assign in NS' },
      { key: 'cost_rate', label: 'Hourly Cost Rate', type: 'currency', required: false },
      { key: 'billing_rate', label: 'Hourly Billing Rate', type: 'currency', required: false },
      { key: 'active', label: 'Active (Y/N)', type: 'boolean', required: true },
    ],
    validationRules: [
      'Employee IDs must be unique',
      'Work Email must be valid email format and unique',
      'Hire Date must be a valid date format',
      'Cost Rate and Billing Rate must be positive numbers where provided',
    ],
  },

  // ─── Transactional ─────────────────────────────────────────────────────────
  {
    id: 'open_ar',
    name: 'Open Accounts Receivable',
    category: 'transactional',
    sheetName: 'Open AR',
    description: 'Outstanding customer invoices as at the cutover date.',
    estimatedRows: '50–500 rows',
    fields: [
      { key: 'invoice_number', label: 'Invoice Number', type: 'text', required: true },
      { key: 'customer_id', label: 'Customer ID', type: 'text', required: true, description: 'Must match Customer Master' },
      { key: 'invoice_date', label: 'Invoice Date', type: 'date', required: true },
      { key: 'due_date', label: 'Due Date', type: 'date', required: true },
      { key: 'currency', label: 'Currency', type: 'text', required: true },
      { key: 'amount', label: 'Invoice Amount (original currency)', type: 'currency', required: true },
      { key: 'amount_base', label: 'Invoice Amount (base currency)', type: 'currency', required: false },
      { key: 'amount_paid', label: 'Amount Paid', type: 'currency', required: false },
      { key: 'balance_due', label: 'Balance Due', type: 'currency', required: true },
    ],
    validationRules: [
      'Invoice numbers must be unique',
      'Customer ID must exist in Customer Master',
      'Due Date must be on or after Invoice Date',
      'Balance Due = Invoice Amount − Amount Paid — flag mismatches',
      'Total of Balance Due column must match the AR opening balance from Trial Balance',
      'All dates must be valid and on or before the cutover date',
    ],
  },

  {
    id: 'open_ap',
    name: 'Open Accounts Payable',
    category: 'transactional',
    sheetName: 'Open AP',
    description: 'Outstanding vendor bills as at the cutover date.',
    estimatedRows: '50–300 rows',
    fields: [
      { key: 'bill_number', label: 'Bill / Invoice Number', type: 'text', required: true },
      { key: 'vendor_id', label: 'Vendor ID', type: 'text', required: true, description: 'Must match Vendor Master' },
      { key: 'bill_date', label: 'Bill Date', type: 'date', required: true },
      { key: 'due_date', label: 'Due Date', type: 'date', required: true },
      { key: 'currency', label: 'Currency', type: 'text', required: true },
      { key: 'amount', label: 'Bill Amount', type: 'currency', required: true },
      { key: 'amount_paid', label: 'Amount Paid', type: 'currency', required: false },
      { key: 'balance_due', label: 'Balance Due', type: 'currency', required: true },
    ],
    validationRules: [
      'Bill numbers must be unique',
      'Vendor ID must exist in Vendor Master',
      'Due Date must be on or after Bill Date',
      'Balance Due = Bill Amount − Amount Paid — flag mismatches',
      'Total Balance Due must match AP opening balance from Trial Balance',
    ],
  },

  {
    id: 'inventory_on_hand',
    name: 'Inventory On-Hand',
    category: 'transactional',
    sheetName: 'Inventory On-Hand',
    description: 'Stock counts per item per location as at the cutover date.',
    estimatedRows: '500–5,000 rows',
    fields: [
      { key: 'item_id', label: 'Item ID / SKU', type: 'text', required: true, description: 'Must match Item Master' },
      { key: 'location', label: 'Location / Warehouse', type: 'text', required: true },
      { key: 'quantity', label: 'Quantity On Hand', type: 'number', required: true },
      { key: 'unit_cost', label: 'Average Unit Cost', type: 'currency', required: true },
      { key: 'total_value', label: 'Total Value', type: 'currency', required: false },
      { key: 'lot_number', label: 'Lot / Batch Number', type: 'text', required: false },
      { key: 'expiry_date', label: 'Expiry Date', type: 'date', required: false },
    ],
    validationRules: [
      'Item ID must exist in Item Master',
      'Quantity must be a positive number',
      'Unit Cost must be a positive number',
      'Total Value = Quantity × Unit Cost — flag mismatches >1%',
      'Total inventory value must be reconcilable to the Inventory account in Opening Balances',
      'Items flagged as Lot Numbered in Item Master must have a Lot Number',
    ],
  },

  // ─── Vertical-specific: Poultry ────────────────────────────────────────────
  {
    id: 'growers',
    name: 'Contract Growers',
    category: 'vertical',
    sheetName: 'Contract Growers',
    description: 'Contract grower (farmer) records for the poultry vertical.',
    estimatedRows: '50–500 rows',
    verticalId: 'POULTRY',
    fields: [
      { key: 'grower_id', label: 'Grower ID', type: 'text', required: true },
      { key: 'grower_name', label: 'Grower / Farm Name', type: 'text', required: true },
      { key: 'owner_name', label: 'Owner Name', type: 'text', required: true },
      { key: 'national_id', label: 'National ID / CR Number', type: 'text', required: false },
      { key: 'phone', label: 'Phone', type: 'text', required: false },
      { key: 'region', label: 'Region / Area', type: 'text', required: false },
      { key: 'gps_coordinates', label: 'GPS Coordinates', type: 'text', required: false, example: '24.7136, 46.6753' },
      { key: 'house_count', label: 'Number of Poultry Houses', type: 'number', required: true },
      { key: 'house_capacity', label: 'Total Capacity (birds)', type: 'number', required: true },
      { key: 'water_type', label: 'Water Source', type: 'select', required: false, options: ['Municipal', 'Well', 'Other'] },
      { key: 'settlement_type', label: 'Settlement Type', type: 'select', required: true, options: ['Performance-based', 'Fixed rate', 'Hybrid'] },
      { key: 'bank_account', label: 'Bank Account (for settlement payments)', type: 'text', required: false },
      { key: 'iban', label: 'IBAN', type: 'text', required: false },
      { key: 'active', label: 'Active (Y/N)', type: 'boolean', required: true },
    ],
    validationRules: [
      'Grower IDs must be unique',
      'House capacity must be a positive integer',
      'IBAN format should be validated where provided',
      'Settlement Type must be one of the allowed values',
    ],
  },

  {
    id: 'flocks_active',
    name: 'Active Flocks (Cutover)',
    category: 'vertical',
    sheetName: 'Active Flocks',
    description: 'Flocks that are live / in-progress at the time of system cutover.',
    estimatedRows: '50–1,000 rows',
    verticalId: 'POULTRY',
    fields: [
      { key: 'flock_id', label: 'Flock ID', type: 'text', required: true },
      { key: 'grower_id', label: 'Grower ID', type: 'text', required: true, description: 'Must match Contract Growers' },
      { key: 'house_number', label: 'House Number', type: 'text', required: true },
      { key: 'species', label: 'Species', type: 'select', required: true, options: ['Broiler', 'Layer', 'Breeder', 'Turkey', 'Duck'] },
      { key: 'breed', label: 'Breed', type: 'text', required: false },
      { key: 'placement_date', label: 'Placement Date', type: 'date', required: true },
      { key: 'chicks_placed', label: 'Chicks Placed', type: 'number', required: true },
      { key: 'current_count', label: 'Current Bird Count (at cutover)', type: 'number', required: true },
      { key: 'cumulative_mortality', label: 'Cumulative Mortality to Date', type: 'number', required: false },
      { key: 'age_days', label: 'Age (days) at Cutover', type: 'number', required: true },
      { key: 'feed_consumed_kg', label: 'Total Feed Consumed to Cutover (kg)', type: 'number', required: false },
      { key: 'estimated_weight_kg', label: 'Average Live Weight at Cutover (kg)', type: 'number', required: false },
      { key: 'expected_catchup_date', label: 'Expected Catchup / Processing Date', type: 'date', required: false },
    ],
    validationRules: [
      'Flock IDs must be unique',
      'Grower ID must exist in the Contract Growers template',
      'Current count must be less than or equal to chicks placed',
      'Age must be a positive integer',
      'Placement date must be before cutover date',
      'Expected Processing date must be after cutover date',
    ],
  },

  {
    id: 'medication_records',
    name: 'Medication & Vaccination Records',
    category: 'vertical',
    sheetName: 'Medication Records',
    description: 'Historical and carry-over medication/vaccination records for active flocks.',
    estimatedRows: '100–2,000 rows',
    verticalId: 'POULTRY',
    fields: [
      { key: 'flock_id', label: 'Flock ID', type: 'text', required: true },
      { key: 'application_date', label: 'Application Date', type: 'date', required: true },
      { key: 'product_name', label: 'Product / Vaccine Name', type: 'text', required: true },
      { key: 'dosage', label: 'Dosage', type: 'text', required: false, example: '0.5 ml/bird' },
      { key: 'application_method', label: 'Application Method', type: 'select', required: false, options: ['Drinking water', 'Spray', 'Injection', 'Eye drop', 'Feed'] },
      { key: 'withdrawal_days', label: 'Withdrawal Period (days)', type: 'number', required: false },
      { key: 'administered_by', label: 'Administered By', type: 'text', required: false },
      { key: 'batch_number', label: 'Product Batch / Lot Number', type: 'text', required: false },
    ],
    validationRules: [
      'Flock ID must exist in Active Flocks template',
      'Application Date must be valid date on or before cutover date',
      'Application Method, if provided, must be one of the allowed values',
      'Withdrawal days must be a positive integer where provided',
    ],
  },

  // ─── Retail-specific ───────────────────────────────────────────────────────
  {
    id: 'price_levels',
    name: 'Price Levels & Pricebooks',
    category: 'vertical',
    sheetName: 'Price Levels',
    description: 'Customer-specific or channel-specific pricing rules.',
    estimatedRows: '100–5,000 rows',
    verticalId: 'RETAIL',
    fields: [
      { key: 'item_id', label: 'Item ID / SKU', type: 'text', required: true },
      { key: 'price_level', label: 'Price Level / Pricebook Name', type: 'text', required: true, example: 'Wholesale', description: 'e.g. Base, Wholesale, VIP' },
      { key: 'unit_price', label: 'Unit Price', type: 'currency', required: true },
      { key: 'currency', label: 'Currency', type: 'text', required: false },
      { key: 'min_quantity', label: 'Minimum Quantity', type: 'number', required: false },
      { key: 'effective_date', label: 'Effective Date', type: 'date', required: false },
      { key: 'end_date', label: 'End Date', type: 'date', required: false },
    ],
    validationRules: [
      'Item ID must exist in Item Master',
      'Unit Price must be a positive number',
      'End Date, if provided, must be after Effective Date',
      'Each Item ID + Price Level combination should be unique',
    ],
  },

  {
    id: 'inventory_locations',
    name: 'Warehouse / Location Setup',
    category: 'master',
    sheetName: 'Locations',
    description: 'Warehouse and store locations to be configured in NetSuite.',
    estimatedRows: '5–100 rows',
    fields: [
      { key: 'location_id', label: 'Location ID', type: 'text', required: true },
      { key: 'location_name', label: 'Location Name', type: 'text', required: true },
      { key: 'location_type', label: 'Type', type: 'select', required: true, options: ['Warehouse', 'Store', '3PL', 'Distribution Center', 'Virtual'] },
      { key: 'address', label: 'Address', type: 'text', required: false },
      { key: 'city', label: 'City', type: 'text', required: false },
      { key: 'country', label: 'Country Code', type: 'text', required: false, maxLength: 2 },
      { key: 'parent_location', label: 'Parent Location ID', type: 'text', required: false },
    ],
    validationRules: [
      'Location IDs must be unique',
      'Type must be one of the allowed values',
      'Parent Location ID, if provided, must reference another Location ID in this file',
    ],
  },

  // ─── Manufacturing-specific ────────────────────────────────────────────────
  {
    id: 'bom_headers',
    name: 'Bill of Materials — Headers',
    category: 'vertical',
    sheetName: 'BOM Headers',
    description: 'Top-level BOM definitions (one row per BOM).',
    estimatedRows: '50–2,000 rows',
    verticalId: 'MANUFACTURING',
    fields: [
      { key: 'bom_id', label: 'BOM ID', type: 'text', required: true },
      { key: 'finished_good_item', label: 'Finished Good Item ID', type: 'text', required: true, description: 'Must match Item Master' },
      { key: 'bom_name', label: 'BOM Name / Revision', type: 'text', required: true },
      { key: 'quantity_produced', label: 'Quantity Produced', type: 'number', required: true, description: 'How many units does one BOM run produce?' },
      { key: 'unit_of_measure', label: 'Unit of Measure', type: 'text', required: true },
      { key: 'effective_date', label: 'Effective Date', type: 'date', required: false },
      { key: 'is_default', label: 'Is Default BOM (Y/N)', type: 'boolean', required: true },
    ],
    validationRules: [
      'BOM IDs must be unique',
      'Finished Good Item must exist in Item Master',
      'Quantity Produced must be a positive number',
      'Each Finished Good Item should have exactly one default BOM — flag multiples or missing defaults',
    ],
  },

  {
    id: 'bom_components',
    name: 'Bill of Materials — Components',
    category: 'vertical',
    sheetName: 'BOM Components',
    description: 'Component (raw material) lines for each BOM.',
    estimatedRows: '200–10,000 rows',
    verticalId: 'MANUFACTURING',
    fields: [
      { key: 'bom_id', label: 'BOM ID', type: 'text', required: true, description: 'Must match BOM Headers' },
      { key: 'component_item_id', label: 'Component Item ID', type: 'text', required: true, description: 'Must match Item Master' },
      { key: 'quantity', label: 'Quantity Required', type: 'number', required: true },
      { key: 'unit_of_measure', label: 'Unit of Measure', type: 'text', required: true },
      { key: 'scrap_percentage', label: 'Scrap % (optional)', type: 'number', required: false },
      { key: 'operation', label: 'Operation / Work Centre', type: 'text', required: false },
      { key: 'line_notes', label: 'Notes', type: 'text', required: false },
    ],
    validationRules: [
      'BOM ID must exist in BOM Headers',
      'Component Item ID must exist in Item Master',
      'Quantity must be a positive number',
      'Scrap percentage must be 0–100 where provided',
    ],
  },

  {
    id: 'work_centres',
    name: 'Work Centres / Machines',
    category: 'vertical',
    sheetName: 'Work Centres',
    description: 'Manufacturing work centres and machine definitions.',
    estimatedRows: '10–200 rows',
    verticalId: 'MANUFACTURING',
    fields: [
      { key: 'work_centre_id', label: 'Work Centre ID', type: 'text', required: true },
      { key: 'name', label: 'Work Centre Name', type: 'text', required: true },
      { key: 'department', label: 'Department', type: 'text', required: false },
      { key: 'capacity_per_day', label: 'Capacity (hours/day)', type: 'number', required: false },
      { key: 'setup_time_hours', label: 'Standard Setup Time (hours)', type: 'number', required: false },
      { key: 'cost_per_hour', label: 'Cost Per Hour', type: 'currency', required: false },
    ],
    validationRules: [
      'Work Centre IDs must be unique',
      'Capacity per day must be 0–24 where provided',
      'Cost per hour must be a positive number where provided',
    ],
  },

  // ─── Non-profit specific ───────────────────────────────────────────────────
  {
    id: 'funds',
    name: 'Funds / Programs',
    category: 'vertical',
    sheetName: 'Funds',
    description: 'Fund and program definitions for non-profit fund accounting.',
    estimatedRows: '5–50 rows',
    verticalId: 'NONPROFIT',
    fields: [
      { key: 'fund_id', label: 'Fund ID', type: 'text', required: true },
      { key: 'fund_name', label: 'Fund Name', type: 'text', required: true },
      { key: 'fund_type', label: 'Fund Type', type: 'select', required: true, options: ['Unrestricted', 'Temporarily Restricted', 'Permanently Restricted', 'Government Grant', 'Capital Fund'] },
      { key: 'program_area', label: 'Program Area', type: 'text', required: false },
      { key: 'start_date', label: 'Fund Start Date', type: 'date', required: false },
      { key: 'end_date', label: 'Fund End Date', type: 'date', required: false },
      { key: 'budget', label: 'Approved Budget', type: 'currency', required: false },
      { key: 'active', label: 'Active (Y/N)', type: 'boolean', required: true },
    ],
    validationRules: [
      'Fund IDs must be unique',
      'Fund Type must be one of the allowed values',
      'End Date must be after Start Date where both are provided',
    ],
  },

  {
    id: 'grants',
    name: 'Grants',
    category: 'vertical',
    sheetName: 'Grants',
    description: 'Active and recently-completed grant records.',
    estimatedRows: '5–50 rows',
    verticalId: 'NONPROFIT',
    fields: [
      { key: 'grant_id', label: 'Grant ID', type: 'text', required: true },
      { key: 'grant_name', label: 'Grant Name', type: 'text', required: true },
      { key: 'donor_id', label: 'Donor / Grantor ID', type: 'text', required: true },
      { key: 'fund_id', label: 'Fund ID', type: 'text', required: true, description: 'Must match Funds template' },
      { key: 'amount_awarded', label: 'Amount Awarded', type: 'currency', required: true },
      { key: 'amount_received', label: 'Amount Received to Date', type: 'currency', required: false },
      { key: 'start_date', label: 'Grant Start Date', type: 'date', required: true },
      { key: 'end_date', label: 'Grant End Date', type: 'date', required: true },
      { key: 'reporting_requirements', label: 'Reporting Requirements', type: 'text', required: false },
    ],
    validationRules: [
      'Grant IDs must be unique',
      'Fund ID must exist in Funds template',
      'Amount Received must be <= Amount Awarded',
      'End Date must be after Start Date',
    ],
  },

  {
    id: 'donors',
    name: 'Donor Records',
    category: 'vertical',
    sheetName: 'Donors',
    description: 'Donor and grantor contact records.',
    estimatedRows: '50–50,000 rows',
    verticalId: 'NONPROFIT',
    fields: [
      { key: 'donor_id', label: 'Donor ID', type: 'text', required: true },
      { key: 'donor_name', label: 'Donor Name / Organization', type: 'text', required: true },
      { key: 'donor_type', label: 'Donor Type', type: 'select', required: true, options: ['Individual', 'Corporate', 'Government', 'Foundation', 'Other'] },
      { key: 'email', label: 'Email', type: 'email', required: false },
      { key: 'phone', label: 'Phone', type: 'text', required: false },
      { key: 'address', label: 'Address', type: 'text', required: false },
      { key: 'total_donated', label: 'Total Donated to Date', type: 'currency', required: false },
      { key: 'first_donation_date', label: 'First Donation Date', type: 'date', required: false },
      { key: 'communication_preference', label: 'Communication Preference', type: 'select', required: false, options: ['Email', 'Phone', 'Post', 'No Contact'] },
    ],
    validationRules: [
      'Donor IDs must be unique',
      'Donor Type must be one of the allowed values',
      'Email must be valid format where provided',
      'Total Donated must be a positive number where provided',
    ],
  },

  // ─── Professional Services specific ────────────────────────────────────────
  {
    id: 'open_projects',
    name: 'Open Projects',
    category: 'vertical',
    sheetName: 'Open Projects',
    description: 'Active projects / engagements to be migrated at cutover.',
    estimatedRows: '10–200 rows',
    verticalId: 'SERVICES',
    fields: [
      { key: 'project_id', label: 'Project ID', type: 'text', required: true },
      { key: 'project_name', label: 'Project Name', type: 'text', required: true },
      { key: 'customer_id', label: 'Customer ID', type: 'text', required: true },
      { key: 'project_manager', label: 'Project Manager (Employee ID)', type: 'text', required: false },
      { key: 'start_date', label: 'Start Date', type: 'date', required: true },
      { key: 'end_date', label: 'Expected End Date', type: 'date', required: false },
      { key: 'billing_type', label: 'Billing Type', type: 'select', required: true, options: ['Time & Materials', 'Fixed Price', 'Milestone', 'Retainer'] },
      { key: 'contract_value', label: 'Contract Value', type: 'currency', required: false },
      { key: 'billed_to_date', label: 'Amount Billed to Date', type: 'currency', required: false },
      { key: 'hours_budgeted', label: 'Hours Budgeted', type: 'number', required: false },
      { key: 'hours_spent_to_date', label: 'Hours Spent to Date', type: 'number', required: false },
    ],
    validationRules: [
      'Project IDs must be unique',
      'Customer ID must exist in Customer Master',
      'Project Manager Employee ID must exist in Employee Master where provided',
      'Billed to date must be <= Contract Value where both are provided',
      'Hours spent must be <= Hours budgeted (warn if exceeded)',
    ],
  },

  // ─── Distribution specific ─────────────────────────────────────────────────
  {
    id: 'lot_numbers',
    name: 'Open Lot Numbers',
    category: 'vertical',
    sheetName: 'Lot Numbers',
    description: 'Active inventory lot numbers with quantities and expiry dates.',
    estimatedRows: '100–5,000 rows',
    verticalId: 'DISTRIBUTION',
    fields: [
      { key: 'item_id', label: 'Item ID', type: 'text', required: true },
      { key: 'lot_number', label: 'Lot / Batch Number', type: 'text', required: true },
      { key: 'location', label: 'Location ID', type: 'text', required: true },
      { key: 'quantity', label: 'Quantity On Hand', type: 'number', required: true },
      { key: 'expiry_date', label: 'Expiry Date', type: 'date', required: false },
      { key: 'manufacture_date', label: 'Manufacture Date', type: 'date', required: false },
      { key: 'supplier_lot', label: 'Supplier Lot Reference', type: 'text', required: false },
    ],
    validationRules: [
      'Item ID must exist in Item Master and be flagged as Lot Numbered',
      'Quantity must be positive',
      'Expiry Date must be after Manufacture Date where both provided',
      'Expiry Date should be in the future for active lots — warn on expired lots',
      'Location must exist in Locations template',
    ],
  },
];

export function getTemplate(id: string): DataTemplate | undefined {
  return DATA_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: DataTemplate['category']): DataTemplate[] {
  return DATA_TEMPLATES.filter((t) => t.category === category);
}

export function getTemplatesForVertical(verticalId: string, includeCore = true): DataTemplate[] {
  return DATA_TEMPLATES.filter((t) => {
    if (t.verticalId === verticalId) return true;
    if (includeCore && !t.verticalId) return true;
    return false;
  });
}
