# Phase 52 — Information Architecture Rebuild (Design Spec)

> Status: **52.0 Design Spec** — this is the contract every later Phase 52
> sub-phase (52.1 schema, 52.2 nav, 52.3 list, 52.4 detail, 52.5 inbox,
> 52.6 cutover, 52.7 tests) implements against. No production behaviour
> changes when this doc lands; subsequent commits do the work.
> Last updated: Phase 52.0 commit.

## Why this rebuild exists

Today the app has **two parallel pipelines** (the Sales kanban at
`/sales/pipeline` and the Engagement projects at
`/engagements/:id/wizard`), **three vocabularies** for the same customer
journey (Sales says "prospect", Delivery says "engagement", SLA says
"account"), **a 7-link top nav** with no hierarchy, and **a dashboard
showing aggregate stats that nobody clicks on**.

Phase 52 collapses all of this into:

- **One table** (`Customer`) replacing both `Engagement` and `SalesPipeline`.
- **One 14-stage lifecycle** spanning Lead → Renewed.
- **One Customers page** with kanban / list / timeline views.
- **One Customer detail page** with a stage-aware sidebar and tabs.
- **One role-based Inbox** replacing the firm-wide stat dashboard.
- **A 4-link top nav**: Inbox / Customers / Reports / Settings.

The rebuild is **big-bang on the frontend** (cutover at 52.6) but
**migration-safe on the backend** (52.1 backfills, keeps old tables
read-only for one release, drops them in 52.6).

## The 14-stage unified lifecycle

```
LEAD  →  QUALIFIED  →  PROPOSAL  →  NEGOTIATION  →  WON
                                                      ↓
DISCOVERY  →  SCOPING  →  BUILD  →  UAT  →  GOLIVE  →  HYPERCARE
                                                      ↓
                          LIVE_SLA  →  RENEWAL_DUE  →  RENEWED
```

**Terminal stages** (excluded from the linear progress bar):
- `LOST` — terminal negative, pre-Won
- `CHURNED` — terminal negative, post-Live
- `RENEWED` — terminal positive (loops back into LIVE_SLA for the next
  contract period; UI shows "renewed N times")

**Stage groups** (used by the kanban column headers and the per-stage
sidebar visibility rules):

| Group       | Stages                                            |
| ----------- | ------------------------------------------------- |
| Pre-Sales   | LEAD, QUALIFIED, PROPOSAL, NEGOTIATION            |
| Closing     | WON                                               |
| Delivery    | DISCOVERY, SCOPING, BUILD, UAT                    |
| Launch      | GOLIVE, HYPERCARE                                 |
| Live        | LIVE_SLA, RENEWAL_DUE                             |
| Terminal    | RENEWED, LOST, CHURNED                            |

## Stage transitions (state machine)

Each transition has a **required precondition** and **side effects**:

| From → To              | Precondition                          | Side effect on transition           |
| ---------------------- | ------------------------------------- | ----------------------------------- |
| LEAD → QUALIFIED       | Lead source + industry captured       | Owner becomes Sales rep             |
| QUALIFIED → PROPOSAL   | Discovery-lite questionnaire complete | Proposal template offered           |
| PROPOSAL → NEGOTIATION | At least one proposal sent            | Pricing-summary doc offered         |
| NEGOTIATION → WON      | Signed SOW present                    | Owner becomes Project Lead          |
| WON → DISCOVERY        | Project lead assigned                 | Kickoff agenda template offered     |
| DISCOVERY → SCOPING    | Discovery questionnaire complete      | Solution Design template offered    |
| SCOPING → BUILD        | Field-mapping workbook approved       | Customisations sidebar enabled      |
| BUILD → UAT            | Build sign-off (DevOps)               | UAT scripts template offered        |
| UAT → GOLIVE           | UAT pass + Go/No-Go matrix green      | Cutover runbook template offered    |
| GOLIVE → HYPERCARE     | Go-live confirmed                     | Hypercare plan template offered     |
| HYPERCARE → LIVE_SLA   | Hypercare window elapsed              | Ticket queue enabled                |
| LIVE_SLA → RENEWAL_DUE | Contract end date within N days       | Renewal-proposal template offered   |
| RENEWAL_DUE → RENEWED  | Renewal SOW signed                    | Resets contract dates; renewedCount++ |
| any → LOST             | Manual; capture lostReason            | Read-only thereafter (isArchived=1) |
| LIVE_SLA → CHURNED     | Manual; capture lostReason            | Read-only thereafter (isArchived=1) |

