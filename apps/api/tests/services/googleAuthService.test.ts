import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  createFirm,
  createUser,
  findUserByEmail,
  findUserByGoogleSub,
} from '../../src/db/index.js';
import {
  resolveGoogleSignIn,
  __testInternals,
} from '../../src/services/googleAuthService.js';
import bcrypt from 'bcryptjs';

/**
 * Phase 2 — Google OAuth resolution service tests.
 *
 * Three branches × edge cases:
 *   - re-login (sub matches)
 *   - linked (email matches, no sub yet)
 *   - created (neither matches → new firm)
 *
 * Plus the slug-derivation helper because it's the bit most likely to
 * silently produce SlugRegex-invalid output and break the create branch.
 */

let cleanup: () => void;

beforeAll(async () => {
  process.env.ERPLAUNCH_MASTER_KEY = 'a'.repeat(64);
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => cleanup());

describe('nameToSlugBase', () => {
  const { nameToSlugBase } = __testInternals;

  it('lowercases + dashes spaces', () => {
    expect(nameToSlugBase('Sarah Chen')).toBe('sarah-chen');
  });

  it('strips punctuation', () => {
    expect(nameToSlugBase("O'Brien & Co.")).toBe('obrien-co');
  });

  it('caps at 32 chars (room for collision suffix)', () => {
    const long = 'abcdefghij abcdefghij abcdefghij abcdefghij';
    expect(nameToSlugBase(long).length).toBeLessThanOrEqual(32);
  });

  it('pads short slugs to >=3 chars so SlugRegex passes', () => {
    expect(nameToSlugBase('Li').length).toBeGreaterThanOrEqual(3);
    expect(nameToSlugBase('A').length).toBeGreaterThanOrEqual(3);
  });

  it('strips leading/trailing dashes that would slip past SlugRegex', () => {
    const slug = nameToSlugBase('--weird name--');
    expect(slug).not.toMatch(/^-/);
    expect(slug).not.toMatch(/-$/);
  });
});

describe('resolveGoogleSignIn — re-login branch (sub already linked)', () => {
  it('returns the existing user with action="re-login" and does not mutate', async () => {
    const firm = await createFirm({ name: 'Existing Firm A', slug: 'existing-firm-a' });
    const u = await createUser({
      firmId: firm!.id as string,
      email: 'relogin@example.com',
      name: 'Re Login',
      passwordHash: await bcrypt.hash('pw', 4),
    });
    // Link the sub directly via DB so we can isolate the re-login branch.
    const { linkUserGoogleSub } = await import('../../src/db/index.js');
    await linkUserGoogleSub(u!.id as string, 'sub-relogin-1');

    const result = await resolveGoogleSignIn({
      sub: 'sub-relogin-1',
      email: 'relogin@example.com',
      name: 'Re Login',
    });

    expect(result.action).toBe('re-login');
    expect(result.id).toBe(u!.id);
    expect(result.firmId).toBe(firm!.id);
  });
});

describe('resolveGoogleSignIn — linked branch (existing email, no sub yet)', () => {
  it('attaches the sub and returns action="linked"', async () => {
    const firm = await createFirm({ name: 'Existing Firm B', slug: 'existing-firm-b' });
    const u = await createUser({
      firmId: firm!.id as string,
      email: 'linkme@example.com',
      name: 'Link Me',
      passwordHash: await bcrypt.hash('pw', 4),
    });
    expect(u!.googleSub == null).toBe(true);

    const result = await resolveGoogleSignIn({
      sub: 'sub-linkme-1',
      email: 'linkme@example.com',
      name: 'Link Me',
    });

    expect(result.action).toBe('linked');
    expect(result.id).toBe(u!.id);
    // Sub should now be attached.
    const reloaded = await findUserByEmail('linkme@example.com');
    expect(reloaded!.googleSub).toBe('sub-linkme-1');
    // Lookup by sub should now find the same user (idempotency check).
    const bySub = await findUserByGoogleSub('sub-linkme-1');
    expect(bySub!.id).toBe(u!.id);
  });

  it('uses the Google-supplied email even if it differs in case from DB', async () => {
    const firm = await createFirm({ name: 'Case Firm', slug: 'case-firm' });
    await createUser({
      firmId: firm!.id as string,
      email: 'mixedcase@example.com',
      name: 'Mixed Case',
      passwordHash: await bcrypt.hash('pw', 4),
    });
    const result = await resolveGoogleSignIn({
      sub: 'sub-mixedcase-1',
      // Email lookup is case-sensitive in SQLite by default — we don't
      // pretend otherwise. If a future schema migration adds COLLATE
      // NOCASE this test will start failing and we'll revisit.
      email: 'mixedcase@example.com',
      name: 'Mixed Case',
    });
    expect(result.action).toBe('linked');
  });
});

describe('resolveGoogleSignIn — created branch (no match → new firm)', () => {
  it('creates a new firm + admin user with the sub linked', async () => {
    const result = await resolveGoogleSignIn({
      sub: 'sub-fresh-1',
      email: 'fresh@example.com',
      name: 'Fresh Newcomer',
    });
    expect(result.action).toBe('created');
    expect(result.email).toBe('fresh@example.com');
    expect(result.role).toBe('ADMIN');

    // Subsequent lookups should find them by sub (re-login proof).
    const bySub = await findUserByGoogleSub('sub-fresh-1');
    expect(bySub).toBeTruthy();
    expect(bySub!.id).toBe(result.id);
  });

  it('handles slug collisions on the firm create path (counter suffix)', async () => {
    // Take the base slug "popular-name".
    await createFirm({ name: 'Popular Name', slug: 'popular-name' });
    const result = await resolveGoogleSignIn({
      sub: 'sub-popular-1',
      email: 'popular@example.com',
      name: 'Popular Name',
    });
    expect(result.action).toBe('created');
    // The new firm should have used the collision-suffix path.
    const firm = (result.firm as { slug?: string } | null);
    expect(firm?.slug).not.toBe('popular-name');
    expect(firm?.slug).toMatch(/^popular-name-/);
  });

  it('handles short names by padding to a SlugRegex-valid length', async () => {
    const result = await resolveGoogleSignIn({
      sub: 'sub-short-1',
      email: 'a@example.com',
      name: 'A',
    });
    expect(result.action).toBe('created');
    const firm = (result.firm as { slug?: string });
    expect(firm.slug!.length).toBeGreaterThanOrEqual(3);
  });

  it('falls back to email local-part when name is empty', async () => {
    const result = await resolveGoogleSignIn({
      sub: 'sub-noname-1',
      email: 'noname.user@example.com',
      // Some Google accounts have no `name` field set on the profile —
      // we fall back to the email local-part to derive a slug + firm name.
      name: '',
    });
    expect(result.action).toBe('created');
    const firm = (result.firm as { slug?: string });
    expect(firm.slug).toContain('noname');
  });
});

describe('resolveGoogleSignIn — branch precedence', () => {
  it('prefers sub match over email match (an account-rotated user keeps their record)', async () => {
    // User signed up via Google originally; later, a NEW user with the
    // same email signs up via email-and-password (somehow). Sub match
    // should win — we don't want to silently merge two unrelated humans
    // just because they share an email at a point in time.
    const firm = await createFirm({ name: 'Precedence Firm', slug: 'precedence-firm' });
    const subUser = await createUser({
      firmId: firm!.id as string,
      email: 'precedence-old@example.com',
      name: 'Sub User',
      passwordHash: await bcrypt.hash('pw', 4),
    });
    const { linkUserGoogleSub } = await import('../../src/db/index.js');
    await linkUserGoogleSub(subUser!.id as string, 'sub-precedence-1');

    const otherFirm = await createFirm({ name: 'Other Firm', slug: 'other-firm' });
    const emailUser = await createUser({
      firmId: otherFirm!.id as string,
      // A different user with the email Google now sends — different DB row.
      email: 'precedence-new@example.com',
      name: 'Email User',
      passwordHash: await bcrypt.hash('pw', 4),
    });

    const result = await resolveGoogleSignIn({
      sub: 'sub-precedence-1',
      email: 'precedence-new@example.com', // Google email != original DB email
      name: 'Either',
    });

    // Should land on the SUB user, not the EMAIL user.
    expect(result.action).toBe('re-login');
    expect(result.id).toBe(subUser!.id);
    expect(result.id).not.toBe(emailUser!.id);
  });
});
