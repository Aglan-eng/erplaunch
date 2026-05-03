/**
 * Reconciliation Queries generator (Pack Z — Component 3).
 *
 * Cross-platform — emits Documentation/Data_Migration/Reconciliation_Queries.md.
 *
 * Adaptor-conditional content:
 *   - NetSuite: saved-search references + SuiteQL snippets via the
 *     SuiteQL Workbook (Setup → Custom → SuiteQL Workbook). Saved
 *     searches are the canonical reconciliation tool — readable by
 *     finance users, no SQL skill required.
 *   - Odoo: PostgreSQL queries via the Database Manager → Query
 *     interface (Settings → Technical → Database Manager). Odoo's
 *     ORM exposes the underlying tables directly.
 *
 * Per object in scope, emits a count check + a financial-total check
 * (where applicable). The migration lead runs these after every load
 * and matches the result against the source extract.
 */

import {
  objectsInScope,
  type MigrationObject,
} from './migrationHelpers.js';

export interface ReconciliationQueriesInput {
  clientName: string;
  adaptorName: string;
  answers: Record<string, unknown>;
}

export interface ReconciliationQueriesOutput {
  markdown: string;
}

function netSuiteCountCheck(obj: MigrationObject): string {
  // SuiteQL select-count by record type. Saved-search reference for the
  // financial-total check piggybacks on the standard "Account Balance
  // by Subsidiary" search.
  const recordType = netSuiteRecordType(obj.id);
  return [
    `**Count check (SuiteQL):**`,
    '',
    '```sql',
    `SELECT COUNT(*) AS loaded_count`,
    `FROM ${recordType}`,
    `WHERE externalid IS NOT NULL;`,
    '```',
    '',
    `**Saved-search reference:** \`Migration_${obj.id}_Count\` (Reports → Saved Searches → New).`,
  ].join('\n');
}

function odooCountCheck(obj: MigrationObject): string {
  const tableName = odooTableName(obj.id);
  return [
    `**Count check (PostgreSQL):**`,
    '',
    '```sql',
    `SELECT COUNT(*) AS loaded_count`,
    `FROM ${tableName}`,
    `WHERE create_date >= 'YYYY-MM-DD';   -- migration date`,
    '```',
    '',
    `**Studio dashboard tile:** Configure a "Migration Loaded — ${obj.label}" tile pointing to the same table.`,
  ].join('\n');
}

function netSuiteFinancialTotalCheck(obj: MigrationObject): string | null {
  if (obj.id === 'openArInvoices') {
    return [
      '**Financial-total check (SuiteQL):**',
      '',
      '```sql',
      'SELECT subsidiary, currency, SUM(amount) AS open_ar_total',
      'FROM transaction',
      "WHERE type = 'CustInvc' AND status NOT IN ('Paid In Full','Closed')",
      'GROUP BY subsidiary, currency',
      'ORDER BY subsidiary, currency;',
      '```',
      '',
      '**Saved-search reference:** `Migration_OpenAR_Total_BySubsidiaryCurrency`.',
    ].join('\n');
  }
  if (obj.id === 'openApBills') {
    return [
      '**Financial-total check (SuiteQL):**',
      '',
      '```sql',
      'SELECT subsidiary, currency, SUM(amount) AS open_ap_total',
      'FROM transaction',
      "WHERE type = 'VendBill' AND status NOT IN ('Paid In Full','Closed')",
      'GROUP BY subsidiary, currency',
      'ORDER BY subsidiary, currency;',
      '```',
      '',
      '**Saved-search reference:** `Migration_OpenAP_Total_BySubsidiaryCurrency`.',
    ].join('\n');
  }
  if (obj.id === 'glOpeningBalances') {
    return [
      '**Trial-balance check (SuiteQL):**',
      '',
      '```sql',
      'SELECT subsidiary, currency,',
      '       SUM(debit) - SUM(credit) AS net',
      'FROM transactionaccountingline',
      'WHERE source_journal = ',
      "  (SELECT id FROM transaction WHERE memo = 'GL_OPENING_BALANCES')",
      'GROUP BY subsidiary, currency;',
      '```',
      '',
      '**Pass criteria:** `net = 0` for every (subsidiary, currency) row.',
      '',
      '**Saved-search reference:** `Migration_GL_Opening_TrialBalance`.',
    ].join('\n');
  }
  if (obj.id === 'inventoryBalances') {
    return [
      '**Inventory-value check (SuiteQL):**',
      '',
      '```sql',
      'SELECT location, SUM(quantityonhand * averagecost) AS inventory_value',
      'FROM inventoryitemlocations',
      'GROUP BY location',
      'ORDER BY location;',
      '```',
      '',
      '**Saved-search reference:** `Migration_Inventory_Value_ByLocation`.',
    ].join('\n');
  }
  return null;
}

