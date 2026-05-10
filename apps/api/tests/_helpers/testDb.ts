import path from 'path';
import os from 'os';
import fs from 'fs';
import { createId } from '@paralleldrive/cuid2';
import { initDb, getDb } from '../../src/db/index.js';

/**
 * Creates an ephemeral libSQL file DB for a single test suite.
 * Returns the path and a cleanup function. Sets DATABASE_URL so initDb()
 * picks up the temp file, then calls initDb() to run all CREATE/ALTER.
 *
 * Phase 48.6 — the libSQL teardown segfault that turned CI red on every
 * Phase 45+ commit is fixed at the vitest layer (`pool: 'forks'` in
 * apps/api/vitest.config.ts) rather than here. Each test file gets its
 * own subprocess, so libSQL native handles never accumulate inside a
 * single Node process and the OS reclaims them on subprocess exit.
 *
 * We deliberately do NOT call closeDb() in cleanup. Some routes fire
 * async background work (e.g. setImmediate(() => processJob(...)) on
 * generate) that outlives the test's afterAll — closing the client
 * synchronously would crash that work with "DB not initialised" after
 * the test reported pass. The forks pool handles the lifecycle for us.
 */
export async function setupTestDb() {
  const file = path.join(os.tmpdir(), `erplaunch-test-${createId()}.db`);
  process.env.DATABASE_URL = `file:${file}`;
  await initDb();
  return {
    file,
    client: getDb(),
    cleanup: () => {
      for (const suffix of ['', '-shm', '-wal']) {
        const p = `${file}${suffix}`;
        try { fs.unlinkSync(p); } catch { /* already gone */ }
      }
    },
  };
}

/**
 * Inserts a Firm + Engagement with a known portal token. Returns IDs for tests.
 */
export async function seedEngagementWithToken(args?: {
  firmName?: string;
  firmSlug?: string;
  clientName?: string;
  token?: string;
}) {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const tokenId = createId();
  const token = args?.token ?? `test-token-${createId()}`;
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, args?.firmName ?? 'Test Firm', args?.firmSlug ?? `test-firm-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, args?.clientName ?? 'Test Client', 'DISCOVERY', now, now],
  });
  await db.execute({
    sql: `INSERT INTO ClientPortalToken (id, engagementId, token, createdAt) VALUES (?,?,?,?)`,
    args: [tokenId, engagementId, token, now],
  });

  return { firmId, engagementId, token };
}
