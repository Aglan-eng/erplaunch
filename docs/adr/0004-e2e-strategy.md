# ADR 0004 — End-to-end test strategy

**Status:** Accepted (pilot, 2026-04-22). Revisit after pilot golive.

## Context

We have good unit and integration coverage:

- **Rule engine: 61 tests.** Every LIC / R2R / P2P / O2C / MFG / RTN rule has a conflict-path and a no-conflict-path fixture. This is our most battle-tested surface.
- **API: 75 tests** across db helpers, services (OTP, credential cipher, email transport, rate limiter), and integration (portal branding, portal auth, firm branding, portal session mutations). Full request/response via `fastify.inject()` against a fresh in-memory SQLite per suite.
- **Web: 1 smoke test.** Placeholder to keep CI green.

We have no browser-level end-to-end coverage (Playwright / Cypress / etc.) exercising the SPA + API + DB together.

The pilot cutover date is <7 days from the audit. Standing up a dedicated Playwright suite before cutover is feasible but would push other pilot items. What's the right call?

## Decision

**No Playwright suite before pilot cutover. The pilot demo itself is the e2e.**

- The existing api integration tests cover the critical server-side flows (portal magic-link round-trip with email capture, session-authenticated mutations with cross-engagement rejection, branding round-trip visible in the public portal endpoint).
- The pilot demo — a real consulting firm running a real engagement with a real client signing in via real email — is a production-grade e2e run against the production environment. We pre-walk it end-to-end before handing off.
- Post-pilot: stand up Playwright under `apps/web-e2e` (directory referenced in code comments but not yet populated) exercising the three critical SPA flows: consultant login → wizard save, client magic-link → portal sign-in → todo completion, firm branding edit → portal visibility.

## Rationale

- **The highest-value e2e is the pilot itself.** A Playwright suite written pre-cutover would exercise golden paths we've already written tests for. It would not find the unknown-unknowns a real pilot flushes out.
- **Deferred doesn't mean ignored.** The post-pilot roadmap has a concrete Playwright line item with file paths and scope. Nothing is hand-waved.
- **Time budget is real.** Seven days to cutover; Playwright setup + 3 meaningful flows + CI integration is 1-2 days. That's 15-30% of the budget. Spend it on the magic-link flow instead (which is the single biggest pilot risk, per the PO audit).

## Consequences

- **A regression in a SPA view that still passes the api integration test is possible.** E.g., the SPA renders a malformed payload or a route is wired wrong. Mitigation: the pre-cutover manual e2e walk. We run the full flow in production a day before cutover and chase anything broken.
- **Test coverage metric stays at "api-only" for the pilot.** When we publish a post-pilot coverage number, it will include the SPA.
- **A known-gap-list** lives in `docs/ROADMAP.md` so nobody forgets. First roadmap item after pilot golive.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Playwright MVP with 1 flow (consultant login only) | Most bang-for-buck single flow is the portal magic-link — and that's the flow a pre-cutover Playwright couldn't exercise without a real inbox captive to the test. Stubbing the email makes the test less realistic than the api integration test we already have. |
| Cypress | Same time budget, no material advantage over Playwright for our use case. |
| Storybook + visual regression | Orthogonal to e2e; useful later, not a substitute. |

## When to revisit

- Within two weeks of pilot golive. Do not let this ADR become a permanent excuse.
- On any production regression that the api integration tests didn't catch (and use that regression to inform the first Playwright scenarios).

## Links

- `apps/api/tests/routes/portal.auth.test.ts` — the integration tests that substitute for e2e coverage in pilot.
- `docs/ROADMAP.md` — post-pilot Playwright line item.
