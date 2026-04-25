# ERPLaunch — Roadmap

Three tiers. Pilot (this week). Post-pilot GA (the month after). Future (quarters out). Nothing below "Pilot" ships before pilot golive.

---

## Pilot — 7-day cutover (current)

Must be done before handing the pilot firm the keys.

- [x] CI honest: lint + typecheck + unit + build passing on every PR. Rule-engine orphan `.js` deleted. 137/137 tests passing.
- [x] Portal magic-link auth (Phase 5A). Request-access → email → verify → cookie-backed `PortalSession`. Todo mutations require the session.
- [x] Firm white-label minimum: displayName + logo URL + 2 colors + support email. Consultant UI at `/settings`. Live portal-header preview.
- [x] Rate limiting wired on `/auth/login`, `/portal/request-access`, `/portal/verify`. Fail-open when Redis is unreachable with a warn log.
- [x] Cross-site cookies (`SameSite=None; Secure`) in prod for consultant + portal sessions.
- [x] Deploy: Render (api) + Vercel (web + landing). `/health` returns `{ ok: true, version }`.
- [x] `.env.example` at repo root listing every read variable with purpose.
- [x] `docs/deploy/RENDER_ENV.md` with rotation procedure.
- [x] ADRs: libSQL dialect, portal auth model, white-label scope, e2e strategy.
- [x] `docs/pilot/ONBOARDING.md` — consultant + client quickstart.
- [ ] Pre-cutover manual walk-through: consultant login → engagement → client portal invite → magic-link → todo completion, end-to-end in prod. **Runs the day before cutover.**

---

## Post-pilot GA — the month after golive

Prioritized. Top of list ships first.

### 1. Observability — make the black box transparent

- Request-ID middleware: every request gets a UUID, logged with every log line, returned to the client in `X-Request-Id`.
- `/metrics` endpoint (Prometheus text format) exposing: portal auth attempts/successes/failures, rate-limit hits, rule-engine evaluations/second, BullMQ queue depth, DB row counts.
- Error dashboard in Render (piggy-back on their built-in) tied to `fastify.log.error` calls.
- Structured AI call logging: `{ orgId, engagementId, model, tokens_in, tokens_out, latency_ms, cache_hit }` per invocation.

### 2. Real e2e suite (per ADR 0004)

- Playwright project at `apps/web-e2e/` (directory already referenced in comments).
- Three critical flows:
  - Consultant: sign in → dashboard → create engagement → wizard save → conflict banner appears.
  - Client: receive invite → magic link → portal sign-in → mark todo complete → sign out.
  - Firm admin: settings → change brand colors → portal header reflects within 1 reload.
- Runs against an ephemeral stack (docker compose) in CI nightly + on release candidate PRs.

### 3. Logo upload (close the white-label loop)

- `POST /api/v1/firm/branding/logo` multipart handler, reuse the `apps/api/src/routes/dataCollection.ts` plumbing.
- Storage: `apps/api/uploads/firm-logos/<firmId>/` via the existing `/uploads/` static mount.
- Validation: ≤2MB, MIME whitelist `image/png` / `image/jpeg` / `image/svg+xml`.
- SVG sanitization via `dompurify` before serving (prevent stored XSS).
- Dropzone in `SettingsPage.tsx`.

### 4. Firm-SMTP settings UI

- `FirmEmailSettings` DB + service already exists (encrypted at rest via `credentialCipher`).
- Need consultant UI: `/settings/email` tab, fields for SMTP host/port/user/password + IMAP (deferred — see channels below).
- "Send test email" button to validate before saving.
- Migrate magic-link email path to prefer firm SMTP over platform default.

### 5. Backup + restore for SQLite

- Daily `sqlite3 dev.db .dump > /data/backups/<date>.sql` cron on Render (or a BullMQ scheduled job).
- Retain 14 days.
- Restore runbook in `docs/deploy/BACKUP_RESTORE.md`.
- Pre-flight: monthly manual restore drill.

### 6. Turso migration path

- Sign up for Turso.
- Create a DB, run `initDb()` against the remote URL.
- Run golden-fixture replay to verify schema parity.
- Keep the libSQL file path as fallback via env var (`DATABASE_URL=libsql://…?authToken=…` switches to Turso).
- Trigger: onboarding the second firm. Do not migrate before.

### 7. Rate-limit dashboard

- Current state: warn logs on 429.
- Add a `GET /api/v1/admin/rate-limits` that returns current Redis counters (auth-required, platform-admin role).
- Simple React page showing top 10 keys by count for the last hour.

### 8. Google OAuth sign-in — **shipped (Phase 21)**

