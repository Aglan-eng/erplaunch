# Lifecycle smoke test (Phase 48.5)

A single integration test that walks one engagement from PROSPECT all
the way to SLA_ACTIVE — plus the post-go-live actions (open ticket,
run Quarterly Health Check, mark renewal RENEWED) — in one continuous
pass.

The intent is to catch cross-phase regressions early. Per-feature
tests verify their own slice; this test verifies the slices fit
together.

## Where it lives

`apps/api/tests/routes/lifecycle.smoke.test.ts`

It runs as part of the standard vitest suite — no extra commands, no
separate runner, no fixtures to seed manually. CI picks it up on
every commit.

## What it covers

Step-by-step:

1. **Sales pipeline:** PROSPECT → PROPOSED → CONTRACTED via
   `POST /engagements/:id/advance`.
2. **Implementation:** CONTRACTED → DISCOVERY → SCOPING → BUILD →
   UAT → GOLIVE via the same advance route.
3. **Closeout entry:** GOLIVE → CLOSEOUT auto-creates the closeout
   checklist (asserts CLIENT_SIGNOFF + SLA_TEAM_ACCEPT exist).
4. **Dual sign-off:** marks every checklist item DONE via
   `PATCH /engagements/:id/closeout-checklist/:key`.
5. **Handover:** CLOSEOUT → SLA_ACTIVE clears the dual-signoff gate.
6. **SLA portfolio:** verifies the engagement appears in
   `GET /sla/portfolio`.
7. **Customer ticket:** simulates the portal "Open ticket" submission
   by creating a SUPPORT_TICKET PendingSubmission and running the
   acceptor — produces a real Ticket row.
8. **SLA team triage:** assigns the ticket, adds a SUPPORT message,
   transitions OPEN → IN_PROGRESS → RESOLVED → CLOSED.
9. **Firm-wide queue:** asserts the ticket surfaces with the right
   status in `GET /sla/tickets?status=ALL`.
10. **Quarterly Health Check:** kicks off a QUARTERLY_HEALTH_CHECK
    job via the standard generate route.
11. **Renewal:** marks the renewal SIGNED via
    `PATCH /engagements/:id/renewal-state`, then verifies
    `GET /sla/renewals` returns the same status.

## What it deliberately does NOT cover

- **Portal magic-link flow.** The mint → email → click → JWT cookie
  sequence is exercised by `routes/portalAuth.test.ts`. This test
  bypasses the email round-trip by calling
  `createPendingSubmission` directly.
- **Visual regression.** Playwright still owns that —
  `apps/web-e2e/` runs against a deployed SPA on demand.
- **Job processing.** Generation jobs (proposal, SOW, QHC) are
  enqueued in the test but the worker isn't run; we just verify the
  route accepted the type and created the row. Each generator has
  its own dedicated test for output shape.

## Run it locally

```bash
pnpm --filter @ofoq/api test -- lifecycle.smoke
```

or run the full api suite:

```bash
pnpm --filter @ofoq/api test
```

The smoke test takes about a second on a warm cache.

## Maintenance

When a new lifecycle stage is added or removed, this test breaks
loudly — the explicit `expect(...).toBe('STAGE_NAME')` assertions
on each advance call pin the order. That's intentional: stage order
is a contract, not an implementation detail.

When a new closeout checklist key is added, the loop in step 4 will
keep marking it DONE so the SLA_ACTIVE gate stays unblocked. If a
new key is added that should NOT be auto-completed in the smoke
test (e.g. an opt-in flag), update the loop to skip it explicitly.

When a new feature lands that the lifecycle should exercise
(e.g. a new post-go-live action), add a step at the bottom of the
test rather than splitting into a second test — the value is the
single continuous pass.
