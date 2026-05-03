import { describe, it, expect } from 'vitest';
import { generateMigrationCleansingRules } from '../../../src/services/generators/migrationCleansingRulesGenerator.js';

describe('Pack Z — migrationCleansingRulesGenerator: structure', () => {
  it('emits the canonical sections', () => {
    const out = generateMigrationCleansingRules({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('# Cleansing Rules');
    expect(out.markdown).toContain('## Cleansing Principles');
    expect(out.markdown).toContain('## Rule Register');
    expect(out.markdown).toContain('## Owner Roster');
    expect(out.markdown).toContain('## Acceptance');
    expect(out.markdown).toContain('## Cross-References');
  });

  it('emits the 4-column rule register table', () => {
    const out = generateMigrationCleansingRules({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('| Object | Cleansing rule | Owner | Status |');
  });
});

describe('Pack Z — migrationCleansingRulesGenerator: defaults', () => {
  it('renders all 6 default canonical rules when no overlay supplied', () => {
    const out = generateMigrationCleansingRules({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('| Customers |');
    expect(out.markdown).toContain('| Vendors |');
    expect(out.markdown).toContain('| Items / Products |');
    expect(out.markdown).toContain('| Chart of Accounts |');
    expect(out.markdown).toContain('| Open AR / AP |');
    expect(out.markdown).toContain('| GL Opening Balances |');
  });

  it('every default row carries Open status', () => {
    const out = generateMigrationCleansingRules({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    // Find at least one defaulted row with the _Open_ status marker.
    expect(out.markdown).toContain('_Open_');
  });
});

describe('Pack Z — migrationCleansingRulesGenerator: consultant overlay', () => {
  it('renders consultant rows alongside defaults — same object override skips default', () => {
    const out = generateMigrationCleansingRules({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      cleansingRulesByObject: 'Customers | Custom — extract VAT into separate column | Sara Khan',
    });
    expect(out.markdown).toContain('Custom — extract VAT into separate column');
    expect(out.markdown).toContain('Sara Khan');
    // Vendors default still present (not overridden).
    expect(out.markdown).toContain('| Vendors |');
  });
});

describe('Pack Z — migrationCleansingRulesGenerator: owner roster', () => {
  it('renders Owner Roster table when owners overlay supplied', () => {
    const out = generateMigrationCleansingRules({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      dataQualityOwners: 'Customers | Sara Khan | Hala Naim\nVendors | Omar Aziz | Nour Hassan',
    });
    expect(out.markdown).toContain('| Object | Primary owner | Backup |');
    expect(out.markdown).toContain('Sara Khan');
    expect(out.markdown).toContain('Hala Naim');
    expect(out.markdown).toContain('Omar Aziz');
  });

  it('falls back to placeholder when no owners overlay supplied', () => {
    const out = generateMigrationCleansingRules({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('Owners not yet assigned');
  });
});
