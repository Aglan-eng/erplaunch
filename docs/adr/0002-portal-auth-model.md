# ADR 0002 — Portal authentication model

**Status:** Accepted (Phase 5A, 2026-04-22).

## Context

Client-side users (not consultants) need to act on their engagement's portal: mark todos complete, upload data-collection files, approve decisions. They are typically non-technical project managers who receive invites from the consultant. We need an auth model that:

- Requires no account creation ceremony (no password to pick/remember).
- Is clearly revocable by the consultant without rotating a shared URL.
- Is usable across mobile + desktop, across email clients.
- Survives a corporate-managed device refresh without the user losing access.
- Costs nothing per-user.

## Decision

**Magic link + one-time code, with a stateful server-side `PortalSession` table.**

Flow:

1. Consultant adds a `ProjectMember` with `team='CLIENT'` and an email address on the engagement.
2. Consultant sends the portal URL (contains an opaque, long-lived engagement token).
3. Client visits URL → sees public read view + "Sign in" CTA.
4. Client submits their email → `POST /portal/request-access`.
5. Server (a) verifies the email matches a client member on the engagement, (b) issues a 6-digit OTP via `PortalMagicLink`, (c) emails a magic link `/portal/<token>/verify?email=…&code=…` via the firm's SMTP. Always responds 202, whether the email matched or not (no user enumeration).
6. Client clicks the link → SPA auto-POSTs to `/portal/verify` → server consumes the OTP, creates a `PortalSession`, signs a portal-namespaced JWT whose payload carries `{ type, memberId, engagementId, jti, sid }`, and sets it as an httpOnly cookie `portal_token`.
7. Subsequent mutations require the cookie. The middleware looks up the session by `sha256(jti)`, checks not-revoked and not-expired, and decorates the request with `{ sessionId, memberId, engagementId }`.

## Rationale

- **No passwords.** Nothing to phish or reset. Every sign-in is a fresh verified email round-trip.
- **Stateful sessions.** Revoke = set `revokedAt` on the row. Next request sees it and 401s. 60-second worst-case revocation SLA. Stateless JWT would require a jti allowlist to achieve the same, which is the same complexity.
- **Separate secret** (`PORTAL_SESSION_COOKIE_SECRET` ≠ `JWT_SECRET`). A compromise of the consultant JWT secret cannot mint portal sessions.
- **Dedicated cookie namespace** (`portal_token` ≠ `token`). Browser-level separation.
- **Engagement-scoping in the payload.** The middleware rejects any request whose URL token resolves to a different engagement than the session's. Stolen cookies can't cross engagements.
- **OTP as second factor.** The URL contains both an email and a 6-digit code. A leaked URL alone is not enough to sign in — the attacker also needs the inbox. A leaked inbox alone is not enough — they need the URL.
- **Rate limited** (see ADR 0004 — security posture). 3 requests/minute per IP and per email; 5 verify attempts per minute per engagement token.

## Consequences

- **Email delivery is a hard dependency.** If the firm's SMTP is misconfigured or blocked, the client can't sign in. Mitigation: the 6-digit code is also shown in the email body — a consultant can read the code aloud over Slack/WhatsApp as a fallback and the portal verify page accepts `?email=…&code=…` query params.
- **No cross-device session sync.** Each device signs in independently. Acceptable; this isn't a consumer product.
- **Cross-site cookie friction.** The SPA on `erplaunch-web.vercel.app` and the API on `erplaunch-api.onrender.com` are cross-site. We set `SameSite=None; Secure` in prod, which works in mainstream browsers but is increasingly being flagged by privacy-strict settings (Brave, iOS Safari ITP). Post-pilot fix: custom domain so api + web share an eTLD+1.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Google / Microsoft SSO | Many clients don't use Google/MS corporate identity, adding friction for non-technical PMs. Can layer in post-pilot as an optional path. |
| Password auth | Ops cost (resets, leaks, expiry policy). No clear pilot benefit. |
| Shared-URL-only (current state before 5A) | No revocation, no per-member audit trail, one share token for the whole committee. Retired by this ADR. |
| Stateless JWT only | Same implementation cost once you add a revocation list, with worse revocation SLA. |

## When to revisit

- A client reports the sign-in email being blocked by a corporate spam filter repeatedly.
- We sign a second firm. Per-firm SMTP configuration becomes mandatory (currently uses platform default).
- We ship a mobile app and need a device-binding story.

## Links

- `apps/api/src/routes/portalAuth.ts` — the three endpoints.
- `apps/api/src/middleware/portalAuth.ts` — session validator.
- `apps/api/src/services/portalOtp.ts` — code generation + bcrypt hashing + attempt tracking.
