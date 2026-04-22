import type { RuleInput, RuleOutput, ConflictResult } from './types.js';
import { evaluateLicense } from './rules/license.js';
import { evaluateR2R } from './rules/r2r.js';
import { evaluateP2P } from './rules/p2p.js';
import { evaluateO2C } from './rules/o2c.js';
import { evaluateMFG } from './rules/mfg.js';
import { evaluateRTN } from './rules/rtn.js';

export function evaluate(input: RuleInput): RuleOutput {
  const allResults: ConflictResult[] = [
    // License rules run first — edition/module mismatches are the most
    // fundamental issues and should surface before any flow-specific rules.
    ...evaluateLicense(input),
    ...evaluateR2R(input),
    ...evaluateP2P(input),
    ...evaluateO2C(input),
    ...evaluateMFG(input),
    ...evaluateRTN(input),
  ];

  return {
    conflicts: allResults.filter((r) => r.severity === 'BLOCK'),
    warnings: allResults.filter((r) => r.severity === 'WARN'),
    infos: allResults.filter((r) => r.severity === 'INFO'),
  };
}
