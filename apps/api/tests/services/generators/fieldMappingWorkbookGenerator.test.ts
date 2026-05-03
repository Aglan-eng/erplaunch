import { describe, it, expect } from 'vitest';
import { generateFieldMappingWorkbook } from '../../../src/services/generators/fieldMappingWorkbookGenerator.js';

describe('Pack Z — fieldMappingWorkbookGenerator: structure', () => {
  it('emits the canonical sections', () => {
    const out = generateFieldMappingWorkbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('# Field Mapping Workbook');
    expect(out.markdown).toContain('## How to Use');
    expect(out.markdown).toContain('## Mapping Sheets');
    expect(out.markdown).toContain('## Cross-References');
  });

  it('emits one mapping subsection per object in scope', () => {
    const out = generateFieldMappingWorkbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    // NetSuite default scope: 15 objects (no FA).
    expect(out.markdown).toContain('### Subsidiaries');
    expect(out.markdown).toContain('### Customers');
    expect(out.markdown).toContain('### Vendors');
    expect(out.markdown).toContain('### GL Opening Balances');
  });

  it('emits the 5-column table header', () => {
    const out = generateFieldMappingWorkbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('| Source field | Source type | Target field | Transformation | Notes |');
  });

  it('per-object section references the corresponding CSV template', () => {
    const out = generateFieldMappingWorkbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('./Templates/01_subsidiaries.csv');
    expect(out.markdown).toContain('./Templates/08_customers.csv');
  });
});

describe('Pack Z — fieldMappingWorkbookGenerator: source-system overlay', () => {
  it('uses consultant-supplied source label when provided', () => {
    const out = generateFieldMappingWorkbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
      sourceSystemsByObject: 'Customers | QuickBooks Online | export per branch',
    });
    expect(out.markdown).toContain('QuickBooks Online');
  });

  it('falls back to placeholder when source overlay missing', () => {
    const out = generateFieldMappingWorkbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('_[ASSIGN — source system]_');
  });
});

describe('Pack Z — fieldMappingWorkbookGenerator: transformation defaults', () => {
  it('Date fields auto-suggest YYYY-MM-DD conversion', () => {
    const out = generateFieldMappingWorkbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Convert to YYYY-MM-DD');
  });

  it('Amount / Price / Cost fields suggest ledger-currency conversion', () => {
    const out = generateFieldMappingWorkbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Convert to ledger currency; 2 decimal places');
  });

  it('External ID rows reference Cleansing_Rules.md', () => {
    const out = generateFieldMappingWorkbook({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.markdown).toContain('Generate stable key');
    expect(out.markdown).toContain('Cleansing_Rules.md');
  });
});