**Backwards transitions** (e.g. PROPOSAL → QUALIFIED if the proposal
got pulled) are allowed without preconditions but log an
`ActivityLog` entry of type `STAGE_REVERTED`.

## Route inventory — old → new mapping

The Phase 52.6 cutover redirects old URLs to new ones. The table is
the contract for the redirect map.

| Old route                              | New route                                                        | Notes                                |
| -------------------------------------- | ---------------------------------------------------------------- | ------------------------------------ |
| `/dashboard`                           | `/inbox`                                                         | Role-aware inbox replaces stats      |
| `/dashboard/archived`                  | `/customers?archived=1`                                          | Filter on unified list               |
| `/sales/pipeline`                      | `/customers?view=kanban&group=pre-sales`                         | Kanban with stage filter             |
| `/sales/reports`                       | `/reports` (stub Phase 52, real Phase 53)                        |                                      |
| `/sales/prospects/:id/discovery-lite`  | `/customers/:id?tab=overview&action=discovery-lite`              | Embedded panel                       |
| `/sales/prospects/:id/proposal`        | `/customers/:id?tab=documents&template=proposal`                 |                                      |
| `/sales/prospects/:id/sow`             | `/customers/:id?tab=documents&template=sow`                      |                                      |
| `/engagements/:id/wizard`              | `/customers/:id`                                                 | Same id (FK rewrite makes it stable) |
| `/engagements/:id/documents`           | `/customers/:id?tab=documents`                                   |                                      |
| `/engagements/:id/data-collection`     | `/customers/:id?tab=overview&panel=data-collection`              |                                      |
| `/engagements/:id/vertical`            | `/customers/:id?panel=vertical`                                  |                                      |
| `/engagements/:id/status-report`       | `/customers/:id?tab=overview&panel=status-report`                |                                      |
| `/engagements/:id/jobs/:jobId`         | `/customers/:id/jobs/:jobId`                                     |                                      |
| `/sla/dashboard`                       | `/customers?filter=stage:LIVE_SLA,RENEWAL_DUE`                   |                                      |
| `/sla/tickets`                         | `/customers?filter=stage:LIVE_SLA&tab=tickets`                   |                                      |
| `/sla/renewals`                        | `/customers?filter=stage:RENEWAL_DUE`                            |                                      |
| `/custom-adaptors`                     | `/settings/integrations`                                         | Moved into Settings                  |
| `/settings/sales-templates`            | `/settings/templates?category=sales`                             | Merged into single Templates page    |
| `/wizard/:id`                          | `/customers/:id` (already redirected; kept for legacy bookmarks) |                                      |
| `/` (root)                             | `/inbox`                                                         | Was `/dashboard`                     |
| `/login`, `/signup`, `/portal/*`       | unchanged                                                        |                                      |

## The 4-link top nav

```
[Logo]   Inbox   Customers   Reports   Settings              [Profile menu]
```

- **Inbox** (default landing): role-aware. See §"Inbox per-role
  queries" below.
- **Customers**: unified list at `/customers`. Kanban / list / timeline.
- **Reports**: stub in Phase 52; Phase 53 fills it out (revenue,
  pipeline, win-rate, NPS, etc.).
- **Settings**: existing settings hub. New section `Integrations`
  hosts the old `/custom-adaptors` page.

**Active-state highlight**: based on the route path prefix.
`/customers/:id/...` keeps `Customers` highlighted; `/inbox/...`
keeps `Inbox` highlighted; etc.

