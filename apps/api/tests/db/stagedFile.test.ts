import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import {
  createStagedFile,
  findStagedFileById,
  findStagedFilesOlderThan,
  deleteStagedFileById,
  findDataFileBySourceSubmissionId,
} from '../../src/db/stagedFile.js';
import { createDataFile, getDb } from '../../src/db/index.js';

let cleanup: () => void;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
});

async function seedClientMember(engagementId: string): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [id, engagementId, 'Client', 'Stakeholder', 'CLIENT', `${id}@example.com`, new Date().toISOString()],
  });
  return id;
}

async function seedDataCollectionItem(engagementId: string): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO DataCollectionItem (id, engagementId, templateId, name, category, status, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [id, engagementId, 'tpl-test', 'Test Item', 'GL', 'PENDING', new Date().toISOString(), new Date().toISOString()],
  });
  return id;
}

describe('stagedFile DB layer', () => {
  it('createStagedFile inserts a row with the provided fields', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'StagedCreate' });
    const memberId = await seedClientMember(engagementId);
    const itemId = await seedDataCollectionItem(engagementId);

    const sf = await createStagedFile({
      engagementId,
      memberId,
      dataCollectionItemId: itemId,
      filename: 'foo.bin',
      originalName: 'real.csv',
      mimeType: 'text/csv',
      sizeBytes: 1234,
      storagePath: '/tmp/foo.bin',
    });

    expect(sf.id).toBeTruthy();
    expect(sf.engagementId).toBe(engagementId);
    expect(sf.memberId).toBe(memberId);
    expect(sf.dataCollectionItemId).toBe(itemId);
    expect(sf.filename).toBe('foo.bin');
    expect(sf.originalName).toBe('real.csv');
    expect(sf.mimeType).toBe('text/csv');
    expect(sf.sizeBytes).toBe(1234);
    expect(sf.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('createStagedFile accepts a null dataCollectionItemId', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'StagedNullItem' });
    const memberId = await seedClientMember(engagementId);

    const sf = await createStagedFile({
      engagementId,
      memberId,
      dataCollectionItemId: null,
      filename: 'x.bin',
      originalName: 'x.csv',
      sizeBytes: 0,
      storagePath: '/tmp/x.bin',
    });
    expect(sf.dataCollectionItemId).toBeNull();
  });

  it('findStagedFileById returns null for unknown id', async () => {
    const found = await findStagedFileById('does-not-exist');
    expect(found).toBeNull();
  });

  it('findStagedFileById returns the row for known id', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'StagedFind' });
    const memberId = await seedClientMember(engagementId);
    const sf = await createStagedFile({
      engagementId,
      memberId,
      filename: 'a.bin',
      originalName: 'a.csv',
      sizeBytes: 10,
      storagePath: '/tmp/a.bin',
    });
    const found = await findStagedFileById(sf.id);
    expect(found?.id).toBe(sf.id);
  });

  it('deleteStagedFileById removes the row + returns true', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'StagedDelete' });
    const memberId = await seedClientMember(engagementId);
    const sf = await createStagedFile({
      engagementId,
      memberId,
      filename: 'd.bin',
      originalName: 'd.csv',
      sizeBytes: 5,
      storagePath: '/tmp/d.bin',
    });
    const ok = await deleteStagedFileById(sf.id);
    expect(ok).toBe(true);
    expect(await findStagedFileById(sf.id)).toBeNull();

    // Second delete returns false (idempotent at the boolean level).
    const ok2 = await deleteStagedFileById(sf.id);
    expect(ok2).toBe(false);
  });

  it('findStagedFilesOlderThan returns rows past the cutoff', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'StagedOlderThan' });
    const memberId = await seedClientMember(engagementId);

    // Insert a row with manually-overridden createdAt 2 days ago.
    const old = await createStagedFile({
      engagementId,
      memberId,
      filename: 'old.bin',
      originalName: 'old.csv',
      sizeBytes: 1,
      storagePath: '/tmp/old.bin',
    });
    const fresh = await createStagedFile({
      engagementId,
      memberId,
      filename: 'fresh.bin',
      originalName: 'fresh.csv',
      sizeBytes: 1,
      storagePath: '/tmp/fresh.bin',
    });
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();
    const db = getDb();
    await db.execute({
      sql: `UPDATE StagedFile SET createdAt = ? WHERE id = ?`,
      args: [twoDaysAgo, old.id],
    });

    const cutoff = new Date(Date.now() - 86400_000).toISOString(); // 1 day ago
    const stale = await findStagedFilesOlderThan(cutoff);
    expect(stale.find((r) => r.id === old.id)).toBeTruthy();
    expect(stale.find((r) => r.id === fresh.id)).toBeFalsy();
  });

  it('findDataFileBySourceSubmissionId returns the promoted DataFile', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'PromotedFind' });
    const memberId = await seedClientMember(engagementId);
    const itemId = await seedDataCollectionItem(engagementId);
    void memberId;

    const submissionId = 'fake-sub-id';
    await createDataFile({
      engagementId,
      dataCollectionItemId: itemId,
      filename: 'promoted.csv',
      originalName: 'real.csv',
      mimeType: 'text/csv',
      sizeBytes: 100,
      uploadedBy: 'test',
      sourceSubmissionId: submissionId,
    });

    const found = await findDataFileBySourceSubmissionId(submissionId);
    expect(found).toBeTruthy();
    expect((found as Record<string, unknown>).filename).toBe('promoted.csv');

    const missing = await findDataFileBySourceSubmissionId('no-such');
    expect(missing).toBeNull();
  });
});
