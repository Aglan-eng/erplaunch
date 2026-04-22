import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import { getDb } from '../../src/db/index.js';
import {
  createPortalMagicLink,
  findActivePortalMagicLink,
  recordPortalMagicLinkAttempt,
  consumePortalMagicLink,
  purgeExpiredPortalMagicLinks,
} from '../../src/db/portalMagicLink.js';

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
    args: [id, engagementId, 'Client', 'Stakeholder', 'CLIENT', email, new Date().toISOString()],
  });
  return id;
}

describe('portalMagicLink: create + find', () => {
  it('creates a row and returns its id', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);
    const row = await createPortalMagicLink({
      engagementId,
      memberId,
      codeHash: 'bcrypt$hash$here',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      maxAttempts: 5,
    });
    expect(row.id).toBeTruthy();
    expect(row.attemptCount).toBe(0);
    expect(row.consumedAt).toBeNull();
  });

  it('findActivePortalMagicLink returns the most-recent unexpired unconsumed link for a member', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'find@b.com');
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

    const first = await createPortalMagicLink({ engagementId, memberId, codeHash: 'h1', expiresAt, maxAttempts: 5 });
    await new Promise((r) => setTimeout(r, 10));
    const second = await createPortalMagicLink({ engagementId, memberId, codeHash: 'h2', expiresAt, maxAttempts: 5 });

    const active = await findActivePortalMagicLink(memberId);
    expect(active).not.toBeNull();
    expect(active!.id).toBe(second.id);
    expect(first.id).not.toBe(second.id);
  });

  it('returns null when no active link exists', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'none@b.com');
    expect(await findActivePortalMagicLink(memberId)).toBeNull();
  });

  it('does not return expired links', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'expired@b.com');
    await createPortalMagicLink({
      engagementId,
      memberId,
      codeHash: 'h',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      maxAttempts: 5,
    });
    expect(await findActivePortalMagicLink(memberId)).toBeNull();
  });

  it('does not return consumed links', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'consumed@b.com');
    const link = await createPortalMagicLink({
      engagementId,
      memberId,
      codeHash: 'h',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      maxAttempts: 5,
    });
    await consumePortalMagicLink(link.id);
    expect(await findActivePortalMagicLink(memberId)).toBeNull();
  });
});

describe('portalMagicLink: attempt tracking', () => {
  it('recordPortalMagicLinkAttempt increments attemptCount and returns new count', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'attempts@b.com');
    const link = await createPortalMagicLink({
      engagementId,
      memberId,
      codeHash: 'h',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      maxAttempts: 5,
    });
    const after1 = await recordPortalMagicLinkAttempt(link.id);
    expect(after1).toBe(1);
    const after2 = await recordPortalMagicLinkAttempt(link.id);
    expect(after2).toBe(2);
  });
});

describe('portalMagicLink: purge', () => {
  it('deletes expired rows and keeps active ones', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'purge@b.com');
    const past = new Date(Date.now() - 2 * 86400_000).toISOString();
    const future = new Date(Date.now() + 10 * 60_000).toISOString();

    await createPortalMagicLink({ engagementId, memberId, codeHash: 'h', expiresAt: past, maxAttempts: 5 });
    const keeper = await createPortalMagicLink({ engagementId, memberId, codeHash: 'h2', expiresAt: future, maxAttempts: 5 });

    const deleted = await purgeExpiredPortalMagicLinks();
    expect(deleted).toBeGreaterThanOrEqual(1);
    const active = await findActivePortalMagicLink(memberId);
    expect(active?.id).toBe(keeper.id);
  });
});