**Removed from top nav**: Adaptors (→ Settings), Sales (→ Customers
filter), SLA (→ Customers filter), Tickets (→ Customer detail tab),
Archived (→ Customers filter).

## The Customers list page (`/customers`)

### Filter row (top of page)

| Filter            | Type           | Default      | Notes                                  |
| ----------------- | -------------- | ------------ | -------------------------------------- |
| My customers      | Toggle         | Off          | When on: `ownerUserId = currentUser`   |
| Stage             | Multi-select   | All non-archived | Grouped by Pre-Sales / Closing / etc. |
| Owner             | User picker    | All          |                                        |
| Source            | Single-select  | All          | Referral / Inbound / Outbound / Conference / Other |
| Industry          | Single-select  | All          | From firm's `industryVerticals[]`      |
| Value range       | Min–Max input  | (unset)      | Stored in cents                        |
| Search            | Text           | (empty)      | Matches `name` and `slug`              |
| Show archived     | Toggle         | Off          | When on: includes `isArchived=1`       |

Filter state is **URL-driven** (query params) so a filter view is
shareable. Example: `/customers?stage=LIVE_SLA,RENEWAL_DUE&owner=u-123`.

### View toggle: Kanban / List / Timeline

#### Kanban view

- One column per **stage group**.
- Sub-rows for each stage within the group, like the Trello "swimlane"
  pattern. Customers in DISCOVERY appear under Delivery → DISCOVERY,
  customers in BUILD under Delivery → BUILD.
- **Drag-and-drop** between stages writes to `Customer.currentStage`
  with the state-machine precondition check. If the precondition
  fails, the drag rolls back and a tooltip surfaces the blocker.
- Cards show: name, stage pill, owner avatar, deal value (if set),
  one-line "next action" suggestion.

#### List view

| Column        | Sortable | Notes                            |
| ------------- | -------- | -------------------------------- |
| Name          | ✓        |                                  |
| Stage         | ✓        |                                  |
| Owner         | ✓        | Avatar + name                    |
| Source        | ✓        |                                  |
| Value         | ✓        | Formatted USD                    |
| Health        | ✓        | 0–100 with color                 |
| Last activity | ✓ (default desc) | Relative time              |

Virtual-scroll for 1000+ rows. Bulk-select with checkbox for
mass-archive / mass-reassign-owner.

#### Timeline view

Horizontal Gantt-style timeline showing each customer as a bar from
`startDate` (or `createdAt` if unset) to `targetGoLive` (or NOW if
unset). Useful for Project Leads to see overlapping go-lives.

### Right-side aggregate stats panel (collapsible)

Shows aggregates for the **current filter**:

- Count of customers
- Total deal value (sum of `dealValue` for non-archived)
- Avg days in current stage
- Conversion rate to next stage (last 30 days)
- Pipeline value forecast (sum of `dealValue × stage-weight`)

Stage weights for forecast: LEAD=10%, QUALIFIED=25%, PROPOSAL=50%,
NEGOTIATION=70%, WON=100%, post-Won=100%. Configurable per firm in
Phase 53.

## The Customer detail page (`/customers/:id`)

### Header band (always visible)

```
[Avatar/logo]  Customer name                   [Stage pill]   [Advance →]
              slug · industry · source                       [Archive] [Menu]
              ─────────────────────────────────────────────
              People: [Owner] [Sponsor] [Client lead] [Consultant lead]
```

- **Stage pill** is colored by stage group (Pre-Sales gray, Delivery
  blue, Live green, Terminal black).
- **Advance** button is enabled only if the state-machine precondition
  is met for the next stage. Disabled state shows the blocker on hover.
- **People avatars** are clickable and open a side-drawer for that
  user.

### Phase progress bar (sticky below header)

Horizontal 14-node track:

```
LEAD ── QUAL ── PROP ── NEGO ── WON ── DISC ── SCOP ── BUILD ── UAT ── GOLIVE ── HYPER ── SLA ── REN_DUE ── RENEWED
 ✓       ✓      ✓      ✓     [●]      ─       ─       ─       ─       ─        ─       ─      ─        ─
```

