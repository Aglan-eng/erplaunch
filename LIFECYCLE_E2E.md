# Lifecycle End-to-End Verification

Honest walkthrough of every stage from Lead to Renewed against the
current code, generated alongside the Phase 54.4 automated test
(`apps/api/tests/lifecycle/endToEnd.test.ts`). This is **not** a
marketing document — it's a map of what works and what's still a
stub, written so anyone (including future-me) can read it before
opening the app and know what they're really looking at.

The automated test passes clean — 8/8. That proves the **mechanical
plumbing** holds (transitions, audit log, owner handoffs, stage
widgets, document catalog, health recompute, renewal counter). It
does **not** prove the *content* generated at each stage is
production-ready; most artifacts are still stubs. The gap is in the
generators, not the lifecycle.

---

## Stage-by-stage walkthrough

### 1. LEAD

**What the user does.** A new prospect has just come in. Sales
decides whether to qualify them.

**Customer page shows.**
- Stage widget (`LEAD`): days-in-stage gauge against a 14-day target, lead source, qualify/disqualify tip. **Real.**
- Documents tab: two cards — *Capability Statement*, *Discovery Call Summary*. **Both stubbed** (no generator).
- Implementation tab focus: *"Pre-sales — no implementation work yet. Qualify the deal."* Primary action: open Documents. **Real.**
- AppNav stage badge with HelpTip explaining the 14-stage lifecycle. **Real.**

**Real vs stub.** Widget + lifecycle + audit trail are real. Both Lead documents are coming-soon.

---

### 2. QUALIFIED

**What the user does.** BANT confirmed. Move toward a Proposal.

**Customer page shows.**
- Stage widget (`QUALIFIED`): same shape as LEAD (days-in-stage + lead source + qualify tip). **Real.**
- Documents tab: *Capability Statement (qualified)*, *Discovery Call Summary (qualified)*. **Both stubbed.**
- Implementation focus: *"Pre-sales — keep moving toward a proposal."* **Real.**

**Real vs stub.** Mechanics real, documents stubbed.

---

### 3. PROPOSAL

**What the user does.** Generate the branded proposal PDF, send it, iterate.

**Customer page shows.**
- Stage widget (`PROPOSAL`): days-in-stage vs 21-day target, deal value (ARR), proposal-generated status chip, link to Documents tab if not yet generated. **Real** — the days/target/ARR/status all come from real data.
- Documents tab: **Proposal** card with a working *Generate PDF* button. ✅ **Working generator** (Phase 51.4 landscape Xelerate slide deck, Phase 51.4 hotfix downsized backgrounds so it no longer OOMs on Render).
- Implementation focus: *"Still pre-sales — generate and refine the proposal."* Primary: *Generate Proposal PDF →* (switches tab to Documents).

**Real vs stub.** Both proposal flow + widget are real. This is the first stage where you can produce a deliverable end-to-end.

---

### 4. NEGOTIATION

**What the user does.** Iterate on price, scope, terms. Issue a revised proposal if asked.

**Customer page shows.**
- Stage widget (`NEGOTIATION`): same shape as PROPOSAL (days, ARR, proposal status).
- Documents tab: *Revised Proposal*, *Commercial Comparison*. **Both stubbed.**
- Implementation focus: *"Closing the deal — refine the commercials."*

**Real vs stub.** Lifecycle real, both negotiation docs stubbed.

---

### 5. WON

**What the user does.** Deal closed. Hand off from Sales to a Project Lead. Generate the SOW + Kickoff Deck, schedule the kickoff.

**Customer page shows.**
- Stage widget (`WON`): SOW-generated status chip, Kickoff-scheduled status chip. **Stub** — both chips read from `Customer.metadata` placeholder fields, no real signal yet.
- Documents tab: **Statement of Work** (✅ working PDF), **Kickoff Deck** (✅ working PDF — Phase 54.2 wired `kickoffGenerator` → markdown→PDF).
- Implementation focus: *"Deal won — kick off delivery."* Primary action: Documents.
- **Owner-handoff fires here:** the automated test pins an `OWNER_HANDOFF` activity row + `effectiveOwnerUserId` flipping from Sales to Sales (still sales-owned at WON per the spec; handoff to Project Lead lands at DISCOVERY).

**Real vs stub.** Two working generators, lifecycle + audit real. Widget status chips read from metadata stubs.

---

### 6. DISCOVERY

**What the user does.** Capture how the customer actually runs. Complete the discovery questionnaire — every downstream generator reads from it.

