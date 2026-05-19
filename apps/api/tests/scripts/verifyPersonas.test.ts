/**
 * Phase 52.9 — verify-personas script tests.
 *
 * Runs the verification logic against a seeded test firm and
 * asserts every persona assertion passes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { getDb } from '../../src/db/index.js';
import { seedLifecycleForFirm } from '../../scripts/seed-lifecycle.js';
import { verifyPersonasForFirm } from '../../scripts/verify-personas.js';

let cleanup: () => void;

async function seedFirmWithUsers(): Promise<string> {
  const db = getDb();
  const fid = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
    args: [fid, 'Persona Test', `pt-${fid}`, 'STARTER', new Date().toISOString()],
  });
  for (let i = 0; i < 3; i++) {
    const uid = createId();
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt)
            VALUES (?, ?, ?, ?, 'x', 'CONSULTANT', ?)`,
      args: [uid, fid, `${uid}@x.io`, `User ${i + 1}`, new Date().toISOString()],
    });
  }
  return fid;
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => cleanup());

describe('verifyPersonasForFirm', () => {
  it('passes every assertion against a freshly-seeded firm', async () => {
    const firmId = await seedFirmWithUsers();
    await seedLifecycleForFirm(firmId, { includeDeadEnds: true });
    const result = await verifyPersonasForFirm(firmId);
    const failed = result.assertions.filter((a) => !a.pass);
    if (failed.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        'Failed assertions:',
        failed.map((f) => `${f.persona} — ${f.name} (${f.detail})`).join('\n  '),
      );
    }
    expect(result.pass).toBe(true);
  });
});
