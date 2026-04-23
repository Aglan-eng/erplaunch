import { describe, it, expect } from 'vitest';
import { evaluateAdaptorRules, type RulePack } from '../src/index.js';

function pack(rules: RulePack['rules']): RulePack {
  return { id: 'test', version: '1.0.0', rules };
}

describe('evaluateAdaptorRules — baseline', () => {
  it('returns empty when the pack has no rules', () => {
    expect(evaluateAdaptorRules(pack([]), { answers: {}, license: { edition: 'X', modules: [] } })).toEqual([]);
  });

  it('skips rules without a when clause (metadata-only)', () => {
    const rules = pack([
      { id: 'doc-only', type: 'LICENSE_GAP', severity: 'BLOCK', questionIds: [], message: '', resolution: '' },
    ]);
    expect(evaluateAdaptorRules(rules, { answers: {}, license: { edition: 'X', modules: [] } })).toEqual([]);
  });
});

describe('evaluateAdaptorRules — leaf conditions', () => {
  it('answerEquals fires only on exact match (deep)', () => {
    const rules = pack([
      { id: 'r1', type: 'DATA_WARNING', severity: 'INFO', questionIds: [], message: 'm', resolution: 'r',
        when: { answerEquals: { questionId: 'x.strategy', value: 'SINGLE' } } },
    ]);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.strategy': 'SINGLE' }, license: { edition: 'X', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.strategy': 'TIERED' }, license: { edition: 'X', modules: [] } })).toHaveLength(0);
    // Arrays compared element-wise
    const ar = pack([{ id: 'r', type: 'DATA_WARNING', severity: 'INFO', questionIds: [], message: 'm', resolution: 'r',
      when: { answerEquals: { questionId: 'x.opts', value: ['a', 'b'] } } }]);
    expect(evaluateAdaptorRules(ar, { answers: { 'x.opts': ['a', 'b'] }, license: { edition: 'X', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(ar, { answers: { 'x.opts': ['a'] }, license: { edition: 'X', modules: [] } })).toHaveLength(0);
  });

  it('answerTruthy treats 0 / empty string / empty array as falsy', () => {
    const rules = pack([
      { id: 'r1', type: 'DATA_WARNING', severity: 'INFO', questionIds: [], message: 'm', resolution: 'r',
        when: { answerTruthy: { questionId: 'x.flag' } } },
    ]);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.flag': true }, license: { edition: 'X', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.flag': 'value' }, license: { edition: 'X', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.flag': 42 }, license: { edition: 'X', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.flag': [1] }, license: { edition: 'X', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.flag': false }, license: { edition: 'X', modules: [] } })).toHaveLength(0);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.flag': '' }, license: { edition: 'X', modules: [] } })).toHaveLength(0);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.flag': 0 }, license: { edition: 'X', modules: [] } })).toHaveLength(0);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.flag': [] }, license: { edition: 'X', modules: [] } })).toHaveLength(0);
    expect(evaluateAdaptorRules(rules, { answers: {}, license: { edition: 'X', modules: [] } })).toHaveLength(0);
  });

  it('answerFalsy is the inverse of answerTruthy', () => {
    const rules = pack([
      { id: 'r1', type: 'DATA_WARNING', severity: 'INFO', questionIds: [], message: 'm', resolution: 'r',
        when: { answerFalsy: { questionId: 'x.flag' } } },
    ]);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.flag': false }, license: { edition: 'X', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(rules, { answers: {}, license: { edition: 'X', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.flag': true }, license: { edition: 'X', modules: [] } })).toHaveLength(0);
  });

  it('licenseEditionIn / licenseEditionNotIn', () => {
    const pa = pack([
      { id: 'a', type: 'LICENSE_GAP', severity: 'BLOCK', questionIds: [], message: 'm', resolution: 'r',
        when: { licenseEditionIn: ['BASIC', 'STANDARD'] } },
    ]);
    expect(evaluateAdaptorRules(pa, { answers: {}, license: { edition: 'BASIC', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(pa, { answers: {}, license: { edition: 'ENTERPRISE', modules: [] } })).toHaveLength(0);

    const pb = pack([
      { id: 'b', type: 'LICENSE_GAP', severity: 'BLOCK', questionIds: [], message: 'm', resolution: 'r',
        when: { licenseEditionNotIn: ['ENTERPRISE'] } },
    ]);
    expect(evaluateAdaptorRules(pb, { answers: {}, license: { edition: 'BASIC', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(pb, { answers: {}, license: { edition: 'ENTERPRISE', modules: [] } })).toHaveLength(0);
  });

  it('licenseHasModule / licenseMissingModule', () => {
    const ph = pack([
      { id: 'has', type: 'LICENSE_GAP', severity: 'BLOCK', questionIds: [], message: 'm', resolution: 'r',
        when: { licenseHasModule: 'MRP' } },
    ]);
    expect(evaluateAdaptorRules(ph, { answers: {}, license: { edition: 'X', modules: ['MRP'] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(ph, { answers: {}, license: { edition: 'X', modules: [] } })).toHaveLength(0);

    const pm = pack([
      { id: 'miss', type: 'LICENSE_GAP', severity: 'BLOCK', questionIds: [], message: 'm', resolution: 'r',
        when: { licenseMissingModule: 'MRP' } },
    ]);
    expect(evaluateAdaptorRules(pm, { answers: {}, license: { edition: 'X', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(pm, { answers: {}, license: { edition: 'X', modules: ['MRP'] } })).toHaveLength(0);
  });
});

describe('evaluateAdaptorRules — combinators', () => {
  it('all fires only when every child matches', () => {
    const rules = pack([
      { id: 'r', type: 'LICENSE_GAP', severity: 'BLOCK', questionIds: [], message: 'm', resolution: 'r',
        when: { all: [
          { answerTruthy: { questionId: 'x.a' } },
          { licenseMissingModule: 'Z' },
        ] } },
    ]);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.a': true }, license: { edition: 'E', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.a': false }, license: { edition: 'E', modules: [] } })).toHaveLength(0);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.a': true }, license: { edition: 'E', modules: ['Z'] } })).toHaveLength(0);
  });

  it('any fires when at least one child matches', () => {
    const rules = pack([
      { id: 'r', type: 'LICENSE_GAP', severity: 'BLOCK', questionIds: [], message: 'm', resolution: 'r',
        when: { any: [
          { licenseMissingModule: 'A' },
          { licenseMissingModule: 'B' },
        ] } },
    ]);
    expect(evaluateAdaptorRules(rules, { answers: {}, license: { edition: 'E', modules: ['A'] } })).toHaveLength(1); // B missing
    expect(evaluateAdaptorRules(rules, { answers: {}, license: { edition: 'E', modules: ['A', 'B'] } })).toHaveLength(0);
  });

  it('not inverts a child', () => {
    const rules = pack([
      { id: 'r', type: 'LICENSE_GAP', severity: 'BLOCK', questionIds: [], message: 'm', resolution: 'r',
        when: { not: { licenseHasModule: 'X' } } },
    ]);
    expect(evaluateAdaptorRules(rules, { answers: {}, license: { edition: 'E', modules: [] } })).toHaveLength(1);
    expect(evaluateAdaptorRules(rules, { answers: {}, license: { edition: 'E', modules: ['X'] } })).toHaveLength(0);
  });

  it('combinators nest', () => {
    const rules = pack([
      { id: 'r', type: 'LICENSE_GAP', severity: 'BLOCK', questionIds: [], message: 'm', resolution: 'r',
        when: { all: [
          { answerTruthy: { questionId: 'x.mfg' } },
          { any: [
            { licenseMissingModule: 'MRP' },
            { licenseMissingModule: 'QUALITY' },
          ] },
        ] } },
    ]);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.mfg': true }, license: { edition: 'E', modules: ['MRP'] } })).toHaveLength(1); // QUALITY missing
    expect(evaluateAdaptorRules(rules, { answers: { 'x.mfg': true }, license: { edition: 'E', modules: ['MRP', 'QUALITY'] } })).toHaveLength(0);
    expect(evaluateAdaptorRules(rules, { answers: { 'x.mfg': false }, license: { edition: 'E', modules: [] } })).toHaveLength(0);
  });
});

describe('evaluateAdaptorRules — result shape', () => {
  it('maps every firing rule to an AdaptorRuleConflict with the rule metadata', () => {
    const rules = pack([
      {
        id: 'sample',
        type: 'CONFIG_CONFLICT',
        severity: 'WARN',
        questionIds: ['x.a', 'x.b'],
        message: 'sample message',
        resolution: 'fix it',
        when: { answerTruthy: { questionId: 'x.a' } },
      },
    ]);
    const [conflict] = evaluateAdaptorRules(rules, { answers: { 'x.a': true }, license: { edition: 'X', modules: [] } });
    expect(conflict).toMatchObject({
      id: 'sample',
      type: 'CONFIG_CONFLICT',
      severity: 'WARN',
      questionIds: ['x.a', 'x.b'],
      message: 'sample message',
      resolution: 'fix it',
    });
  });
});
