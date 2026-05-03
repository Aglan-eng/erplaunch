import { describe, it, expect } from 'vitest';
import { generateIntegrationTestPlan } from '../../../src/services/generators/integrationTestPlanGenerator.js';

describe('Pack ZZ — integrationTestPlanGenerator: structure', () => {
  it('emits the canonical sections', () => {
    const out = generateIntegrationTestPlan({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('# Integration Test Plan');
    expect(out.markdown).toContain('## Pre-Cutover Gate');
    expect(out.markdown).toContain('## Post-Cutover Smoke');
    expect(out.markdown).toContain('## Default Test Pattern per Integration Type');
    expect(out.markdown).toContain('## Per-Integration Test Cases');
    expect(out.markdown).toContain('## Test Data Management');
    expect(out.markdown).toContain('## Integration UAT Linkage');
  });

  it('emits one test case section per integration in scope', () => {
    const out = generateIntegrationTestPlan({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('### Avalara Tax');
    expect(out.markdown).toContain('### Salesforce CPQ');
  });
});

describe('Pack ZZ — integrationTestPlanGenerator: per-test sections', () => {
  it('every test case has both pre-cutover and post-cutover smoke', () => {
    const out = generateIntegrationTestPlan({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    // Each integration section has Pre-cutover smoke (gate) and Post-cutover smoke.
    const preCutover = (out.markdown.match(/\*\*Pre-cutover smoke \(gate\):\*\*/g) ?? []).length;
    const postCutover = (out.markdown.match(/\*\*Post-cutover smoke:\*\*/g) ?? []).length;
    expect(preCutover).toBe(11); // NetSuite default catalog has 11 integrations
    expect(postCutover).toBe(11);
  });

  it('every test case includes UAT linkage cross-reference', () => {
    const out = generateIntegrationTestPlan({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Documentation/UAT_Plan.md');
  });
});

describe('Pack ZZ — integrationTestPlanGenerator: default pattern table', () => {
  it('default pattern table covers 4 integration types', () => {
    const out = generateIntegrationTestPlan({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Inbound master-data');
    expect(out.markdown).toContain('Inbound transactional');
    expect(out.markdown).toContain('| Outbound');
    expect(out.markdown).toContain('| File drop');
  });
});

describe('Pack ZZ — integrationTestPlanGenerator: overlay-driven smoke tests', () => {
  it('uses consultant-supplied pre-cutover + post-cutover smoke verbatim', () => {
    const out = generateIntegrationTestPlan({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {
        'integrations.catalog.integrationCatalog':
          'Avalara Tax | Transactional API | Bidirectional | Realtime | RESTlet | Avalara',
      },
      integrationCutoverSmokeTests:
        'Avalara Tax | Calculate tax on test SO | Confirm tax on first 5 production SOs matches expected',
    });
    expect(out.markdown).toContain('Calculate tax on test SO');
    expect(out.markdown).toContain('first 5 production SOs');
  });
});

describe('Pack ZZ — integrationTestPlanGenerator: cross-references', () => {
  it('cross-refs Pack V Go/No-Go and Post-Cutover Smoke + Pack T UAT', () => {
    const out = generateIntegrationTestPlan({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Documentation/Cutover/Go_NoGo_Matrix.md');
    expect(out.markdown).toContain('Documentation/Cutover/Post_Cutover_Smoke.md');
    expect(out.markdown).toContain('Documentation/UAT_Plan.md');
  });
});
