import { describe, it, expect } from 'vitest';
import { generateDataQualityScorecard } from '../../../src/services/generators/dataQualityScorecardGenerator.js';

describe('Pack Z — dataQualityScorecardGenerator: structure', () => {
  it('emits the canonical sections', () => {
    const out = generateDataQualityScorecard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('# Data Quality Scorecard');
    expect(out.markdown).toContain('## Readiness Gates');
    expect(out.markdown).toContain('## Per-Object Scorecard');
    expect(out.markdown).toContain('## Aggregate Pass-Rate');
    expect(out.markdown).toContain('## Decision Rules');
    expect(out.markdown).toContain('## Cross-References');
  });

  it('emits the 5-checkpoint readiness gate table (T-30 / T-14 / T-7 / T-3 / T-1)', () => {
    const out = generateDataQualityScorecard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('| **T-30** | 30 days before go-live |');
    expect(out.markdown).toContain('| **T-14** | 14 days before go-live |');
    expect(out.markdown).toContain('| **T-7**  | 7 days before go-live  |');
    expect(out.markdown).toContain('| **T-3**  | 3 days before go-live  |');
    expect(out.markdown).toContain('| **T-1**  | 1 day before go-live   |');
  });

  it('emits the 8-column per-object scorecard table (Object / Owner / 5 gate cols / Status)', () => {
    const out = generateDataQualityScorecard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain(
      '| Object | Owner | T-30 pass-rate | T-14 pass-rate | T-7 pass-rate | T-3 pass-rate | T-1 pass-rate | Status |',
    );
  });

  it('per-object scorecard renders one row per object in scope', () => {
    const out = generateDataQualityScorecard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('| Subsidiaries |');
    expect(out.markdown).toContain('| Customers |');
    expect(out.markdown).toContain('| Vendors |');
    expect(out.markdown).toContain('| GL Opening Balances |');
  });
});

describe('Pack Z — dataQualityScorecardGenerator: aggregate pass-rate', () => {
  it('aggregate table includes T-1 GO / NO-GO row', () => {
    const out = generateDataQualityScorecard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('| T-1');
    expect(out.markdown).toContain('GO / NO-GO');
  });
});

describe('Pack Z — dataQualityScorecardGenerator: input handling', () => {
  it('uses consultant-supplied threshold, dates, owners', () => {
    const out = generateDataQualityScorecard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
      dryRunPassThreshold: '99.9% records loaded clean',
      migrationCutoffDate: '2026-11-13',
      targetGoLiveDate: '2026-11-15',
      dataQualityOwners: 'Customers | Sara Khan | Hala Naim',
    });
    expect(out.markdown).toContain('99.9% records loaded clean');
    expect(out.markdown).toContain('2026-11-13');
    expect(out.markdown).toContain('2026-11-15');
    expect(out.markdown).toContain('Sara Khan');
  });

  it('falls back to defaults when input is empty', () => {
    const out = generateDataQualityScorecard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('99.5%');
    expect(out.markdown).toContain('_[ASSIGN target go-live]_');
  });
});

describe('Pack Z — dataQualityScorecardGenerator: cross-references', () => {
  it('references Cutover_Runbook + Go_NoGo_Matrix (Pack V) + sibling Pack Z docs', () => {
    const out = generateDataQualityScorecard({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Documentation/Cutover/Cutover_Runbook.md');
    expect(out.markdown).toContain('Documentation/Cutover/Go_NoGo_Matrix.md');
    expect(out.markdown).toContain('./Migration_Runbook.md');
    expect(out.markdown).toContain('./Reconciliation_Queries.md');
    expect(out.markdown).toContain('./Reject_Handling_Playbook.md');
    expect(out.markdown).toContain('./Cleansing_Rules.md');
    expect(out.markdown).toContain('./Templates/');
  });
});
