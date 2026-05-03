import { describe, it, expect } from 'vitest';
import { generateCutoverTeamRoster } from '../../../src/services/generators/cutoverTeamRosterGenerator.js';

describe('Pack V — cutoverTeamRosterGenerator: structure', () => {
  it('emits the canonical 5 sections', () => {
    const out = generateCutoverTeamRoster({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. On-Call Schedule');
    expect(out.markdown).toContain('## 2. Communication Channel');
    expect(out.markdown).toContain('## 3. Coverage Validation Checklist');
    expect(out.markdown).toContain('## 4. Roles + Responsibilities Quick-Reference');
    expect(out.markdown).toContain('## 5. Cross-References');
  });

  it('Slack channel name uses kebab-case client slug', () => {
    const out = generateCutoverTeamRoster({ clientName: 'Atlas Industries Group' });
    expect(out.markdown).toContain('`#cutover-atlas-industries-group`');
  });
});

describe('Pack V — cutoverTeamRosterGenerator: roster parsing', () => {
  it('renders one table row per parsed roster line', () => {
    const out = generateCutoverTeamRoster({
      clientName: 'Atlas',
      cutoverTeamRoster:
        'Mariam Hassan: Consultant PM: T-1 → T+3\n' +
        'Aisha Othman: Client PM: T0 → T+5',
    });
    expect(out.markdown).toContain('| Mariam Hassan | Consultant PM | T-1 → T+3 |');
    expect(out.markdown).toContain('| Aisha Othman | Client PM | T0 → T+5 |');
  });

  it('placeholder row when no roster captured', () => {
    const out = generateCutoverTeamRoster({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN]_');
  });

  it('graceful handling of 2-segment lines (no on-call window)', () => {
    const out = generateCutoverTeamRoster({
      clientName: 'Atlas',
      cutoverTeamRoster: 'Test Person: Some Role',
    });
    expect(out.markdown).toContain('| Test Person | Some Role | _[ASSIGN window]_ |');
  });

  it('roster size renders in metadata', () => {
    const out = generateCutoverTeamRoster({
      clientName: 'Atlas',
      cutoverTeamRoster: 'A: B: C\nD: E: F\nG: H: I',
    });
    expect(out.markdown).toContain('**Roster Size:** 3');
  });
});

describe('Pack V — cutoverTeamRosterGenerator: standard sections', () => {
  it('coverage validation checklist mentions 24h coverage + 2 awake', () => {
    const out = generateCutoverTeamRoster({ clientName: 'Atlas' });
    expect(out.markdown).toContain('24h coverage confirmed');
    expect(out.markdown).toContain('At least 2 people awake');
  });

  it('roles quick-reference defines Consultant PM / Migration Lead / IT Lead', () => {
    const out = generateCutoverTeamRoster({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| Consultant PM |');
    expect(out.markdown).toContain('| Migration Lead |');
    expect(out.markdown).toContain('| IT Lead |');
  });

  it('cross-refs Cutover Runbook + Communication Plan + Go/No-Go', () => {
    const out = generateCutoverTeamRoster({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Cutover/Cutover_Runbook.md');
    expect(out.markdown).toContain('Documentation/Cutover/Communication_Plan.md');
    expect(out.markdown).toContain('Documentation/Cutover/Go_No_Go_Matrix.md');
  });
});
