import { describe, it, expect } from 'vitest';
import { generatePowerUserOfficeHours } from '../../../src/services/generators/powerUserOfficeHoursGenerator.js';

describe('Pack X — powerUserOfficeHoursGenerator: structure', () => {
  it('emits the canonical 6 sections', () => {
    const out = generatePowerUserOfficeHours({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Schedule');
    expect(out.markdown).toContain('## 2. Format');
    expect(out.markdown).toContain('## 3. Topics');
    expect(out.markdown).toContain('## 4. Recording & Topic Log');
    expect(out.markdown).toContain('## 5. Escalation From Office Hours');
    expect(out.markdown).toContain('## 6. Cross-References');
  });
});

describe('Pack X — powerUserOfficeHoursGenerator: schedule + tapering', () => {
  it('default schedule taper at T+15 (durationDays=30 default)', () => {
    const out = generatePowerUserOfficeHours({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Early hypercare | T+1 to T+15');
    expect(out.markdown).toContain('Late hypercare | T+16 to T+30');
  });

  it('respects custom hypercare duration', () => {
    const out = generatePowerUserOfficeHours({
      clientName: 'Atlas',
      hypercareDurationDays: 14,
    });
    expect(out.markdown).toContain('Early hypercare | T+1 to T+7');
    expect(out.markdown).toContain('Late hypercare | T+8 to T+14');
  });

  it('cadence: ≥ 2 sessions/week early, 1 session/week late', () => {
    const out = generatePowerUserOfficeHours({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**2 sessions per week minimum**');
    expect(out.markdown).toContain('**1 session per week**');
  });
});

describe('Pack X — powerUserOfficeHoursGenerator: format', () => {
  it('renders 60-minute format + open Q&A + recording', () => {
    const out = generatePowerUserOfficeHours({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Duration:** 60 minutes');
    expect(out.markdown).toContain('**Style:** Open Q&A');
    expect(out.markdown).toContain('Always recorded');
  });

  it('hosts include hypercare lead', () => {
    const out = generatePowerUserOfficeHours({
      clientName: 'Atlas',
      hypercareLeadName: 'Lara Mansour',
    });
    expect(out.markdown).toContain('Lara Mansour (hypercare lead)');
  });

  it('falls back to ASSIGN when lead missing', () => {
    const out = generatePowerUserOfficeHours({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN hypercare lead]_');
  });
});

describe('Pack X — powerUserOfficeHoursGenerator: workstream topics', () => {
  it('renders R2R / P2P / O2C topic lines when in scope', () => {
    const out = generatePowerUserOfficeHours({
      clientName: 'Atlas',
      workstreamsInScope: ['R2R', 'P2P', 'O2C'],
    });
    expect(out.markdown).toContain('R2R: trial balance, period close');
    expect(out.markdown).toContain('P2P: vendor master, PO + 3-way match');
    expect(out.markdown).toContain('O2C: customer master, sales orders');
  });

  it('renders MFG / RTN / CRM / HR / IT topic lines when in scope', () => {
    const out = generatePowerUserOfficeHours({
      clientName: 'Atlas',
      workstreamsInScope: ['MFG', 'RTN', 'CRM', 'HR', 'IT'],
    });
    expect(out.markdown).toContain('Manufacturing:');
    expect(out.markdown).toContain('Returns:');
    expect(out.markdown).toContain('CRM:');
    expect(out.markdown).toContain('HR:');
    expect(out.markdown).toContain('IT admin:');
  });

  it('placeholder when no workstreams provided', () => {
    const out = generatePowerUserOfficeHours({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN — populate workstreams in scope');
  });

  it('case-insensitive workstream matching', () => {
    const out = generatePowerUserOfficeHours({
      clientName: 'Atlas',
      workstreamsInScope: ['r2r', 'p2p'],
    });
    expect(out.markdown).toContain('R2R: trial balance');
    expect(out.markdown).toContain('P2P: vendor master');
  });

  it('unknown workstream falls back to generic copy', () => {
    const out = generatePowerUserOfficeHours({
      clientName: 'Atlas',
      workstreamsInScope: ['CUSTOM'],
    });
    expect(out.markdown).toContain('CUSTOM: workstream-specific topics');
  });
});

describe('Pack X — powerUserOfficeHoursGenerator: log template + escalation', () => {
  it('embeds gherkin/codeblock-fenced session log template', () => {
    const out = generatePowerUserOfficeHours({ clientName: 'Atlas' });
    expect(out.markdown).toContain('```markdown');
    expect(out.markdown).toContain('## Session: <Date>');
    expect(out.markdown).toContain('### Topics covered');
    expect(out.markdown).toContain('### Defect-log entries created');
  });

  it('escalation flows into war-room issue log within 1 business hour', () => {
    const out = generatePowerUserOfficeHours({ clientName: 'Atlas' });
    expect(out.markdown).toContain('within 1 business hour');
  });

  it('TRAINING-gap questions feed back into per-role training guides', () => {
    const out = generatePowerUserOfficeHours({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Training/<Role>_Training_Guide.md');
  });
});

describe('Pack X — powerUserOfficeHoursGenerator: cross-references', () => {
  it('cross-refs Hypercare_Plan + War_Room + Daily_Readiness + KPI + Defect_Log', () => {
    const out = generatePowerUserOfficeHours({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_Plan.md');
    expect(out.markdown).toContain('Documentation/Hypercare/War_Room_SOP.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Daily_Readiness_Checklist.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_KPI_Dashboard.md');
    expect(out.markdown).toContain('Documentation/Defect_Log_Template.md');
  });
});
