# Phase 52 — IA Rebuild · Verification Report

Closing report for the Phase 52 sequence (52.1 → 52.9) that collapsed the
legacy Engagement / SalesPipeline / SLA surface into a single unified
Customer model with a 14-stage lifecycle, role-based Inbox, five
dashboards, and a tabbed Settings shell.

## Phase 52 scope as delivered

| Sub-phase | What landed |
|---|---|
| **52.0** | `docs/ia-rebuild.md` — the IA design contract |
| **52.1** | Unified `Customer` table + 14-stage lifecycle + id-preserving backfill from Engagement |
| **52.2** | Four-link `AppNav` (Inbox · Customers · Reports · Settings) + page stubs |
| **52.3** | Customers list (kanban + table) + filters + stage drag-drop + `PATCH /:id/stage` |
| **52.3.1** | Reconcile/owners/health passes wired into boot; composite health formula |
| **52.4** | Customer Detail page (Overview · Documents · Activity · Settings) |
| **52.5** | Role-based Inbox (For You · Watching · Firm-wide) with 6 alert types |
| **52.6** | Five Reports dashboards (Pipeline · Delivery · Health · Renewals · Utilization) |
| **52.7** | Stage-specific widget panel on Customer Detail Overview (one per stage) |
| **52.8** | Cutover — legacy URLs redirect, Settings absorbs Adaptors + Tickets |
| **52.9** | Lifecycle seed (16 demo customers) + persona verification + this report |

## What each persona sees in their daily view

### Sales rep
- **Inbox For-You** → Lead/Qualified/Proposal customers they own, plus any pending decisions on their pipeline.
- **Customers** → Filter to LEAD..WON stages, kanban-by-default for drag-drop forward motion.
- **Reports → Pipeline** → Funnel by stage, conversion rates, average days in stage, stalled-customer callout.
- **Customer Detail (Sales-stage)** → ProposalWidget shows ARR + proposal status + "Generate Proposal PDF" link.

### Project Lead
- **Inbox For-You** → Stage-overdue customers in Discovery/Build/UAT, open blockers, handoff-incoming alerts when Sales hands off a Won customer.
- **Customers** → Filter to DISCOVERY..GOLIVE; list view for managing many concurrent deliveries.
- **Reports → Delivery** → Active project count, by-stage on-track/slipping split, slipping-customer list with days overdue, blockers-by-stage, forecasted go-lives.
- **Customer Detail (Build)** → BuildWidget shows blocker count + decision count + days-in-stage gauge; activity tab has the audit trail.

### CSM
- **Inbox For-You** → Renewal-due-within-90 alerts, health-band-degraded watchers, post-go-live customers handed off from PM.
- **Customers** → Filter to HYPERCARE..RENEWAL_DUE; list view sorted by health band.
- **Reports → Customer Health** → Managed customer count, red/yellow/green distribution, churn-risk score, red-customer list with days since last activity.
- **Reports → Renewals** → 90-day strip, total ARR at risk, by-month bar chart, renewals-coming-due table with "Generate Renewal Quote" CTA.
- **Customer Detail (Renewal Due)** → RenewalDueWidget shows big countdown + value at risk + health band chip + quote-not-yet-generated CTA.

### AR owner
- **Customer Detail (any stage from WON onward)** → AR badge populated; ARR field editable in Settings tab.
- **Reports → Utilization** → AR-segment of the per-user stacked bar shows workload across active customers.
- No dedicated AR-only view yet (gap — see below).

## Dashboards → lead-to-cash question

| Dashboard | Question it answers |
|---|---|
| **Pipeline** | "Where are deals stalling and what's our conversion rate stage-by-stage?" |
| **Delivery** | "Which active projects are slipping vs on-track, and what's blocking them?" |
| **Customer Health** | "Who's at churn risk and which CSM should intervene?" |
| **Renewals** | "What's at risk in the next 90 days and which renewals need a quote?" |
| **Utilization** | "Is workload distributed sensibly across owners or are individuals overloaded?" |

## Known gaps (honest list)

