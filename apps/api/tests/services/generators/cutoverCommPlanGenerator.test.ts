import { describe, it, expect } from 'vitest';
import { generateCutoverCommPlan } from '../../../src/services/generators/cutoverCommPlanGenerator.js';

const SAMPLE_ROSTER =
  'Mariam Hassan: Consultant PM (overall command): T-1 → T+3\n' +
  'Aisha Othman: Client PM: T0 → T+5\n' +
  'Daniel Sterling: Migration lead: T0 → T+1\n' +
  'Helena Reyes: Sponsor / CFO: T0 → T+5';

describe('Pack V — cutoverCommPlanGenerator: structure', () => {
  it('emits the canonical 6 sections', () => {
    const out = generateCutoverCommPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Pre-Cutover Cascade');
    expect(out.markdown).toContain('## 2. During Cutover');
    expect(out.markdown).toContain('## 3. Post-Cutover');
    expect(out.markdown).toContain('## 4. Escalation Contacts');
    expect(out.markdown).toContain('## 5. Communication Templates');
    expect(out.markdown).toContain('## 6. Cross-References');
  });

  it('emits 3 template sub-sections (Pre-Freeze / Cutover Begins / Go Declared)', () => {
    const out = generateCutoverCommPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('### 5.1 Pre-Freeze Notice');
    expect(out.markdown).toContain('### 5.2 Cutover Begins');
    expect(out.markdown).toContain('### 5.3 Go Declared');
  });

  it('platform default is ERP', () => {
    const out = generateCutoverCommPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Platform:** ERP');
  });
});

describe('Pack V — cutoverCommPlanGenerator: milestone phase classification', () => {
  it('classifies pre-freeze milestones into Pre-Cutover Cascade', () => {
    const out = generateCutoverCommPlan({
      clientName: 'Atlas',
      cutoverMilestones:
        'Pre-freeze starts: All users + Sponsor\n' +
        'Cutover begins: Steering + Department Heads\n' +
        'Day 7 hypercare review: Steering',
    });
    // Pre-freeze should land in section 1.
    const pre = out.markdown.split('## 2. During Cutover')[0];
    expect(pre).toContain('| Pre-freeze starts | All users + Sponsor |');
    // "Cutover begins" should land in during-cutover.
    const during = out.markdown.split('## 2. During Cutover')[1].split('## 3. Post-Cutover')[0];
    expect(during).toContain('| Cutover begins | Steering + Department Heads |');
    // "Day 7 hypercare review" should land in post-cutover.
    const post = out.markdown.split('## 3. Post-Cutover')[1].split('## 4. Escalation Contacts')[0];
    expect(post).toContain('| Day 7 hypercare review | Steering |');
  });

  it('falls back to ASSIGN placeholder when no milestones in a phase', () => {
    const out = generateCutoverCommPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN milestone]_');
  });
});

describe('Pack V — cutoverCommPlanGenerator: roster owner resolution', () => {
  it('Owner column populates Consultant PM / Sponsor / Migration lead from roster', () => {
    const out = generateCutoverCommPlan({
      clientName: 'Atlas',
      cutoverTeamRoster: SAMPLE_ROSTER,
    });
    expect(out.markdown).toContain('Mariam Hassan');
    expect(out.markdown).toContain('Helena Reyes');
    expect(out.markdown).toContain('Daniel Sterling');
  });

  it('falls back to [ASSIGN] when role keyword does not match', () => {
    const out = generateCutoverCommPlan({
      clientName: 'Atlas',
      cutoverTeamRoster: 'Generic Person: Some Random Role: T0',
    });
    expect(out.markdown).toContain('_[ASSIGN]_');
  });

  it('signature in templates uses Sponsor + Consultant PM names', () => {
    const out = generateCutoverCommPlan({
      clientName: 'Atlas',
      cutoverTeamRoster: SAMPLE_ROSTER,
    });
    // Pre-Freeze template signs from Sponsor.
    expect(out.markdown).toMatch(/— Helena Reyes/);
    // Cutover Begins signs from Consultant PM.
    expect(out.markdown).toMatch(/— Mariam Hassan/);
  });
});

describe('Pack V — cutoverCommPlanGenerator: escalations + cross-refs', () => {
  it('parses escalationContacts into the contacts table', () => {
    const out = generateCutoverCommPlan({
      clientName: 'Atlas',
      escalationContacts:
        'Group CEO: only if rollback triggered\n' +
        'External SuiteCloud Support: if SDF deploy fails',
    });
    expect(out.markdown).toContain('| Group CEO | only if rollback triggered |');
    expect(out.markdown).toContain('| External SuiteCloud Support | if SDF deploy fails |');
  });

  it('cross-refs Cutover Runbook + Go_No_Go_Matrix + Cutover_Team_Roster + Rollback', () => {
    const out = generateCutoverCommPlan({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Cutover/Cutover_Runbook.md');
    expect(out.markdown).toContain('Documentation/Cutover/Go_No_Go_Matrix.md');
    expect(out.markdown).toContain('Documentation/Cutover/Cutover_Team_Roster.md');
    expect(out.markdown).toContain('Documentation/Cutover/Rollback_Plan.md');
  });

  it('mid-cutover checkpoint timestamp is half the cutover window', () => {
    const out = generateCutoverCommPlan({
      clientName: 'Atlas',
      cutoverWindowHours: 48,
    });
    expect(out.markdown).toContain('mid-cutover checkpoint (T+24h)');
  });
});
