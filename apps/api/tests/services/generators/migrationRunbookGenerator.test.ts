import { describe, it, expect } from 'vitest';
import { generateMigrationRunbook } from '../../../src/services/generators/migrationRunbookGenerator.js';

describe('Pack Z — migrationRunbookGenerator: structure', () => {
  it('emits the 4 phase headings', () => {
    const out = generateMigrationRunbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('## Phase 1 — Pre-Cutover Readiness Gates');
    expect(out.markdown).toContain('## Phase 2 — Cutover Window');
    expect(out.markdown).toContain('## Phase 3 — Post-Load Validation + Sign-Off');
    expect(out.markdown).toContain('## Phase 4 — Rollback Decision Tree');
  });

  it('emits all five readiness gates (T-30 / T-14 / T-7 / T-3 / T-1)', () => {
    const out = generateMigrationRunbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('### T-30 — Cleansing complete');
    expect(out.markdown).toContain('### T-14 — Dry-run #2');
    expect(out.markdown).toContain('### T-7 — Dry-run #3');
    expect(out.markdown).toContain('### T-3 — Source-system freeze decision');
    expect(out.markdown).toContain('### T-1 — Pre-flight');
  });
});

describe('Pack Z — migrationRunbookGenerator: cross-references', () => {
  it('cross-references Cutover_Runbook.md (Pack V — parent runbook)', () => {
    const out = generateMigrationRunbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Documentation/Cutover/Cutover_Runbook.md');
  });

  it('cross-references Rollback_Plan.md, Go_NoGo_Matrix.md, War_Room_SOP.md', () => {
    const out = generateMigrationRunbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Documentation/Cutover/Rollback_Plan.md');
    expect(out.markdown).toContain('Documentation/Cutover/Go_NoGo_Matrix.md');
    expect(out.markdown).toContain('Documentation/Hypercare/War_Room_SOP.md');
  });

  it('cross-references all sibling Pack Z docs', () => {
    const out = generateMigrationRunbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('./Templates/');
    expect(out.markdown).toContain('./Field_Mapping_Workbook.md');
    expect(out.markdown).toContain('./Reconciliation_Queries.md');
    expect(out.markdown).toContain('./Cleansing_Rules.md');
    expect(out.markdown).toContain('./Load_Sequencing.md');
    expect(out.markdown).toContain('./Reject_Handling_Playbook.md');
    expect(out.markdown).toContain('./Data_Quality_Scorecard.md');
  });
});

describe('Pack Z — migrationRunbookGenerator: input handling', () => {
  it('uses consultant-supplied threshold + cut-off + go-live + history', () => {
    const out = generateMigrationRunbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
      historicalDataDepth: 'Current FY full + 3 prior years summary',
      dryRunPassThreshold: '99.9% records loaded clean',
      migrationCutoffDate: '2026-11-13',
      targetGoLiveDate: '2026-11-15',
    });
    expect(out.markdown).toContain('Current FY full + 3 prior years summary');
    expect(out.markdown).toContain('99.9% records loaded clean');
    expect(out.markdown).toContain('2026-11-13');
    expect(out.markdown).toContain('2026-11-15');
  });

  it('falls back to defaults when input is empty', () => {
    const out = generateMigrationRunbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('99.5%');
    expect(out.markdown).toContain('_[ASSIGN target go-live]_');
    expect(out.markdown).toContain('_[ASSIGN — last business day before go-live]_');
  });
});

describe('Pack Z — migrationRunbookGenerator: load steps', () => {
  it('emits one numbered step per object in scope (NetSuite default = 15)', () => {
    const out = generateMigrationRunbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('01. **Subsidiaries**');
    expect(out.markdown).toContain('15. **GL Opening Balances**');
  });

  it('cumulative trial-balance check uses subsidiary on NetSuite, company on Odoo', () => {
    const ns = generateMigrationRunbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    const odoo = generateMigrationRunbook({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(ns.markdown).toContain('subsidiary × currency');
    expect(odoo.markdown).toContain('company × currency');
  });
});
