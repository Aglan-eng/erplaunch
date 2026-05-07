# RBAC walkthrough — Phase 43.6

This document walks each fixture user from `apps/api/src/seed-rbac.ts`
through the platform and pins what they see vs what an `APP_ADMIN` sees.

## How to run the seed

```bash
pnpm --filter @ofoq/api exec tsx src/seed-rbac.ts
```

The seed:
- Targets the firm with slug `xelerate` (or the first firm in the DB
  if Xelerate isn't there).
- Idempotent — re-running it is safe.
- Demo password for all four users is `rbac-demo`. **Don't run this
  seed against production.**

## The four fixture users

| Email | Role | Scope |
|---|---|---|
| `sales.rep@xelerate.example` | `SALES_REP` | Engagement-scoped on the first non-archived engagement |
| `pm@xelerate.example` | `PROJECT_MANAGER` | Engagement-scoped on the Acme engagement |
| `functional.finance@xelerate.example` | `FUNCTIONAL_CONSULTANT` | Engagement + module-scoped (Acme, modules=[r2r]) |
| `accountant@xelerate.example` | `INTERNAL_ACCOUNTANT` | Firm-wide (sees every engagement, billing fields only) |

For comparison, the `APP_ADMIN` is the firm creator (the user who
ran `/auth/register` originally). They have `WRITE` access to every
resource at every stage.

---

## 1. `sales.rep@xelerate.example` (SALES_REP)

What they see:

- **Dashboard** — only the engagements where they hold `SALES_REP`.
  In the smoke seed that's the first non-archived engagement.
- **Sidebar (Project Mgmt)** — most items hidden. They get
  `READ`-default on most resources, so the sidebar filter shows
  read-mostly items (Activity Feed, etc.) and hides write-heavy ones.
- **Engagement metadata** — `WRITE` while the deal is at `PROSPECT`,
  `PROPOSED`, or `CONTRACTED`. Becomes `READ` once the deal moves
  into `DISCOVERY`.
- **Decisions** — `READ` on their deal (so they can see what's been
  agreed) but cannot author. The matrix returns `NONE` on
  `GENERATORS` and `READ` on `BILLING`.
- **Other engagements** — invisible. `/me/permissions?engagementId=X`
  returns no roles and `NONE` everywhere for any engagement they're
  not assigned to.

What `POST /engagements/<other-eng>/decisions` does for them: **403
FORBIDDEN** with `requiredRole: 'PROJECT_LEAD'`.

---

## 2. `pm@xelerate.example` (PROJECT_MANAGER on Acme)

What they see:

- **Dashboard** — Acme appears, other engagements don't (they have
  no role on Beacon, NorthStar, etc.).
- **Sidebar (Project Mgmt)** — every operational item visible
  (risks, issues, decisions, meetings, data collection, migration,
  auto-fill, activity).
- **Decisions / Risks / Issues / Meetings on Acme** — `WRITE` during
  `DISCOVERY` through `GOLIVE`. `READ`-only at `PROSPECT`/`PROPOSED`/
  `CONTRACTED` (the deal hasn't been handed over yet) and at
  `CLOSEOUT`/`SLA_ACTIVE`/`ARCHIVED`.
- **Billing** — `READ`-only. The accountant owns this surface.
- **Roles management (Settings → Team)** — visible but read-only.
  Only `APP_ADMIN` can grant/revoke roles.

What they cannot do: `POST /engagements/<other-engagement>/decisions`
returns 403. Same on every other engagement.

---

## 3. `functional.finance@xelerate.example` (FUNCTIONAL_CONSULTANT, modules=[r2r])

What they see:

- **Dashboard** — Acme appears.
- **Sidebar (Project Mgmt)** — risks, issues, meetings, data
  collection, activity all visible. Decisions visible (they READ
  decisions but can't WRITE).
- **Wizard sections** — only the `r2r` modules pass the module
  scope check. Other modules render as read-only or hidden depending
  on the section's policy.
- **Risks / Issues / Meetings** — `WRITE` during `DISCOVERY`–`GOLIVE`.
- **Decisions** — `READ` only. Consultants don't author decisions;
  the project lead does.
- **Billing / Roles** — `NONE`. Hidden entirely.

`assignedModulesByRole` in `/me/permissions` exposes
`{ FUNCTIONAL_CONSULTANT: ["r2r"] }` so the SPA can hide
non-`r2r` flow tabs.

---

## 4. `accountant@xelerate.example` (INTERNAL_ACCOUNTANT, firm-wide)

What they see:

- **Dashboard** — every engagement, every status. They need
  visibility for billing reconciliation.
- **Engagement payload** — stripped of decisions/risks/profile/
  members. Only the structural fields (id, clientName, status,
  dates, adaptorId) plus billing-shaped fields. The
  `filterEngagementForAccountant` helper applies this; see
  Phase 43.2 for the implementation. (As of this commit the helper
  is wired but the dashboard list endpoint hasn't applied it yet —
  that's a Phase 43.5 follow-up.)
- **Sidebar (Project Mgmt)** — empty. Every resource the matrix
  returns `NONE` on (DECISIONS, RISKS, ISSUES, MEETINGS, MEMBERS,
  DATA_COLLECTION, GENERATORS, INTEGRATIONS, ROLES).
- **Billing** — `WRITE` everywhere.

`GET /engagements/:id/decisions` for them returns **403** with
`requiredRole: 'PROJECT_LEAD'`. Likewise `/risks`, `/issues`,
`/meetings`.

---

## Smoke test

The end-to-end coverage lives at
`apps/api/tests/routes/rbacSmoke.test.ts`. It seeds the four personas
+ two engagements (Acme and Beacon) and walks each persona through
the real route stack:

- 10 tests covering 200/403 outcomes per persona × resource × stage.
- Verifies cross-engagement isolation (PM on Acme cannot write to
  Beacon).
- Verifies module scoping data is exposed via `/me/permissions`.
- Verifies INTERNAL_ACCOUNTANT denial on every non-billing surface.

Run via:
```bash
pnpm --filter @ofoq/api test:notypecheck -- rbacSmoke
```

## What's still to come

These bits are Phase 43.5/43.6 follow-up:

1. **Pipeline filtering** — the dashboard endpoint (`GET /engagements`)
   currently returns every engagement in the firm. The SALES_REP
   should only see their own deals; the SUPPORT_ENGINEER should
   only see their assigned SLA customers. Implementation lands when
   that endpoint gets gated through `requirePermission` + a
   role-aware filter.

2. **INTERNAL_ACCOUNTANT field-stripping wiring** — the helper is
   built and tested, but `GET /engagements/:id` and `GET /engagements`
   don't yet call it. They will once the dashboard frontend is
   gated end-to-end.

3. **Per-button gating** — the sidebar already hides whole sections
   for forbidden users. The fine-grained "+ New decision" button
   should also disable with a "Requires PROJECT_LEAD" tooltip on
   hover, even when the section is visible. That's a UI polish
   round.

4. **Generic 403 → "Talk to your App Admin" empty state** — when
   the API 403s mid-flow (e.g. user opened a tab they shouldn't
   have), the SPA should render a friendly empty state instead of
   a red error toast.