- Completed stages: green check.
- Current stage: filled dot in stage-group color.
- Future stages: empty gray circle.
- Clicking a future node is a no-op. Clicking a past node opens the
  Activity tab filtered to events from that stage.
- Terminal stages (LOST, CHURNED) replace the bar with a single
  banner: "Lost · {reason}" or "Churned · {reason}".

### Action panel (top-right, sticky)

A single computed "what to do next" card based on stage + open items.
Examples:

- LEAD: "Send the cold-outreach email. (Template available.)"
- QUALIFIED: "3 discovery-lite questions waiting for sponsor signoff."
- PROPOSAL: "Proposal not yet generated."
- DISCOVERY: "12 questionnaire answers pending."
- BUILD: "5 customisations awaiting SME review."
- UAT: "UAT scripts 7/12 passed; 1 failed."
- LIVE_SLA: "Quarterly Health Check due in 5 days."
- RENEWAL_DUE: "Renewal proposal not yet sent."

The action-panel logic lives in
`apps/api/src/services/customerActionPanel.ts` (new file, Phase 52.4)
and returns `{ headline, body, ctaLabel, ctaUrl, severity }`.

### Tabs — stage-aware visibility

| Tab        | Visible for stages                                | Notes                                       |
| ---------- | ------------------------------------------------- | ------------------------------------------- |
| Overview   | all                                               | Summary card + action panel echo            |
| Activity   | all                                               | Timeline of every event                     |
| Documents  | WON onwards                                       | Saved `GeneratedDocument` rows              |
| Decisions  | DISCOVERY onwards                                 | Decision log                                |
| Risks      | DISCOVERY onwards                                 | Risk register                               |
| Threads    | WON onwards                                       | Conversation threads                        |
| Tickets    | LIVE_SLA, RENEWAL_DUE, RENEWED                    | Ticket queue                                |
| Billing    | WON onwards                                       | Invoices, milestones, AR aging              |
| Settings   | all                                               | Customer-specific overrides + archive       |

Tabs that aren't visible for the current stage are **hidden, not
disabled** — keeps the UI calm. Showing all tabs greyed-out leaks
implementation detail.

### Left sidebar — phase-grouped quick navigation

The sidebar lists **phase-scoped action surfaces**, not just the
template list (which lives in the Documents tab). Phase sections
appear when in or past that phase; never before.

```
Pre-Sales (visible LEAD onwards)
  ◦ Lead source
  ◦ Qualification questionnaire
  ◦ Outreach cadence

Sales (visible QUALIFIED onwards)
  ◦ Proposals
  ◦ Pricing summary
  ◦ Win/loss

Project Setup (visible WON onwards)
  ◦ Kickoff agenda
  ◦ Project charter
  ◦ Comms plan

Discovery (visible DISCOVERY onwards)
  ◦ Questionnaire
  ◦ License profile
  ◦ Blockers

Build (visible BUILD onwards)
  ◦ NetSuite customisations  ← renamed from "Customizations"
  ◦ Data migration
  ◦ Integrations

UAT (visible UAT onwards)
  ◦ Test scripts
  ◦ Defect log
  ◦ Go/No-Go matrix

Live (visible LIVE_SLA onwards)
  ◦ SLA dashboard
  ◦ Ticket queue
  ◦ Renewal date

Cash (visible WON onwards)
  ◦ Invoices
  ◦ Payment milestones
  ◦ AR aging
```

Each sidebar item routes to `/customers/:id?panel=<panel-key>`. The
panel renders inside the active tab's body or replaces it for
full-bleed panels (e.g. Test scripts).

## Inbox per-role queries (`/inbox`)

Role detection: `User.role` field. Fallback: "everything" view (the
union of all sections, useful for solo-founder firms where one
person plays every role).

Each section card: title, count badge, top 5 items, "view all" link.

