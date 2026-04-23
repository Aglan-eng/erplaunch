# Platform Adaptor SPI

Status as of **2026-04-25**: live in production. Two built-in adaptors (NetSuite, Odoo), firm-authored custom adaptors via document upload + AI parse, full end-to-end wiring (questions, license, phases, generators, declarative rule evaluation, AI prompts).

This doc explains how the SPI is shaped, how adaptors flow through the runtime, and which pieces are adaptor-aware today vs still NetSuite-shaped.

---

## Why an SPI

The pilot shipped NetSuite-only. The pivot plan called for supporting "any ERP or software implementation," but doing that cleanly required isolating the parts of the app that assumed NetSuite. The SPI is the seam: a `PlatformAdaptor` object packages everything the platform needs to drive an engagement against one target system. Built-ins ship with the repo; custom adaptors are firm-authored at runtime from uploaded docs.

Wins on the pivot:

- A second adaptor (Odoo) ships in ~500 lines of TypeScript with its own questions, license model, phase plan, and rule pack.
- Custom adaptors need zero code changes — firms upload vendor docs, Claude drafts a `PlatformAdaptor` JSON, firm reviews + publishes.
- The evaluator, wizard, and document generators run one code path. No per-adaptor branching outside the boundary.

---

## The shape

Every adaptor is a single object implementing `PlatformAdaptor` from `@ofoq/adaptor-sdk`:

```ts
interface PlatformAdaptor {
  manifest:   AdaptorManifest;     // id, name, vendor, version, capabilities
  schema:     QuestionnaireSchema; // flows → sections → questions
  license:    LicenseModel;        // editions + modules + default
  phases:     PhaseModel;          // default phases
  rules:      RulePack;            // rule definitions with optional `when` clauses
  generators: OutputGeneratorDefinition[];
}
```

Types live in [`packages/adaptor-sdk/src/index.ts`](../packages/adaptor-sdk/src/index.ts). The SDK has zero framework dependencies (only `zod` for the validator) so adaptors can be loaded server-side, typed in the SPA, and shared with anything else without pulling in Fastify / React.

`validateAdaptor(adaptor)` runs at registration time: it asserts the manifest is well-formed, flows/editions/phases/rules/generators are arrays. It does **not** validate rule logic or schema consistency — those are the adaptor author's responsibility (see each built-in's test suite).

### Flow IDs

Schemas declare flows by well-known IDs: `R2R`, `P2P`, `O2C`, `PRODUCTION`, `RETURNS`. The wizard maps these to its URL-prefix convention: `r2r.*`, `p2p.*`, `o2c.*`, `mfg.*`, `rtn.*`. Adaptors can use any section IDs within those flows — the mapping table is `wizardPrefixForFlow` in [`apps/api/src/services/adaptorSchemaHelpers.ts`](../apps/api/src/services/adaptorSchemaHelpers.ts).

### Capabilities

Adaptors declare capabilities as string tags: `document`, `script`, `workflow`, `license.gating`, `phase.planning`, `connector.read`, `connector.push`. The runtime uses these as metadata only today (displayed in the ERP picker). `connector.read` is reserved for future live-data integrations.

---

## Registry + resolution

### Built-in adaptors

Process-wide registry at [`packages/adaptor-registry`](../packages/adaptor-registry/). Singleton with `register / has / get / find / list`. `apps/api/src/server.ts` registers every built-in once at boot via `registerBuiltinAdaptor(...)`.

```
server.ts boot →
  registerBuiltinAdaptor(netsuiteAdaptor)
  registerBuiltinAdaptor(odooAdaptor)
  [guarded by globalThis.__erplaunch_adaptors_registered so hot-reload doesn't double-register]
```

### Custom adaptors

Per-firm, stored in the DB (`CustomAdaptor` table). Uploaded docs → AI parse → draft state → firm publishes → becomes visible to the engagement creator for that firm as `custom:<slug>`.

Custom adaptors are **never** promoted to the process registry. Every lookup goes through `findCustomAdaptorByFirmAndSlug(firmId, slug)` to preserve tenant isolation.

### Engagement → adaptor resolution

`Engagement.adaptorId` is a FK onto whichever registry holds the adaptor. Resolution helper in [`apps/api/src/routes/engagements.ts`](../apps/api/src/routes/engagements.ts):

