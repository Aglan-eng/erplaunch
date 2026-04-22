import type { RuleInput, ConflictResult } from '../types.js';

const VALID_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function evaluateR2R(input: RuleInput): ConflictResult[] {
  const { answers, license, phases } = input;
  const results: ConflictResult[] = [];

  const get = (key: string) => answers[key];

  // R2R-001 (BLOCK): Multi-entity without OneWorld module
  if (get('r2r.entities.multiEntity') === true) {
    if (!license.modules.includes('ONEWORLD')) {
      results.push({
        id: 'R2R-001',
        severity: 'BLOCK',
        type: 'LICENSE_GAP',
        questionIds: ['r2r.entities.multiEntity'],
        message: 'Multi-entity configuration requires the OneWorld module, which is not included in the current license.',
        resolution: 'Add the OneWorld module to the license profile, or disable multi-entity mode.',
      });
    }
  }

  // R2R-002 (BLOCK): Multi-currency on Starter edition
  if (get('r2r.currencies.isMultiCurrency') === true) {
    if (license.edition === 'STARTER') {
      results.push({
        id: 'R2R-002',
        severity: 'BLOCK',
        type: 'LICENSE_GAP',
        questionIds: ['r2r.currencies.isMultiCurrency'],
        message: 'Multi-currency is not supported on the Starter edition.',
        resolution: 'Upgrade the license to Mid-Market or Enterprise, or disable multi-currency.',
      });
    }
  }

  // R2R-003 (WARN): Intercompany JEs enabled but multi-entity not set
  if (get('r2r.journalEntries.intercompanyJE') === true) {
    if (get('r2r.entities.multiEntity') !== true) {
      results.push({
        id: 'R2R-003',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['r2r.journalEntries.intercompanyJE', 'r2r.entities.multiEntity'],
        message: 'Intercompany journal entries are enabled but the client is not configured for multi-entity.',
        resolution: 'Enable multi-entity mode, or disable intercompany journal entries.',
      });
    }
  }

  // R2R-004 (WARN): Departments enabled but no department list provided
  if (get('r2r.segmentation.useDepartments') === true) {
    const deptList = get('r2r.segmentation.departmentList');
    if (!deptList || (Array.isArray(deptList) && deptList.length === 0)) {
      results.push({
        id: 'R2R-004',
        severity: 'WARN',
        type: 'DATA_WARNING',
        questionIds: ['r2r.segmentation.useDepartments', 'r2r.segmentation.departmentList'],
        message: 'Department tracking is enabled but no department names have been provided.',
        resolution: 'Provide a list of departments in the segmentation section.',
      });
    }
  }

  // R2R-005 (BLOCK): Invalid or missing fiscal year start month
  const fiscalYearStart = get('r2r.accountingPeriods.fiscalYearStart');
  if (fiscalYearStart !== undefined && fiscalYearStart !== null) {
    if (typeof fiscalYearStart !== 'string' || !VALID_MONTHS.includes(fiscalYearStart)) {
      results.push({
        id: 'R2R-005',
        severity: 'BLOCK',
        type: 'CONFIG_CONFLICT',
        questionIds: ['r2r.accountingPeriods.fiscalYearStart'],
        message: `"${fiscalYearStart}" is not a valid fiscal year start month.`,
        resolution: 'Select a valid calendar month (January–December) for the fiscal year start.',
      });
    }
  }

  // R2R-006 (WARN): Cash-based accounting with revenue recognition
  if (get('r2r.accountingPeriods.cashBased') === true) {
    if (get('r2r.reporting.revenueRecognition') === true) {
      results.push({
        id: 'R2R-006',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['r2r.accountingPeriods.cashBased', 'r2r.reporting.revenueRecognition'],
        message: 'Cash-based accounting is incompatible with deferred revenue recognition.',
        resolution: 'Switch to accrual accounting, or disable revenue recognition configuration.',
      });
    }
  }

  // R2R-007 (WARN): Auto exchange rate updates on Starter edition
  if (get('r2r.currencies.autoExchangeRateUpdate') === true) {
    if (license.edition === 'STARTER') {
      results.push({
        id: 'R2R-007',
        severity: 'WARN',
        type: 'LICENSE_GAP',
        questionIds: ['r2r.currencies.autoExchangeRateUpdate'],
        message: 'Automatic exchange rate updates may have limited functionality on the Starter edition.',
        resolution: 'Verify this feature is available in the contracted license, or plan for manual rate updates.',
      });
    }
  }

  // R2R-008 (BLOCK): Intercompany JEs without OneWorld module
  if (get('r2r.journalEntries.intercompanyJE') === true) {
    if (!license.modules.includes('ONEWORLD')) {
      results.push({
        id: 'R2R-008',
        severity: 'BLOCK',
        type: 'LICENSE_GAP',
        questionIds: ['r2r.journalEntries.intercompanyJE'],
        message: 'Intercompany journal entries require the OneWorld module, which is not included in the current license.',
        resolution: 'Add the OneWorld module to the license profile, or disable intercompany journal entries.',
      });
    }
  }

  // R2R-009 (WARN): R2R phase exists but is not scheduled first
  const r2rPhase = phases.find((p) => p.flows.includes('R2R'));
  if (r2rPhase) {
    const minOrder = Math.min(...phases.map((p) => p.order));
    if (r2rPhase.order !== minOrder) {
      results.push({
        id: 'R2R-009',
        severity: 'WARN',
        type: 'PHASE_DEPENDENCY',
        questionIds: [],
        message: 'The R2R (Record-to-Report) flow is not in the first phase. It is typically a foundation dependency.',
        resolution: 'Move the R2R flow to Phase 1, or confirm this ordering is intentional.',
      });
    }
  }

  // R2R-010 (WARN): Multiple bank accounts without multi-currency enabled
  const bankAccountCount = get('r2r.bankTransactions.bankAccountCount');
  if (typeof bankAccountCount === 'number' && bankAccountCount > 1) {
    if (get('r2r.currencies.isMultiCurrency') !== true) {
      results.push({
        id: 'R2R-010',
        severity: 'WARN',
        type: 'DATA_WARNING',
        questionIds: ['r2r.bankTransactions.bankAccountCount', 'r2r.currencies.isMultiCurrency'],
        message: `${bankAccountCount} bank accounts are configured but multi-currency is not enabled. Multiple accounts in different currencies would require multi-currency.`,
        resolution: 'Enable multi-currency if accounts are in different currencies, or confirm all accounts share the same base currency.',
      });
    }
  }

  return results;
}
