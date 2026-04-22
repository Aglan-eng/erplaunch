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

describe('R2R-001: Multi-entity requires OneWorld', () => {
  it('BLOCK when multiEntity=true and ONEWORLD not in modules', () => {
    const output = evaluate(makeInput({ answers: { 'r2r.entities.multiEntity': true } }));
    expect(output.conflicts.some((c) => c.id === 'R2R-001')).toBe(true);
  });

  it('no conflict when multiEntity=true and ONEWORLD is in modules', () => {
    const output = evaluate(makeInput({
      answers: { 'r2r.entities.multiEntity': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'MID_MARKET', modules: ['ONEWORLD'], updatedAt: new Date() },
    }));
    expect(output.conflicts.some((c) => c.id === 'R2R-001')).toBe(false);
  });
});

describe('R2R-002: Multi-currency on Starter edition', () => {
  it('BLOCK when isMultiCurrency=true and edition=STARTER', () => {
    const output = evaluate(makeInput({
      answers: { 'r2r.currencies.isMultiCurrency': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'STARTER', modules: [], updatedAt: new Date() },
    }));
    expect(output.conflicts.some((c) => c.id === 'R2R-002')).toBe(true);
  });

  it('no conflict when isMultiCurrency=true and edition=MID_MARKET', () => {
    const output = evaluate(makeInput({
      answers: { 'r2r.currencies.isMultiCurrency': true },
    }));
    expect(output.conflicts.some((c) => c.id === 'R2R-002')).toBe(false);
  });
});

describe('R2R-003: Intercompany JE without multi-entity', () => {
  it('WARN when intercompanyJE=true and multiEntity not set', () => {
    const output = evaluate(makeInput({ answers: { 'r2r.journalEntries.intercompanyJE': true } }));
    expect(output.warnings.some((c) => c.id === 'R2R-003')).toBe(true);
  });

  it('no warn when both intercompanyJE and multiEntity are true', () => {
    const output = evaluate(makeInput({
      answers: {
        'r2r.journalEntries.intercompanyJE': true,
        'r2r.entities.multiEntity': true,
      },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'MID_MARKET', modules: ['ONEWORLD'], updatedAt: new Date() },
    }));
    expect(output.warnings.some((c) => c.id === 'R2R-003')).toBe(false);
  });
});

describe('R2R-004: Departments without list', () => {
  it('WARN when useDepartments=true and departmentList is empty', () => {
    const output = evaluate(makeInput({
      answers: { 'r2r.segmentation.useDepartments': true, 'r2r.segmentation.departmentList': [] },
    }));
    expect(output.warnings.some((c) => c.id === 'R2R-004')).toBe(true);
  });

  it('no warn when useDepartments=true and departmentList has entries', () => {
    const output = evaluate(makeInput({
      answers: { 'r2r.segmentation.useDepartments': true, 'r2r.segmentation.departmentList': ['Sales', 'Ops'] },
    }));
    expect(output.warnings.some((c) => c.id === 'R2R-004')).toBe(false);
  });
});

describe('R2R-005: Invalid fiscal year start', () => {
  it('BLOCK when fiscalYearStart is an invalid string', () => {
    const output = evaluate(makeInput({
      answers: { 'r2r.accountingPeriods.fiscalYearStart': 'InvalidMonth' },
    }));
    expect(output.conflicts.some((c) => c.id === 'R2R-005')).toBe(true);
  });

  it('no conflict when fiscalYearStart is a valid month', () => {
    const output = evaluate(makeInput({
      answers: { 'r2r.accountingPeriods.fiscalYearStart': 'April' },
    }));
    expect(output.conflicts.some((c) => c.id === 'R2R-005')).toBe(false);
  });
});