```
resolveAdaptorContext(adaptorId, firmId) →
  custom:<slug>  → DB lookup, returns {platform, flattenedQuestions}
  netsuite       → {} (legacy @ofoq/shared bank)
  else           → registry.find(adaptorId)
```

Routes never call the registry directly when the firm matters — they use `resolveAdaptorContext` or `resolveRulePack` so cross-firm leakage is structurally impossible for custom adaptors.

---

## What's adaptor-aware end-to-end

| Surface | Adaptor-driven? | Notes |
|---|---|---|
| ERP picker | Yes | `/adaptors` overlays firm's published custom on top of built-ins |
| `Engagement.adaptorId` | Yes | Validated against registry + firm DB on create |
| Wizard sidebar | Yes | Bridged from `schema.flows` → flow-prefix groups |
| Wizard sections | Yes | `FlowSectionStep` renders adaptor's questions, falls back to NetSuite bank |
| Dependency gates | Yes | `QuestionCard` reads `dependsOn` from bridged questions |
| License editor | Yes | Editions + modules from `adaptor.license` |
| Rule evaluation | Yes (declarative) | `evaluateAdaptorRules(pack, {answers, license})` — see below |
| Generator catalog | Yes | `/engagements/:id/generators` from adaptor |
| Generator runner | Partial | Platform-neutral docs always; NetSuite-only for SDF + SuiteScript |
| AI advisor prompts | Yes | `platform: {id, name, vendor, sectionLabel}` in every call |
| AI profile generator | Yes | Question bank + platform framing from adaptor |

**Not yet adaptor-driven**:

- NetSuite's own rule engine (`packages/rule-engine/`) runs hand-written rules with phase-dependency logic that doesn't fit the current declarative `when` shape. Lives alongside the adaptor evaluator and is only invoked when `adaptorId === 'netsuite'`.
- Generator runner emits platform-neutral documents for non-NetSuite adaptors. Adaptor-native artifacts (Odoo XML-RPC push, Dynamics extensions, etc.) are a later phase.
- Custom adaptor draft editor — firms can view and publish the AI-drafted PlatformAdaptor but can't yet hand-edit rule `when` clauses from the UI.

---

## Declarative rule evaluation

`RuleDefinition` has an optional `when: RuleCondition` clause. `evaluateAdaptorRules(pack, input)` is a pure function that walks the pack, fires the `when` tree against `{answers, license}`, and returns `AdaptorRuleConflict[]`.

### Condition language

```ts
type RuleCondition =
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition }
  | { answerEquals:      { questionId: string; value: unknown } }
  | { answerTruthy:      { questionId: string } }
  | { answerFalsy:       { questionId: string } }
  | { licenseEditionIn:      string[] }
  | { licenseEditionNotIn:   string[] }
  | { licenseHasModule:      string }
  | { licenseMissingModule:  string };
```

Intentionally small. JSON-serializable by design — the Custom Adaptor Wizard will eventually let firms author these in a form UI or hand-written JSON. Truthy follows JS intuitions with carve-outs: `0`, `''`, `[]`, `{}` all fall on the falsy side.

### Example Odoo rule

```ts
{
  id: 'odoo.mrp.requires-mrp-module',
  type: 'LICENSE_GAP',
  severity: 'BLOCK',
  questionIds: ['odoo.mrp.enabled'],
  message: 'Manufacturing is enabled but the MRP module is not provisioned.',
  resolution: 'Add "MRP" to the Licensed Modules list or set Manufacturing to No.',
  when: {
    all: [
      { answerTruthy: { questionId: 'odoo.mrp.enabled' } },
      { licenseMissingModule: 'MRP' },
    ],
  },
}
```

Rules without a `when` clause stay metadata-only — they render in the AdaptorPanel count and serve as documentation, but don't auto-fire.

### Where it runs

Three routes re-evaluate conflicts after any answer or license change, dispatching per-adaptor:

- `PATCH /engagements/:id/profile` — after answers save
- `PUT /engagements/:id/license` — after license change
- `POST /engagements/:id/generate-profile` — after AI auto-fill

All three call `evaluate(...)` (legacy NetSuite engine) when `adaptorId === 'netsuite'`, otherwise `evaluateAdaptorRules(pack, {answers, license})` against the resolved pack.

---

## Custom adaptor lifecycle

