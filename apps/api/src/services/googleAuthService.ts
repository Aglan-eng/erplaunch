/**
 * Google OAuth sign-in resolution.
 *
 * Three branches, evaluated in order:
 *   1. Match by googleSub  → re-login. JWT issued, no DB writes.
 *   2. Match by email      → existing email-signup user. Link the sub
 *                            (idempotent attach), issue JWT.
 *   3. No match            → first-time Google sign-up. Create a new firm
 *                            with the user as ADMIN. Firm name + slug are
 *                            derived from the user's name with collision
 *                            handling for the slug.
 *
 * The route layer (auth.ts) wraps this with the @fastify/oauth2 token
 * exchange + JWT cookie issuance. This module owns the "who are you,
 * have I seen you, and if not who do I attach you to" decision tree —
 * a pure(ish) async function so it can be exhaustively unit-tested
 * without spinning up a real Google authorization redirect.
 */

import {
  findUserByEmail,
  findUserByGoogleSub,
  linkUserGoogleSub,
  createGoogleUserAndFirm,
  findFirmBySlug,
  type UserWithFirm,
} from '../db/index.js';

export type ResolveAction = 're-login' | 'linked' | 'created';

export interface ResolvedGoogleUser {
  id: string;
  email: string;
  name: string;
  role: string;
  firmId: string;
  firm: unknown;
  action: ResolveAction;
}

export interface GoogleProfile {
  /** OIDC `sub` claim — opaque, stable, Google-internal user ID. */
  sub: string;
  email: string;
  name: string;
}

/**
 * Slug-friendly version of an arbitrary display string. Mirrors the
 * shared SlugRegex contract: 3-40 chars, lowercase, dashes ok, no
 * leading/trailing/double dashes.
 */
function nameToSlugBase(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  // Pad short slugs (e.g. single-word names like "li") to >=3 chars so
  // SlugRegex passes — appending zeros is ugly but doesn't break anything,
  // and the user can rename the firm in /settings later.
  return out.length >= 3 ? out : (out + '00').slice(0, 3);
}

/**
 * Pick a free firm slug starting from `base`. Tries `base`, then
 * `base-2`, `base-3`, ..., `base-9`, then falls back to `base-<5 hex>`.
 * Bounded retries — never an infinite loop.
 */
async function reserveFreeSlug(base: string): Promise<string> {
  if (!(await findFirmBySlug(base))) return base;
  for (let i = 2; i <= 9; i++) {
    const candidate = `${base}-${i}`;
    if (!(await findFirmBySlug(candidate))) return candidate;
  }
  // Cryptographic randomness over Math.random — the suffix is the only
  // thing protecting against multi-tenant slug clashes at scale.
  const crypto = (await import('crypto')).default;
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Resolve a Google profile to an ERPLaunch user, performing whichever DB
 * mutation is needed. Returns the user + firm + which branch fired.
 */
export async function resolveGoogleSignIn(profile: GoogleProfile): Promise<ResolvedGoogleUser> {
  // Branch 1: re-login by sub.
  const bySub = await findUserByGoogleSub(profile.sub);
  if (bySub) {
    return shapeResolved(bySub, 're-login');
  }

  // Branch 2: existing email-signup user. Link the sub once and proceed.
  const byEmail = await findUserByEmail(profile.email);
  if (byEmail) {
    await linkUserGoogleSub(byEmail.id, profile.sub);
    // Re-fetch so the returned record carries the now-linked sub —
    // matters for tests asserting on action='linked'.
    const fresh = await findUserByEmail(profile.email);
    return shapeResolved(fresh!, 'linked');
  }

  // Branch 3: first-time sign-up. Auto-create a firm with the user as ADMIN.
  // Firm name/slug derived from the user's display name; the user can
  // rename in /settings later.
  const baseSlug = nameToSlugBase(profile.name || profile.email.split('@')[0]);
  const slug = await reserveFreeSlug(baseSlug);
  const firmName = profile.name || profile.email.split('@')[0];

  const created = await createGoogleUserAndFirm({
    email: profile.email,
    name: profile.name,
    firmName,
    firmSlug: slug,
    googleSub: profile.sub,
  });
  if (!created) {
    // createFirm collision retry exhaustion — extremely unlikely, but the
    // type is `null` so we have to handle it. Throwing surfaces a 500 at
    // the route layer, which is the right outcome.
    throw new Error('googleAuthService: failed to create firm + user');
  }
  return shapeResolved(created.user, 'created');
}

function shapeResolved(user: UserWithFirm, action: ResolveAction): ResolvedGoogleUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    firmId: user.firmId,
    firm: user.firm,
    action,
  };
}

// Exposed for unit tests.
export const __testInternals = { nameToSlugBase, reserveFreeSlug };
