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

// ─── O2C-001: Credit limits on Starter ───────────────────────────────────────
describe('O2C-001: Credit limit enforcement on Starter edition', () => {
  it('BLOCK when creditLimits=true and edition=STARTER', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.customers.creditLimits': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'STARTER', modules: [], updatedAt: new Date() },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-001')).toBe(true);
  });

  it('no conflict when creditLimits=true and edition=MID_MARKET', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.customers.creditLimits': true },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-001')).toBe(false);
  });
});

// ─── O2C-002: SO approval without thresholds ─────────────────────────────────
describe('O2C-002: SO approval without thresholds', () => {
  it('WARN when soApprovalRequired=true and thresholds not set', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.salesOrders.soApprovalRequired': true },
    }));
    expect(output.warnings.some((c) => c.id === 'O2C-002')).toBe(true);
  });

  it('no warn when soApprovalRequired=true and thresholds populated', () => {
    const output = evaluate(makeInput({
      answers: {
        'o2c.salesOrders.soApprovalRequired': true,
        'o2c.salesOrders.soApprovalThresholds': [{ role: 'Sales Director', amount: 100000 }],
      },
    }));
    expect(output.warnings.some((c) => c.id === 'O2C-002')).toBe(false);
  });
});

// ─── O2C-003: Foreign currency pricing on Starter ────────────────────────────
describe('O2C-003: Foreign currency pricing on Starter edition', () => {
  it('BLOCK when foreignCurrencyPricing=true and edition=STARTER', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.pricing.foreignCurrencyPricing': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'STARTER', modules: [], updatedAt: new Date() },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-003')).toBe(true);
  });

  it('no conflict when foreignCurrencyPricing=true and edition=MID_MARKET', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.pricing.foreignCurrencyPricing': true },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-003')).toBe(false);
  });
});

// ─── O2C-004: Revenue recognition on Starter ─────────────────────────────────
describe('O2C-004: Revenue recognition on Starter edition', () => {
  it('BLOCK when revenueRecognition=true and edition=STARTER', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.invoicing.revenueRecognition': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'STARTER', modules: [], updatedAt: new Date() },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-004')).toBe(true);
  });

  it('no conflict when revenueRecognition=true and edition=MID_MARKET', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.invoicing.revenueRecognition': true },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-004')).toBe(false);
  });
});

// ─── O2C-005: Multi-location fulfillment on Starter ──────────────────────────
describe('O2C-005: Multi-location fulfillment on Starter edition', () => {
  it('BLOCK when multipleLocations=true and edition=STARTER', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.fulfillment.multipleLocations': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'STARTER', modules: [], updatedAt: new Date() },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-005')).toBe(true);
  });

  it('no conflict when multipleLocations=true and edition=MID_MARKET', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.fulfillment.multipleLocations': true },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-005')).toBe(false);
  });
});

// ─── O2C-006: Dunning letters — configuration reminder ───────────────────────
describe('O2C-006: Dunning letters configuration reminder', () => {
  it('WARN when dunningLetters=true (always needs schedule config)', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.collections.dunningLetters': true },
    }));
    expect(output.warnings.some((c) => c.id === 'O2C-006')).toBe(true);
  });

  it('no warn when dunningLetters is not enabled', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.collections.dunningLetters': false },
    }));
    expect(output.warnings.some((c) => c.id === 'O2C-006')).toBe(false);
  });
});

// ─── O2C-007: Advanced pricing on Starter ────────────────────────────────────
describe('O2C-007: Advanced pricing on Starter edition', () => {
  it('BLOCK when quantityDiscounts=true and edition=STARTER', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.pricing.quantityDiscounts': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'STARTER', modules: [], updatedAt: new Date() },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-007')).toBe(true);
  });

  it('BLOCK when promotionalPricing=true and edition=STARTER', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.pricing.promotionalPricing': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'STARTER', modules: [], updatedAt: new Date() },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-007')).toBe(true);
  });

  it('no conflict when quantityDiscounts=true and edition=MID_MARKET', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.pricing.quantityDiscounts': true },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-007')).toBe(false);
  });
});

// ─── O2C-008: Pick-pack-ship without warehouse ───────────────────────────────
describe('O2C-008: Pick-pack-ship requires warehouse to be enabled', () => {
  it('BLOCK when pickPackShip=true and usesWarehouse is not true', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.fulfillment.pickPackShip': true, 'o2c.fulfillment.usesWarehouse': false },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-008')).toBe(true);
  });

  it('no block when pickPackShip=true and usesWarehouse=true', () => {
    const output = evaluate(makeInput({
      answers: { 'o2c.fulfillment.pickPackShip': true, 'o2c.fulfillment.usesWarehouse': true },
    }));
    expect(output.conflicts.some((c) => c.id === 'O2C-008')).toBe(false);
  });
});
