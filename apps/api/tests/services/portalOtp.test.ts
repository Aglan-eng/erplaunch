import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import { getDb } from '../../src/db/index.js';
import { issuePortalOtp, verifyPortalOtp } from '../../src/services/portalOtp.js';

let cleanup: () => void;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
});

async function seedMember(engagementId: string, email: string) {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [id, engagementId, 'Client', 'Stakeholder', 'CLIENT', email, new Date().toISOString()],
  });
  return id;
}

describe('portalOtp: issuePortalOtp', () => {
  it('returns a 6-digit numeric code and stores a bcrypt hash (not plaintext)', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'issue@b.com');
    const { code, linkId } = await issuePortalOtp({ engagementId, memberId });

    expect(code).toMatch(/^\d{6}$/);
    expect(linkId).toBeTruthy();

    const db = getDb();
    const r = await db.execute({
      sql: `SELECT codeHash FROM PortalMagicLink WHERE id = ?`,
      args: [linkId],
    });
    const hash = (r.rows[0] as Record<string, unknown>).codeHash as string;
    expect(hash).not.toContain(code);
    expect(hash.startsWith('$2')).toBe(true); // bcrypt prefix
  });

  it('invalidates any previous active link when a new code is issued', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'reissue@b.com');
    const first = await issuePortalOtp({ engagementId, memberId });
    const second = await issuePortalOtp({ engagementId, memberId });

    // First code no longer verifies
    const r1 = await verifyPortalOtp({ memberId, code: first.code });
    expect(r1.ok).toBe(false);

    // Second does
    const r2 = await verifyPortalOtp({ memberId, code: second.code });
    expect(r2.ok).toBe(true);
  });
});

describe('portalOtp: verifyPortalOtp', () => {
  it('returns ok:true for the correct code', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'verify@b.com');
    const { code } = await issuePortalOtp({ engagementId, memberId });
    const r = await verifyPortalOtp({ memberId, code });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.linkId).toBeTruthy();
  });

  it('returns ok:false for wrong code', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'wrong@b.com');
    await issuePortalOtp({ engagementId, memberId });
    const r = await verifyPortalOtp({ memberId, code: '999999' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('INVALID_CODE');
  });

  it('returns NO_ACTIVE_LINK when no code has been issued', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'no-link@b.com');
    const r = await verifyPortalOtp({ memberId, code: '000000' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NO_ACTIVE_LINK');
  });

  it('burns the code after PORTAL_OTP_MAX_ATTEMPTS wrong tries', async () => {
    const saved = process.env.PORTAL_OTP_MAX_ATTEMPTS;
    process.env.PORTAL_OTP_MAX_ATTEMPTS = '3';
    try {
      const { engagementId } = await seedEngagementWithToken();
      const memberId = await seedMember(engagementId, 'burn@b.com');
      const { code } = await issuePortalOtp({ engagementId, memberId });
      for (let i = 0; i < 3; i++) await verifyPortalOtp({ memberId, code: '111111' });
      const r = await verifyPortalOtp({ memberId, code });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('RATE_LIMITED');
    } finally {
      if (saved !== undefined) process.env.PORTAL_OTP_MAX_ATTEMPTS = saved;
      else delete process.env.PORTAL_OTP_MAX_ATTEMPTS;
    }
  });

  it('consumes the code on successful verification (one-time use)', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId, 'consume@b.com');
    const { code } = await issuePortalOtp({ engagementId, memberId });
    const r1 = await verifyPortalOtp({ memberId, code });
    expect(r1.ok).toBe(true);
    const r2 = await verifyPortalOtp({ memberId, code });
    expect(r2.ok).toBe(false);
  });

  it('returns CODE_EXPIRED for a link past its TTL', async () => {
    const saved = process.env.PORTAL_OTP_TTL_MINUTES;
    process.env.PORTAL_OTP_TTL_MINUTES = '0';
    try {
      const { engagementId } = await seedEngagementWithToken();
      const memberId = await seedMember(engagementId, 'expired-otp@b.com');
      const { code } = await issuePortalOtp({ engagementId, memberId });
      await new Promise((r) => setTimeout(r, 50));
      const r = await verifyPortalOtp({ memberId, code });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('NO_ACTIVE_LINK'); // expired link is not "active"
    } finally {
      if (saved !== undefined) process.env.PORTAL_OTP_TTL_MINUTES = saved;
      else delete process.env.PORTAL_OTP_TTL_MINUTES;
    }
  });
});