describe('R2R-006: Cash-based with revenue recognition', () => {
  it('WARN when cashBased=true and revenueRecognition=true', () => {
    const output = evaluate(makeInput({
      answers: {
        'r2r.accountingPeriods.cashBased': true,
        'r2r.reporting.revenueRecognition': true,
      },
    }));
    expect(output.warnings.some((c) => c.id === 'R2R-006')).toBe(true);
  });

  it('no warn when cashBased=true but revenueRecognition=false', () => {
    const output = evaluate(makeInput({
      answers: { 'r2r.accountingPeriods.cashBased': true, 'r2r.reporting.revenueRecognition': false },
    }));
    expect(output.warnings.some((c) => c.id === 'R2R-006')).toBe(false);
  });
});

describe('R2R-007: Auto exchange rate on Starter', () => {
  it('WARN when autoExchangeRateUpdate=true and edition=STARTER', () => {
    const output = evaluate(makeInput({
      answers: { 'r2r.currencies.autoExchangeRateUpdate': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'STARTER', modules: [], updatedAt: new Date() },
    }));
    expect(output.warnings.some((c) => c.id === 'R2R-007')).toBe(true);
  });

  it('no warn when autoExchangeRateUpdate=true and edition=ENTERPRISE', () => {
    const output = evaluate(makeInput({
      answers: { 'r2r.currencies.autoExchangeRateUpdate': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'ENTERPRISE', modules: [], updatedAt: new Date() },
    }));
    expect(output.warnings.some((c) => c.id === 'R2R-007')).toBe(false);
  });
});

describe('R2R-008: Intercompany JE requires OneWorld', () => {
  it('BLOCK when intercompanyJE=true and ONEWORLD not in modules', () => {
    const output = evaluate(makeInput({
      answers: { 'r2r.journalEntries.intercompanyJE': true },
    }));
    expect(output.conflicts.some((c) => c.id === 'R2R-008')).toBe(true);
  });

  it('no block when intercompanyJE=true and ONEWORLD present', () => {
    const output = evaluate(makeInput({
      answers: {
        'r2r.journalEntries.intercompanyJE': true,
        'r2r.entities.multiEntity': true,
      },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'MID_MARKET', modules: ['ONEWORLD'], updatedAt: new Date() },
    }));
    expect(output.conflicts.some((c) => c.id === 'R2R-008')).toBe(false);
  });
});

describe('R2R-009: R2R phase should be first', () => {
  it('WARN when R2R phase order is not the minimum', () => {
    const output = evaluate(makeInput({
      phases: [
        { id: 'p1', engagementId: 'eng-1', name: 'Phase 1', order: 1, flows: ['P2P'], trigger: 'REQUIREMENT', status: 'PLANNED' },
        { id: 'p2', engagementId: 'eng-1', name: 'Phase 2', order: 2, flows: ['R2R'], trigger: 'REQUIREMENT', status: 'PLANNED' },
      ],
    }));
    expect(output.warnings.some((c) => c.id === 'R2R-009')).toBe(true);
  });

  it('no warn when R2R phase is first', () => {
    const output = evaluate(makeInput({
      phases: [
        { id: 'p1', engagementId: 'eng-1', name: 'Phase 1', order: 1, flows: ['R2R'], trigger: 'REQUIREMENT', status: 'PLANNED' },
        { id: 'p2', engagementId: 'eng-1', name: 'Phase 2', order: 2, flows: ['P2P'], trigger: 'REQUIREMENT', status: 'PLANNED' },
      ],
    }));
    expect(output.warnings.some((c) => c.id === 'R2R-009')).toBe(false);
  });
});

describe('R2R-010: Multiple bank accounts without multi-currency', () => {
  it('WARN when bankAccountCount>1 and isMultiCurrency not set', () => {
    const output = evaluate(makeInput({
      answers: { 'r2r.bankTransactions.bankAccountCount': 3 },
    }));
    expect(output.warnings.some((c) => c.id === 'R2R-010')).toBe(true);
  });

  it('no warn when bankAccountCount>1 and isMultiCurrency=true', () => {
    const output = evaluate(makeInput({
      answers: {
        'r2r.bankTransactions.bankAccountCount': 3,
        'r2r.currencies.isMultiCurrency': true,
      },
    }));
    expect(output.warnings.some((c) => c.id === 'R2R-010')).toBe(false);
  });
});
