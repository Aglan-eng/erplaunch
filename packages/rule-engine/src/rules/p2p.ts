import type { RuleInput, ConflictResult } from '../types.js';

export function evaluateP2P(input: RuleInput): ConflictResult[] {
  const { answers, license } = input;
  const results: ConflictResult[] = [];

  const get = (key: string) => answers[key];

  // P2P-001 (BLOCK): PO approval enabled but no thresholds defined
  if (get('p2p.purchasing.usePurchaseOrders') === true &&
      get('p2p.purchasing.poApprovalRequired') === true) {
    const thresholds = get('p2p.purchasing.approvalThresholds');
    if (!thresholds || (Array.isArray(thresholds) && thresholds.length === 0)) {
      results.push({
        id: 'P2P-001',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['p2p.purchasing.poApprovalRequired', 'p2p.purchasing.approvalThresholds'],
        message: 'PO approval is required but no approval thresholds have been defined.',
        resolution: 'Add at least one approval threshold in the Purchasing section to define who approves at what amount.',
      });
    }
  }

  // P2P-002 (BLOCK): Budget check enabled but Starter edition doesn't support budgeting
  if (get('p2p.purchasing.budgetCheck') === true && license.edition === 'STARTER') {
    results.push({
      id: 'P2P-002',
      severity: 'BLOCK',
      type: 'LICENSE_GAP',
      questionIds: ['p2p.purchasing.budgetCheck'],
      message: 'Budget checking on purchase orders requires at least the Mid-Market edition. It is not available on Starter.',
      resolution: 'Upgrade the license edition, or disable budget check on purchase orders.',
    });
  }

  // P2P-003 (WARN): 3-way matching enabled but no formal receiving defined
  if (get('p2p.receiving.threeWayMatch') === true &&
      get('p2p.receiving.formalReceiving') !== true) {
    results.push({
      id: 'P2P-003',
      severity: 'BLOCK',
      type: 'CONFIG_CONFLICT',
      questionIds: ['p2p.receiving.threeWayMatch', 'p2p.receiving.formalReceiving'],
      message: '3-way matching requires formal receiving to be enabled. You cannot match bills to receipts if receipts are not created.',
      resolution: 'Enable formal receiving, or disable 3-way matching.',
    });
  }

  // P2P-004 (WARN): Multi-currency bills but Starter edition
  if (get('p2p.bills.multiCurrencyBills') === true && license.edition === 'STARTER') {
    results.push({
      id: 'P2P-004',
      severity: 'BLOCK',
      type: 'LICENSE_GAP',
      questionIds: ['p2p.bills.multiCurrencyBills'],
      message: 'Foreign currency bills require at least the Mid-Market edition. Multi-currency is not supported on Starter.',
      resolution: 'Upgrade the license edition, or confirm that all vendor invoices will be in the base currency.',
    });
  }

  // P2P-005 (WARN): Bill approval enabled but no thresholds
  if (get('p2p.bills.billApprovalRequired') === true) {
    const thresholds = get('p2p.bills.billApprovalThresholds');
    if (!thresholds || (Array.isArray(thresholds) && thresholds.length === 0)) {
      results.push({
        id: 'P2P-005',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['p2p.bills.billApprovalRequired', 'p2p.bills.billApprovalThresholds'],
        message: 'Bill approval is required but no approval thresholds have been defined.',
        resolution: 'Add at least one approval threshold to define who approves bills at what amount.',
      });
    }
  }

  // P2P-006 (WARN): Expense claims enabled but no categories defined
  if (get('p2p.expenses.employeeExpenses') === true) {
    const cats = get('p2p.expenses.expenseCategories');
    if (!cats || (Array.isArray(cats) && cats.length === 0)) {
      results.push({
        id: 'P2P-006',
        severity: 'WARN',
        type: 'DATA_WARNING',
        questionIds: ['p2p.expenses.employeeExpenses', 'p2p.expenses.expenseCategories'],
        message: 'Employee expense claims are enabled but no expense categories have been defined.',
        resolution: 'Add expense categories in the Expenses section so that claims can be correctly coded to GL accounts.',
      });
    }
  }

  return results;
}
