# ADR 0003 — Firm white-label scope for pilot

**Status:** Accepted (Day 3, 2026-04-22).

## Context

The client portal must not look like ERPLaunch's product — it must look like the consulting firm's product. The firm's client PM is not buying software; they are receiving a service from a trusted advisor. Branding is therefore the minimum credibility bar, not a nice-to-have.

Open question: how far to go with white-label in pilot?

## Decision

**Four fields + one logo, on a single Firm row. That's it.**

| Field | Column on `Firm` | Type | Purpose |
|---|---|---|---|
| Display name | `displayName` | TEXT | Shown in the portal header, outbound email "from" name, and portal `<title>`. |
| Logo URL | `logoUrl` | TEXT | Small image (≤48px rendered) in the portal header. Hosted elsewhere; ERPLaunch does not host logo assets in pilot. |
| Primary color | `primaryColor` | TEXT (hex) | Portal accent color: header background, link color, CTA background. |
| Secondary color | `secondaryColor` | TEXT (hex) | Paired with primary for gradient + interaction states. |
| Support email | `supportEmail` | TEXT | Shown to clients who can't sign in; `mailto:` link in the portal footer. |

Scope is frozen. No theme editor. No font selection. No dark mode toggle. No custom CSS. No per-engagement override (firm-wide only).

## Rationale

- **Every field earns its place**. These five together cover 80% of the perceived-brand lift with 10% of the surface area.
- **Logo via URL**, not upload. In pilot, uploading adds a multipart handler, storage, MIME validation, file-size limits, CDN decisions, and a UI dropzone. A URL field is one line of input and the client's asset is almost always hosted already. Upload ships in Day 4+ if time permits (currently deferred).
- **Firm-level, not engagement-level**. One consulting firm has one brand. Per-engagement override is a feature no pilot user has asked for.
- **No theme engine**. A theme engine invites design decisions we don't have taste for yet. Two colors → a gradient → done.

## What's explicitly out

- Logo file upload → Day 4 or post-pilot.
- Verified sending domain for magic-link emails (DKIM / SPF configured per firm) — post-pilot channels workstream.
- Custom portal subdomain (e.g. `portal.acme.com`) — post-pilot infra work.
- Typography selection / custom fonts.
- Localization / language packs.
- Dark mode.
- Client-side (per-PM) preference storage.

## Consequences

- **A firm with unusual brand colors** (e.g. white-on-white) will produce a portal that's hard to read. No pilot firm is expected to hit this; if it surfaces, we add guardrails (contrast validator) in post-pilot.
- **Logo URL trust**. If the hosted image goes 404, the portal header falls back to the firm's initial letter in a colored square. Not as good but not broken.
- **Email brand** is separate. The magic-link email is sent via the firm's SMTP (if configured) or the platform default. Post-pilot, a verified-sending-domain flow makes the `From` match the firm's domain. Out of pilot scope.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Theme editor (6-10 color slots, typography, spacing) | Overkill; invites design-by-committee requests we can't fulfill. |
| ERPLaunch-branded portal ("powered by ERPLaunch") | Wrong identity for the pilot use case — the client-side user doesn't buy ERPLaunch, they buy their consultant's service. |
| Per-engagement branding override | No pilot user has asked for it; adds UI complexity (which one wins?). |

## When to revisit

- Second firm onboarded. Their first pilot engagement goes live. They ask for something on the "out of scope" list — capture it, prioritize.
- A client reports contrast/legibility issues.
- Sales asks for "powered by" attribution as part of a co-marketing arrangement (then make it opt-out / plan-gated).

## Links

- `apps/api/src/db/firmBranding.ts` — DB access.
- `apps/api/src/routes/firmBranding.ts` — API surface.
- `apps/web/src/pages/SettingsPage.tsx` — consultant UI + live portal-header preview.
- `apps/web/src/pages/ClientPortalPage.tsx` — branding consumption.
