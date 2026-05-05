import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import {
  createPortalSession,
  findPortalSessionByJtiHash,
  touchPortalSession,
  revokePortalSession,
  revokeAllSessionsForMember,
  purgeExpiredPortalSessions,
} from '../../src/db/portalSession.js';
import { getDb } from '../../src/db/index.js';

let cleanup: () => void;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
});

async function seedMember(engagementId: string, email = 'client@example.com') {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [id, engagementId, 'Client User', 'Stakeholder', 'CLIENT', email, new Date().toISOString()],
  });
  return id;
}

describe('portalSession: createPortalSession', () => {
  it('creates a row and returns the inserted session', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);

    const session = await createPortalSession({
      engagementId,
      memberId,
      jtiHash: 'hash-' + createId(),
      expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      userAgent: 'vitest',
      ipHash: 'iphash',
    });

    expect(session.id).toBeTruthy();
    expect(session.engagementId).toBe(engagementId);
    expect(session.memberId).toBe(memberId);
    expect(session.revokedAt).toBeNull();
  });
});

describe('portalSession: findPortalSessionByJtiHash', () => {
  it('returns null for unknown jti', async () => {
    const found = await findPortalSessionByJtiHash('nope-does-not-exist');
    expect(found).toBeNull();
  });

  it('returns the session row for a known jti', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'a@b.com');
    const jtiHash = 'hash-' + createId();
    await createPortalSession({
      engagementId,
      memberId,
      jtiHash,
      expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });

    const found = await findPortalSessionByJtiHash(jtiHash);
    expect(found).not.toBeNull();
    expect(found!.jtiHash).toBe(jtiHash);
  });
});

describe('portalSession: revokePortalSession', () => {
  it('sets revokedAt on the row', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'r@b.com');
    const jtiHash = 'hash-' + createId();
    const s = await createPortalSession({
      engagementId,
      memberId,
      jtiHash,
      expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });

    await revokePortalSession(s.id);
    const after = await findPortalSessionByJtiHash(jtiHash);
    expect(after!.revokedAt).not.toBeNull();
  });
});

describe('portalSession: touchPortalSession', () => {
  it('updates expiresAt and lastUsedAt', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 't@b.com');
    const jtiHash = 'hash-' + createId();
    const oldExpiry = new Date(Date.now() + 86400_000).toISOString();
    const s = await createPortalSession({
      engagementId,
      memberId,
      jtiHash,
      expiresAt: oldExpiry,
    });

    const newExpiry = new Date(Date.now() + 14 * 86400_000).toISOString();
    await touchPortalSession(s.id, newExpiry);

    const after = await findPortalSessionByJtiHash(jtiHash);
    // expiresAt is the deterministic signal that touch ran — lastUsedAt is
    // populated from SQLite's `datetime('now')` (second-precision), so a
    // back-to-back create+touch in the same wall-clock second leaves the two
    // values byte-equal. Phase 33 dropped the lastUsedAt assertion to kill
    // the resulting flake; expiresAt advancement is the load-bearing check.
    expect(after!.expiresAt).toBe(newExpiry);
  });
});

describe('portalSession: revokeAllSessionsForMember', () => {
  it('revokes every active session for the given member', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'multi@b.com');
    const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();

    const j1 = 'hash-' + createId();
    const j2 = 'hash-' + createId();
    await createPortalSession({ engagementId, memberId, jtiHash: j1, expiresAt });
    await createPortalSession({ engagementId, memberId, jtiHash: j2, expiresAt });

    await revokeAllSessionsForMember(memberId);

    const a = await findPortalSessionByJtiHash(j1);
    const b = await findPortalSessionByJtiHash(j2);
    expect(a!.revokedAt).not.toBeNull();
    expect(b!.revokedAt).not.toBeNull();
  });
});

describe('portalSession: purgeExpiredPortalSessions', () => {
  it('deletes rows with expiresAt < now', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'purge@b.com');
    const pastExpiry = new Date(Date.now() - 10 * 86400_000).toISOString();
    const futureExpiry = new Date(Date.now() + 7 * 86400_000).toISOString();

    const past = 'hash-past-' + createId();
    const future = 'hash-future-' + createId();
    await createPortalSession({ engagementId, memberId, jtiHash: past, expiresAt: pastExpiry });
    await createPortalSession({ engagementId, memberId, jtiHash: future, expiresAt: futureExpiry });

    const deleted = await purgeExpiredPortalSessions();
    expect(deleted).toBeGreaterThanOrEqual(1);

    expect(await findPortalSessionByJtiHash(past)).toBeNull();
    expect(await findPortalSessionByJtiHash(future)).not.toBeNull();
  });
});
