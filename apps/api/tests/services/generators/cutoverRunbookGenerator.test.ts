import { describe, it, expect } from 'vitest';
import { generateCutoverRunbook } from '../../../src/services/generators/cutoverRunbookGenerator.js';

/**
 * Pack V — Cutover Runbook tests.
 *
 * Covers all 4 cutoverStyle templates + hour-distribution math + roster
 * owner resolution + dry-run schedule embedding + cross-references.
 */

const SAMPLE_ROSTER =
  'Mariam Hassan: Consultant PM (overall command): T-1 → T+3 days continuous\n' +
  'Aisha Othman: Client PM: T0 → T+5 days\n' +
  'Daniel Sterling: Migration lead: T0 → T+1 day\n' +
  'Tom Wilson: IT lead: T-1 → T+1 day\n' +
  'Helena Reyes: Functional lead — finance: T0 → T+1 day';

describe('Pack V — cutoverRunbookGenerator: shape', () => {
  it('emits markdown with the canonical 4 phases (pre-cutover / cutover / post-cutover / cross-refs)', () => {
    const out = generateCutoverRunbook({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## Pre-Cutover Phase');
    expect(out.markdown).toContain('## Cutover Window');
    expect(out.markdown).toContain('## Post-Cutover Phase');
    expect(out.markdown).toContain('## Cross-References');
  });

  it('emits HTML companion that renders the markdown', () => {
    const out = generateCutoverRunbook({ clientName: 'Atlas' });
    expect(out.html).toContain('<!DOCTYPE html>');
    expect(out.html).toContain('Cutover Runbook');
  });

  it('platform default reads as ERP when adaptorName omitted', () => {
    const out = generateCutoverRunbook({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Platform:** ERP');
  });

  it('platform name flavours the markdown header when provided', () => {
    const out = generateCutoverRunbook({ clientName: 'Atlas', adaptorName: 'NetSuite' });
    expect(out.markdown).toContain('**Platform:** NetSuite');
  });

  it('go-live date renders in metadata when provided', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      targetGoLiveDate: '2027-02-01',
    });
    expect(out.markdown).toContain('**Target Go-Live:** 2027-02-01');
  });

  it('go-live falls back to TBD when omitted', () => {
    const out = generateCutoverRunbook({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Target Go-Live:** TBD');
  });
});

describe('Pack V — cutoverRunbookGenerator: cutoverStyle branching', () => {
  it('BIG_BANG (default) emits hour-by-hour table with T+H:MM rows', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverWindowHours: 36,
      cutoverTeamRoster: SAMPLE_ROSTER,
    });
    expect(out.resolvedStyle).toBe('BIG_BANG');
    expect(out.markdown).toContain('Big Bang');
    // Hour-by-hour table should have rows like "| T+0:00 |" or "| T+0:30 |".
    expect(out.markdown).toMatch(/\| T\+\d+:\d{2}/);
  });

  it('BIG_BANG distributes hours across extract / transform / load / validate / smoke phases', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverWindowHours: 36,
      cutoverTeamRoster: SAMPLE_ROSTER,
    });
    // 20% extract / 30% transform / 30% load / 10% validate / 10% smoke.
    expect(out.markdown).toContain('extraction');
    expect(out.markdown).toContain('transformation');
    expect(out.markdown).toContain('Tie-out validation');
    expect(out.markdown).toContain('P0 smoke test');
  });

  it('BIG_BANG resolves roster owners by role keyword (Consultant PM / Migration lead / IT lead / Functional lead)', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverWindowHours: 36,
      cutoverTeamRoster: SAMPLE_ROSTER,
    });
    // Each named owner from SAMPLE_ROSTER should appear in the table.
    expect(out.markdown).toContain('Mariam Hassan');
    expect(out.markdown).toContain('Daniel Sterling');
    expect(out.markdown).toContain('Tom Wilson');
    expect(out.markdown).toContain('Helena Reyes');
  });

  it('BIG_BANG renders [ASSIGN] placeholder when roster keyword does not match', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverWindowHours: 36,
      cutoverTeamRoster: 'Generic Person: Some Role: T0',
    });
    expect(out.markdown).toContain('_[ASSIGN]_');
  });

  it('PARALLEL_RUN emits parallel-run sections with daily reconciliation', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverStyle: 'PARALLEL_RUN',
      parallelRunDays: 14,
      cutoverTeamRoster: SAMPLE_ROSTER,
    });
    expect(out.resolvedStyle).toBe('PARALLEL_RUN');
    expect(out.markdown).toContain('Parallel Run');
    expect(out.markdown).toContain('14 day');
    expect(out.markdown).toContain('Daily reconciliation');
    expect(out.markdown).toContain('Legacy Retirement');
  });

  it('PARALLEL_RUN includes Parallel Run Days in metadata', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverStyle: 'PARALLEL_RUN',
      parallelRunDays: 21,
    });
    expect(out.markdown).toContain('**Parallel Run Days:** 21');
  });

  it('PHASED_ENTITY emits per-wave entity sequence', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverStyle: 'PHASED_ENTITY',
      cutoverTeamRoster: SAMPLE_ROSTER,
    });
    expect(out.resolvedStyle).toBe('PHASED_ENTITY');
    expect(out.markdown).toContain('Phased by Entity');
    expect(out.markdown).toContain('Per-Entity Wave Pattern');
    expect(out.markdown).toContain('| 1 |');
    expect(out.markdown).toContain('| 2 |');
  });

  it('PHASED_MODULE emits dependency-ordered module waves', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverStyle: 'PHASED_MODULE',
      cutoverTeamRoster: SAMPLE_ROSTER,
    });
    expect(out.resolvedStyle).toBe('PHASED_MODULE');
    expect(out.markdown).toContain('Phased by Module');
    expect(out.markdown).toContain('Finance + Master Data');
    expect(out.markdown).toContain('Inventory + Procurement');
  });

  it('unknown style token falls back to BIG_BANG', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverStyle: 'BOGUS' as unknown as 'BIG_BANG',
    });
    expect(out.resolvedStyle).toBe('BIG_BANG');
  });
});

