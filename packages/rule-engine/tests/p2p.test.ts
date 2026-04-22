import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/index.js';
import type { RuleInput } from '../src/index.js';

function makeInput(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    answers: {},
    license: { id: 'lic-1', engagementId: 'eng-1', edition: 'MID_MARKET', modules: [], updatedAt: new Date() },
    phases: [],
    ...overrides,
  };
}

// ─── P2P-001: PO approval enabled but no thresholds ──────────────────────────
describe('P2P-001: PO approval without thresholds', () => {
  it('WARN when usePOs=true, poApprovalRequired=true, and thresholds empty', () => {
    const output = evaluate(makeInput({
      answers: {
        'p2p.purchasing.usePurchaseOrders': true,
        'p2p.purchasing.poApprovalRequired': true,
        'p2p.purchasing.approvalThresholds': [],
      },
    }));
    expect(output.warnings.some((c) => c.id === 'P2P-001')).toBe(true);
  });

  it('no warn when usePOs=true, poApprovalRequired=true, and thresholds populated', () => {
    const output = evaluate(makeInput({
      answers: {
        'p2p.purchasing.usePurchaseOrders': true,
        'p2p.purchasing.poApprovalRequired': true,
        'p2p.purchasing.approvalThresholds': [{ level: 1, role: 'Manager', amount: 5000 }],
      },
    }));
    expect(output.warnings.some((c) => c.id === 'P2P-001')).toBe(false);
  });
});

// ─── P2P-002: Budget check on Starter ────────────────────────────────────────
describe('P2P-002: Budget check on Starter edition', () => {
  it('BLOCK when budgetCheck=true and edition=STARTER', () => {
    const output = evaluate(makeInput({
      answers: { 'p2p.purchasing.budgetCheck': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'STARTER', modules: [], updatedAt: new Date() },
    }));
    expect(output.conflicts.some((c) => c.id === 'P2P-002')).toBe(true);
  });

  it('no conflict when budgetCheck=true and edition=MID_MARKET', () => {
    const output = evaluate(makeInput({
      answers: { 'p2p.purchasing.budgetCheck': true },
    }));
    expect(output.conflicts.some((c) => c.id === 'P2P-002')).toBe(false);
  });
});

// ─── P2P-003: 3-way matching without formal receiving ────────────────────────
describe('P2P-003: 3-way matching requires formal receiving', () => {
  it('BLOCK when threeWayMatch=true and formalReceiving is not true', () => {
    const output = evaluate(makeInput({
      answers: { 'p2p.receiving.threeWayMatch': true, 'p2p.receiving.formalReceiving': false },
    }));
    expect(output.conflicts.some((c) => c.id === 'P2P-003')).toBe(true);
  });

  it('no block when threeWayMatch=true and formalReceiving=true', () => {
    const output = evaluate(makeInput({
      answers: { 'p2p.receiving.threeWayMatch': true, 'p2p.receiving.formalReceiving': true },
    }));
    expect(output.conflicts.some((c) => c.id === 'P2P-003')).toBe(false);
  });
});

// ─── P2P-004: Multi-currency bills on Starter ────────────────────────────────
describe('P2P-004: Multi-currency bills on Starter edition', () => {
  it('BLOCK when multiCurrencyBills=true and edition=STARTER', () => {
    const output = evaluate(makeInput({
      answers: { 'p2p.bills.multiCurrencyBills': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'STARTER', modules: [], updatedAt: new Date() },
    }));
    expect(output.conflicts.some((c) => c.id === 'P2P-004')).toBe(true);
  });

  it('no conflict when multiCurrencyBills=true and edition=MID_MARKET', () => {
    const output = evaluate(makeInput({
      answers: { 'p2p.bills.multiCurrencyBills': true },
    }));
    expect(output.conflicts.some((c) => c.id === 'P2P-004')).toBe(false);
  });
});

// ─── P2P-005: Bill approval without thresholds ───────────────────────────────
describe('P2P-005: Bill approval without thresholds', () => {
  it('WARN when billApprovalRequired=true and thresholds empty', () => {
    const output = evaluate(makeInput({
      answers: {
        'p2p.bills.billApprovalRequired': true,
        'p2p.bills.billApprovalThresholds': [],
      },
    }));
    expect(output.warnings.some((c) => c.id === 'P2P-005')).toBe(true);
  });

  it('no warn when billApprovalRequired=true and thresholds populated', () => {
    const output = evaluate(makeInput({
      answers: {
        'p2p.bills.billApprovalRequired': true,
        'p2p.bills.billApprovalThresholds': [{ level: 1, role: 'Finance Manager', amount: 10000 }],
      },
    }));
    expect(output.warnings.some((c) => c.id === 'P2P-005')).toBe(false);
  });
});

// ─── P2P-006: Expenses enabled but no categories ─────────────────────────────
describe('P2P-006: Employee expenses without categories', () => {
  it('WARN when employeeExpenses=true and expenseCategories empty', () => {
    const output = evaluate(makeInput({
      answers: {
        'p2p.expenses.employeeExpenses': true,
        'p2p.expenses.expenseCategories': [],
      },
    }));
    expect(output.warnings.some((c) => c.id === 'P2P-006')).toBe(true);
  });

  it('no warn when employeeExpenses=true and categories populated', () => {
    const output = evaluate(makeInput({
      answers: {
        'p2p.expenses.employeeExpenses': true,
        'p2p.expenses.expenseCategories': [{ name: 'Air Travel', account: 'T&E' }],
      },
    }));
    expect(output.warnings.some((c) => c.id === 'P2P-006')).toBe(false);
  });
});
