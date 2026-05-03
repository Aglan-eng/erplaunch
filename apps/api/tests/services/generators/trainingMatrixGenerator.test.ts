import { describe, it, expect } from 'vitest';
import { generateTrainingMatrix } from '../../../src/services/generators/trainingMatrixGenerator.js';

/**
 * Pack U — Training Matrix tests.
 */

describe('Pack U — trainingMatrixGenerator: structure', () => {
  it('emits markdown with the 4 canonical sections', () => {
    const out = generateTrainingMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Role × Workstream Coverage');
    expect(out.markdown).toContain('## 2. Legend');
    expect(out.markdown).toContain('## 3. Total Training Hours per Role');
    expect(out.markdown).toContain('## 4. Cross-References');
  });

  it('emits HTML companion that renders the markdown', () => {
    const out = generateTrainingMatrix({ clientName: 'Atlas' });
    expect(out.html).toContain('<!DOCTYPE html>');
    expect(out.html).toContain('Training Matrix');
  });

  it('platform default reads as ERP when adaptorName omitted', () => {
    const out = generateTrainingMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Platform:** ERP');
  });

  it('platform name flavours the markdown header when provided', () => {
    const out = generateTrainingMatrix({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('**Platform:** NetSuite');
  });
});

describe('Pack U — trainingMatrixGenerator: role rows', () => {
  it('parses roles from trainingPerRole + standardRoleCustomization', () => {
    const out = generateTrainingMatrix({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x\nAR Clerk: y',
      standardRoleCustomization: 'CFO: scope full\nSales Manager: per-territory',
    });
    expect(out.markdown).toContain('| AP Clerk |');
    expect(out.markdown).toContain('| AR Clerk |');
    expect(out.markdown).toContain('| CFO |');
    expect(out.markdown).toContain('| Sales Manager |');
  });

  it('case-insensitive dedup between sources', () => {
    const out = generateTrainingMatrix({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x',
      standardRoleCustomization: 'ap clerk: extra perms',
    });
    // AP Clerk appears in both the coverage table AND the hours table —
    // 2 occurrences is the correct dedup'd count (one per table). 3+
    // would mean dedup is broken.
    expect((out.markdown.match(/\| AP Clerk \|/g) ?? []).length).toBe(2);
  });

  it('AP Clerk row has ✓ Required for P2P (per family coverage)', () => {
    const out = generateTrainingMatrix({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x',
    });
    const lines = out.markdown.split('\n');
    const apRow = lines.find((l) => l.startsWith('| AP Clerk '));
    expect(apRow).toBeDefined();
    expect(apRow!).toContain('✓ Required');
  });

  it('CFO row has ✓ Required for R2R + ✓ Required for Reports column', () => {
    const out = generateTrainingMatrix({
      clientName: 'Atlas',
      trainingPerRole: 'CFO: x',
    });
    const lines = out.markdown.split('\n');
    const cfoRow = lines.find((l) => l.startsWith('| CFO '));
    expect(cfoRow).toBeDefined();
    expect(cfoRow!).toContain('✓ Required');
  });

  it('Total hours table populates per family', () => {
    const out = generateTrainingMatrix({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x\nCFO: y',
    });
    expect(out.markdown).toMatch(/\| AP Clerk \| 4h \|/);
    expect(out.markdown).toMatch(/\| CFO \| 6h \|/);
  });

  it('shows placeholder when no roles captured', () => {
    const out = generateTrainingMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_(no roles captured)_');
  });
});

describe('Pack U — trainingMatrixGenerator: workstream column filtering', () => {
  it('renders ALL workstream columns when no in-scope flag is provided', () => {
    const out = generateTrainingMatrix({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x',
    });
    // Markdown tables use single pipes between cells, so we match by
    // ordered substring presence rather than `\| X \|.*\| Y \|` (which
    // would require double pipes between cells).
    expect(out.markdown).toMatch(/R2R.*P2P.*O2C.*Inventory.*MFG.*Returns.*CRM.*HR.*IT/);
  });

  it('filters columns to only in-scope when flags provided', () => {
    const out = generateTrainingMatrix({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x',
      r2rInScope: true,
      p2pInScope: true,
    });
    // Only R2R + P2P + Custom Records + Reports should appear in header.
    expect(out.markdown).toMatch(/\| Role \| R2R \| P2P \| Custom Records \| Reports \|/);
  });
});

describe('Pack U — trainingMatrixGenerator: cross-references', () => {
  it('cross-refs per-role guide path + Quick_Reference_Cards', () => {
    const out = generateTrainingMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Training/<Role>_Training_Guide.md');
    expect(out.markdown).toContain('Documentation/Training/Quick_Reference_Cards/');
  });

  it('cross-refs Training_Schedule + Sign_Off_Matrix', () => {
    const out = generateTrainingMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Training_Schedule.md');
    expect(out.markdown).toContain('Documentation/Sign_Off_Matrix.md');
  });
});
