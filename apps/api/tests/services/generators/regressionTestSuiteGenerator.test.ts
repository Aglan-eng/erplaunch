import { describe, it, expect } from 'vitest';
import { generateRegressionTestSuite } from '../../../src/services/generators/regressionTestSuiteGenerator.js';

/**
 * Pack T — Regression Test Suite tests.
 */

describe('Pack T — regressionTestSuiteGenerator: shape', () => {
  it('emits markdown with the 7 canonical sections', () => {
    const out = generateRegressionTestSuite({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Purpose');
    expect(out.markdown).toContain('## 2. When to Run');
    expect(out.markdown).toContain('## 3. Smoke Scenarios');
    expect(out.markdown).toContain('## 4. Roll-up Table');
    expect(out.markdown).toContain('## 5. Pass Criteria');
    expect(out.markdown).toContain('## 6. Deploy Halt Triggers');
    expect(out.markdown).toContain('## 7. Sign-off');
  });

  it('emits HTML companion that renders the markdown', () => {
    const out = generateRegressionTestSuite({ clientName: 'Atlas' });
    expect(out.html).toContain('<!DOCTYPE html>');
    expect(out.html).toContain('Regression Test Suite');
  });

  it('platform default reads as ERP when adaptorName omitted', () => {
    const out = generateRegressionTestSuite({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Platform:** ERP');
  });
});

describe('Pack T — regressionTestSuiteGenerator: scenario parsing', () => {
  it('parses one scenario per line into an S-NN block', () => {
    const out = generateRegressionTestSuite({
      clientName: 'Atlas',
      regressionSmokeScenarios:
        'Login as each role: User can log in + lands on correct center\nCreate PO + approve: PO routes through approval workflow correctly',
    });
    expect(out.markdown).toContain('### S-01: Login as each role');
    expect(out.markdown).toContain('- **Validates:** User can log in + lands on correct center');
    expect(out.markdown).toContain('### S-02: Create PO + approve');
  });

  it('rolls scenarios up into the table with matching IDs', () => {
    const out = generateRegressionTestSuite({
      clientName: 'Atlas',
      regressionSmokeScenarios:
        'Login as each role: validation\nCreate PO + approve: validation',
    });
    expect(out.markdown).toContain('| S-01 | Login as each role | ⏳ Pending');
    expect(out.markdown).toContain('| S-02 | Create PO + approve | ⏳ Pending');
  });

  it('line missing colon becomes scenario name with [ASSIGN] validation', () => {
    const out = generateRegressionTestSuite({
      clientName: 'Atlas',
      regressionSmokeScenarios: 'Just a scenario name with no colon',
    });
    expect(out.markdown).toContain('### S-01: Just a scenario name with no colon');
    expect(out.markdown).toContain('_[ASSIGN key validation]_');
  });

  it('shows placeholder block when no scenarios captured', () => {
    const out = generateRegressionTestSuite({ clientName: 'Atlas' });
    expect(out.markdown).toContain(
      'No regression smoke scenarios captured during discovery',
    );
  });

  it('skips blank lines + trims whitespace', () => {
    const out = generateRegressionTestSuite({
      clientName: 'Atlas',
      regressionSmokeScenarios: '\n  Login: validation  \n\n   \n  Create PO: validation\n',
    });
    expect(out.markdown).toContain('### S-01: Login');
    expect(out.markdown).toContain('### S-02: Create PO');
  });
});

describe('Pack T — regressionTestSuiteGenerator: cross-references', () => {
  it('references Performance_Test_Plan.md in pass criteria', () => {
    const out = generateRegressionTestSuite({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Performance_Test_Plan.md');
  });

  it('references Defect_Log_Template.md in halt triggers', () => {
    const out = generateRegressionTestSuite({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Defect_Log_Template.md');
  });

  it('30-minute total runtime is documented in the purpose section', () => {
    const out = generateRegressionTestSuite({ clientName: 'Atlas' });
    expect(out.markdown).toContain('30 minutes');
  });
});