describe('Pack V — cutoverRunbookGenerator: dry-run schedule embedding', () => {
  it('renders dry-run schedule lines verbatim in pre-cutover section', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      dryRunDates:
        'Dry Run 1: 2026-12-14: Data migration only\n' +
        'Dry Run 2: 2027-01-04: Full end-to-end',
    });
    expect(out.markdown).toContain('**Dry Run 1**');
    expect(out.markdown).toContain('2026-12-14');
    expect(out.markdown).toContain('Data migration only');
    expect(out.markdown).toContain('**Dry Run 2**');
    expect(out.markdown).toContain('2027-01-04');
  });

  it('falls back to ASSIGN placeholder when dry-run schedule is empty', () => {
    const out = generateCutoverRunbook({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN dry-run schedule once locked');
  });
});

describe('Pack V — cutoverRunbookGenerator: defaults + bounds', () => {
  it('defaults cutoverWindowHours to 36 when omitted', () => {
    const out = generateCutoverRunbook({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Cutover Window:** 36h');
  });

  it('defaults preFreezeDays to 3 when omitted', () => {
    const out = generateCutoverRunbook({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Pre-Freeze:** 3 business day');
  });

  it('respects custom cutoverWindowHours value', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverWindowHours: 48,
    });
    expect(out.markdown).toContain('**Cutover Window:** 48h');
  });

  it('respects custom preFreezeDays value', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      preFreezeDays: 5,
    });
    expect(out.markdown).toContain('**Pre-Freeze:** 5 business day');
  });
});

