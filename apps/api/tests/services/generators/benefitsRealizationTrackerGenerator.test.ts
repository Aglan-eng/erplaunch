import { describe, it, expect } from 'vitest';
import { generateBenefitsRealizationTracker } from '../../../src/services/generators/benefitsRealizationTrackerGenerator.js';

describe('Pack Y — benefitsRealizationTrackerGenerator: structure', () => {
  it('emits the canonical 6 sections', () => {
    const out = generateBenefitsRealizationTracker({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Purpose');
    expect(out.markdown).toContain('## 2. Tracker Table');
    expect(out.markdown).toContain('## 3.'); // section title varies per adaptor
    expect(out.markdown).toContain('## 4. Re-baselining Trigger Conditions');
    expect(out.markdown).toContain('## 5. Review Cadence');
    expect(out.markdown).toContain('## 6. Cross-References');
  });

  it('tracker table header has 7 columns (Metric / Baseline / Target / Timing / Source data / Owner / Status)', () => {
    const out = generateBenefitsRealizationTracker({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| Metric | Baseline | Target | Timing | Source data | Owner | Status |');
  });
});

describe('Pack Y — benefitsRealizationTrackerGenerator: business-case overlay', () => {
  it('parses overlay rows into tracker table', () => {
    const out = generateBenefitsRealizationTracker({
      clientName: 'Atlas',
      businessCaseSummary:
        'Close cycle days | 11 | 5 | T+180\n' +
        'Audit prep hours | 600 | 240 | T+270\n' +
        'Manual JE count per period | 250 | 60 | T+180',
    });
    expect(out.markdown).toMatch(/\| Close cycle days \| 11 \| 5 \| T\+180 \|/);
    expect(out.markdown).toMatch(/\| Audit prep hours \| 600 \| 240 \| T\+270 \|/);
    expect(out.markdown).toMatch(/\| Manual JE count per period \| 250 \| 60 \| T\+180 \|/);
  });

  it('uses default canonical 6-row metric set when overlay is sparse (< 3 rows)', () => {
    const out = generateBenefitsRealizationTracker({
      clientName: 'Atlas',
      businessCaseSummary: 'Single metric | 10 | 5 | T+90',
    });
    expect(out.markdown).toContain('| Close cycle days |');
    expect(out.markdown).toContain('| AP days-payable-outstanding |');
    expect(out.markdown).toContain('| AR days-sales-outstanding |');
    expect(out.markdown).toContain('| Manual journal count per period |');
    expect(out.markdown).toContain('| Audit prep hours |');
    expect(out.markdown).toContain('| Headcount avoided in finance ops |');
  });

  it('uses default 6-row set when overlay is empty', () => {
    const out = generateBenefitsRealizationTracker({ clientName: 'Atlas' });
    expect(out.markdown).toContain('canonical default ERP business-case metrics');
    // Default 6 rows render.
    const dataRows = (out.markdown.match(/^\| (?:Close cycle|AP days|AR days|Manual journal|Audit prep|Headcount avoided)/gm) ?? []).length;
    expect(dataRows).toBe(6);
  });

  it('overlay with 3+ rows turns off default fallback', () => {
    const out = generateBenefitsRealizationTracker({
      clientName: 'Atlas',
      businessCaseSummary:
        'A | 1 | 2 | T+30\nB | 3 | 4 | T+60\nC | 5 | 6 | T+90',
    });
    expect(out.markdown).toContain('parsed `stabilization.benefits.businessCaseSummary` overlay');
    expect(out.markdown).not.toContain('canonical default ERP business-case metrics');
  });
});

describe('Pack Y — benefitsRealizationTrackerGenerator: adaptor-conditional measurement', () => {
  it('NetSuite renders saved-search references with customsearch_ss_* IDs', () => {
    const out = generateBenefitsRealizationTracker({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('## 3. NetSuite Measurement Methodology');
    expect(out.markdown).toContain('customsearch_ss_close_cycle_history');
    expect(out.markdown).toContain('customsearch_ss_dpo_dso_history');
    expect(out.markdown).toContain('customsearch_ss_manual_je_count');
    expect(out.markdown).toContain('SuiteAnalytics Connect');
  });

  it('Odoo renders Studio dashboard / SQL view references', () => {
    const out = generateBenefitsRealizationTracker({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
    });
    expect(out.markdown).toContain('## 3. Odoo Measurement Methodology');
    expect(out.markdown).toContain('bm_close_cycle');
    expect(out.markdown).toContain('bm_dpo_dso');
    expect(out.markdown).toContain('bm_manual_je');
    expect(out.markdown).toContain('account.move.line');
  });

  it('unknown adaptor renders [ASSIGN] placeholder', () => {
    const out = generateBenefitsRealizationTracker({
      clientName: 'X',
      adaptorName: 'CustomERP',
    });
    expect(out.markdown).toContain('_[ASSIGN platform-specific data sources');
  });
});

describe('Pack Y — benefitsRealizationTrackerGenerator: owner + cadence', () => {
  it('benefits owner renders verbatim in metadata + section 5 (covers harness check)', () => {
    const out = generateBenefitsRealizationTracker({
      clientName: 'Atlas',
      benefitsReviewOwner: 'Helena Reyes (CFO) — accountable; David Chen (IT) — measurement support',
    });
    expect(out.markdown).toContain('**Benefits Owner:** Helena Reyes (CFO) — accountable; David Chen (IT) — measurement support');
    expect(out.markdown).toContain('**Owner:** Helena Reyes (CFO) — accountable; David Chen (IT) — measurement support');
  });

  it('falls back to ASSIGN when owner missing', () => {
    const out = generateBenefitsRealizationTracker({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN benefits-review owner]_');
  });

  it('cadence renders verbatim when provided', () => {
    const out = generateBenefitsRealizationTracker({
      clientName: 'Atlas',
      benefitsReviewCadence: 'Quarterly to steering committee, annual to board',
    });
    expect(out.markdown).toContain('Quarterly to steering committee, annual to board');
  });
});

describe('Pack Y — benefitsRealizationTrackerGenerator: re-baselining + cross-refs', () => {
  it('lists 4 re-baselining triggers', () => {
    const out = generateBenefitsRealizationTracker({ clientName: 'Atlas' });
    expect(out.markdown).toContain('underlying business model changes');
    expect(out.markdown).toContain('original baseline turns out to have been mismeasured');
    expect(out.markdown).toContain('scope change');
    expect(out.markdown).toContain('timing assumption');
  });

  it('cross-refs sibling Pack Y artefacts + KICKOFF business case', () => {
    const out = generateBenefitsRealizationTracker({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Stabilization/Stabilization_Roadmap.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Process_Improvement_Backlog.md');
    expect(out.markdown).toContain('Documentation/Stabilization/KPI_Evolution_Plan.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Phase_Two_Charter.md');
    expect(out.markdown).toContain('Documentation/Project_Kickoff.md');
    expect(out.markdown).toContain('Documentation/Solution_Design.html');
  });
});