**Customer page shows.**
- Stage widget (`DISCOVERY`): questionnaire completion % + sections complete/total + next section name. **Real** — pulled from `BusinessProfile.completeness` JSON.
- Documents tab: **Business Process Document** (✅ working PDF — Phase 54.2 wired `brdGenerator` → markdown→PDF), *Requirements Document* (stub).
- Implementation focus: *"Discovery — capture how the customer actually runs."* Primary action: *Open Discovery & Data Collection →* (routes to the existing engagement Data Collection workspace via Phase 54.1).
- **Owner-handoff fires here:** Sales → Project Lead. The automated test pins the activity row.

**Real vs stub.** Widget signal is real (best-quality stage widget today). BRD generator is real, Requirements doc is stubbed.

---

### 7. SCOPING

**What the user does.** Lock the solution. Generate Scope Document, Fit-Gap, Solution Design. Get scope sign-off.

**Customer page shows.**
- Stage widget (`SCOPING`): open-decisions count (real, from `DecisionItem`), pending-scope-signoff chip (stub — `Customer.metadata.pendingScopeSignoff`).
- Documents tab: *Scope Document*, *Fit-Gap Analysis*, *Solution Design*. **All three stubbed.**
- Implementation focus: *"Scoping — lock the solution."*

**Real vs stub.** Open-decisions count is real signal. All three SCOPING documents are coming-soon.

---

### 8. BUILD

**What the user does.** Configure the system. Generate the Configuration Workbook + SDF artifacts. Weekly progress reports.

**Customer page shows.**
- Stage widget (`BUILD`): open-blockers count (✅ real, from `IssueItem` WHERE status='OPEN'), open-decisions count (✅ real), days-in-stage gauge vs 60-day target (✅ real), "View activity" link to the Activity tab.
- Documents tab: *Configuration Workbook*, *Build Progress Report*. **Both stubbed.**
- Implementation focus: *"Build — configure the system."* Cards re-ordered so Documents, Generation Jobs, and Vertical Workspace lead.

**Real vs stub.** Widget signals are the most real on the system — blocker/decision counts come straight from live tables. Documents stubbed.

**Note:** The ~90 actual generators (`generateConfigurationWorkbook`, the full SDF bundle, etc.) live inside the `processJob` orchestrator and fire all-at-once from the legacy `EngagementDocumentsPage`. They are not yet per-doc-invokable from the Customer page.

---

### 9. UAT

**What the user does.** User Acceptance Testing. Track defects to closure.

**Customer page shows.**
- Stage widget (`UAT`): open-blockers count (real), tests-passed % (stub — `Customer.metadata.testsPassedPct`), days-in-stage vs 21-day target (real).
- Documents tab: *UAT Test Plan*, *UAT Sign-Off Form*. **Both stubbed.**
- Implementation focus: *"UAT — prove it works."*

**Real vs stub.** Blocker count + days-in-stage real. Test-pass % is a placeholder; no UAT test-execution tracker exists.

---

### 10. GOLIVE

**What the user does.** Execute the cutover. Generate Cutover Plan, Go-Live Runbook, Data Migration Plan. Lock the runbook 48h before cutover.

**Customer page shows.**
- Stage widget (`GOLIVE`): days-until-go-live countdown (real, from `Customer.targetGoLive`), cutover-checklist complete/total (stub — metadata).
- Documents tab: *Cutover Plan*, *Go-Live Checklist*, *Go-Live Runbook*, *Data Migration Plan*. **All four stubbed.**
- Implementation focus: *"Go-live — execute the cutover."*

**Real vs stub.** Days-until-go-live is real signal. Checklist is a metadata stub — no cutover-checklist UI exists. All four GOLIVE docs are coming-soon (these are the most-asked-for next batch to wire).

---

### 11. HYPERCARE

**What the user does.** Stabilize. Hypercare Plan + KPI dashboard. Triage incidents daily.

**Customer page shows.**
- Stage widget (`HYPERCARE`): open-incidents count (stub), P1 count (stub), days-remaining countdown (real — derived from hypercare start + duration metadata).
- Documents tab: *Hypercare Plan*, *Hypercare Exit Report*. **Both stubbed.**
- Implementation focus: *"Hypercare — stabilize."*

**Real vs stub.** Days-remaining is real. Incident counts are metadata placeholders; no IncidentReport table exists yet.

---

### 12. LIVE_SLA

**What the user does.** Steady-state managed service. CSM owns. Quarterly health checks. Watch for emerging issues.

**Customer page shows.**
- Stage widget (`LIVE_SLA`): open-ticket count (✅ real — from `Ticket` WHERE status NOT IN RESOLVED/CLOSED), SLA uptime % (stub), last-incident-days-ago (stub), next-renewal-date (real — from `Customer.contractEndDate`).
- Documents tab: *SLA Agreement*, *Monthly Service Report*. **Both stubbed.**
- Implementation focus: *"Live service — keep it healthy."*

