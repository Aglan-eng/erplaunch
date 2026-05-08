/**
 * Phase 46.4 — pure tests for the SOW generator + PDF render.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSowSections,
  generateSowPdf,
  type SowInput,
} from '../../../src/services/generators/sowGenerator.js';

function baseInput(over: Partial<SowInput> = {}): SowInput {
  return {
    clientName: 'Acme Industries',
    clientLegalEntity: 'Acme Industries, Inc.',
    adaptorId: 'netsuite',
    adaptorName: 'NetSuite',
    firmName: 'ERPLaunch Partners',
    firmLegalEntity: 'ERPLaunch Partners LLC',
    modulesOfInterest: [
      { id: 'gl-ar-ap', label: 'General Ledger / AR / AP' },
      { id: 'inventory', label: 'Inventory' },
    ],
    estimatedUsers: 50,
    estimatedLocations: 3,
    geographyMultiEntity: 'single-country-multi-entity',
    totalAnnualLicense: 125_000,
    implementationServices: 100_000,
    totalFirstYear: 225_000,
    pricingPhases: [
      { label: 'Discovery', amount: 15_000 },
      { label: 'Configure', amount: 45_000 },
      { label: 'UAT', amount: 20_000 },
      { label: 'Go-Live', amount: 10_000 },
      { label: 'Hypercare', amount: 10_000 },
    ],
    validUntil: '2026-06-08',
    effectiveDate: '2026-06-15',
    estimatedDurationDays: 270,
    version: 1,
    supersedesVersion: null,
    preparedAt: '2026-05-08',
    preparedByName: 'Sales Lead',
    ...over,
  };
}

describe('buildSowSections — section structure', () => {
  it('emits the 14 canonical sections', () => {
    const sections = buildSowSections(baseInput());
    expect(sections.length).toBe(14);
    const headings = sections.map((s) => s.heading);
    expect(headings).toContain('1. Parties');
    expect(headings).toContain('3. Scope of Work');
    expect(headings).toContain('6. Pricing Schedule');
    expect(headings).toContain('14. Entire Agreement');
  });
});

describe('buildSowSections — content inputs', () => {
  it('uses the legal entity name when present, otherwise the display name', () => {
    const withEntity = buildSowSections(baseInput());
    expect(withEntity[0].body).toContain('Acme Industries, Inc.');
    expect(withEntity[0].body).toContain('ERPLaunch Partners LLC');
    const withoutEntity = buildSowSections(
      baseInput({ clientLegalEntity: null, firmLegalEntity: null }),
    );
    expect(withoutEntity[0].body).toContain('Acme Industries');
    expect(withoutEntity[0].body).toContain('ERPLaunch Partners');
  });

  it('lists every in-scope module', () => {
    const s = buildSowSections(baseInput());
    const scope = s.find((x) => x.heading === '3. Scope of Work');
    expect(scope?.body).toContain('General Ledger / AR / AP');
    expect(scope?.body).toContain('Inventory');
  });

  it('renders pricing phases verbatim', () => {
    const s = buildSowSections(baseInput());
    const pricing = s.find((x) => x.heading === '6. Pricing Schedule');
    expect(pricing?.body).toContain('$125,000');
    expect(pricing?.body).toContain('$100,000');
    expect(pricing?.body).toContain('Discovery: $15,000');
    expect(pricing?.body).toContain('Configure: $45,000');
  });

  it('computes the contract end date from effectiveDate + estimatedDurationDays', () => {
    const s = buildSowSections(baseInput()); // 2026-06-15 + 270d
    const timeline = s.find((x) => x.heading === '5. Timeline');
    expect(timeline?.body).toContain('2026-06-15');
    // Trust the calculator — 270 days after 2026-06-15 is 2027-03-12.
    expect(timeline?.body).toContain('2027-03-12');
  });

  it('mentions the supersedes chain only when a previous version exists', () => {
    const v1 = buildSowSections(baseInput());
    expect(v1.find((x) => x.heading === '14. Entire Agreement')?.body).not.toContain('supersedes version');
    const v2 = buildSowSections(baseInput({ version: 2, supersedesVersion: 1 }));
    expect(v2.find((x) => x.heading === '14. Entire Agreement')?.body).toContain('supersedes version 1');
  });

  it('singular/plural agreement on user + location counts', () => {
    const single = buildSowSections(
      baseInput({ estimatedUsers: 1, estimatedLocations: 1 }),
    );
    const recitals = single.find((x) => x.heading === '2. Recitals');
    expect(recitals?.body).toContain('1 location');
    expect(recitals?.body).toContain('1 user');
    expect(recitals?.body).not.toContain('1 locations');
    expect(recitals?.body).not.toContain('1 users');
  });
});

describe('generateSowPdf — actually produces a PDF', () => {
  it('returns a non-empty Buffer that starts with the PDF magic', async () => {
    const buf = await generateSowPdf(baseInput());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    // PDF magic bytes are %PDF-
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('produces a sized buffer (>3KB for our 14-section + signatures doc)', async () => {
    // pdfkit's content stream isn't trivially ASCII-searchable (text
    // is encoded with PDF operators + kerning), so we rely on size +
    // magic-byte verification rather than substring-matching the
    // bytes. The buildSowSections tests cover the content checks.
    const buf = await generateSowPdf(baseInput({ version: 7 }));
    expect(buf.length).toBeGreaterThan(3000);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
