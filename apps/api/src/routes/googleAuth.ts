/**
 * Google OAuth sign-in routes (Phase 2).
 *
 * Two endpoints, both unauthenticated:
 *
 *   GET /api/v1/auth/google/start    — registered automatically by
 *                                       @fastify/oauth2. Redirects the
 *                                       browser to Google's consent screen.
 *   GET /api/v1/auth/google/callback — Google redirects here with an
 *                                       authorization code. We exchange
 *                                       the code for an access token,
 *                                       fetch the userinfo claims, run
 *                                       them through resolveGoogleSignIn,
 *                                       issue a JWT cookie, and redirect
 *                                       the browser to the SPA dashboard.
 *
 * This whole module only registers when GOOGLE_CLIENT_ID +
 * GOOGLE_CLIENT_SECRET + GOOGLE_CALLBACK_URL are all present in env. Dev
 * environments without those vars (e.g. local without a configured OAuth
 * app, or CI) skip the registration entirely so a missing secret doesn't
 * crash boot. The "Continue with Google" UI button is rendered
 * conditionally based on the API's `/api/v1/auth/google/available` probe.
 */

import type { FastifyInstance } from 'fastify';
// @fastify/oauth2 v7 ships as CJS with `export = fastifyOauth2` plus a
// namespace+const merge. Under module:node16 + esModuleInterop, the
// default-import value is typed as `typeof fastifyOauth2` (the namespace),
// not the FastifyOauth2 plugin function — so `oauth2.GOOGLE_CONFIGURATION`
// resolves via the namespace's `fastifyOauth2` const re-export instead of
// the top-level value. Runtime: `module.exports.fastifyOauth2 = fastifyOauth2`
// (index.js:707) is the same plugin instance with GOOGLE_CONFIGURATION
// attached at index.js:626. Both layers agree on this access path.
import oauth2 from '@fastify/oauth2';
import { resolveGoogleSignIn } from '../services/googleAuthService.js';
import { incrementCounter } from '../services/metrics.js';

/** Where to send the browser after a successful sign-in. */
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

/** Google's OIDC userinfo endpoint — returns the user's sub/email/name. */
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
}

/**
 * Returns true when all required Google OAuth env vars are present.
 * Exported so server.ts can decide whether to register this module, and
 * so the SPA can probe whether to show the "Continue with Google" button.
 */
export function isGoogleAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CALLBACK_URL,
  );
}

export async function googleAuthRoutes(fastify: FastifyInstance) {
  if (!isGoogleAuthConfigured()) {
    // Surface a probe endpoint even when not configured so the UI gets a
    // clean 200 with `{available:false}` instead of a 404.
    fastify.get('/auth/google/available', async () => ({ data: { available: false } }));
    return;
  }

  // Register the @fastify/oauth2 plugin scoped to this route module so
  // the global fastify instance stays clean.
  await fastify.register(oauth2.fastifyOauth2, {
    name: 'googleOAuth2',
    scope: ['openid', 'profile', 'email'],
    credentials: {
      client: {
        id: process.env.GOOGLE_CLIENT_ID!,
        secret: process.env.GOOGLE_CLIENT_SECRET!,
      },
      auth: oauth2.fastifyOauth2.GOOGLE_CONFIGURATION,
    },
    startRedirectPath: '/auth/google/start',
    callbackUri: process.env.GOOGLE_CALLBACK_URL!,
  });

  fastify.get('/auth/google/available', async () => ({ data: { available: true } }));

  fastify.get('/auth/google/callback', async (request, reply) => {
    let profile: GoogleUserInfo;
    try {
      // Exchange the authorization code for an access token.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { token } = await (fastify as any).googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);

      // Fetch the userinfo claims. Google's ID token also contains these
      // but using the userinfo endpoint avoids a JWT-verification step.
      const res = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!res.ok) {
        throw new Error(`google userinfo fetch failed: ${res.status}`);
      }
      profile = await res.json() as GoogleUserInfo;
    } catch (err) {
      request.log.error({ err: String(err) }, 'auth/google/callback: token exchange failed');
      incrementCounter('auth_google_total', { outcome: 'token_exchange_failed' });
      return reply.redirect(`${APP_URL}/login?error=google_oauth_failed`);
    }

    // Sanity check the profile shape — Google promises these fields when
    // the `email`/`profile`/`openid` scopes are granted, but defensive
    // is cheap.
    if (!profile.sub || !profile.email) {
      request.log.error({ profile }, 'auth/google/callback: profile missing sub/email');
      incrementCounter('auth_google_total', { outcome: 'profile_invalid' });
      return reply.redirect(`${APP_URL}/login?error=google_profile_invalid`);
    }

    if (!profile.email_verified) {
      // Google occasionally lets unverified addresses through — refuse so
      // the same email can't be claimed in two different ERPLaunch firms.
      request.log.warn({ email: profile.email }, 'auth/google/callback: email not verified by google');
      incrementCounter('auth_google_total', { outcome: 'email_unverified' });
      return reply.redirect(`${APP_URL}/login?error=google_email_unverified`);
    }

    let resolved;
    try {
      resolved = await resolveGoogleSignIn({
        sub: profile.sub,
        email: profile.email,
        name: profile.name || profile.email,
      });
    } catch (err) {
      request.log.error({ err: String(err) }, 'auth/google/callback: resolveGoogleSignIn threw');
      incrementCounter('auth_google_total', { outcome: 'resolve_failed' });
      return reply.redirect(`${APP_URL}/login?error=google_resolve_failed`);
    }

    incrementCounter('auth_google_total', { outcome: resolved.action });

    // Mint the same JWT shape email-and-password sign-in produces. Cookie
    // settings mirror /auth/login exactly so the SPA can't tell them apart.
    const token = fastify.jwt.sign(
      {
        userId: resolved.id,
        firmId: resolved.firmId,
        role: resolved.role,
        name: resolved.name,
        email: resolved.email,
      },
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' },
    );

    const isProd = process.env.NODE_ENV === 'production';
    reply
      .setCookie('token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      })
      // First-time sign-ups get a `?welcome=1` flag the SPA can use to
      // surface an onboarding banner. Re-logins go straight to the inbox.
      .redirect(
        resolved.action === 'created'
          ? `${APP_URL}/inbox?welcome=1`
          : `${APP_URL}/inbox`,
      );
  });
}