describe('Pack V — cutoverRunbookGenerator: cross-references', () => {
  it('cross-refs Go_No_Go_Matrix + Rollback_Plan + Post_Cutover_Smoke', () => {
    const out = generateCutoverRunbook({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Cutover/Go_No_Go_Matrix.md');
    expect(out.markdown).toContain('Documentation/Cutover/Rollback_Plan.md');
    expect(out.markdown).toContain('Documentation/Cutover/Post_Cutover_Smoke.md');
  });

  it('cross-refs Communication_Plan + Dry_Run_Plan + Cutover_Team_Roster', () => {
    const out = generateCutoverRunbook({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Cutover/Communication_Plan.md');
    expect(out.markdown).toContain('Documentation/Cutover/Dry_Run_Plan.md');
    expect(out.markdown).toContain('Documentation/Cutover/Cutover_Team_Roster.md');
  });

  it('forward-refs Pack X Hypercare_Plan in post-cutover phase', () => {
    const out = generateCutoverRunbook({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Hypercare_Plan.md');
  });

  it('cross-refs Pack T artefacts (Performance_Test_Plan + Defect_Log_Template)', () => {
    const out = generateCutoverRunbook({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Performance_Test_Plan.md');
    expect(out.markdown).toContain('Defect_Log_Template.md');
  });
});

// ─── Phase 41.1 — engagement-specific BIG_BANG extract row + PHASED_MODULE waves
//
// The runbook used to read identically across engagements: a hardcoded
// extract list ("customers, vendors, items, open AR/AP, opening TB,
// inventory snapshot") and a hardcoded 4-wave PHASED_MODULE table that
// included Manufacturing for clients that didn't license it. These
// tests pin the new behaviour: BIG_BANG names the actual objects, and
// PHASED_MODULE only renders waves that have at least one in-scope
// licensed module.

describe('Pack V — Phase 41.1 BIG_BANG extract row', () => {
  it('falls back to the legacy generic list when no migrationObjects are provided', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverTeamRoster: SAMPLE_ROSTER,
    });
    expect(out.markdown).toContain('Run data extraction scripts (customers, vendors, items, open AR/AP, opening TB, inventory snapshot)');
  });

  it('names the actual objects when migrationObjects are provided', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverTeamRoster: SAMPLE_ROSTER,
      migrationObjects: [
        { id: 'subsidiaries', label: 'Subsidiaries' },
        { id: 'customers', label: 'Customers' },
        { id: 'items', label: 'Items / Products' },
      ],
    });
    expect(out.markdown).toContain('Run data extraction scripts: Subsidiaries, Customers, Items / Products');
    // Pass-criteria mentions the count.
    expect(out.markdown).toContain('All 3 extracts complete');
  });

  it('truncates very long object lists with a "+ N more" suffix', () => {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverTeamRoster: SAMPLE_ROSTER,
      migrationObjects: labels.map((l) => ({ id: l.toLowerCase(), label: l })),
    });
    // 8 objects, cap at 6 → "A, B, C, D, E, F + 2 more"
    expect(out.markdown).toContain('A, B, C, D, E, F + 2 more');
    expect(out.markdown).toContain('All 8 extracts complete');
  });
});

describe('Pack V — Phase 41.1 PHASED_MODULE waves derived from license modules', () => {
  it('renders only waves that have at least one in-scope licensed module', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverStyle: 'PHASED_MODULE',
      cutoverTeamRoster: SAMPLE_ROSTER,
      // Only Foundation + Finance + Sales modules — Procurement and
      // Manufacturing waves should be omitted.
      licenseModules: ['Finance', 'General Ledger', 'Sales (CRM)', 'Invoicing'],
    });
    expect(out.markdown).toContain('Foundation + Finance');
    expect(out.markdown).toContain('Sales + Customer Operations');
    // Procurement + Manufacturing waves should NOT appear when no
    // matching module was licensed.
    expect(out.markdown).not.toContain('Procurement + Inventory');
    expect(out.markdown).not.toContain('Manufacturing + Returns');
  });

  it('lists the actual module names inside each wave row', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverStyle: 'PHASED_MODULE',
      cutoverTeamRoster: SAMPLE_ROSTER,
      licenseModules: ['General Ledger', 'Inventory', 'Manufacturing'],
    });
    expect(out.markdown).toContain('Foundation + Finance (General Ledger)');
    expect(out.markdown).toContain('Procurement + Inventory (Inventory)');
    expect(out.markdown).toContain('Manufacturing + Returns (Manufacturing)');
  });

  it('groups unmatched modules into a final "Other" wave so nothing silently drops', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverStyle: 'PHASED_MODULE',
      cutoverTeamRoster: SAMPLE_ROSTER,
      licenseModules: ['General Ledger', 'Mystery Bespoke Module'],
    });
    expect(out.markdown).toContain('Foundation + Finance');
    expect(out.markdown).toContain('Other / unclassified');
    expect(out.markdown).toContain('Mystery Bespoke Module');
  });

  it('falls back to the legacy 4-wave table when licenseModules is absent', () => {
    const out = generateCutoverRunbook({
      clientName: 'Atlas',
      cutoverStyle: 'PHASED_MODULE',
      cutoverTeamRoster: SAMPLE_ROSTER,
    });
    // Legacy unconditional waves still rendered for backward-compatibility.
    expect(out.markdown).toContain('| 1 | Finance + Master Data');
    expect(out.markdown).toContain('| 4 | Manufacturing + Returns');
    expect(out.markdown).toContain('License modules were not provided');
  });
});
