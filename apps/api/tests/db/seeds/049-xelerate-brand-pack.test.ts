/**
 * Phase 49.5 — Xelerate Brand Pack seed tests.
 *
 * Pin three behaviours:
 *   - SKIPPED_NO_FIRM when no firm with slug "xelerate" exists
 *   - SEEDED on first run with a Xelerate firm in place; templateVersion bumps
 *   - SKIPPED_VERSIONED on second run when templateVersion > 1
 *   - The seeded firm has a Xelerate-flavoured tagline (not platform default)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../../_helpers/testDb.js';
import { seedXelerateBrandPack } from '../../../src/db/seeds/049-xelerate-brand-pack.js';
import { getDb, getFirmTemplate } from '../../../src/db/index.js';

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

  it('seeds a Xelerate firm on first run and bumps templateVersion', async () => {
    const firmId = await seedXelerateFirm();
    const r = await seedXelerateBrandPack();
    expect(r.status).toBe('SEEDED');
    expect(r.firmId).toBe(firmId);
    expect(r.templateVersion).toBeGreaterThanOrEqual(2);

    const t = await getFirmTemplate(firmId);
    expect(t?.tagline).toContain('Outcome-first ERP delivery');
    expect(t?.themeAccentColor).toBe('#1a8754');
    expect(t?.themeHeadlineCase).toBe('sentence');
    // Methodology has at least the 3 Frame/Build/Land steps from the
    // canonical pack — pin the structural shape so a future pack
    // edit doesn't accidentally drop a section.
    expect(t?.methodology).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Frame' }),
        expect.objectContaining({ title: 'Build' }),
        expect.objectContaining({ title: 'Land' }),
      ]),
    );
    // Industry verticals carry over with the spec'd attributes.
    expect(t?.industryVerticals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Retail and Wholesale Distribution' }),
      ]),
    );
  });

  it('skips on second run because templateVersion > 1', async () => {
    await seedXelerateFirm();
    const first = await seedXelerateBrandPack();
    expect(first.status).toBe('SEEDED');
    const second = await seedXelerateBrandPack();
    expect(second.status).toBe('SKIPPED_VERSIONED');
    expect(second.templateVersion).toBe(first.templateVersion);
  });
});
