# Microsoft Project Schedule (Phase 47)

ERPLaunch emits a Microsoft Project 2003 XML Schedule Interchange file
(`Project_Plan.xml`) for every engagement. The file opens natively in
Microsoft Project Desktop and saves as a real `.mpp` on first save, so
consultants get full `.mpp` interop without ERPLaunch having to write
the proprietary binary format.

## Where the file is generated

`Project_Plan.xml` is produced by
`apps/api/src/services/generators/msProjectPlanGenerator.ts`. The
generator is pure — it takes engagement metadata, project members,
open action items, and pending decisions and returns
`Record<string, string>` with a single `Project_Plan.xml` key.

There are **two** ways the file gets emitted:

1. **Inside the BUSINESS_PROFILE bundle.** Every full-pack generation
   run lands the file at the bundle root next to `manifest.json` (so
   the resulting ZIP now contains 147 files, up from 146).
2. **As a standalone single-file deliverable.** The
   `MS_PROJECT_PLAN` job type produces the file by itself — no
   wizard answers, no other artifacts. The dashboard kanban quick-
   download icon and the GeneratePanel "Generate Project Plan"
   button both fire this job type.

## Schedule structure

| Element | Mapping |
|---|---|
| `<Title>` | `Engagement.clientName` |
| `<StartDate>` | `Engagement.startDate` (defaults to today) |
| `<FinishDate>` | `Engagement.contractEndDate` (defaults to start + 27 weeks) |
| `<Manager>` | `EngagementRole(PROJECT_MANAGER)` user, falls back to project member with role containing "Project Manager" |
| Summary tasks | 5 lifecycle stages — Discovery, Scoping, Build, UAT, Go-Live |
| Sub-tasks | open ActionItems + needsAction Decisions, bucketed under their stage |
| Resources | every CONSULTANT-team `ProjectMember` (CLIENT-team members are stakeholders, not project resources) |
| Assignments | module-agnostic consultants assigned to all 5 phases; module-scoped to Scoping/Build/UAT only |
| Predecessors | `Type=1` (FinishToStart) chain across all 5 phases |

## Default phase durations

```
Discovery   4 weeks
Scoping     6 weeks
Build      12 weeks
UAT         4 weeks
Go-Live     1 week
            ──────
Total      27 weeks
```

These are pinned in `PHASE_DEFAULTS` and locked by a vitest contract.
Action items with explicit `dueDate` override the phase default for
their sub-task duration.

## Direct-download URL

```
GET /api/v1/engagements/:id/project-plan/latest.xml
```

Returns the latest COMPLETE `MS_PROJECT_PLAN` job's
`Project_Plan.xml` with `Content-Disposition: attachment; filename="<Client> - Project Plan.xml"`.
Returns `404 NO_PROJECT_PLAN` when no such job exists yet — the UI
then prompts the user to generate one.

For a specific job, the existing files endpoint also works:

```
GET /api/v1/engagements/:id/jobs/:jobId/files/Project_Plan.xml
```

## Opening the file in Microsoft Project Desktop

1. Open Microsoft Project Desktop (2013 or newer).
2. **File → Open → Browse**.
3. In the file-type dropdown, pick **MS Project Schedule (\*.xml)**.
4. Select the downloaded `Project_Plan.xml`.
5. Project Desktop imports the schedule, resources, and assignments.
6. Save once — Project Desktop converts the file to `.mpp`.

The conversion preserves every element: tasks keep their UID/ID,
predecessor links remain `FinishToStart`, resources stay assigned to
the same tasks, and outline levels stay intact (summary at level 1,
sub-tasks at level 2).

## Testing

Generator-level tests live at
`apps/api/tests/services/generators/msProjectPlanGenerator.test.ts`.
Route-level tests for the convenience endpoint live at
`apps/api/tests/routes/engagementProjectPlan.test.ts`.

To verify a new schedule shape opens cleanly:

```bash
pnpm --filter @ofoq/api test -- msProjectPlanGenerator
```

To produce a sample file locally:

```ts
import { generateMsProjectPlan } from './apps/api/src/services/generators/msProjectPlanGenerator';
import { writeFileSync } from 'fs';

const out = generateMsProjectPlan({
  clientName: 'Sample Client',
  startDate: '2026-06-01',
  contractEndDate: '2026-12-31',
  projectManagerName: 'Sample PM',
  members: [],
  actionItems: [],
  decisions: [],
});
writeFileSync('Project_Plan.xml', out['Project_Plan.xml']);
```

Then drag the file onto Microsoft Project Desktop to confirm the
schedule renders.
