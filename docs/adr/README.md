# Architecture Decision Records

One file per consequential decision. Each ADR is a snapshot of the context, the decision, the trade-offs we considered, and when we'll revisit it. ADRs are not gospel — they are decisions at a point in time.

## Index

| # | Title | Status | Revisit when |
|---|---|---|---|
| [0001](./0001-libsql-sqlite-runtime-db.md) | libSQL/SQLite as the runtime DB | Accepted | Second firm onboarding. |
| [0002](./0002-portal-auth-model.md) | Portal authentication model (magic link + stateful session) | Accepted | Corporate spam-filter blocks reported; mobile app story. |
| [0003](./0003-firm-whitelabel-scope.md) | Firm white-label scope for pilot | Accepted | Second firm's first engagement. |
| [0004](./0004-e2e-strategy.md) | End-to-end test strategy (defer Playwright) | Accepted | Two weeks after pilot golive, unconditional. |

## When to write a new ADR

- Any architectural decision that would surprise a new engineer six months from now.
- Any decision you expect to revisit later.
- Any "we picked X over Y" with non-obvious trade-offs.

Not for: bug fixes, feature specs (those go in issue/PR bodies), style choices.

## Template

Copy `0001-libsql-sqlite-runtime-db.md` as a starting point. Sections: Status, Context, Decision, Rationale, Consequences, Alternatives considered, When to revisit, Links.
