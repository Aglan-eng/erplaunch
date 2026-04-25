import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  createFirm,
  createUser,
  findUserByEmail,
  findUserByGoogleSub,
  linkUserGoogleSub,
  createGoogleUserAndFirm,
} from '../../src/db/index.js';

/**
 * DB layer for Google OAuth sign-in (Phase 1).
 *
 * The user record gets one new column: googleSub. Three operations:
 *   - findUserByGoogleSub(sub)        — match-first lookup on subsequent
 *                                        sign-ins (idempotent re-login)
 *   - linkUserGoogleSub(userId, sub)  — attach a Google identity to an
 *                                        existing email-signup user
 *   - createGoogleUserAndFirm(...)    — first-time Google sign-up:
 *                                        creates a new firm with the user
 *                                        as admin, no password (random
 *                                        unguessable hash so password
 *                                        login is impossible until the
 *                                        user uses "Forgot password" to
 *                                        set one)
 *
 * Test scope is just the DB shape; the auth flow / OAuth code lives in
 * Phase 2 with its own integration test.
 */

let cleanup: () => void;
let firmId: string;

beforeAll(async () => {
  process.env.ERPLAUNCH_MASTER_KEY = 'a'.repeat(64);
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  const firm = await createFirm({ name: 'Test Firm', slug: 'test-firm' });
  firmId = firm!.id as string;
});

afterAll(() => cleanup());

describe('googleSub column', () => {
  it('is added to existing User table without blowing up on second migration run', async () => {
    // setupTestDb already booted initDb once; if the ALTER wasn't idempotent
    // this test file would never have loaded. Just confirm the column exists
    // by inserting a record with it.
    const u = await createUser({
      firmId,
      email: 'columntest@example.com',
      name: 'Column Test',
      passwordHash: await bcrypt.hash('something', 4),
    });
    expect(u).toBeTruthy();
    // googleSub starts null on email-signup users.
    expect(u!.googleSub == null).toBe(true);
  });
});

describe('findUserByGoogleSub', () => {
  it('returns null when no user has that sub', async () => {
    const u = await findUserByGoogleSub('does-not-exist-sub');
    expect(u).toBeNull();
  });

  it('returns the user once linked', async () => {
    const created = await createUser({
      firmId,
      email: 'findbysub@example.com',
      name: 'Find Test',
      passwordHash: await bcrypt.hash('pw', 4),
    });
    await linkUserGoogleSub(created!.id as string, 'sub-find-test-123');
    const found = await findUserByGoogleSub('sub-find-test-123');
    expect(found).toBeTruthy();
    expect(found!.id).toBe(created!.id);
    expect(found!.email).toBe('findbysub@example.com');
  });
});

describe('linkUserGoogleSub', () => {
  it('attaches a sub to an existing email-signup user', async () => {
    const u = await createUser({
      firmId,
      email: 'link@example.com',
      name: 'Link Test',
      passwordHash: await bcrypt.hash('pw', 4),
    });
    expect(u!.googleSub == null).toBe(true);

    await linkUserGoogleSub(u!.id as string, 'sub-link-456');
    const reloaded = await findUserByEmail('link@example.com');
    expect(reloaded!.googleSub).toBe('sub-link-456');
  });

  it('overwrites a previously linked sub if called again (last-write-wins)', async () => {
    const u = await createUser({
      firmId,
      email: 'rebind@example.com',
      name: 'Rebind',
      passwordHash: await bcrypt.hash('pw', 4),
    });
    await linkUserGoogleSub(u!.id as string, 'first-sub');
    await linkUserGoogleSub(u!.id as string, 'second-sub');
    const reloaded = await findUserByGoogleSub('second-sub');
    expect(reloaded!.id).toBe(u!.id);
    const orphaned = await findUserByGoogleSub('first-sub');
    expect(orphaned).toBeNull();
  });
});

describe('createGoogleUserAndFirm', () => {
  it('creates a new firm + admin user with no usable password', async () => {
    const result = await createGoogleUserAndFirm({
      email: 'newgoogle@example.com',
      name: 'Google Newcomer',
      firmName: 'Google Newcomer Inc',
      firmSlug: 'google-newcomer',
      googleSub: 'sub-newgoogle-789',
    });
    expect(result).toBeTruthy();
    expect(result!.user.email).toBe('newgoogle@example.com');
    expect(result!.user.googleSub).toBe('sub-newgoogle-789');
    expect(result!.user.role).toBe('ADMIN');
    expect(result!.firm.name).toBe('Google Newcomer Inc');

    // Password must be set (NOT NULL constraint) but unguessable. We can't
    // assert the value directly; just confirm bcrypt of a random known
    // input doesn't match — i.e. the user can't log in via password.
    const found = await findUserByEmail('newgoogle@example.com');
    expect(found!.passwordHash).toBeTruthy();
    const knownGuess = await bcrypt.compare('password', found!.passwordHash as string);
    expect(knownGuess).toBe(false);
  });

  it('produces a SlugRegex-compatible firm slug from the suggested input', async () => {
    const result = await createGoogleUserAndFirm({
      email: 'slugtest@example.com',
      name: 'Slug Tester',
      firmName: 'Slug Tester Co',
      firmSlug: 'slug-tester-co',
      googleSub: 'sub-slug-test-' + crypto.randomBytes(4).toString('hex'),
    });
    expect(result!.firm.slug).toBe('slug-tester-co');
  });
});
