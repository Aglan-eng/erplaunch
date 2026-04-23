# Render environment — ERPLaunch API

Every production environment variable the `erplaunch-api` Render service reads, with purpose, source of truth, and rotation policy. If you add a new env var anywhere in `apps/api/src`, add it here.

## Required — the service will not boot without these

| Variable | Purpose | Rotation |
|---|---|---|
| `NODE_ENV` | Must be `production` on Render. Enables `SameSite=None; Secure` cookies, refuses dev fallbacks for secrets. | Never — fixed to `production`. |
| `JWT_SECRET` | HMAC secret for consultant-side JWTs (`token` cookie). 48+ random bytes, base64url. | On suspected leak. Rotation invalidates all consultant sessions. |
| `PORTAL_SESSION_COOKIE_SECRET` | HMAC secret for the portal-namespaced JWT (`portal_token` cookie). Must be different from `JWT_SECRET`. | On suspected leak. Rotation invalidates all portal sessions. |
| `ERPLAUNCH_MASTER_KEY` | 64 hex chars (32 bytes). AES-256-GCM key for encrypting firm SMTP passwords and any future at-rest secrets via `services/credentialCipher.ts`. | Only if compromised. Rotation invalidates every stored ciphertext — every firm must re-enter their SMTP creds. |
| `DATABASE_URL` | libSQL/SQLite connection URL. On Render: `file:/data/db/dev.db` (the persistent disk mount point). | Never during pilot. Migration to Turso is post-pilot. |
| `CORS_ORIGIN` | Exact origin of the deployed SPA (e.g. `https://erplaunch-web.vercel.app`). No wildcards — the API sets `credentials: true` so wildcards are rejected by the browser anyway. | When the SPA host domain changes. |
| `APP_URL` | Base URL the SPA is served at. Used by portal magic-link emails to construct the verify link. Usually same as `CORS_ORIGIN`. | When the SPA host domain changes. |

## Optional but set in production

| Variable | Purpose | Default | Notes |
|---|---|---|---|
| `REDIS_URL` | Rate-limiter backing store. | none | If unset or unreachable the portal + login rate-limiters fail open (log-only). Set it. |
| `AI_API_KEY` | Anthropic key used by the AI advisor + AI profile generator + landing chatbot Edge Function. | none | Shared between api and landing (same variable name). |
| `PORTAL_SESSION_TTL_DAYS` | Portal session lifetime. | `7` | |
| `PORTAL_AUTH_RATELIMIT_REQUEST_PER_MIN` | Max `/portal/request-access` attempts per IP and per email per minute. | `3` | |
| `PORTAL_AUTH_RATELIMIT_VERIFY_PER_MIN` | Max `/portal/verify` attempts per engagement-token per minute. | `5` | |
| `PORTAL_OTP_TTL_MINUTES` | Magic-link code lifetime. | `10` | |
| `PORTAL_OTP_MAX_ATTEMPTS` | Wrong-code attempts before the link burns. | `5` | |
| `PORTAL_OTP_CODE_LENGTH` | OTP digits. | `6` | Valid range 4-10. |
| `AI_MODEL` | Model name. | `claude-sonnet-4-20250514` | |
| `AI_PROVIDER` | | `anthropic` | Only `anthropic` is wired today. |
| `JWT_EXPIRES_IN` | Consultant token lifetime. | `24h` | |

## Unused in pilot (set to blank or omit)

`JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, `TWILIO_*`, `SENDGRID_*` — reserved for the channels/refresh workstreams post-pilot. Safe to leave blank.

## Rotation procedure (any secret)

1. Generate a new value:
   - `JWT_SECRET`, `PORTAL_SESSION_COOKIE_SECRET`:
     ```
     node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
     ```
   - `ERPLAUNCH_MASTER_KEY`:
     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
2. Update the value in Render dashboard → `erplaunch-api` → Environment → Edit.
3. Click "Save, rebuild, and deploy" — Render will restart the service with the new value.
4. Expected session loss:
   - `JWT_SECRET`: all consultants must sign in again.
   - `PORTAL_SESSION_COOKIE_SECRET`: all portal sessions invalidated; clients re-request magic links.
   - `ERPLAUNCH_MASTER_KEY`: **all stored ciphertext is unreadable**. Every firm must re-enter SMTP creds. Do not rotate casually.

## Adding a new secret

1. Read it from `process.env.X` in code. If missing in production, throw (see `server.ts` for the pattern).
2. Add it to `apps/api/.env.example` at the repo root.
3. Add it to this file with purpose + rotation.
4. Add it to `render.yaml` with `sync: false` so the blueprint prompts for a value on next deploy.
5. Set it in the Render dashboard before shipping the code that reads it.

## Last reviewed

2026-04-22 — Phase 5A cutover (portal magic-link + firm branding landed).