- DB: `User.googleSub` column + unique partial index. Helpers: `findUserByGoogleSub`, `linkUserGoogleSub`, `createGoogleUserAndFirm` (sets `emailVerifiedAt`, stores unguessable random bcrypt hash so password login is impossible until "Forgot password" is used).
- API: `@fastify/oauth2@^7` (pinned for Fastify 4 compat); `/api/v1/auth/google/start` + `/api/v1/auth/google/callback`; thin route wrapping `services/googleAuthService.resolveGoogleSignIn` which handles the three branches (re-login by sub, link existing email-signup user, create new firm).
- UI: `<GoogleSignInButton/>` component, probes `/auth/google/available` and self-hides when unconfigured. Drops on LoginPage + SignupPage.
- Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`. All three or none — module is a no-op (probe only) when any is missing. Documented in `docs/deploy/RENDER_ENV.md`.
- Tests: 13 service-level unit tests covering all three branches + edge cases (slug collision, short names, sub-vs-email precedence) + 7 route integration tests covering configured/unconfigured paths.
- Failure handling: every error redirects to `${APP_URL}/login?error=<reason>` and increments `auth_google_total{outcome=...}` for `/metrics`.
- See commits: `38ea394` (DB), `cb3a485` (API), `1914cb5` (UI).

---

## Future — quarters out

Not a commitment. Directional.

### Channels workstream (WhatsApp + SMS + email inbound)

- `@ofoq/channels` abstraction over providers (Twilio, per-firm SMTP/IMAP).
- WhatsApp inbound → route to conversations; outbound business-number sending.
- SMS for OTP fallback (clients in low-email-delivery environments).
- IMAP polling for inbound email replies, extracted into conversation threads.
- See `WHATSAPP_INTEGRATION_SPEC.md` (from early design) for the per-client Baileys direction if we revisit it. Current lean: Twilio WhatsApp Business API (compliant), not Baileys (ToS risk).

### Adapter SPI and vendor adapters — **shipped** (see [docs/adaptor-spi.md](adaptor-spi.md) + [ADR 0005](adr/0005-adaptor-spi.md))

- Platform Adaptor SPI live in production across twelve phases (1B → 12).
- Built-ins: NetSuite (wraps legacy code) + Odoo (native, with 10 declarative rules firing end-to-end).
- Firm-authored custom adaptors via `/custom-adaptors`: upload docs → AI parse → review → publish.
- Generic `evaluateAdaptorRules()` pure function in `@ofoq/adaptor-sdk`; NetSuite's hand-written engine still runs for NetSuite engagements.
- Next adapter: ship only for a named design partner. SAP Business One or Dynamics 365 BC are the likely candidates; either would follow the Odoo adapter's pattern (package + registry hook + Dockerfile copy + COMING_SOON removal).

### `connector.read` capability — future

- The SDK declares `connector.read` + `connector.push` as capability tags but nothing uses them.
- First candidate: Odoo XML-RPC adapter that pulls real CoA / vendor / module-provision data to prefill wizard answers.
- Gated on credential handling (encrypt at rest via existing `credentialCipher`), network-isolation for tests, and refresh semantics. Treat as its own workstream when a design partner asks.

### Vertical rule packs

- Sub-packs under each workstream: e.g. R2R → Multi-country (EU / GCC / US), O2C → Subscription-billing, MFG → Process vs. Discrete.
- Activated per engagement based on profile answers.
- The rule engine already supports this shape; the rules themselves need to be authored.

### AI product-layer features

- Wizard answer auto-fill from uploaded documents (we have the plumbing in `aiProfileGenerator.ts`; UI is minimal today).
- Conflict resolution suggestions (not just "this is wrong"; "here's how to fix it, with a BRD snippet").
- Meeting-note summarization → auto-populate risks/issues/decisions.

### Multi-tenant plan tiers

- Per-firm plans: Starter / Professional / Enterprise.
- Feature flags: vertical packs, AI advisor, marketplace adaptors, audit log retention.
- Billing via Stripe; not a priority until >3 firms are paying.

### Client-portal mobile app

- The SPA is already mobile-responsive. A wrapper (Capacitor or React Native) would give push notifications for todo/deadline reminders. Only if clients ask.

### Marketplace for firm-authored rule packs

- Firm A writes a domain rule pack for healthcare-on-NetSuite. Publishes. Firm B installs it on their engagement.
- Requires signing, versioning, revenue-share decisions. Big workstream. Only after second-firm golive.

---

## How to use this roadmap

- A new feature request: check the Post-pilot GA list. If listed, point the asker there. If not, evaluate against the "Future" bar: who's the named design partner?
- A bug report: doesn't go in the roadmap — goes in GitHub Issues.
- An architecture question: should generate an ADR. This roadmap doesn't capture decisions, it captures intent.

**Last reviewed:** 2026-04-22 (pilot cutover week).
