import { describe, it, expect } from 'vitest';
import { generateIntegrationsIndex } from '../../../src/services/generators/integrationsIndexGenerator.js';

describe('Pack ZZ — integrationsIndexGenerator: structure', () => {
  it('emits the canonical sections', () => {
    const out = generateIntegrationsIndex({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('# Integrations');
    expect(out.markdown).toContain('## Folder Layout');
    expect(out.markdown).toContain('## Integrations');
    expect(out.markdown).toContain('## Cross-Pack References');
    expect(out.markdown).toContain('## On-Call Quick Reference');
  });

  it('lists all 11 NetSuite default integrations as cards', () => {
    const out = generateIntegrationsIndex({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    // Each card has "### NN. <name>" header.
    const cards = (out.markdown.match(/^### \d{2}\. /gm) ?? []).length;
    expect(cards).toBe(11);
  });

  it('lists all 6 Odoo default integrations as cards', () => {
    const out = generateIntegrationsIndex({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    const cards = (out.markdown.match(/^### \d{2}\. /gm) ?? []).length;
    expect(cards).toBe(6);
  });
});

describe('Pack ZZ — integrationsIndexGenerator: criticality marker', () => {
  it('critical-path integrations have 🔴 emoji marker', () => {
    const out = generateIntegrationsIndex({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    // At least one critical-path integration in the default catalog (Avalara).
    expect(out.markdown).toContain('🔴');
  });
});

describe('Pack ZZ — integrationsIndexGenerator: runbook links', () => {
  it('every integration card links to its runbook .md', () => {
    const out = generateIntegrationsIndex({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('./Runbooks/01_avalara_tax.md');
  });
});

describe('Pack ZZ — integrationsIndexGenerator: cross-pack references', () => {
  it('references Pack V (Cutover), Pack X (Hypercare), Pack Y (Stabilization), Pack Z (Migration)', () => {
    const out = generateIntegrationsIndex({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Documentation/Cutover/Cutover_Runbook.md');
    expect(out.markdown).toContain('Documentation/Cutover/Go_NoGo_Matrix.md');
    expect(out.markdown).toContain('Documentation/Cutover/Post_Cutover_Smoke.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_Plan.md');
    expect(out.markdown).toContain('Documentation/Hypercare/War_Room_SOP.md');
    expect(out.markdown).toContain(
      'Documentation/Stabilization/Continuous_Improvement_Governance.md',
    );
    expect(out.markdown).toContain('Documentation/Data_Migration/Migration_Runbook.md');
  });
});

describe('Pack ZZ — integrationsIndexGenerator: on-call quick reference', () => {
  it('includes the 6-step on-call decision tree', () => {
    const out = generateIntegrationsIndex({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('1. **Identify the integration**');
    expect(out.markdown).toContain('2. **Open the runbook**');
    expect(out.markdown).toContain('3. **Try L1 recovery**');
    expect(out.markdown).toContain('4. **Reconcile**');
    expect(out.markdown).toContain('5. **Escalate if needed**');
    expect(out.markdown).toContain('6. **War room if SLA at risk**');
  });
});
