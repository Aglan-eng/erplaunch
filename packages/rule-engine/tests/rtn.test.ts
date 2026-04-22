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

describe('RTN-001: Restocking fees without RMA flow', () => {
  it('WARN when restockingFees=true and useRMA not set', () => {
    const output = evaluate(makeInput({ 
      answers: { 'rtn.processing.restockingFees': true } 
    }));
    expect(output.warnings.some((c) => c.id === 'RTN-001')).toBe(true);
  });

  it('no warn when restockingFees=true and useRMA is true', () => {
    const output = evaluate(makeInput({ 
      answers: { 'rtn.processing.restockingFees': true, 'rtn.customerReturns.useRMA': true }
    }));
    expect(output.warnings.some((c) => c.id === 'RTN-001')).toBe(false);
  });
});

describe('RTN-002: Refund before receipt requires advanced edition', () => {
  it('BLOCK when refundPolicy=REFUND_BEFORE_RECEIPT and edition=STARTER', () => {
    const output = evaluate(makeInput({ 
      answers: { 'rtn.customerReturns.refundPolicy': 'REFUND_BEFORE_RECEIPT' },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'STARTER', modules: [], updatedAt: new Date() }
    }));
    expect(output.conflicts.some((c) => c.id === 'RTN-002')).toBe(true);
  });

  it('no conflict when refundPolicy=REFUND_BEFORE_RECEIPT and edition=MID_MARKET', () => {
    const output = evaluate(makeInput({ 
      answers: { 'rtn.customerReturns.refundPolicy': 'REFUND_BEFORE_RECEIPT' },
    }));
    expect(output.conflicts.some((c) => c.id === 'RTN-002')).toBe(false);
  });
});
