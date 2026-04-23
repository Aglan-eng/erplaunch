# ADR 0005 — Platform Adaptor SPI

**Status:** Accepted (pilot, 2026-04-25). Re-evaluate when the first `connector.read` adaptor ships.

## Context

ERPLaunch shipped NetSuite-only for the pilot. The roadmap called for supporting "any ERP or in-house system," initially via a second vendor adapter, eventually via firm-authored custom adapters. Three forces pushed against each other:

1. **Pilot velocity.** We couldn't stop shipping to refactor the whole runtime around an adapter abstraction mid-pilot.
2. **Real pivot.** The platform-pivot plan (see repo history) was explicit that long-term we need one code path for any target system, not N forks of the wizard.
3. **Firm authorship.** The highest-leverage feature was letting firms onboard their own in-house systems without us shipping code. That only works if the abstraction is genuine.

Options considered:

1. **Per-target forks.** Copy the NetSuite wizard, strip, customise. Fastest to a second adapter, worst long-term. Rejected on Day 1.
2. **Conditional switches everywhere.** Add `if (adaptorId === 'odoo')` at every decision point in the existing code. Deferred the refactor debt indefinitely. Rejected.
3. **Single-object SPI.** One `PlatformAdaptor` object captures manifest, schema, license, phases, rules, generators. Registry loads built-ins at boot; firm-authored ones live in the DB. Every NetSuite-assuming call site migrates to the SPI one at a time; NetSuite itself becomes the first implementation of it.

## Decision

Adopt option 3. Ship `@ofoq/adaptor-sdk` (pure types + validator + pure rule evaluator), `@ofoq/adaptor-registry` (process-wide singleton for built-ins), `@ofoq/adaptor-netsuite` (wraps existing NetSuite code as the reference implementation), `@ofoq/adaptor-odoo` (native second adapter), and a DB-backed custom adaptor lifecycle.

Migrate NetSuite-assuming surfaces one commit at a time, NetSuite staying as the fallback on every dispatch. Twelve phases from first SPI scaffold (Phase 1A) to the declarative rule evaluator (Phase 12).

## Rationale

- **One SPI, not two.** Every adaptor implements the same shape — whether built-in, firm-authored custom, or a future third-party marketplace. The code paths the SPA + API run don't branch on source.
- **Incremental migration.** The NetSuite adapter wraps existing code rather than re-implementing it. Every phase ships independently: ERP picker first, then per-engagement adaptor resolution, then wizard questions, then license, then rules. Each phase was commit-sized and deploy-verified before the next one started.
- **Firm authorship as a first-class capability.** Custom adaptors are DB-backed, firm-scoped, and go through the same validation as built-ins. Firms upload source docs, Claude drafts the PlatformAdaptor JSON, firm reviews + publishes. Zero platform-team involvement per new target system.
- **Pure-function evaluator.** The declarative rule evaluator is framework-free (no Fastify, no React, no zod outside validation). Runs in the API today; the same code can run in the SPA for client-side previews, or in a worker for bulk evaluation, with zero glue.
- **Tenant isolation is structural, not convention.** Custom adaptors are looked up via `findCustomAdaptorByFirmAndSlug(firmId, slug)` on every request. Routes don't get a handle that could be passed cross-firm.

## Consequences

