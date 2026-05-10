# Phase 48.3 — Phase 46.8 Frontend Audit Report

**Date:** 2026-05-10
**Auditor:** Phase 48.3 sprint
**Scope:** All six Phase 46.8 frontend deliverables, end-to-end.

## Summary

| Severity | Count | Resolved in 48.3 |
|----------|-------|------------------|
| CRITICAL | 0     | n/a              |
| HIGH     | 4     | 4 (all)          |
| MEDIUM   | 4     | 0 (deferred)     |
| LOW      | 4     | 1 (LOW-1)        |

No deliverable was completely broken. Every page rendered, every API
helper resolved to a real backend route, and every page-level useQuery
flow worked. The 4 HIGH issues were correctness bugs the user wouldn't
hit on a happy-path demo but would absolutely hit in real use:

- A data-loss race in the portal Discovery Lite wizard (typing-then-
  clicking-Next-fast-enough drops the last answer)
- A SOW preview URL that 404s as soon as the version counter and job
  count diverge (which they will, the moment any SOW row is deleted)
- A React anti-pattern in SalesTemplatesPage that sets state inside
  `queryFn` (works today, will break under React 18 strict mode)
- A "Configure templates" deep link that points at the wrong route

All four were fixed in this commit. The MEDIUM and LOW items are
documented at the bottom and filed as follow-up work.

## Deliverables — verification findings

### 46.8.1 — Discovery Lite consultant wizard (`SalesDiscoveryLitePage.tsx`)

**Status: PASS** — wired end-to-end, route registered, all 14 questions
render from server catalog, Save Draft works (autosave + manual flush),
Submit transitions stage (invalidates pipeline cache, navigates back).

Backend coverage: all five routes present in `routes/discoveryLite.ts`.
Test coverage: 14 unit tests on the helpers in `discoveryLiteHelpers.test.ts`.

**No HIGH/CRITICAL issues.** One LOW-2 type-contract lie on
`mintShareToken` return type (returns `record` field that the type
declaration omits). Filed as follow-up.

### 46.8.2 — Discovery Lite portal self-serve (`PortalDiscoveryLitePage.tsx`)

**Status: PASS with one HIGH bug** — token-based auth works, submission
fires the email-rep notification (`sendDiscoveryLiteCompletedEmail`),
"Thanks" confirmation renders.

Backend coverage: three self-serve routes in `routes/discoveryLite.ts`
(GET / PUT / POST .../complete).

**HIGH-1 (FIXED):** The Next button advanced the step without flushing
the autosave debounce. A prospect typing an answer and tapping Next
within 600ms of the last keystroke would advance with their answer
still in the in-memory React state but never written to the database
— and the `POST .../complete` resolves against whatever was last saved.
The consultant wizard had a `flushAndAdvance` helper for this exact
case; the portal just didn't use it.

**Fix applied:** added `flushAndAdvance()` to PortalDiscoveryLitePage
that clears the debounce timer and calls `putMutation.mutate(answers)`
synchronously before `setStepIndex`. Also wrapped `completeMutation`
in a sync flush so the very last answer is always persisted before the
complete call fires.

### 46.8.3 — Proposal management UI (`SalesProposalPage.tsx`)

**Status: PASS with one HIGH route fix** — page wires correctly,
backend reuses the existing engagements job pipeline.

**HIGH-4 (FIXED):** "Configure templates" link pointed at `/settings`
not `/settings/sales-templates`. The user lands on the firm settings
home and has to navigate manually to the template editor.

**Fix applied:** changed `to="/settings"` →  `to="/settings/sales-templates"`.

Test coverage: 8 helper tests in `proposalHelpers.test.ts`.

### 46.8.4 — SOW management + signature center (`SalesSowPage.tsx`)

**Status: PASS with one HIGH bug** — wired correctly, both DocuSign
and manual paths function, webhook auto-conversion fires on SIGNED.

**HIGH-2 (FIXED):** The preview URL was constructed as
`SOW/Statement_of_Work_v${jobs.length}.pdf` where `jobs.length` is the
count of all SOW jobs. The actual filename uses the version number
that the backend's `nextSowVersion` function stamps from
`EngagementSowVersion.MAX(version) + 1`. These diverge as soon as a
SOW row is deleted or the version counter is incremented out of band.
The preview iframe would 404 silently, leaving the rep confused about
why their PDF wasn't loading.

**Fix applied:** the page now queries the latest job's file tree
(`engagementsApi.listJobFiles`) and pulls the actual filename from
the `SOW/` directory. Two new pure helpers — `findLatestSowFilename`
and `extractVersionFromFilename` — handle the lookup and version
extraction. Both have full test coverage (9 new tests).

### 46.8.5 — Sales reports (`SalesReportsPage.tsx`)

**Status: PASS** — all four reports render, Export PDF works.

**LOW-1 (FIXED):** duplicate `import { useMutation }` line — merged
into the existing `@tanstack/react-query` destructure.

Outstanding (MEDIUM-2): leaderboard shows raw userId prefix instead
of the user's name. Backend GET response doesn't include the name;
fix requires either expanding the leaderboard payload or doing a
client-side User lookup. Deferred.

### 46.8.6 — Pricing template editor (`SalesTemplatesPage.tsx`)

**Status: PASS with one HIGH anti-pattern fix** — wired correctly,
preview pane works, both routes (GET + PATCH) present.

**HIGH-3 (FIXED):** the page was calling `setPermissionDenied(true)`
inside the `queryFn` catch block — a React anti-pattern. setState
calls inside non-React code work today only because React batches
updates, but they break under strict-mode double-invocation and are
inconsistent with the rest of the codebase (compare SalesReportsPage,
which derives its error UI from `query.error` directly).

**Fix applied:** removed the `permissionDenied` useState entirely;
derived it from `query.error.response.status === 403`. The retry
callback still skips retries on 403 so the error settles cleanly.

## Deferred items (MEDIUM / LOW)

The following were noted but not fixed in 48.3 — they're polish or
maintainability issues the audit caught but they don't block ship:

- **MEDIUM-1:** duplicate `shallowEqual` and `AutoSaveIndicator`
  helpers in PortalDiscoveryLitePage + SalesDiscoveryLitePage. Extract
  to `apps/web/src/lib/discoveryLiteUtils.ts`.
- **MEDIUM-2:** leaderboard shows raw userId prefix; needs name lookup.
- **MEDIUM-3:** stale TODO comment in SalesReportsPage about disabled
  Export PDF button.
- **MEDIUM-4:** SalesSowPage doesn't show a loading hint while
  `sigsQuery` is in flight.
- **LOW-2:** `mintShareToken` return type missing `record` field.
- **LOW-3:** PortalDiscoveryLitePage has no dedicated test file
  (the autosave-flush bug HIGH-1 only had unit-test coverage on the
   shared helpers — a render test would have caught it earlier).
- **LOW-4:** `sowPageHelpers.test.ts` now has 12 tests, but the
  `handleFile` PDF-magic validation logic still has zero coverage.

## Verification

- `apps/web` typecheck: clean
- `apps/api` typecheck: clean
- `apps/web/tests` full run: all green
- `apps/api/tests` full run: all green

End-to-end verification on the live app (a fresh prospect from
prospect-creation through Discovery Lite → Proposal → SOW) is the
Phase 48.5 smoke-test deliverable.