function odooFinancialTotalCheck(obj: MigrationObject): string | null {
  if (obj.id === 'openCustomerInvoices') {
    return [
      '**Financial-total check (PostgreSQL):**',
      '',
      '```sql',
      "SELECT company_id, currency_id,",
      '       SUM(amount_total) AS open_ar_total',
      'FROM account_move',
      "WHERE move_type = 'out_invoice' AND payment_state != 'paid'",
      'GROUP BY company_id, currency_id',
      'ORDER BY company_id, currency_id;',
      '```',
    ].join('\n');
  }
  if (obj.id === 'openVendorBills') {
    return [
      '**Financial-total check (PostgreSQL):**',
      '',
      '```sql',
      "SELECT company_id, currency_id,",
      '       SUM(amount_total) AS open_ap_total',
      'FROM account_move',
      "WHERE move_type = 'in_invoice' AND payment_state != 'paid'",
      'GROUP BY company_id, currency_id',
      'ORDER BY company_id, currency_id;',
      '```',
    ].join('\n');
  }
  if (obj.id === 'glOpeningBalances') {
    return [
      '**Trial-balance check (PostgreSQL):**',
      '',
      '```sql',
      'SELECT company_id, currency_id,',
      '       SUM(debit) - SUM(credit) AS net',
      'FROM account_move_line',
      'WHERE move_id IN (',
      "  SELECT id FROM account_move WHERE ref = 'GL_OPENING_BALANCES'",
      ')',
      'GROUP BY company_id, currency_id;',
      '```',
      '',
      '**Pass criteria:** `net = 0` for every (company_id, currency_id) row.',
    ].join('\n');
  }
  if (obj.id === 'inventoryBalances') {
    return [
      '**Inventory-value check (PostgreSQL):**',
      '',
      '```sql',
      'SELECT location_id, SUM(quantity * unit_cost) AS inventory_value',
      'FROM stock_quant',
      'GROUP BY location_id',
      'ORDER BY location_id;',
      '```',
    ].join('\n');
  }
  return null;
}

function netSuiteRecordType(objId: string): string {
  switch (objId) {
    case 'subsidiaries': return 'subsidiary';
    case 'departments': return 'department';
    case 'classes': return 'classification';
    case 'locations': return 'location';
    case 'chartOfAccounts': return 'account';
    case 'currencies': return 'currency';
    case 'taxCodes': return 'taxitem';
    case 'customers': return 'customer';
    case 'vendors': return 'vendor';
    case 'employees': return 'employee';
    case 'items': return 'item';
    case 'inventoryBalances': return 'inventoryitemlocations';
    case 'openArInvoices': return 'transaction';
    case 'openApBills': return 'transaction';
    case 'glOpeningBalances': return 'transaction';
    case 'fixedAssets': return 'customrecord_fam_asset';
    default: return objId;
  }
}

function odooTableName(objId: string): string {
  switch (objId) {
    case 'companies': return 'res_company';
    case 'chartOfAccounts': return 'account_account';
    case 'taxes': return 'account_tax';
    case 'partners': return 'res_partner';
    case 'products': return 'product_template';
    case 'inventoryBalances': return 'stock_quant';
    case 'openCustomerInvoices': return 'account_move';
    case 'openVendorBills': return 'account_move';
    case 'glOpeningBalances': return 'account_move_line';
    case 'boms': return 'mrp_bom';
    default: return objId;
  }
}

export function generateReconciliationQueries(
  input: ReconciliationQueriesInput,
): ReconciliationQueriesOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const isNetSuite = input.adaptorName.toLowerCase().includes('netsuite');
  const inScope = objectsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });

  const queryToolPath = isNetSuite
    ? 'Setup → Custom → SuiteQL Workbook (or Reports → Saved Searches → New for the saved-search alternates)'
    : 'Settings → Technical → Database Manager → Query (Enterprise) — or via psql for self-hosted instances';

  const sections = inScope
    .map((obj) => {
      const countBlock = isNetSuite ? netSuiteCountCheck(obj) : odooCountCheck(obj);
      const totalBlock = isNetSuite
        ? netSuiteFinancialTotalCheck(obj)
        : odooFinancialTotalCheck(obj);
      return [
        `### ${obj.label}`,
        '',
        countBlock,
        '',
        totalBlock ?? '_(No financial-total check applicable for this object — count check is sufficient.)_',
        '',
      ].join('\n');
    })
    .join('\n');

  const markdown = [
    `# Reconciliation Queries — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Query tool:** ${queryToolPath}  `,
    `**Objects in scope:** ${inScope.length}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    `Per-object reconciliation queries the migration lead runs after every load. Each `,
    `result is matched against the source-system extract — the load is "passed" only `,
    `when count + financial total agree.`,
    '',
    `Run order: count check first (cheap, catches gross errors); financial-total `,
    `check second (slower, but is the actual sign-off gate). The Data Quality `,
    `Scorecard (\`./Data_Quality_Scorecard.md\`) tracks pass-rate per dry-run.`,
    '',
    '## How to Run',
    '',
    `1. Open the query tool: **${queryToolPath}**.`,
    '2. Paste the query for the object you just loaded.',
    `3. Compare the result against the source-system extract. Capture both numbers `,
    `   in the Data Quality Scorecard.`,
    '4. Investigate any mismatch via the Reject Handling Playbook (`./Reject_Handling_Playbook.md`).',
    '5. Sign off only when count + financial total match exactly.',
    '',
    '## Per-Object Queries',
    '',
    sections,
    '## Cross-References',
    '',
    '- CSV import templates: `./Templates/`',
    '- Field mapping workbook: `./Field_Mapping_Workbook.md`',
    '- Cleansing rules: `./Cleansing_Rules.md`',
    '- Reject handling: `./Reject_Handling_Playbook.md`',
    '- Data quality scorecard: `./Data_Quality_Scorecard.md`',
    '- Migration runbook: `./Migration_Runbook.md`',
    '',
    '_Generated by ERPLaunch — Pack Z (Data Migration Assets)._',
    '',
  ].join('\n');

  return { markdown };
}