**Real vs stub.** Ticket count + renewal date are real. Uptime + last-incident are placeholders — no live telemetry source.

---

### 13. RENEWAL_DUE

**What the user does.** Secure the next term before contract end.

**Customer page shows.**
- Stage widget (`RENEWAL_DUE`): big days-until-renewal countdown (✅ real — derived from `Customer.contractEndDate`), value-at-risk (real — from `Customer.dealValue`), health band (real — composite formula), quote-generated chip (stub), "Generate Renewal Quote →" CTA.
- Documents tab: *Renewal Quote*, *Renewal Proposal*. **Both stubbed** — could be wired by adapting the `proposalGenerator` with a renewal flag.
- Implementation focus: *"Renewal — secure the next term."*

**Real vs stub.** The countdown / value-at-risk / health are the strongest piece of real signal in the post-go-live half. The two doc types are coming-soon.

---

### 14. RENEWED

**What the user does.** Treat exactly like LIVE_SLA. Quarterly health, ongoing service reports.

**Customer page shows.**
- Stage widget (`RENEWED`): renewal count (real — `Customer.renewalCount`), last renewal date (real — derived from most-recent `RENEWAL_DUE → LIVE_SLA/RENEWED` ActivityLog row), next renewal date (real — `contractEndDate`).
- Documents tab: empty for this stage (terminal for doc purposes).
- Implementation focus: *"Renewed — continue managed service."* Identical to LIVE_SLA.

**Real vs stub.** Mechanics real, doc set empty by design. The renewal count is verified by the automated test (RENEWAL_DUE → LIVE_SLA increments it).

---

### Dead-end paths

- **LOST**: a pre-Won customer can land here. The automated test pins
  this. *No business rule blocks resurrecting a LOST customer to
  NEGOTIATION today* — flagging that as a future tightening if
  needed.
- **CHURNED**: a post-live customer can land here. Test pins it.
  Same lack-of-block applies; future tightening.

---

## What the automated test pins (8/8 passing)

1. **LEAD → RENEWED full walk** — every transition writes a clean `STAGE_TRANSITION` row with the correct `fromStage`/`toStage`/`actorUserId`, `isRollback=0`, health stays in [0..100], `effectiveOwnerUserId` matches the expected role at every stage, `OWNER_HANDOFF` rows fire only at role-boundary crossings (counted cumulatively), `stageWidget.kind` matches the destination stage, and `documentsForStage(stage)` returns a non-empty doc set for every non-terminal stage.
2. **Rollback writes `isRollback=true`** — PROPOSAL → QUALIFIED writes the rollback row; re-advance to PROPOSAL writes a clean forward row.
3. **Renewal counter increments** on RENEWAL_DUE → LIVE_SLA.
4. **Dead-ends**: NEGOTIATION → LOST and LIVE_SLA → CHURNED both succeed.
5. **Persona coherence**: the active owner at every stage matches `expectedActiveRole` (sales for LEAD..WON, projectLead for DISCOVERY..GOLIVE, csm for HYPERCARE..RENEWED).
6. **Catalog coverage**: every non-terminal stage has ≥1 catalog entry; every catalog entry maps to a stage in the lifecycle.

**No findings.** The lifecycle plumbing is solid. The test deliberately does not weaken any assertion to make implementation gaps pass — they're documented below instead.

---

## Gaps before this is a true production lead-to-cash system

Honest punch list. Listed by category, not by stage, so prioritisation is easier:

### Documents (catalog status: 4 available / 24 coming-soon)

The big one. Only `proposal`, `sow`, `kickoff-deck`, and `business-process-document` have working generators. **24 catalog entries are still "Coming soon":**

- Sales: capability-statement, discovery-call-summary (×2 for LEAD/QUALIFIED), revised-proposal, commercial-comparison
- Delivery: requirements-document, scope-document, fit-gap-analysis, solution-design, configuration-workbook, build-progress-report, uat-test-plan, uat-signoff, cutover-plan, golive-checklist, golive-runbook, data-migration-plan
- Support: hypercare-plan, hypercare-exit-report, sla-agreement, monthly-service-report
- Renewal: renewal-quote, renewal-proposal

Each needs a small adapter (Phase 54.2 established the pattern at ~30 LOC + a test) that loads the engagement context, calls the matching generator from `services/generators/*`, runs the markdown through `markdownToPdf`. The generators exist (`generateCutoverRunbook`, `generateUATPlan`, `generateHypercarePlan`, `generateSolutionDocHtml`, etc.); they just need per-doc routes.

