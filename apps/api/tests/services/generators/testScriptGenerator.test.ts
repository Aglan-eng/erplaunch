import { describe, it, expect } from 'vitest';
import { generateTestScripts } from '../../../src/services/generators/testScriptGenerator.js';

/**
 * Pack T — Test Script Generator tests.
 *
 * Covers:
 *   - Parsing of scenariosPerWorkstream lines (well-formed + malformed)
 *   - Auto-increment per workstream → TC-<ws>-<NN> IDs
 *   - Step inference per workstream + keyword family
 *   - Acceptance-criteria style branching (SIMPLE / GIVEN_WHEN_THEN / GHERKIN)
 *   - Test-owner inference from testRoles
 *   - Pre-condition assembly per workstream
 *   - Cross-platform behaviour (NetSuite + Odoo + missing adaptorName)
 *   - File-path layout (Documentation/Test_Scripts/<id>-<slug>.md)
 *   - Vacuous-truth contract on empty / null input
 */

describe('Pack T — testScriptGenerator: parsing', () => {
  it('parses one scenario line into one emitted test script', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: Create a PO for a vendor and verify status',
    });
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0].testId).toBe('TC-P2P-01');
    expect(result.emitted[0].workstream).toBe('P2P');
    expect(result.emitted[0].scenarioName).toBe('PO creation');
  });

  it('emits one Markdown file per parsed scenario into Test_Scripts/', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream:
        'P2P: PO creation: Create a PO\nO2C: SO creation: Create an SO',
    });
    expect(Object.keys(result.files)).toHaveLength(2);
    for (const path of Object.keys(result.files)) {
      expect(path).toMatch(/^Documentation\/Test_Scripts\/TC-/);
      expect(path.endsWith('.md')).toBe(true);
    }
  });

  it('auto-increments per workstream so TC IDs read cleanly per family', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream:
        'P2P: First PO: desc\nP2P: Second PO: desc\nO2C: First SO: desc\nP2P: Third PO: desc',
    });
    const ids = result.emitted.map((e) => e.testId);
    expect(ids).toEqual(['TC-P2P-01', 'TC-P2P-02', 'TC-O2C-01', 'TC-P2P-03']);
  });

  it('captures malformed lines in unmatchedLines (no missing colon → unmatched)', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream:
        'P2P: PO creation: ok\nthis line is not parseable\nO2C: SO creation: also ok',
    });
    expect(result.emitted).toHaveLength(2);
    expect(result.unmatchedLines).toEqual(['this line is not parseable']);
  });

  it('skips blank lines + ignores leading/trailing whitespace', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream:
        '\n  P2P: PO creation: desc  \n\n   \nO2C: SO creation: desc\n',
    });
    expect(result.emitted).toHaveLength(2);
    expect(result.unmatchedLines).toEqual([]);
  });

  it('upper-cases the workstream token regardless of input case', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'p2p: PO creation: desc',
    });
    expect(result.emitted[0].workstream).toBe('P2P');
    expect(result.emitted[0].testId).toBe('TC-P2P-01');
  });
});

describe('Pack T — testScriptGenerator: step inference', () => {
  it('R2R + "period close" yields the period-close step skeleton (6 steps)', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'R2R: Period close: Run month-end close',
    });
    const md = Object.values(result.files)[0];
    // The period-close template has exactly 6 numbered steps in the table.
    const stepRows = (md.match(/^\| \d+ \|/gm) ?? []).length;
    expect(stepRows).toBe(6);
    expect(md).toContain('Manage Accounting Periods');
  });

  it('P2P + "PO" yields the PO-approval step skeleton (7 steps)', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: Create a PO at each tier',
    });
    const md = Object.values(result.files)[0];
    expect((md.match(/^\| \d+ \|/gm) ?? []).length).toBe(7);
    expect(md).toContain('Enter Purchase Orders');
  });

  it('O2C + "sales order" yields the SO step skeleton', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'O2C: SO creation: Create a sales order',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('Enter Sales Orders');
  });

  it('MFG + "work order" yields the WO step skeleton (7 steps)', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'MFG: Work order completion: Complete a WO',
    });
    const md = Object.values(result.files)[0];
    expect((md.match(/^\| \d+ \|/gm) ?? []).length).toBe(7);
    expect(md).toContain('Enter Work Orders');
  });

  it('RTN + "return" yields the return / RMA step skeleton (5 steps)', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'RTN: Customer return: RMA against invoice',
    });
    const md = Object.values(result.files)[0];
    expect((md.match(/^\| \d+ \|/gm) ?? []).length).toBe(5);
    expect(md).toContain('Return Authorization');
  });

  it('unrecognised workstream/keyword combo falls through to the generic 5-step default', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'CRM: Lead conversion: Convert lead to opportunity',
    });
    const md = Object.values(result.files)[0];
    const stepRows = (md.match(/^\| \d+ \|/gm) ?? []).length;
    expect(stepRows).toBe(5);
  });

  it('keyword match is case-insensitive (e.g., "PURCHASE ORDER" matches po template)', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PURCHASE ORDER approval: trigger top tier',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('Enter Purchase Orders');
  });
});

