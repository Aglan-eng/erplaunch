# ADR 0001 — libSQL/SQLite as the runtime DB

**Status:** Accepted (pilot, 2026-04-22). Re-evaluate before onboarding a second firm.

## Context

ERPLaunch needs a relational data store for a single-firm pilot on Render Starter ($7.25/mo including a 1GB persistent disk). Load is one consulting firm, tens of engagements, hundreds of rows per engagement, single-digit concurrent writers. Every engagement is a fully isolated set of records; cross-engagement queries are rare.

Options considered:

1. **libSQL / SQLite** via `@libsql/client`, file-backed on the Render persistent disk.
2. **Postgres** via Render's managed Postgres add-on (cheapest tier $7/mo on top of the service).
3. **Turso** (hosted libSQL, cross-region replication).

## Decision

Ship with **libSQL/SQLite** file-backed at `/data/db/dev.db` on the Render persistent disk. No ORM; thin hand-rolled SQL in `apps/api/src/db/index.ts` using parameterized queries. Schema lives in `createTables()` with `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE … ADD COLUMN` tolerance probes — no migration framework.

## Rationale

- **Zero additional infra** for the pilot. Render Starter already includes a 1GB disk; no separate DB service to provision, pay for, monitor, or back up.
- **Embedded simplicity**. No network round-trip for every query; single-writer is plenty for one firm.
- **Turso upgrade path is drop-in**. The same `@libsql/client` talks to Turso's remote URL with an auth token. When we need multi-region or >1 firm we flip `DATABASE_URL`, re-seed, point at Turso. No code rewrite.
- **Portability**. Every dev has the same SQLite file shape locally. Tests use an in-memory libSQL instance with the same schema (see `apps/api/tests/_helpers/testDb.ts`).

## Consequences

- **Single-writer ceiling.** SQLite serialises writes. At current load this is invisible. When we onboard a second firm on the same deployment, we will start seeing contention. Mitigation: migrate to Turso before that happens.
- **No migration framework.** Schema evolution happens via idempotent `createTables()` on every boot. This works because every column is either `NOT NULL` with a default or nullable, and tables are created with `IF NOT EXISTS`. Tradeoff: we cannot easily do non-additive migrations (rename column, change type, drop column). Pilot scope accepts this. Post-pilot, introduce a lightweight migrations table.
- **Backups.** Render disks persist across deploys but are not backed up automatically. For pilot we accept the risk (one firm, manual SQL exports weekly, see `docs/pilot/BACKUPS.md` — TODO, Day 5+). Turso migration also solves this via their replicated model.
- **Testing.** Tests create a fresh temp SQLite file per suite via `setupTestDb()`. Isolation is per-suite, not per-test — acceptable because each test uses unique cuid2 IDs.

## When to revisit

- Second firm signed. Before their onboarding day: plan the Turso migration.
- Any schema change that needs non-additive work (rename / drop / type change).
- Any report of write contention or "database is locked" errors in Render logs.

## Links

- `apps/api/src/db/index.ts` — the data access layer this decision shapes.
- `apps/api/Dockerfile` — mounts `/data` at the persistent disk, creates `/data/db` at runtime.
- [libSQL / Turso docs](https://docs.turso.tech/)