### BDR

- **Leads to follow up today** — `currentStage = LEAD` and `lastActivityAt < NOW - 3 days` and `ownerUserId = me`.
- **Active outreach cadences with steps due** — Phase 53 (cadence engine not yet built); shows empty state in Phase 52.
- **Fresh inbound leads (last 24h)** — `currentStage = LEAD` and `leadSource = Inbound` and `createdAt > NOW - 24h`.
- **Conference / event follow-ups** — `leadSource = Conference` and `lastActivityAt < NOW - 7 days`.

### Sales rep

- **Deals at Proposal/Negotiation needing my attention** — `currentStage IN (PROPOSAL, NEGOTIATION)` and `ownerUserId = me` and `daysInStage > 7`.
- **Proposals to finalise** — `currentStage = PROPOSAL` and no `GeneratedDocument` of type `proposal` exists for the customer.
- **Calls scheduled today** — from `Meeting` table where `scheduledAt = today` and `attendees CONTAINS me`.
- **Quotes expiring this week** — Phase 53.

### Sales manager

- **Pipeline by rep** — Group `currentStage IN pre-sales OR closing` by `ownerUserId`, aggregate count + value.
- **Forecast** — Sum of `dealValue × stage-weight` across pre-Won stages.
- **Win rate** — `WON / (WON + LOST)` over last 90 days.
- **Stuck deals** — `daysInStage > 14` and `currentStage` not terminal.
- **This-week close commitments** — `currentStage = NEGOTIATION` and `targetGoLive ≤ NOW + 7 days`.

### Project Lead

- **Decisions waiting on sponsor signoff** — `Decision` rows where `status = PENDING_SPONSOR` and `customer.ownerUserId = me`.
- **Blockers across my active customers** — `Risk` rows where `status = OPEN` and `severity = HIGH` and `customer.ownerUserId = me`.
- **Status reports due** — Customers where `nextStatusReportDue ≤ NOW + 1 day` and `ownerUserId = me`.
- **Engagements at risk** — `customer.health < 50` and `ownerUserId = me`.

### SME

- **Questionnaire questions assigned to me** — `WizardAnswer` or `DataCollection` rows where `assignedTo = me` and `status != ANSWERED`.
- **Documents waiting for my review** — `GeneratedDocument` rows where `reviewerId = me` and `status = PENDING_REVIEW`.
- **Threads with @-mentions** — `ConversationThread` messages where `mentions CONTAINS me` and `readAt IS NULL`.

### Customer Success Manager

- **Renewals coming due (next 90 days)** — `currentStage IN (LIVE_SLA, RENEWAL_DUE)` and `contractEndDate ≤ NOW + 90 days`.
- **Quarterly Health Checks scheduled** — `Meeting` rows tagged `QHC` and `scheduledAt > NOW`.
- **Escalated tickets** — `Ticket` rows where `priority = P1` and `status != RESOLVED`.

### Account Manager

- **Renewal opportunities** — `currentStage = RENEWAL_DUE`.
- **Upsell signals** — Customers where `modules` count < firm's avg modules sold per customer (heuristic).
- **Customer health alerts** — `customer.health < 70`.

### AR clerk

- **Invoices to send** — Payment-milestone rows where `triggeredAt <= NOW` and `invoiceSentAt IS NULL`.
- **Overdue payments** — Invoice rows where `dueDate < NOW` and `paidAt IS NULL`.
- **Statements to issue** — Customers where `lastStatementSentAt < NOW - 30 days` and `currentStage IN (LIVE_SLA, RENEWAL_DUE)`.

### Firm partner / owner

- **Portfolio health snapshot** — Count by stage group + aggregate health avg.
- **Pipeline value + forecast** — Total weighted forecast across all reps.
- **Revenue this month / quarter** — Sum of paid invoices in window.
- **At-risk customers** — `health < 30` and not archived.

## Backfill strategy (Phase 52.1)

