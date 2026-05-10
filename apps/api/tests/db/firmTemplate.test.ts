/**
 * Phase 49.1 — firmTemplate DB layer tests.
 *
 * Covers:
 *   - getFirmTemplate returns null for unknown firms
 *   - getFirmTemplate returns EMPTY_FIRM_TEMPLATE shape for fresh firms
 *   - updateFirmTemplate writes scalar + JSON fields, bumps templateVersion
 *   - templateVersion is monotonic and survives partial updates
 *   - structured fields round-trip through JSON.stringify safely
 *   - corrupt JSON in storage → empty array (defensive read path)
 *   - updateFirmTemplate({}) is a no-op (no version bump)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  getFirmTemplate,
  updateFirmTemplate,
  EMPTY_FIRM_TEMPLATE,
  getDb,
} from '../../src/db/index.js';

let cleanup: () => void;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.execute('DELETE FROM Firm');
});

async function seedFirm(): Promise<string> {
  const db = getDb();
  const firmId = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Template Test', `tmpl-${createId()}`, 'STARTER', new Date().toISOString()],
  });
  return firmId;
}

describe('getFirmTemplate', () => {
  it('returns null for an unknown firm', async () => {
    const r = await getFirmTemplate('does-not-exist');
    expect(r).toBeNull();
  });

  it('returns the empty-template shape for a fresh firm row', async () => {
    const firmId = await seedFirm();
    const r = await getFirmTemplate(firmId);
    expect(r).not.toBeNull();
    // Every JSON-array field is an empty array, every text field is null,
    // templateVersion defaults to 1.
    expect(r).toMatchObject({
      tagline: null,
      methodology: [],
      roadmap: [],
      proposalStructure: [],
      pricingTemplate: [],
      industryVerticals: [],
      ctaOptions: [],
      voiceGuide: null,
      themeFontFamily: null,
      themeHeadlineCase: null,
      themeAccentColor: null,
      templateVersion: 1,
    });
  });

  it('parses corrupt JSON columns to empty arrays without throwing', async () => {
    const firmId = await seedFirm();
    const db = getDb();
    await db.execute({
      sql: `UPDATE Firm SET methodology = ?, roadmap = ? WHERE id = ?`,
      args: ['{not valid json', '"a string, not an array"', firmId],
    });
    const r = await getFirmTemplate(firmId);
    expect(r?.methodology).toEqual([]);
    expect(r?.roadmap).toEqual([]);
  });
});

describe('updateFirmTemplate', () => {
  it('writes scalar fields and bumps templateVersion', async () => {
    const firmId = await seedFirm();
    const r = await updateFirmTemplate(firmId, {
      tagline: 'Outcome-first ERP delivery',
      voiceGuide: 'Sentence case headlines.',
    });
    expect(r?.tagline).toBe('Outcome-first ERP delivery');
    expect(r?.voiceGuide).toBe('Sentence case headlines.');
    expect(r?.templateVersion).toBe(2);
  });

  it('writes structured JSON fields and round-trips them', async () => {
    const firmId = await seedFirm();
    const methodology = [
      { step: 1, title: 'Discover', body: 'Workshop the operating model.' },
      { step: 2, title: 'Design', body: 'Lock the to-be process.' },
    ];
    const pricing = [
      { sku: 'IMPL-001', description: 'Implementation', annual: 75000 },
    ];
    await updateFirmTemplate(firmId, {
      methodology,
      pricingTemplate: pricing,
    });
    const r = await getFirmTemplate(firmId);
    expect(r?.methodology).toEqual(methodology);
    expect(r?.pricingTemplate).toEqual(pricing);
  });

  it('treats undefined fields as untouched and explicit null as clear', async () => {
    const firmId = await seedFirm();
    await updateFirmTemplate(firmId, {
      tagline: 'Original',
      whyUs: 'Original reasons',
    });
    // Patch only one field — the other should be preserved.
    await updateFirmTemplate(firmId, { tagline: 'Updated' });
    let r = await getFirmTemplate(firmId);
    expect(r?.tagline).toBe('Updated');
    expect(r?.whyUs).toBe('Original reasons');
    // Explicit null clears.
    await updateFirmTemplate(firmId, { whyUs: null });
    r = await getFirmTemplate(firmId);
    expect(r?.whyUs).toBeNull();
  });

  it('is a no-op when patch is empty — does not bump templateVersion', async () => {
    const firmId = await seedFirm();
    await updateFirmTemplate(firmId, { tagline: 'first' });
    const before = await getFirmTemplate(firmId);
    expect(before?.templateVersion).toBe(2);
    await updateFirmTemplate(firmId, {});
    const after = await getFirmTemplate(firmId);
    expect(after?.templateVersion).toBe(2);
  });

  it('persists themeHeadlineCase only for valid values, falls back to null otherwise', async () => {
    const firmId = await seedFirm();
    await updateFirmTemplate(firmId, { themeHeadlineCase: 'sentence' });
    expect((await getFirmTemplate(firmId))?.themeHeadlineCase).toBe('sentence');
    await updateFirmTemplate(firmId, { themeHeadlineCase: 'title' });
    expect((await getFirmTemplate(firmId))?.themeHeadlineCase).toBe('title');
    // A bogus value written directly to the DB is filtered to null on read.
    const db = getDb();
    await db.execute({
      sql: `UPDATE Firm SET themeHeadlineCase = ? WHERE id = ?`,
      args: ['BANANA', firmId],
    });
    expect((await getFirmTemplate(firmId))?.themeHeadlineCase).toBeNull();
  });

  it('templateVersion is monotonic across many partial updates', async () => {
    const firmId = await seedFirm();
    let v = (await getFirmTemplate(firmId))?.templateVersion ?? 0;
    expect(v).toBe(1);
    for (let i = 0; i < 5; i++) {
      await updateFirmTemplate(firmId, { tagline: `v${i + 1}` });
      const next = (await getFirmTemplate(firmId))?.templateVersion ?? 0;
      expect(next).toBe(v + 1);
      v = next;
    }
    expect(v).toBe(6);
  });
});

describe('EMPTY_FIRM_TEMPLATE constant', () => {
  it('matches the shape returned for a fresh firm', () => {
    expect(EMPTY_FIRM_TEMPLATE.methodology).toEqual([]);
    expect(EMPTY_FIRM_TEMPLATE.tagline).toBeNull();
    expect(EMPTY_FIRM_TEMPLATE.templateVersion).toBe(1);
  });
});
