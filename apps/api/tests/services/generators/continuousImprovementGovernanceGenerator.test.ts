import { describe, it, expect } from 'vitest';
import { generateContinuousImprovementGovernance } from '../../../src/services/generators/continuousImprovementGovernanceGenerator.js';

describe('Pack Y — continuousImprovementGovernanceGenerator: structure', () => {
  it('emits the canonical 6 sections', () => {
    const out = generateContinuousImprovementGovernance({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Steady-State Governance Body');
    expect(out.markdown).toContain('## 2. Decision-Rights Matrix (RACI)');
    expect(out.markdown).toContain('## 3. Change-Request Lifecycle');
    expect(out.markdown).toContain('## 4. Cadence');
    expect(out.markdown).toContain('## 5.'); // section title varies per adaptor
    expect(out.markdown).toContain('## 6. Cross-References');
  });
});

describe('Pack Y — continuousImprovementGovernanceGenerator: RACI matrix', () => {
  it('renders RACI for at least 7 decision categories', () => {
    const out = generateContinuousImprovementGovernance({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Configuration change');
    expect(out.markdown).toContain('Master-data change');
    expect(out.markdown).toContain('Integration change');
    expect(out.markdown).toContain('Customisation change');
    expect(out.markdown).toContain('Release of new module');
    expect(out.markdown).toContain('Expansion to new entity');
    expect(out.markdown).toContain('Vendor escalation');
  });

  it('uses A,R / C / I notation per RACI convention', () => {
    const out = generateContinuousImprovementGovernance({ clientName: 'Atlas' });
    expect(out.markdown).toMatch(/\| A,R \|/);
    expect(out.markdown).toMatch(/\| C \|/);
    expect(out.markdown).toMatch(/\| I \|/);
  });
});

describe('Pack Y — continuousImprovementGovernanceGenerator: governance committee', () => {
  it('uses default 6-row canonical roster when overlay sparse', () => {
    const out = generateContinuousImprovementGovernance({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| Sustainment Owner |');
    expect(out.markdown).toContain('| Finance lead |');
    expect(out.markdown).toContain('| Power-user representative |');
    expect(out.markdown).toContain('| Vendor account manager |');
  });

  it('parses committee overlay rows', () => {
    const out = generateContinuousImprovementGovernance({
      clientName: 'Atlas',
      governanceCommittee:
        'David Chen | IT Director | IT chair\n' +
        'Helena Reyes | CFO | Finance + sponsor',
    });
    expect(out.markdown).toContain('| David Chen | IT Director | IT chair |');
    expect(out.markdown).toContain('| Helena Reyes | CFO | Finance + sponsor |');
  });
});

describe('Pack Y — continuousImprovementGovernanceGenerator: change-request lifecycle', () => {
  it('uses default 6-stage flow when consultant skips', () => {
    const out = generateContinuousImprovementGovernance({ clientName: 'Atlas' });
    expect(out.markdown).toContain('1. **Submit');
    expect(out.markdown).toContain('2. **Triage');
    expect(out.markdown).toContain('3. **Estimate');
    expect(out.markdown).toContain('4. **Prioritize');
    expect(out.markdown).toContain('5. **Build');
    expect(out.markdown).toContain('6. **Release');
  });

  it('uses overlay steps when consultant provides own', () => {
    const out = generateContinuousImprovementGovernance({
      clientName: 'Atlas',
      changeRequestProcess:
        'Custom step A\n' +
        'Custom step B\n' +
        'Custom step C',
    });
    expect(out.markdown).toContain('1. **Custom step A**');
    expect(out.markdown).toContain('2. **Custom step B**');
    expect(out.markdown).toContain('3. **Custom step C**');
  });
});

describe('Pack Y — continuousImprovementGovernanceGenerator: adaptor-conditional release calendar', () => {
  it('NetSuite renders biannual release cadence', () => {
    const out = generateContinuousImprovementGovernance({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('## 5. NetSuite Release Calendar');
    expect(out.markdown).toContain('2 vendor releases per year');
    expect(out.markdown).toContain('2026.1 and 2026.2');
    expect(out.markdown).toContain('Release Preview');
    expect(out.markdown).toContain('SuiteScript/WFA breakages');
    expect(out.markdown).toContain('Freeze windows');
  });

  it('Odoo renders annual major + OdooSH staging-prod promotion', () => {
    const out = generateContinuousImprovementGovernance({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
    });
    expect(out.markdown).toContain('## 5. Odoo Release Calendar');
    expect(out.markdown).toContain('1 annual major version');
    expect(out.markdown).toContain('19.0, 20.0');
    expect(out.markdown).toContain('OdooSH');
    expect(out.markdown).toContain('staging→production promotion');
    expect(out.markdown).toContain('annual major upgrade');
  });

  it('unknown adaptor renders [ASSIGN] placeholder', () => {
    const out = generateContinuousImprovementGovernance({
      clientName: 'X',
      adaptorName: 'CustomERP',
    });
    expect(out.markdown).toContain('_[ASSIGN platform release cadence');
  });
});

describe('Pack Y — continuousImprovementGovernanceGenerator: cadence + cross-refs', () => {
  it('cadence value renders verbatim when provided', () => {
    const out = generateContinuousImprovementGovernance({
      clientName: 'Atlas',
      decisionCadence: 'Monthly steering, quarterly business review',
    });
    expect(out.markdown).toContain('Monthly steering, quarterly business review');
  });

  it('cross-refs sibling Pack Y artefacts + Pack X escalation matrix', () => {
    const out = generateContinuousImprovementGovernance({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Stabilization/Stabilization_Roadmap.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Process_Improvement_Backlog.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Benefits_Realization_Tracker.md');
    expect(out.markdown).toContain('Documentation/Stabilization/KPI_Evolution_Plan.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Phase_Two_Charter.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Issue_Escalation_Matrix.md');
  });
});