Runs **once on first boot** after the Phase 52.1 deploy. Detected by
checking whether the `Customer` table is empty AND the `Engagement`
or `SalesPipeline` tables are non-empty. Subsequent boots see a
populated `Customer` and skip.

### Stage mapping — Engagement → Customer

| `Engagement.status` | `Customer.currentStage` | Notes                                           |
| ------------------- | ----------------------- | ----------------------------------------------- |
| PROSPECT            | LEAD                    | (Pre-50.9 prospects sometimes have this)        |
| PROPOSED            | PROPOSAL                |                                                 |
| CONTRACTED          | WON                     | "Contracted" was the old "Won + ready to build" |
| DISCOVERY           | DISCOVERY               |                                                 |
| SCOPING             | SCOPING                 |                                                 |
| BUILD               | BUILD                   |                                                 |
| UAT                 | UAT                     |                                                 |
| GOLIVE              | GOLIVE                  |                                                 |
| CLOSEOUT            | HYPERCARE               | "Closeout" was the post-go-live tail            |
| SLA_ACTIVE          | LIVE_SLA                |                                                 |
| ARCHIVED            | (preserve previousStatus); `isArchived = 1` | Use `previousStatus` to recover terminal stage  |

### Stage mapping — SalesPipeline → Customer

| `SalesPipeline.status` | `Customer.currentStage` | Notes                                      |
| ---------------------- | ----------------------- | ------------------------------------------ |
| NEW                    | LEAD                    |                                            |
| QUALIFIED              | QUALIFIED               |                                            |
| DISCOVERY_LITE         | QUALIFIED               | Discovery-lite is **firm pre-discovery**, NOT the post-Won DISCOVERY phase |
| PROPOSAL_SENT          | PROPOSAL                |                                            |
| NEGOTIATION            | NEGOTIATION             |                                            |
| WON                    | (merge with Engagement of same firmId+clientName if present; else WON) |  |
| LOST                   | LOST; `isArchived = 1`  |                                            |

### Merge logic for SalesPipeline+WON ↔ Engagement

A pipeline deal that closed (WON) typically has a matching Engagement
row created at conversion time. The backfill **merges** these:

1. For each `SalesPipeline` row with `status = WON`, look up
   `Engagement WHERE firmId = ? AND clientName = ?`.
2. If found: insert a single `Customer` using the Engagement's
   id+stage, carrying the deal value + lead source + lostReason from
   the SalesPipeline row.
3. If not found: insert as a standalone WON customer.

This collapses the duplicate-row problem the existing two-table
design has.

### Foreign-key rewrite

The following tables today reference `engagementId`. After backfill,
they need `customerId` pointing to the new row. Migration steps per
table:

1. `ALTER TABLE <table> ADD COLUMN customerId TEXT;`
2. `UPDATE <table> SET customerId = (SELECT id FROM Customer WHERE <existing FK matches>);`
3. Verify no `customerId IS NULL` rows.
4. (Phase 52.6 final cleanup) drop the old `engagementId` column.

Affected tables: `Decision`, `Risk`, `ActionItem`, `Thread`,
`ConversationThread`, `Meeting`, `Issue`, `GeneratedDocument`,
`Ticket`, `WizardAnswer`, `DataCollection`, `Job`, `EngagementRole`,
`ActivityLog`, `StatusReport`, `PendingSubmission`, `License`.

Because Customer.id is **set equal to Engagement.id** during backfill
(no new cuids minted for migrated rows), most foreign keys keep
working without rewrite — the column name change is the only delta.
SalesPipeline-only customers (LEAD/QUALIFIED/PROPOSAL/NEGOTIATION
without a matching Engagement) DO get fresh cuids, but they have no
child rows yet, so there's nothing to rewrite.

## What gets deleted in Phase 52.6 cleanup

