import { describe, it, expect } from 'vitest';
import { generateDefectLogTemplate } from '../../../src/services/generators/defectLogTemplateGenerator.js';

/**
 * Pack T — Defect Log Template tests.
 *
 * Covers all 3 severity-scheme branches plus the platform + canonical
 * sections + register column shape.
 */

describe('Pack T — defectLogTemplateGenerator: severity scheme branching', () => {
  it('STANDARD_4_LEVEL renders Critical / High / Medium / Low rows', () => {
    const out = generateDefectLogTemplate({
      clientName: 'Atlas',
      defectSeverityLevels: 'STANDARD_4_LEVEL',
    });
    expect(out.markdown).toContain('**Critical**');
    expect(out.markdown).toContain('**High**');
    expect(out.markdown).toContain('**Medium**');
    expect(out.markdown).toContain('**Low**');
    expect(out.markdown).toContain('Standard 4-level');
  });

  it('MAJOR_MINOR renders only Major + Minor', () => {
    const out = generateDefectLogTemplate({
      clientName: 'Atlas',
      defectSeverityLevels: 'MAJOR_MINOR',
    });
    expect(out.markdown).toContain('**Major**');
    expect(out.markdown).toContain('**Minor**');
    // Should NOT carry the 4-level rows in the SLA / definitions table.
    expect(out.markdown).not.toContain('**Critical**');
    expect(out.markdown).not.toContain('**Medium**');
  });

  it('NUMERIC_1_5 renders the 5 numbered levels', () => {
    const out = generateDefectLogTemplate({
      clientName: 'Atlas',
      defectSeverityLevels: 'NUMERIC_1_5',
    });
    expect(out.markdown).toContain('**1 - Blocker**');
    expect(out.markdown).toContain('**2 - Critical**');
    expect(out.markdown).toContain('**3 - Major**');
    expect(out.markdown).toContain('**4 - Minor**');
    expect(out.markdown).toContain('**5 - Trivial**');
  });

  it('defaults to STANDARD_4_LEVEL when scheme is omitted', () => {
    const out = generateDefectLogTemplate({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Standard 4-level');
    expect(out.markdown).toContain('**Critical**');
  });

  it('defaults to STANDARD_4_LEVEL when scheme is null/empty/unknown', () => {
    const r1 = generateDefectLogTemplate({ clientName: 'Atlas', defectSeverityLevels: null });
    const r2 = generateDefectLogTemplate({ clientName: 'Atlas', defectSeverityLevels: '' });
    const r3 = generateDefectLogTemplate({ clientName: 'Atlas', defectSeverityLevels: 'BOGUS' });
    for (const out of [r1, r2, r3]) {
      expect(out.markdown).toContain('Standard 4-level');
    }
  });
});

describe('Pack T — defectLogTemplateGenerator: structure + sections', () => {
  it('emits the 5 canonical sections', () => {
    const out = generateDefectLogTemplate({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Severity Definitions');
    expect(out.markdown).toContain('## 2. Defect Lifecycle');
    expect(out.markdown).toContain('## 3. Defect Register');
    expect(out.markdown).toContain('## 4. Resolution Targets (SLA)');
    expect(out.markdown).toContain('## 5. Reporting Cadence');
  });

  it('register table has the 13 standard columns', () => {
    const out = generateDefectLogTemplate({ clientName: 'Atlas' });
    const headerLine = out.markdown
      .split('\n')
      .find((l) => l.startsWith('| Defect ID | Test Case |'));
    expect(headerLine).toBeDefined();
    const colCount = (headerLine!.match(/\|/g) ?? []).length - 1;
    expect(colCount).toBe(13);
  });

  it('seeds an example D-001 row with the workstream-aware severity for the scheme', () => {
    const out = generateDefectLogTemplate({
      clientName: 'Atlas',
      defectSeverityLevels: 'NUMERIC_1_5',
    });
    expect(out.markdown).toContain('| D-001 | TC-P2P-01 | 1 - Blocker |');
  });

  it('platform name flavours the markdown header (NetSuite)', () => {
    const out = generateDefectLogTemplate({ clientName: 'Atlas', adaptorName: 'NetSuite' });
    expect(out.markdown).toContain('**Platform:** NetSuite');
  });
});