**Caveat:** the SDF / configuration-workbook generators have richer engagement input requirements (RoleMatrix, Phases, integration topology) than `Customer` alone provides. Those will need data plumbing before they produce non-empty artifacts.

### Stage widget signal quality (real vs placeholder)

| Stage | Real signal | Placeholder fields |
|---|---|---|
| LEAD/QUALIFIED | days-in-stage, leadSource | — |
| PROPOSAL/NEGOTIATION | days-in-stage, ARR | proposalGeneratedAt (set when user generates) |
| WON | — | sowGeneratedAt, kickoffScheduled (both metadata) |
| DISCOVERY | questionnaire % from BusinessProfile | — |
| SCOPING | open-decisions count | pendingScopeSignoff |
| BUILD | blockers, decisions, days-in-stage | — |
| UAT | blockers, days-in-stage | testsPassedPct |
| GOLIVE | days-until-go-live | cutoverChecklistComplete/Total |
| HYPERCARE | days-remaining | openIncidents, p1Count |
| LIVE_SLA | open-ticket count, next-renewal-date | slaUptimePct, lastIncidentDaysAgo |
| RENEWAL_DUE | days-until-renewal, ARR, health-band | quoteGenerated |
| RENEWED | renewalCount, last/next renewal dates | — |

The placeholders all read from `Customer.metadata` JSON. They render as designed; they just don't yet reflect live state.

### Missing systems that block "true production lead-to-cash"

- **No time tracking / timesheet system.** Utilization dashboard shows assignment counts, not hours. AR can't bill without time data.
- **No AR / billing module.** AR owner field is populated; nothing reads from it. No invoices, no payment tracking, no aging.
- **No real ticketing data tied to LIVE_SLA dashboard math.** Tickets table exists; the dashboard widget reads `openTicketCount` but SLA breach %, MTTR, and uptime are all placeholders.
- **No real IncidentReport table.** Hypercare incident counts are metadata stubs.
- **No cutover-checklist UI.** GOLIVE widget reads `cutoverChecklistComplete/Total` from metadata; nowhere to tick items off.
- **No UAT test-execution tracker.** UAT widget's `testsPassedPct` is metadata stub.
- **No e-signature integration.** SOW has a signature table but no DocuSign/HelloSign wiring.
- **No real LIVE_SLA telemetry source.** Uptime, last-incident, MTTR are all placeholders.
- **No KickoffMeeting table.** Kickoff-scheduled chip on WON widget is metadata stub.

### Lifecycle rules not yet enforced

- **No business rule blocks resurrecting LOST → NEGOTIATION** or CHURNED → LIVE_SLA. If we want truly terminal stages, the route layer should reject those transitions.
- **No "renewal window" enforcement.** A customer can transition to RENEWAL_DUE at any time, not just when `contractEndDate - 90 days < now`.
- **No "stage must have passed gate" enforcement.** A LEAD can jump straight to BUILD via the API (the kanban UI prevents it, but the route doesn't validate stage adjacency).

### Doc generation honesty

- The Phase 51.4 proposal PDF works (post-OOM hotfix at 1600×900 backgrounds). It is the only landscape slide-deck template; SOW still uses the older portrait pdfkit path.
- Kickoff-deck and BRD use the legacy markdownToPdf (pdfkit-based portrait A4) — not the new landscape deck template. Visually they're different from the Proposal PDF.

### What I'd build next, in priority order

1. **Wire the 4 GOLIVE documents** (cutover-plan, golive-checklist, golive-runbook, data-migration-plan) — these get asked for the most and the generators exist (`cutoverRunbookGenerator`, `dailyReadinessChecklistGenerator`, `migrationRunbookGenerator`, `dryRunPlanGenerator`).
2. **Wire the UAT documents** (uatGenerator, signOffMatrixGenerator) — closes UAT-stage credibility.
3. **Wire Hypercare Plan** (hypercarePlanGenerator) — closes HYPERCARE.
4. **Add a "renewal" flag to the existing proposal generator** to produce renewal-quote / renewal-proposal — cheap, high value.
5. **Replace stub fields with real signal one at a time** — incident counts, uptime, tests-passed.
6. **Enforce terminal stages** at the route layer (reject LOST/CHURNED outbound transitions).
7. **Time tracking + AR module** — the big "becomes a true lead-to-cash system" item.

---

_This document is the honest answer to "does the app do what you envisioned, lead to cash?" The lifecycle and persona ownership and audit trail do. The artifacts most stages need are still being wired one phase at a time._

_Generated alongside the Phase 54.4 automated lifecycle test — all 8 invariants pass, no findings._
