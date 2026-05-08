/**
 * Phase 46.4 — DB layer tests for SOW version tracking.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  getDb,
  nextSowVersion,
  recordSowVersion,
  listSowVersionsByEngagement,
  findLatestSowVersion,
  setSowSignedFileUrl,
} from '../../src/db/index.js';

let cleanup: () => void;

async function seedFirmEngagement(): Promise<{ firmId: string; engagementId: string }> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'SOW Firm', `sow-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Acme Co', 'PROSPECT', now, now],
  });
  return { firmId, engagementId };
}

async function seedJob(engagementId: string): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO GenerationJob (id, engagementId, type) VALUES (?,?,?)`,
    args: [id, engagementId, 'SOW'],
  });
  return id;
}

beforeAll(async () => {
  ({ cleanup } = await setupTestDb());
});
afterAll(() => {
  cleanup();
});
beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM EngagementSowVersion`);
  await db.execute(`DELETE FROM GenerationJob`);
  await db.execute(`DELETE FROM LicenseProfile`);
  await db.execute(`DELETE FROM BusinessProfile`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM Firm`);
});

describe('nextSowVersion', () => {
  it('returns 1 for an engagement with no versions yet', async () => {
    const f = await seedFirmEngagement();
    expect(await nextSowVersion(f.engagementId)).toBe(1);
  });

  it('returns N+1 after recording N versions', async () => {
    const f = await seedFirmEngagement();
    for (let v = 1; v <= 3; v++) {
      const jobId = await seedJob(f.engagementId);
      await recordSowVersion({ engagementId: f.engagementId, jobId, version: v });
    }
    expect(await nextSowVersion(f.engagementId)).toBe(4);
  });

  it('is independent per engagement', async () => {
    const a = await seedFirmEngagement();
    const b = await seedFirmEngagement();
    const job = await seedJob(a.engagementId);
    await recordSowVersion({ engagementId: a.engagementId, jobId: job, version: 1 });
    expect(await nextSowVersion(b.engagementId)).toBe(1);
  });
});

describe('recordSowVersion + listSowVersionsByEngagement', () => {
  it('persists the supersedes chain', async () => {
    const f = await seedFirmEngagement();
    const jobs = [await seedJob(f.engagementId), await seedJob(f.engagementId)];
    await recordSowVersion({ engagementId: f.engagementId, jobId: jobs[0], version: 1 });
    await recordSowVersion({
      engagementId: f.engagementId,
      jobId: jobs[1],
      version: 2,
      supersedesVersion: 1,
    });
    const list = await listSowVersionsByEngagement(f.engagementId);
    expect(list).toHaveLength(2);
    // newest first
    expect(list[0].version).toBe(2);
    expect(list[0].supersedesVersion).toBe(1);
    expect(list[1].version).toBe(1);
    expect(list[1].supersedesVersion).toBeNull();
  });

  it('rejects duplicate version numbers per engagement', async () => {
    const f = await seedFirmEngagement();
    const jobA = await seedJob(f.engagementId);
    const jobB = await seedJob(f.engagementId);
    await recordSowVersion({ engagementId: f.engagementId, jobId: jobA, version: 1 });
    await expect(
      recordSowVersion({ engagementId: f.engagementId, jobId: jobB, version: 1 }),
    ).rejects.toBeTruthy();
  });
});

describe('findLatestSowVersion', () => {
  it('returns null when no versions exist', async () => {
    const f = await seedFirmEngagement();
    expect(await findLatestSowVersion(f.engagementId)).toBeNull();
  });

  it('returns the highest-version row', async () => {
    const f = await seedFirmEngagement();
    for (const v of [1, 2, 3]) {
      const jobId = await seedJob(f.engagementId);
      await recordSowVersion({ engagementId: f.engagementId, jobId, version: v });
    }
    const latest = await findLatestSowVersion(f.engagementId);
    expect(latest?.version).toBe(3);
  });
});

describe('setSowSignedFileUrl', () => {
  it('stamps the URL onto the version row', async () => {
    const f = await seedFirmEngagement();
    const jobId = await seedJob(f.engagementId);
    const v = await recordSowVersion({ engagementId: f.engagementId, jobId, version: 1 });
    expect(v.signedFileUrl).toBeNull();
    const updated = await setSowSignedFileUrl(v.id, '/uploads/signed/v1.pdf');
    expect(updated?.signedFileUrl).toBe('/uploads/signed/v1.pdf');
  });
});
