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

describe('MFG-001: WIP & Routings requires Work Orders module', () => {
  it('BLOCK when productionFlow.type=WIP_ROUTINGS and WORK_ORDERS missing', () => {
    const output = evaluate(makeInput({ 
      answers: { 'mfg.productionFlow.type': 'WIP_ROUTINGS' } 
    }));
    expect(output.conflicts.some((c) => c.id === 'MFG-001')).toBe(true);
  });

  it('no conflict when productionFlow.type=WIP_ROUTINGS and WORK_ORDERS present', () => {
    const output = evaluate(makeInput({ 
      answers: { 'mfg.productionFlow.type': 'WIP_ROUTINGS' },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'MID_MARKET', modules: ['WORK_ORDERS'], updatedAt: new Date() }
    }));
    expect(output.conflicts.some((c) => c.id === 'MFG-001')).toBe(false);
  });
});

describe('MFG-002: Labor tracking requires WIP & Routings', () => {
  it('WARN when trackLabor=true and type=SIMPLE_ASSEMBLY', () => {
    const output = evaluate(makeInput({ 
      answers: { 'mfg.productionFlow.trackLabor': true, 'mfg.productionFlow.type': 'SIMPLE_ASSEMBLY' } 
    }));
    expect(output.warnings.some((c) => c.id === 'MFG-002')).toBe(true);
  });

  it('no warn when trackLabor=true and type=WIP_ROUTINGS', () => {
    const output = evaluate(makeInput({ 
      answers: { 'mfg.productionFlow.trackLabor': true, 'mfg.productionFlow.type': 'WIP_ROUTINGS' },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'MID_MARKET', modules: ['WORK_ORDERS'], updatedAt: new Date() }
    }));
    expect(output.warnings.some((c) => c.id === 'MFG-002')).toBe(false);
  });
});

describe('MFG-003: Demand Planning requires module', () => {
  it('BLOCK when useDemandPlanning=true and DEMAND_PLANNING missing', () => {
    const output = evaluate(makeInput({ 
      answers: { 'mfg.demand.useDemandPlanning': true } 
    }));
    expect(output.conflicts.some((c) => c.id === 'MFG-003')).toBe(true);
  });

  it('no conflict when useDemandPlanning=true and module present', () => {
    const output = evaluate(makeInput({ 
      answers: { 'mfg.demand.useDemandPlanning': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'MID_MARKET', modules: ['DEMAND_PLANNING'], updatedAt: new Date() }
    }));
    expect(output.conflicts.some((c) => c.id === 'MFG-003')).toBe(false);
  });
});

describe('MFG-004: Outsourced manufacturing on Starter', () => {
  it('WARN when useOutsourced=true and edition=STARTER', () => {
    const output = evaluate(makeInput({ 
      answers: { 'mfg.outsourced.useOutsourced': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'STARTER', modules: [], updatedAt: new Date() }
    }));
    expect(output.warnings.some((c) => c.id === 'MFG-004')).toBe(true);
  });

  it('no warn when useOutsourced=true and edition=MID_MARKET', () => {
    const output = evaluate(makeInput({ 
      answers: { 'mfg.outsourced.useOutsourced': true },
      license: { id: 'lic-1', engagementId: 'eng-1', edition: 'MID_MARKET', modules: [], updatedAt: new Date() }
    }));
    expect(output.warnings.some((c) => c.id === 'MFG-004')).toBe(false);
  });
});
