/**
 * Phase 49.5 + 50.8 — Xelerate Brand Pack seed tests.
 *
 * Phase 50.8 switched idempotency from "skip when templateVersion > 1"
 * to "skip when seed-file content hash matches the stored hash". This
 * makes the seed file the source of truth: an author edit + redeploy
 * picks up the change automatically, while a no-op re-run is a real
 * no-op (no templateVersion bump).
 *
 * Pins:
 *   - SKIPPED_NO_FIRM when no xelerate slug exists
 *   - SEEDED on first run; stored hash matches the file's hash
 *   - SKIPPED_HASH_MATCH on second run with unchanged file
 *   - Real Xelerate content lands (Business Enabling Technologies
 *     tagline + United OFOQ heritage + 5 industry verticals + the
 *     specific pricing SKUs)
 *   - Editing the file → re-running picks up the change and bumps
 *     templateVersion
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../../_helpers/testDb.js';
import { seedXelerateBrandPack } from '../../../src/db/seeds/049-xelerate-brand-pack.js';
import { getDb, getFirmTemplate, updateFirmTemplate } from '../../../src/db/index.js';

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
  await db.execute('DELETE FROM CustomTemplate');
  await db.execute('DELETE FROM FirmRole');
  await db.execute('DELETE FROM EngagementRole');
  await db.execute('DELETE FROM User');
  await db.execute('DELETE FROM Firm');
});

async function seedXelerateFirm(): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [id, 'Xelerate', 'xelerate', 'STARTER', new Date().toISOString()],
  });
  return id;
}

describe('seedXelerateBrandPack', () => {
  it('returns SKIPPED_NO_FIRM when no xelerate firm exists', async () => {
    const r = await seedXelerateBrandPack();
    expect(r.status).toBe('SKIPPED_NO_FIRM');
  });

  it('seeds a Xelerate firm on first run and stores the content hash', async () => {
    const firmId = await seedXelerateFirm();
    const r = await seedXelerateBrandPack();
    expect(r.status).toBe('SEEDED');
    expect(r.firmId).toBe(firmId);
    expect(r.templateVersion).toBeGreaterThanOrEqual(2);
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);

    // Hash landed on the Firm row.
    const db = getDb();
    const row = await db.execute({
      sql: `SELECT brandPackContentHash FROM Firm WHERE id = ?`,
      args: [firmId],
    });
    const stored = (row.rows[0] as { brandPackContentHash?: string | null } | undefined)
      ?.brandPackContentHash;
    expect(stored).toBe(r.contentHash);
  });

  it('skips on second run with unchanged file (hash match)', async () => {
    await seedXelerateFirm();
    const first = await seedXelerateBrandPack();
    expect(first.status).toBe('SEEDED');
    const second = await seedXelerateBrandPack();
    expect(second.status).toBe('SKIPPED_HASH_MATCH');
    expect(second.contentHash).toBe(first.contentHash);
  });

  it('re-seeds when the stored hash has been cleared (simulates content change)', async () => {
    const firmId = await seedXelerateFirm();
    await seedXelerateBrandPack();
    // Clear the stored hash to simulate "the seed file changed since
    // last deploy" without having to actually edit the file on disk.
    const db = getDb();
    await db.execute({
      sql: `UPDATE Firm SET brandPackContentHash = NULL WHERE id = ?`,
      args: [firmId],
    });
    const r = await seedXelerateBrandPack();
    expect(r.status).toBe('SEEDED');
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lands the real Xelerate identity content (not the placeholder)', async () => {
    const firmId = await seedXelerateFirm();
    await seedXelerateBrandPack();
    const t = await getFirmTemplate(firmId);
    // Real tagline marker — the Phase 50.8 contract requires this
    // exact phrase to surface in firm voice.
    expect(t?.tagline).toContain('Business Enabling Technologies');
    expect(t?.tagline).toContain('Oracle NetSuite partner');
    expect(t?.tagline).toContain('MENA');
    // United OFOQ heritage in the company description.
    expect(t?.companyDescription).toContain('United OFOQ');
    expect(t?.companyDescription).toContain('INTILAQA');
    // The 5 industry verticals the spec calls out.
    const verticalNames = (t?.industryVerticals ?? []).map((v) => v.name);
    expect(verticalNames).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Poultry'),
        expect.stringContaining('Precious Metals'),
        expect.stringContaining('Professional Services'),
        expect.stringContaining('Pharma'),
        expect.stringContaining('Manufacturing'),
      ]),
    );
    // The specific pricing SKUs.
    const skus = (t?.pricingTemplate ?? []).map((p) => p.sku);
    expect(skus).toEqual(
      expect.arrayContaining([
        'NS-FIN-MM',
        'NS-USR-CSU',
        'NS-SBX-001',
        'XEL-IMPL-STD',
        'XEL-ORG-MS',
      ]),
    );
    // The CTAs the spec calls out by name.
    const ctaLabels = (t?.ctaOptions ?? []).map((c) => c.label);
    expect(ctaLabels.some((l) => l.includes('Strategy Session'))).toBe(true);
    expect(ctaLabels.length).toBeGreaterThanOrEqual(3);
    // Theme tokens match the real Xelerate brand palette.
    expect(t?.themeAccentColor).toBe('#1FAE5C');
    expect(t?.themeHeadlineCase).toBe('sentence');
  });

  it('does NOT contain the Phase 49.5 placeholder copy after seed', async () => {
    const firmId = await seedXelerateFirm();
    await seedXelerateBrandPack();
    const t = await getFirmTemplate(firmId);
    // The old placeholder tagline was "Outcome-first ERP delivery
    // for ambitious mid-market operators." — assert it's gone.
    expect(t?.tagline).not.toContain('Outcome-first ERP delivery for ambitious');
  });

  it('preserves firm hand-edits when the seed file is unchanged', async () => {
    const firmId = await seedXelerateFirm();
    await seedXelerateBrandPack();
    // Hand-edit the tagline via the same path the UI uses.
    await updateFirmTemplate(firmId, { tagline: 'Hand-edited override.' });
    // Re-running the seed with the same file content should NOT
    // clobber the edit (hash matches → skip).
    const r = await seedXelerateBrandPack();
    expect(r.status).toBe('SKIPPED_HASH_MATCH');
    const t = await getFirmTemplate(firmId);
    expect(t?.tagline).toBe('Hand-edited override.');
  });
});
