import { describe, it, expect } from 'vitest';
import { generateWarRoomSop } from '../../../src/services/generators/warRoomSopGenerator.js';

describe('Pack X — warRoomSopGenerator: structure', () => {
  it('emits the canonical 7 sections', () => {
    const out = generateWarRoomSop({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. War-Room Dates & Hours');
    expect(out.markdown).toContain('## 2. Physical / Virtual Setup');
    expect(out.markdown).toContain('## 3. Daily Standup Structure (15 minutes)');
    expect(out.markdown).toContain('## 4. Issue Logging Template');
    expect(out.markdown).toContain('## 5. Root Cause Analysis (RCA) Template');
    expect(out.markdown).toContain('## 6. Decision-Rights Matrix');
    expect(out.markdown).toContain('## 7. Cross-References');
  });

  it('Slack channel name is kebab-case client slug', () => {
    const out = generateWarRoomSop({ clientName: 'Atlas Industries Group' });
    expect(out.markdown).toContain('`#hypercare-atlas-industries-group`');
  });
});

describe('Pack X — warRoomSopGenerator: 15-minute standup format', () => {
  it('lists all 5 standup phases with time allocations', () => {
    const out = generateWarRoomSop({ clientName: 'Atlas' });
    expect(out.markdown).toMatch(/Yesterday's resolved \(3 min\)/);
    expect(out.markdown).toMatch(/Today's blockers \(3 min\)/);
    expect(out.markdown).toMatch(/S1-S2 walk \(5 min\)/);
    expect(out.markdown).toMatch(/KPI scan \(3 min\)/);
    expect(out.markdown).toMatch(/Cross-team dependencies \(1 min\)/);
  });

  it('standup time flows from input', () => {
    const out = generateWarRoomSop({
      clientName: 'Atlas',
      dailyStandupTime: '09:00 KSA daily',
    });
    expect(out.markdown).toContain('Held at **09:00 KSA daily** every business day');
  });

  it('falls back to ASSIGN when standup time missing', () => {
    const out = generateWarRoomSop({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN daily standup time]_');
  });
});

describe('Pack X — warRoomSopGenerator: 8-field issue card', () => {
  it('lists all 8 fields (ID / Severity / Raiser / Area / Description / Owner / ETA / Status)', () => {
    const out = generateWarRoomSop({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| **ID** |');
    expect(out.markdown).toContain('| **Severity** |');
    expect(out.markdown).toContain('| **Raiser** |');
    expect(out.markdown).toContain('| **Area** |');
    expect(out.markdown).toContain('| **Description** |');
    expect(out.markdown).toContain('| **Owner** |');
    expect(out.markdown).toContain('| **ETA** |');
    expect(out.markdown).toContain('| **Status** |');
  });
});

describe('Pack X — warRoomSopGenerator: 5-Whys RCA template', () => {
  it('renders the 5-Whys structure', () => {
    const out = generateWarRoomSop({ clientName: 'Atlas' });
    expect(out.markdown).toContain('5-Whys structure');
    // 5 numbered "why" questions (allow flexible numbering 1-6 with a final 6th catch-all).
    const numberedWhys = (out.markdown.match(/^\d+\.\s+\*\*(?:What|Why|Final)/gm) ?? []).length;
    expect(numberedWhys).toBeGreaterThanOrEqual(5);
  });

  it('lists RCA mandatory triggers', () => {
    const out = generateWarRoomSop({ clientName: 'Atlas' });
    expect(out.markdown).toContain('S1 or S2');
    expect(out.markdown).toContain('fixed but recurring');
    expect(out.markdown).toContain('longer than the resolution-target SLA');
  });
});

describe('Pack X — warRoomSopGenerator: decision-rights matrix', () => {
  it('renders 6 decision rights with hypercare lead resolution', () => {
    const out = generateWarRoomSop({
      clientName: 'Atlas',
      hypercareLeadName: 'Lara Mansour',
    });
    expect(out.markdown).toContain('| Approve hot-fix deploy (config or script) | Lara Mansour (Hypercare Lead) |');
    expect(out.markdown).toContain('| Roll back a deployed change | Lara Mansour + Sponsor (joint, in writing) |');
    expect(out.markdown).toContain('| Adjust SLA or response window | Sponsor only |');
  });

  it('falls back to ASSIGN when lead missing', () => {
    const out = generateWarRoomSop({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN hypercare lead]_');
  });
});

describe('Pack X — warRoomSopGenerator: war-room hours + cross-refs', () => {
  it('embeds verbatim war-room schedule', () => {
    const out = generateWarRoomSop({
      clientName: 'Atlas',
      warRoomHours: 'T+1 to T+5: full team 08:00-18:00. T+6 to T+15: 09:00-13:00.',
    });
    expect(out.markdown).toContain('T+1 to T+5: full team 08:00-18:00');
  });

  it('cross-refs Hypercare_Plan + Daily_Readiness + Escalation + KPI_Dashboard + Defect_Log', () => {
    const out = generateWarRoomSop({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_Plan.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Daily_Readiness_Checklist.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Issue_Escalation_Matrix.md');
    expect(out.markdown).toContain('Documentation/Hypercare/Hypercare_KPI_Dashboard.md');
    expect(out.markdown).toContain('Documentation/Defect_Log_Template.md');
  });
});