describe('Pack T — testScriptGenerator: acceptance-criteria style branching', () => {
  it('defaults to SIMPLE bulleted list when style is omitted', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: desc',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('## Acceptance Criteria');
    expect(md).toContain('- All test steps pass');
    expect(md).not.toContain('Feature:');
    expect(md).not.toContain('**Given**');
  });

  it('renders BDD-style Given/When/Then when GIVEN_WHEN_THEN selected', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: desc',
      acceptanceCriteriaTemplate: 'GIVEN_WHEN_THEN',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('**Given**');
    expect(md).toContain('**When**');
    expect(md).toContain('**Then**');
    expect(md).not.toContain('Feature:');
  });

  it('renders Gherkin-fenced block when GHERKIN selected', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: desc',
      acceptanceCriteriaTemplate: 'GHERKIN',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('```gherkin');
    expect(md).toContain('Feature: PO creation');
    expect(md).toContain('  Scenario: PO creation');
    expect(md).toContain('    Given the pre-conditions');
  });

  it('unknown style token falls back to SIMPLE', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: desc',
      acceptanceCriteriaTemplate: 'XYZ_BAD' as unknown as 'SIMPLE',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('- All test steps pass');
    expect(md).not.toContain('**Given**');
  });
});

describe('Pack T — testScriptGenerator: test-owner inference', () => {
  it('uses the first role mentioning the workstream as Test Owner', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: desc',
      testRoles:
        'CFO: Sign off on R2R scenarios\nAP Clerk: Test all P2P scenarios',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('AP Clerk');
    expect(md).toContain('Test all P2P scenarios');
  });

  it('falls back to first listed role when no role mentions the workstream', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: desc',
      testRoles: 'CFO: Sign off on R2R + financial reports',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('CFO');
  });

  it('uses [ASSIGN] placeholder when no roles are provided', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: desc',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('_[ASSIGN');
  });
});

describe('Pack T — testScriptGenerator: pre-conditions per workstream', () => {
  it('P2P pre-conditions reference vendor record', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: desc',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('Vendor record');
  });

  it('O2C pre-conditions reference active Customer', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'O2C: SO creation: desc',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('active Customer');
  });

  it('R2R pre-conditions reference open accounting period', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'R2R: Period close: desc',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('Open accounting period');
  });

  it('MFG pre-conditions reference BOM + Routing', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'MFG: Work order: desc',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('BOM + Routing');
  });

  it('platform-specific pre-conditions: NetSuite name passed through', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: desc',
      adaptorName: 'NetSuite',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('logged in to NetSuite');
  });

  it('platform-specific pre-conditions: Odoo name passed through', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'O2C: SO creation: desc',
      adaptorName: 'Odoo',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('logged in to Odoo');
  });
});

describe('Pack T — testScriptGenerator: file shape + vacuous-truth contract', () => {
  it('Test ID + scenario slug form the filename', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO Approval Routing: desc',
    });
    expect(Object.keys(result.files)).toEqual([
      'Documentation/Test_Scripts/TC-P2P-01-po-approval-routing.md',
    ]);
  });

  it('emitted files all carry the standard 6 markdown headings', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: desc',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('# Test Script:');
    expect(md).toContain('## Metadata');
    expect(md).toContain('## Test Steps');
    expect(md).toContain('## Acceptance Criteria');
    expect(md).toContain('## Defects Found');
    expect(md).toContain('## Sign-off');
  });

  it('linked-defect-log pointer references Defect_Log_Template.md', () => {
    const result = generateTestScripts({
      scenariosPerWorkstream: 'P2P: PO creation: desc',
    });
    const md = Object.values(result.files)[0];
    expect(md).toContain('Defect_Log_Template.md');
  });

  it('empty input emits zero files and no unmatched lines', () => {
    const r1 = generateTestScripts({ scenariosPerWorkstream: '' });
    const r2 = generateTestScripts({ scenariosPerWorkstream: null });
    const r3 = generateTestScripts({});
    for (const r of [r1, r2, r3]) {
      expect(r.emitted).toHaveLength(0);
      expect(r.files).toEqual({});
      expect(r.unmatchedLines).toEqual([]);
    }
  });

  it('output is deterministic — same input produces identical files', () => {
    const input = {
      scenariosPerWorkstream:
        'P2P: PO creation: desc\nO2C: SO creation: desc',
      testRoles: 'AP Clerk: P2P\nAR Clerk: O2C',
      acceptanceCriteriaTemplate: 'GHERKIN' as const,
    };
    const a = generateTestScripts(input);
    const b = generateTestScripts(input);
    expect(a.files).toEqual(b.files);
    expect(a.emitted).toEqual(b.emitted);
  });
});
