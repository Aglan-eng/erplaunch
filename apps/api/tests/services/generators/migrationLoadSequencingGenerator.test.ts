import { describe, it, expect } from 'vitest';
import { generateMigrationLoadSequencing } from '../../../src/services/generators/migrationLoadSequencingGenerator.js';

describe('Pack Z — migrationLoadSequencingGenerator: structure', () => {
  it('emits the canonical sections', () => {
    const out = generateMigrationLoadSequencing({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('# Load Sequencing');
    expect(out.markdown).toContain('## Dependency Diagram');
    expect(out.markdown).toContain('## Load Order (executable)');
    expect(out.markdown).toContain('## Sequencing Rules');
    expect(out.markdown).toContain('## Cross-References');
  });

  it('emits a Mermaid graph TD block', () => {
    const out = generateMigrationLoadSequencing({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('```mermaid');
    expect(out.markdown).toContain('graph TD');
    expect(out.markdown).toContain('classDef classRef');
    expect(out.markdown).toContain('classDef classMaster');
    expect(out.markdown).toContain('classDef classOpenBal');
  });

  it('emits the 5-column load order table', () => {
    const out = generateMigrationLoadSequencing({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('| # | Filename | Object | Category | Depends on |');
  });
});

describe('Pack Z — migrationLoadSequencingGenerator: NetSuite catalog', () => {
  it('NetSuite default scope lists 15 objects (no FA, no MFG)', () => {
    const out = generateMigrationLoadSequencing({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    // 7 reference + 4 master + 4 open-balance = 15.
    expect(out.markdown).toContain('15 (7 reference / 4 master / 4 open-balance)');
  });

  it('Customers depend on Subsidiaries — edge present in mermaid', () => {
    const out = generateMigrationLoadSequencing({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('subsidiaries --> customers');
  });

  it('GL Opening Balances depend on Chart of Accounts + Subsidiaries', () => {
    const out = generateMigrationLoadSequencing({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('chartOfAccounts --> glOpeningBalances');
    expect(out.markdown).toContain('subsidiaries --> glOpeningBalances');
  });
});

describe('Pack Z — migrationLoadSequencingGenerator: Odoo catalog', () => {
  it('default Odoo scope lists 9 objects (no boms)', () => {
    const out = generateMigrationLoadSequencing({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.markdown).toContain('9 (3 reference / 2 master / 4 open-balance)');
  });

  it('manufacturing-in-scope adds boms node + edge from products', () => {
    const out = generateMigrationLoadSequencing({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: { 'odoo.mfg.routingRequired': true },
    });
    expect(out.markdown).toContain('Bills of Materials');
    expect(out.markdown).toContain('products --> boms');
  });
});

describe('Pack Z — migrationLoadSequencingGenerator: load-order count', () => {
  it('load-order final step number matches in-scope count (NetSuite)', () => {
    const out = generateMigrationLoadSequencing({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Final sign-off only after step 15.');
  });
});