- **Ticketing data not tied to LIVE_SLA dashboard math.** Tickets exist as a separate `/settings?tab=tickets` queue but the LIVE_SLA widget reads `Ticket WHERE engagementId = ?` rather than aggregating SLA breach metrics. Real uptime telemetry is placeholder.
- **No real go-live checklist UI.** GoLive widget reads `cutoverChecklistComplete/Total` from `Customer.metadata` — there's no UI to tick items off yet.
- **Hypercare incident counts are metadata stubs.** No live IncidentReport table — widget displays whatever `metadata.hypercareOpenIncidents` is set to.
- **Tests-passed % during UAT is stubbed.** No UAT test-execution tracker; the widget reads `metadata.testsPassedPct`.
- **Customer Detail Documents tab lacks history.** Generated PDFs download but aren't stored in a `Document` table keyed by `customerId` — only ad-hoc one-off generation works.
- **Inbox has no email/Slack push.** All alerts are in-app only; no notification service wired to deliver them outside the SPA.
- **No dedicated AR view.** AR owners can see their customers via Utilization and Customer Detail badges but there's no AR-specific dashboard (e.g., outstanding invoices by aging bucket).
- **Search bar in AppNav is a placeholder.** Cross-customer search is disabled — comes online when Phase 53+ ships the search index.
- **Phase 51 PDF engine carries only Proposal + SOW templates.** Status Report, Change Order, Runbook, Renewal Quote, etc. are queued for future phases.

## Acceptance criteria checklist

- [x] Lead can be created and walked through to Renewed without leaving the app (drag in kanban or `PATCH /:id/stage`)
- [x] Each stage transition writes an audit row (`ActivityLog action='STAGE_TRANSITION'` with from/to/actor/rollback flags)
- [x] Owner handoffs raise notifications and update primary owner (`OWNER_HANDOFF` audit + `effectiveOwnerUserId` recomputed; in-app inbox alert via `HANDOFF_INCOMING`)
- [x] Documents generate as branded PDFs at Proposal + SOW stages (Phase 51 HTML/CSS engine; Renewal Quote uses the same proposal endpoint with a renewal flag)
- [x] Health scores recompute on every transition (`advanceStage` invokes `recomputeAndPersistHealth`)
- [x] Reports dashboards reflect live data without manual refresh (each tab refetches via react-query on mount)
- [x] Legacy URLs all redirect cleanly to new IA (13 redirects verified in `apps/web/tests/cutover.test.tsx`)

## Suggested next priorities (Phase 53+)

1. **Light up the Reports dashboards with real volume.** Once a firm has 20+ customers across stages, Pipeline conversion rates and Renewals projections become genuinely useful — current data is mostly demo.
2. **Doc-type expansion.** Status Report, Change Order, Runbook, Renewal Quote — extend the Phase 51 HTML/CSS template engine. The shared brand-pack helper already supports them.
3. **Structured pricing & quoting.** Move proposal pricing line-items into a typed `Quote` table so the Renewal Quote button can pull last year's contract + bump.
4. **Time tracking + AR.** A `TimeEntry` table keyed by `customerId` would feed Utilization (real hours, not just count) and unlock invoice generation tied to AR ownership.
5. **E-signature integration.** SOW signature collection currently uses the `sowSignature` table but no production e-signature provider is wired — pick DocuSign or HelloSign and ship.
6. **Real LIVE_SLA telemetry.** Uplink uptime metrics + incident streams so the LIVE_SLA widget shows live numbers instead of placeholders.
7. **In-app notifications → email/Slack.** Most alerts only fire when the user opens the inbox; pushing critical ones (renewal in <14 days, P1 incident) to email or Slack closes the loop.

## How to load the demo data

```bash
# CLI
pnpm -F @ofoq/api seed:lifecycle

# OR via admin endpoint (APP_ADMIN-gated, idempotent)
POST /api/v1/admin/seed-lifecycle
Body: { "includeDeadEnds": true }

# Verify all 4 personas see their daily view correctly
pnpm -F @ofoq/api verify:personas
# Expected output: "[verify] ✅ all 4 personas validated"
```

After seeding, the firm gains 16 `[DEMO]`-prefixed customers spanning
every lifecycle stage, with real BusinessProfile completeness, open
blockers/decisions, and ActivityLog stage transitions so every
dashboard renders with meaningful numbers.

---

_Generated by Phase 52.9 — final verification round of the IA rebuild._