- `apps/web/src/pages/DashboardPage.tsx` (replaced by InboxPage)
- `apps/web/src/pages/SalesPipelinePage.tsx` (replaced by CustomersPage)
- `apps/web/src/pages/EngagementWizardPage.tsx` (replaced by CustomerDetailPage)
- `apps/web/src/pages/SlaDashboardPage.tsx` / SlaTicketsPage / SlaRenewalsPage (replaced by filtered Customers + tabs)
- `apps/web/src/pages/CustomAdaptorsPage.tsx` (moved under `/settings/integrations`)
- `apps/web/src/components/TopNav.tsx` (replaced by 4-link `AppNav.tsx`)
- The kanban code at `apps/web/src/components/SalesPipeline*` (replaced by unified CustomersKanban)
- DB: drop `Engagement` and `SalesPipeline` table-level helpers that
  aren't backed by Customer. Keep `Engagement` and `SalesPipeline`
  tables themselves for one more release as read-only safety net;
  drop in Phase 53.

## Sub-phase commit plan

| Sub-phase | What lands                                                         | Calendar slot |
| --------- | ------------------------------------------------------------------ | ------------- |
| **52.0**  | This document                                                      | Week 0        |
| **52.1**  | `Customer` table, helpers, backfill migration, FK rewrite          | Week 1        |
| **52.2**  | New `AppNav.tsx` (4 links), new route stubs `/inbox`, `/customers`, `/customers/:id`, `/reports` | Week 1 |
| **52.3**  | `/customers` page: filters, kanban, list, timeline, aggregate panel | Week 2        |
| **52.4**  | `/customers/:id` page: header, progress bar, action panel, tabs, sidebar | Week 3 |
| **52.5**  | `/inbox` page: role-aware sections                                 | Week 4        |
| **52.6**  | Cutover: redirect map, delete dead code                            | Week 5        |
| **52.7**  | Tests + production verification                                    | Week 6        |

Each sub-phase ships its own commit cluster on `main`. Week 1–5 ship
the new IA **alongside** the old (both work). Week 5 (cutover) flips
the default and removes the old. Week 6 is hardening only.

## Test targets

- api ≥ 2900 (currently 2839 — Phase 52 adds ≥ 61 tests across schema, migration, action-panel logic, inbox queries)
- web ≥ 320 (currently 287 — Phase 52 adds ≥ 33 tests across CustomersList filters, CustomerDetail tab visibility, PhaseProgressBar, AppNav, Inbox role rendering)

## Open questions (resolve before 52.1 lands)

1. **`renewedCount` semantics.** When a customer transitions
   RENEWAL_DUE → RENEWED, does the stage loop back to LIVE_SLA with
   `renewedCount++`, or stay terminal at RENEWED? Recommendation:
   loop back. RENEWED is a UI badge, not a terminal stage in storage.

2. **Multi-owner customers.** Some customers have BOTH a Sales rep
   AND a Project Lead. The schema has one `ownerUserId`. Phase 52.1
   should add a separate `salesOwnerUserId` and rename `ownerUserId`
   to `projectOwnerUserId`. Inbox queries use the appropriate
   column based on stage.

3. **Stage rollback audit.** Backwards transitions log a
   `STAGE_REVERTED` activity entry. Do we surface this prominently
   (a red banner on the customer header) or quietly (just in
   Activity)? Recommendation: quiet — Sales reps legitimately
   backwards-step deals all the time.

4. **`Customer.health`** computation. Current `Engagement.health` is
   computed from open risks + overdue actions + blocked decisions.
   For pre-Won stages there are no risks/decisions yet — so health
   defaults to N/A. Confirm the heuristic for each stage group.

5. **Mobile pass.** Spec says desktop-only for Phase 52. The kanban
   in particular doesn't work on phones. Confirm the team is OK with
   "open the app on desktop" being the official answer for Phase 52.

## References

- Phase 49: Brand Pack contract → `docs/firm-templates.md`
- Phase 50: Documents pipeline → `docs/engagement-documents.md`
- Phase 50.9: PDF colour + overlap + seed hotfixes → commits 496945a, a117ce5, 4da0d3a, 20dff67
- Phase 51: HTML/CSS document engine (parallel in-flight sprint) → spec in conversation history
