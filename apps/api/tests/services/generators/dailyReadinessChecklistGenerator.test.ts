import { describe, it, expect } from 'vitest';
import { generateDailyReadinessChecklist } from '../../../src/services/generators/dailyReadinessChecklistGenerator.js';

describe('Pack X — dailyReadinessChecklistGenerator: structure', () => {
  it('emits the canonical 9 sections', () => {
    const out = generateDailyReadinessChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Overnight Job Status');
    expect(out.markdown).toContain('## 2. Open Issues by Severity');
    expect(out.markdown).toContain('## 3. KPIs vs Bands');
    expect(out.markdown).toContain('## 4. Integration Health');
    expect(out.markdown).toContain('## 5. User Feedback Channel Scan');
    expect(out.markdown).toContain('## 6. Capacity Check');
    expect(out.markdown).toContain('## 7. Standup Agenda Prep');
    expect(out.markdown).toContain('## 8. Day-N Specific Watch Items');
    expect(out.markdown).toContain('## 9. End-of-Day Wrap');
  });

  it('contains checkboxes (markdown-safe — should copy cleanly into Confluence/Notion)', () => {
    const out = generateDailyReadinessChecklist({ clientName: 'Atlas' });
    const checkboxCount = (out.markdown.match(/^- \[ \]/gm) ?? []).length;
    expect(checkboxCount).toBeGreaterThanOrEqual(15);
  });

  it('hypercare window header reflects custom duration', () => {
    const out = generateDailyReadinessChecklist({
      clientName: 'Atlas',
      hypercareDurationDays: 14,
    });
    expect(out.markdown).toContain('**Hypercare Window:** T+1 → T+14');
  });

  it('default duration is 30', () => {
    const out = generateDailyReadinessChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Hypercare Window:** T+1 → T+30');
  });
});

describe('Pack X — dailyReadinessChecklistGenerator: severity table', () => {
  it('renders S1-S4 rows for triage tracking', () => {
    const out = generateDailyReadinessChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| S1 | 0 | — |');
    expect(out.markdown).toContain('| S2 | 0 | — |');
    expect(out.markdown).toContain('| S3 | 0 | — |');
    expect(out.markdown).toContain('| S4 | 0 | — |');
  });

  it('mentions S1 + S2 must show owner + ETA', () => {
    const out = generateDailyReadinessChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('S1 + S2 must show owner + ETA');
  });
});

describe('Pack X — dailyReadinessChecklistGenerator: integration health', () => {
  it('renders one row per parsed integration name', () => {
    const out = generateDailyReadinessChecklist({
      clientName: 'Atlas',
      integrationsList:
        'Salesforce | customer master | hourly\n' +
        'Avalara | tax-code lookup | real-time',
    });
    expect(out.markdown).toContain('| Salesforce | ⏳ | ⏳ | ⏳ |');
    expect(out.markdown).toContain('| Avalara | ⏳ | ⏳ | ⏳ |');
  });

  it('placeholder when no integrations provided', () => {
    const out = generateDailyReadinessChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN integration name]_');
  });
});

describe('Pack X — dailyReadinessChecklistGenerator: fragile dates', () => {
  it('renders provided fragile dates rows', () => {
    const out = generateDailyReadinessChecklist({
      clientName: 'Atlas',
      fragileDates: [
        { dayN: 'Day 12', reason: 'First month-end close' },
        { dayN: 'Day 25', reason: 'Payroll run' },
      ],
    });
    expect(out.markdown).toContain('| Day 12 | First month-end close | ⏳ |');
    expect(out.markdown).toContain('| Day 25 | Payroll run | ⏳ |');
  });

  it('placeholder when no fragile dates provided', () => {
    const out = generateDailyReadinessChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN fragile date]_');
  });
});

describe('Pack X — dailyReadinessChecklistGenerator: cross-references', () => {
  it('cross-refs Hypercare_Plan + KPI_Dashboard + Escalation_Matrix + Defect_Log', () => {
    const out = generateDailyReadinessChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_Plan.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_KPI_Dashboard.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Issue_Escalation_Matrix.md');
    expect(out.markdown).toContain('Documentation/Defect_Log_Template.md');
  });
});
