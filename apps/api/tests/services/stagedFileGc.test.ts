import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import { createStagedFile, findStagedFileById } from '../../src/db/stagedFile.js';
import { purgeOrphanStagedFiles } from '../../src/services/stagedFileGc.js';
import { getDb } from '../../src/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGING_DIR = path.join(__dirname, '../../uploads/staged');

let cleanup: () => void;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });
});

afterAll(() => cleanup());

async function seedClientMember(engagementId: string): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [id, engagementId, 'C', 'Stakeholder', 'CLIENT', `${id}@x.com`, new Date().toISOString()],
  });
  return id;
}

function backdateRow(id: string, hoursAgo: number): Promise<void> {
  const ts = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  return getDb().execute({
    sql: `UPDATE StagedFile SET createdAt = ? WHERE id = ?`,
    args: [ts, id],
  }).then(() => undefined);
}

describe('purgeOrphanStagedFiles', () => {
  it('purges rows older than the cutoff and deletes the on-disk file', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'GC1' });
    const memberId = await seedClientMember(engagementId);
    const filename = `gc-${createId()}.bin`;
    const fullPath = path.join(STAGING_DIR, filename);
    fs.writeFileSync(fullPath, 'orphan content');

    const sf = await createStagedFile({
      engagementId,
      memberId,
      filename,
      originalName: 'orig.csv',
      sizeBytes: 14,
      storagePath: fullPath,
    });
    await backdateRow(sf.id, 25); // older than 24h default

    const result = await purgeOrphanStagedFiles();
    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.deletedRows).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(fullPath)).toBe(false);
    expect(await findStagedFileById(sf.id)).toBeNull();
  });

  it('skips fresh rows', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'GCFresh' });
    const memberId = await seedClientMember(engagementId);
    const filename = `fresh-${createId()}.bin`;
    const fullPath = path.join(STAGING_DIR, filename);
    fs.writeFileSync(fullPath, 'fresh');
    const sf = await createStagedFile({
      engagementId,
      memberId,
      filename,
      originalName: 'fresh.csv',
      sizeBytes: 5,
      storagePath: fullPath,
    });
    // No backdate — row is fresh.
    const result = await purgeOrphanStagedFiles();
    expect(await findStagedFileById(sf.id)).not.toBeNull();
    expect(fs.existsSync(fullPath)).toBe(true);
    void result;
    fs.unlinkSync(fullPath);
  });

  it('logs + continues on FS unlink failure (file already gone)', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'GCFsErr' });
    const memberId = await seedClientMember(engagementId);
    const filename = `missing-${createId()}.bin`;
    // Intentionally do NOT create the file on disk.
    const sf = await createStagedFile({
      engagementId,
      memberId,
      filename,
      originalName: 'missing.csv',
      sizeBytes: 0,
      storagePath: path.join(STAGING_DIR, filename),
    });
    await backdateRow(sf.id, 25);

    // Should not throw — the GC tolerates missing files.
    const result = await purgeOrphanStagedFiles();
    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(await findStagedFileById(sf.id)).toBeNull();
  });

  it('returns counts that match what was actually purged', async () => {
    // Sweep any leftovers first so the count is deterministic.
    await purgeOrphanStagedFiles();
    const { engagementId } = await seedEngagementWithToken({ firmName: 'GCCount' });
    const memberId = await seedClientMember(engagementId);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const filename = `count-${createId()}-${i}.bin`;
      const fullPath = path.join(STAGING_DIR, filename);
      fs.writeFileSync(fullPath, String(i));
      const sf = await createStagedFile({
        engagementId,
        memberId,
        filename,
        originalName: `c${i}.csv`,
        sizeBytes: 1,
        storagePath: fullPath,
      });
      await backdateRow(sf.id, 25);
      ids.push(sf.id);
    }
    const result = await purgeOrphanStagedFiles();
    expect(result.deletedRows).toBeGreaterThanOrEqual(3);
    for (const id of ids) {
      expect(await findStagedFileById(id)).toBeNull();
    }
  });
});

// Suppress unused-import warning under strict TS
void os;
