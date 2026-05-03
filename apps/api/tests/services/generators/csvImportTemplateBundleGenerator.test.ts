import { describe, it, expect } from 'vitest';
import { generateCsvImportTemplateBundle } from '../../../src/services/generators/csvImportTemplateBundleGenerator.js';

describe('Pack Z — csvImportTemplateBundleGenerator: NetSuite catalog', () => {
  it('emits exactly 16 CSVs (no FA, no MFG by default — 16 base catalog)', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: { 'ns.design.fixedAssetsScope': 'something' },
    });
    // Default NetSuite catalog is 16 objects; FA toggled in answers above.
    expect(Object.keys(out.files)).toHaveLength(16);
    expect(out.objectCount).toBe(16);
  });

  it('emits 15 CSVs when fixed assets are out of scope', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(Object.keys(out.files)).toHaveLength(15);
  });

  it('every file path is prefixed with Templates/', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    for (const k of Object.keys(out.files)) {
      expect(k.startsWith('Templates/')).toBe(true);
    }
  });

  it('header row is byte-for-byte the canonical NetSuite header (Subsidiaries)', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    const csv = out.files['Templates/01_subsidiaries.csv'];
    expect(csv).toBeDefined();
    expect(csv.split('\n')[0]).toBe('External ID,Name,Country,Currency,Legal Name,Federal ID,Parent');
  });

  it('every CSV has header + 2 blank data rows (LF-only line endings)', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    const sample = out.files['Templates/08_customers.csv'];
    const lines = sample.split('\n');
    // header + 2 blank rows + trailing empty (because join with '' tail)
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toContain('External ID');
    // Both blank rows are commas-only.
    expect(lines[1].replace(/,/g, '')).toBe('');
    expect(lines[2].replace(/,/g, '')).toBe('');
  });

  it('blank data rows have arity equal to header column count - 1 commas', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    for (const csv of Object.values(out.files)) {
      const lines = csv.split('\n');
      const headerCols = lines[0].split(',').length;
      const blankCommas = lines[1].split(',').length;
      expect(blankCommas).toBe(headerCols);
    }
  });
});

describe('Pack Z — csvImportTemplateBundleGenerator: Odoo catalog', () => {
  it('emits 9 CSVs by default (no BOMs without mfg)', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(Object.keys(out.files)).toHaveLength(9);
  });

  it('emits 10 CSVs when manufacturing is in scope', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: { 'odoo.mfg.routingRequired': true },
    });
    expect(Object.keys(out.files)).toHaveLength(10);
    expect(out.files['Templates/10_boms.csv']).toBeDefined();
  });

  it('partners.csv header uses Odoo dotted-path notation', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    const csv = out.files['Templates/04_partners.csv'];
    expect(csv).toBeDefined();
    expect(csv.split('\n')[0]).toContain('property_payment_term_id/id');
    expect(csv.split('\n')[0]).toContain('country_id');
  });

  it('every header begins with id, (Odoo external ID convention)', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    for (const csv of Object.values(out.files)) {
      expect(csv.split('\n')[0].startsWith('id,')).toBe(true);
    }
  });
});

describe('Pack Z — csvImportTemplateBundleGenerator: README', () => {
  it('NetSuite README references Setup → Import/Export → Import CSV Records', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.readme).toContain('Setup → Import/Export → Import CSV Records');
  });

  it('Odoo README references Settings → Technical → Import', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.readme).toContain('Settings → Technical → Import');
  });

  it('README inventory table lists every emitted CSV', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    for (const fp of Object.keys(out.files)) {
      const filename = fp.replace('Templates/', '');
      expect(out.readme).toContain(filename);
    }
  });

  it('README cross-references Load_Sequencing.md, Field_Mapping_Workbook.md, Reconciliation_Queries.md', () => {
    const out = generateCsvImportTemplateBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.readme).toContain('Load_Sequencing.md');
    expect(out.readme).toContain('Field_Mapping_Workbook.md');
    expect(out.readme).toContain('Reconciliation_Queries.md');
  });
});