```
  DRAFT  (firm clicks "New custom adaptor", provides name + slug)
    │
    │  firm uploads PDF / DOCX / TXT / MD source docs
    ▼
  DRAFT  (sourceDocuments[] appended)
    │
    │  firm triggers /parse
    ▼
  PARSING  (fire-and-forget; polls for completion)
    │
    ├── ok → READY  (parsedManifest/schema/license/phases/generators populated,
    │                 validated via validateAdaptor())
    └── fail → FAILED  (parseError recorded; firm can re-upload + retry)
    │
    │  firm reviews in UI (PATCH /draft lets them edit any field)
    ▼
  READY
    │
    │  firm clicks "Publish"
    ▼
  PUBLISHED  (visible in engagement picker as "custom:<slug>")
    │
    ▼  (optional)
  ARCHIVED  (soft-deleted; hidden from list but retained)
```

- Parse service: [`apps/api/src/services/customAdaptorParse.ts`](../apps/api/src/services/customAdaptorParse.ts). PDF via `pdfjs-dist`, DOCX best-effort via optional `mammoth` import, TXT/MD direct. Extracted text truncated to ~180k chars and sent to Claude with the `PlatformAdaptor` contract as the output schema.
- Routes: [`apps/api/src/routes/customAdaptors.ts`](../apps/api/src/routes/customAdaptors.ts). Every mutation is firm-scoped; 19 integration tests in `apps/api/tests/routes/customAdaptors.test.ts` lock in tenant isolation.

---

## Testing strategy

Each adaptor has its own test file asserting:

- Manifest identity (id, vendor, capabilities)
- `validateAdaptor()` returns ok
- Schema flow order + unique question IDs
- License editions + modules
- Phase order
- Generator catalog
- Registry registration behavior (duplicate rejection, etc.)
- Rule pack: shape validity, namespace, questionId references to real questions, behavioral evaluation of the `when` clauses

Additional layers:

- `packages/adaptor-sdk/tests/` — evaluator unit tests (12 tests covering every combinator + leaf predicate)
- `apps/api/tests/routes/customAdaptors.test.ts` — 19 HTTP integration tests, tenant isolation, multipart upload
- `apps/api/tests/routes/odooRuleEvaluation.test.ts` — 5 end-to-end tests driving real Odoo conflicts through `PUT /license` + `PATCH /profile`
- `apps/api/tests/services/adaptorSchemaHelpers.test.ts` — 12 tests for `findSectionLabel`, `flattenAdaptorSchemaToQuestions`, `wizardPrefixForFlow`

Full workspace: **263 tests passing** across 7 packages.

---

## Adding a new built-in adaptor

1. Create `packages/adaptor-<name>/` mirroring `packages/adaptor-odoo/` (package.json, tsconfig.json, src/index.ts, tests).
2. Export `export default <name>Adaptor: PlatformAdaptor` as the module's default.
3. Add `"@ofoq/adaptor-<name>": "workspace:*"` to `apps/api/package.json`.
4. Register at boot: `registerBuiltinAdaptor(<name>Adaptor)` in `apps/api/src/server.ts`.
5. Add COPY lines to `apps/api/Dockerfile` so the package is available in the production image.
6. Remove the `<name>` entry from `COMING_SOON` in `apps/web/src/components/dashboard/NewEngagementModal.tsx` so the picker treats it as live.

Tests should mirror the Odoo pack structure — see `packages/adaptor-odoo/tests/adaptor.test.ts` as a working template.

---

## References

- [`docs/adr/0005-adaptor-spi.md`](./adr/0005-adaptor-spi.md) — decision record
- [`packages/adaptor-sdk/src/index.ts`](../packages/adaptor-sdk/src/index.ts) — type definitions + validator + evaluator
- [`packages/adaptor-registry/src/index.ts`](../packages/adaptor-registry/src/index.ts) — process-wide registry
- [`packages/adaptor-netsuite/src/index.ts`](../packages/adaptor-netsuite/src/index.ts) — reference built-in (wraps legacy NetSuite code)
- [`packages/adaptor-odoo/src/index.ts`](../packages/adaptor-odoo/src/index.ts) — reference built-in (native, with declarative rules)
- [`apps/api/src/routes/customAdaptors.ts`](../apps/api/src/routes/customAdaptors.ts) — firm-authored adaptor lifecycle routes
- [`apps/api/src/services/customAdaptorParse.ts`](../apps/api/src/services/customAdaptorParse.ts) — AI parse pipeline
- [`apps/web/src/pages/CustomAdaptorsPage.tsx`](../apps/web/src/pages/CustomAdaptorsPage.tsx) — firm-authored adaptor wizard UI
