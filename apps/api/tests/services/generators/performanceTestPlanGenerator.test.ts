import { describe, it, expect } from 'vitest';
import { generatePerformanceTestPlan } from '../../../src/services/generators/performanceTestPlanGenerator.js';

/**
 * Pack T — Performance Test Plan tests.
 */

describe('Pack T — performanceTestPlanGenerator: shape', () => {
  it('emits markdown with the 7 canonical sections', () => {
    const out = generatePerformanceTestPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Objectives');
    expect(out.markdown).toContain('## 2. Load Profile');
    expect(out.markdown).toContain('## 3. Performance Benchmarks');
    expect(out.markdown).toContain('## 4. Test Approach');
    expect(out.markdown).toContain('## 5. Pass Criteria');
    expect(out.markdown).toContain('## 6. Hypercare Monitoring Handoff');
    expect(out.markdown).toContain('## 7. Sign-off');
  });

  it('emits HTML companion that renders the markdown', () => {
    const out = generatePerformanceTestPlan({ clientName: 'Atlas' });
    expect(out.html).toContain('<!DOCTYPE html>');
    expect(out.html).toContain('Performance Test Plan');
  });

  it('platform default reads as ERP when adaptorName omitted', () => {
    const out = generatePerformanceTestPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Platform:** ERP');
  });
});

describe('Pack T — performanceTestPlanGenerator: benchmark parsing', () => {
  it('parses one benchmark per line into a table row', () => {
    const out = generatePerformanceTestPlan({
      clientName: 'Atlas',
      performanceBenchmarks:
        'PO creation: <2 seconds end-to-end\nTrial balance generation for 4 subsidiaries: <30 seconds',
    });
    expect(out.markdown).toContain('| PO creation | <2 seconds end-to-end |');
    expect(out.markdown).toContain('| Trial balance generation for 4 subsidiaries | <30 seconds |');
  });

  it('benchmark line with no colon is treated as operation with [ASSIGN] target', () => {
    const out = generatePerformanceTestPlan({
      clientName: 'Atlas',
      performanceBenchmarks: 'Inventory query 50k SKUs',
    });
    expect(out.markdown).toContain('| Inventory query 50k SKUs | _[ASSIGN target]_');
  });

  it('shows placeholder row when no benchmarks captured', () => {
    const out = generatePerformanceTestPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_(no benchmarks captured)_');
  });

  it('skips blank lines + trims whitespace', () => {
    const out = generatePerformanceTestPlan({
      clientName: 'Atlas',
      performanceBenchmarks: '\n   PO creation: <2s\n\n  \n',
    });
    expect(out.markdown).toContain('| PO creation | <2s |');
  });
});

describe('Pack T — performanceTestPlanGenerator: load profile', () => {
  it('renders verbatim load profile under the Load Profile section', () => {
    const out = generatePerformanceTestPlan({
      clientName: 'Atlas',
      loadProfile: 'Peak: 80 users\nSteady: 25 users\nOff-peak: 5 users',
    });
    expect(out.markdown).toContain('- Peak: 80 users');
    expect(out.markdown).toContain('- Steady: 25 users');
    expect(out.markdown).toContain('- Off-peak: 5 users');
  });

  it('shows [ASSIGN] placeholder when load profile is empty', () => {
    const out = generatePerformanceTestPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN concurrent-user load profile during discovery]_');
  });
});

describe('Pack T — performanceTestPlanGenerator: tooling per platform', () => {
  it('NetSuite tooling references SuiteScript REST API + APM SuiteApp', () => {
    const out = generatePerformanceTestPlan({ clientName: 'Atlas', adaptorName: 'NetSuite' });
    expect(out.markdown).toContain('SuiteScript REST API');
    expect(out.markdown).toContain('SuiteCloud Performance Monitoring');
  });

  it('Odoo tooling references locust + Odoo profiler + PG_STAT_STATEMENTS', () => {
    const out = generatePerformanceTestPlan({ clientName: 'Atlas', adaptorName: 'Odoo' });
    expect(out.markdown).toContain('locust or k6');
    expect(out.markdown).toContain('PG_STAT_STATEMENTS');
  });

  it('vendor-neutral fallback when adaptorName is unknown', () => {
    const out = generatePerformanceTestPlan({ clientName: 'Atlas', adaptorName: 'Custom' });
    expect(out.markdown).toContain('JMeter or k6');
    expect(out.markdown).not.toContain('SuiteCloud Performance Monitoring');
    expect(out.markdown).not.toContain('PG_STAT_STATEMENTS');
  });
});