- **Two rule evaluators co-exist.** NetSuite's hand-written `packages/rule-engine/` runs when `adaptorId === 'netsuite'`; the new `evaluateAdaptorRules()` runs for everything else. The declarative `when` language doesn't (yet) express every NetSuite rule — some have phase-dependency logic that would need combinators we don't have. We keep both until either (a) NetSuite rules are ported onto the declarative model, or (b) the declarative language grows the missing primitives. Acceptable for the pilot + immediate post-pilot; see "When to revisit."
- **Generator runner is half-migrated.** `processJob` branches: NetSuite adapters get the legacy full pack (BRD + SDF + SuiteScript + docs); non-NetSuite get the platform-neutral document set only. SDF/SuiteScript are NetSuite-specific file formats; emitting them against Odoo would be meaningless. Adaptor-native generators (Odoo `.po` modules, Dynamics extensions) are a later phase — no forcing function until a client asks.
- **Custom adaptor authoring UI is read-only + publish.** Firms can view the AI-drafted PlatformAdaptor and publish it; the `PATCH /draft` route supports hand edits but there's no form UI for rule `when` authoring yet. Firms that need custom rules either edit the JSON via the API directly or wait for Phase 13+.
- **Schema migration has a tolerance window.** The CustomAdaptor table was added mid-pilot; reruns of `initDb()` tolerate its absence via `CREATE TABLE IF NOT EXISTS`. Additive changes only — same SQLite constraint as the rest of the schema (see ADR 0001).
- **The SPI contract is stable but young.** `SDK_VERSION = '0.1.0'`. The validator checks manifest shape but not semantic compatibility — an adaptor authored against 0.1 will keep loading into 0.2 as long as its JSON still parses, even if some fields are ignored. Semver enforcement happens when we ship a breaking change, not before.

## Alternatives considered

- **Do not write an SDK package at all — just make `packages/adaptor-*` each export a literal object with no shared types.** Rejected because custom adaptors need the types for AI parse validation + the runtime registry needs them for shape checks.
- **Use a general-purpose rule engine (json-logic, CEL, Rego).** Rejected for the declarative evaluator: the rule-definition audience is firm consultants authoring in JSON, not developers. A bespoke 10-operator language is more approachable than a Turing-complete one, and the authoring UI (still to come) can be structural rather than text-based.
- **Make custom adaptors process-global after publish.** Rejected — a firm's custom adaptor has no business being visible to another firm on the same deployment. Every lookup is firm-scoped.

## When to revisit

- **Third party publishes a marketplace adaptor.** The SDK has `'marketplace'` as a valid `sourceKind` but nothing uses it yet. When it does, revisit the validator + registry to support signed + versioned marketplace loads.
- **First `connector.read` capability ships.** That requires credential handling, network I/O, and async data-refresh flows that the current `PlatformAdaptor` shape doesn't yet account for. Expect an SDK 0.2 with `connectors: ConnectorDefinition[]` on the adapter and a runtime connector registry.
- **NetSuite rule engine gets ported.** The legacy engine has cross-phase dependency logic that the declarative language doesn't express. Either (a) retire the legacy engine after extending the condition language, or (b) accept both engines long-term and document the split. Decision: (a), once a concrete phase-dependency rule is authored on a non-NetSuite adapter.
- **SDK breaking change.** Bump to 0.2, tighten the validator to reject `minSdk < 0.2` at register time, write a migration note.

## Links

- [`docs/adaptor-spi.md`](../adaptor-spi.md) — architectural reference
- [`packages/adaptor-sdk/src/index.ts`](../../packages/adaptor-sdk/src/index.ts) — the SPI contract
- [`packages/adaptor-registry/src/index.ts`](../../packages/adaptor-registry/src/index.ts) — process-wide registry
- [`packages/adaptor-netsuite/src/index.ts`](../../packages/adaptor-netsuite/src/index.ts) — reference built-in (wraps legacy code)
- [`packages/adaptor-odoo/src/index.ts`](../../packages/adaptor-odoo/src/index.ts) — reference built-in (native, declarative rules)
- [`apps/api/src/routes/customAdaptors.ts`](../../apps/api/src/routes/customAdaptors.ts) — firm-authored lifecycle
- [`apps/api/src/services/customAdaptorParse.ts`](../../apps/api/src/services/customAdaptorParse.ts) — AI parse pipeline
- [`apps/web/src/pages/CustomAdaptorsPage.tsx`](../../apps/web/src/pages/CustomAdaptorsPage.tsx) — firm-authored wizard UI
- Git history: commits from `838d4e4` (Phase 1A SPI scaffold) through `e4de32c` (Phase 12 evaluator) trace the twelve phases end-to-end.
