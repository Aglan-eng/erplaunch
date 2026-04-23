# ERPLaunch — Pilot Onboarding

You are the first consulting firm on ERPLaunch. This document gets you from zero to a live client engagement with a branded portal in under an hour.

Pilot scope: **one firm, one NetSuite engagement, one client portal, magic-link auth, firm white-label, Render deploy.** Anything outside that is roadmap.

---

## 1. What ERPLaunch is (in one page)

ERPLaunch is a consulting-firm accelerator for ERP implementation. It runs on three surfaces:

- **Consultant workspace** — where you manage engagements. Dashboard → Wizard → Data Collection → Pipeline view. You fill in a client's business profile, license edition, and modules. The rule engine flags conflicts in real time (license gaps, missing prerequisites, phase-order issues). You generate artifacts — BRD, SuiteScript, SDF package, training manual — from the profile.
- **Client portal** — a branded view your client signs into via magic link. They see the engagement's timeline, todos, data-collection requests, risks, and decisions. They check off their own todos, upload requested files, and reply to open questions.
- **Rule engine** — runs behind the scenes. Six rule packs today: LIC (license/edition gating), R2R, P2P, O2C, MFG, RTN. Each re-evaluates after every profile or license change and writes a `ConflictLog` the wizard surfaces as live banners.

What ERPLaunch is **not** (pilot): not a general ERP SaaS, not a WhatsApp bot, not a multi-ERP platform. It is a NetSuite implementation accelerator for one firm's pilot engagement.

---

## 2. Consultant quickstart

### 2.1 Sign in

- URL: `https://erplaunch-web.vercel.app/login`
- Credentials: issued separately. If you got an error: see §5.

### 2.2 Brand your firm (once)

1. Dashboard → **Settings** (top-right).
2. Branding section:
   - Display name (appears on the client portal header)
   - Logo URL (hosted image — your website asset is fine)
   - Primary color + Secondary color (hex, e.g. `#0ea5e9`). A live preview updates as you type.
   - Support email (shown to clients who need help signing in)
3. Save.

Your portal now renders under your brand, not ours.

### 2.3 Create an engagement

1. Dashboard → **+ New**.
2. Enter client name. An engagement is created with default phases and empty profile/license rows.
3. You land on the Wizard.

### 2.4 Run the wizard

1. **Project Setup** — stakeholder members, roles. Add client-side members with their email addresses (magic-link invite will use these).
2. **License Profile** — choose edition (Starter / Mid-Market / Premium) and modules (OneWorld, Advanced Revenue, Manufacturing, etc.). Conflicts appear immediately as banners.
3. **R2R / P2P / O2C / MFG / RTN** — flow sections. Each question has context help; click the lightbulb for AI advice.
4. **Risks / Issues / Decisions / Meetings** — RAID log as you go.
5. **Data Collection** — add items the client owes you (Chart of Accounts, Customer Master, Opening Balances…). Each item gets a status + due date.
6. **Generate** — produce the artifact package. Downloads as a ZIP.

### 2.5 Invite the client

1. From the engagement → **Portal** tab → **Generate share link**.
2. Copy the URL. Send it to the client's PM by the channel you already use (email, Slack, whatever).
3. Optional: use **Send portal invites** to email every client-side member a personalized link directly from the app. Requires your firm SMTP settings (Firm Settings → Email Transport — *not in pilot; see roadmap §6*).

---

## 3. Client portal quickstart (what the client experiences)

### 3.1 First sign-in

1. Client receives your share URL: `https://erplaunch-web.vercel.app/portal/<token>`.
2. Clicks it → lands on a read-only view branded with your firm.
3. Sees the **Sign in** button (top banner).
4. Enters their email → submits.
5. If their email matches a `CLIENT`-team member on the engagement, they get an email from your firm's support domain with a sign-in link + a 6-digit code.
6. Clicks the link. The SPA auto-verifies. A cookie is set. Redirects to the portal view.

### 3.2 What they can do

- **Todos** — click the checkbox to mark complete. Reopen if needed.
- **Data Collection** — drag-and-drop files for each requested item.
- **View** — timeline, risks, issues, decisions, meeting notes — filtered to what you've exposed via Portal Settings.

### 3.3 Session lifetime

- 7 days, sliding (extends each time they act).
- Revoke all sessions: from the engagement's Portal tab, click **Rotate portal token** — all active sessions invalidate within seconds.

---

## 4. Known limits (pilot — what's not here yet)

- **No logo upload UI yet.** Paste a hosted URL into Firm Settings → Branding → Logo URL.
- **No firm-SMTP email transport UI.** Magic-link emails are sent via the configured platform default in the pilot deploy. Per-firm SMTP lands in the channels workstream.
- **No multi-tenant billing.** Pilot is single-firm on a $7.25/mo Render Starter tier.
- **No real-time updates.** The SPA polls on focus; changes may take up to 10s to appear.
- **No WhatsApp or SMS channel.** Deferred; see roadmap.
- **Rate limits** — 3 sign-in requests per minute per IP+email; 5 verify attempts per minute per engagement token. If a client hits the limit they'll see a "wait a moment" error and can retry in 60s.

---

## 5. Troubleshooting

**Can't sign in (consultant side)**
- Your password lives server-side. Ask your Render deployer to re-run `pnpm --filter @ofoq/api run seed` against the prod DB to reset the test user (see `apps/api/src/seed.ts`).
- Check browser dev tools → Application → Cookies for the `token` cookie. Missing cookie = CORS/cross-site issue; confirm `CORS_ORIGIN` on Render matches your Vercel SPA URL exactly.

**Client says the magic-link email never arrived**
- Firm SMTP must be configured on the engagement's firm for magic-link emails to send. In the pilot the platform default is used. Check `docs/deploy/RENDER_ENV.md` for which transport is active.
- Send the 6-digit code directly via your own channel (e.g. Slack, WhatsApp). The portal verify page accepts `?email=…&code=…` params.

**Rule-engine conflict won't go away**
- Conflicts are recomputed after every profile/license/phases mutation. If a stuck conflict persists after the triggering answer changed, hit the engagement's **Refresh conflicts** action (wizard header → ⋯ menu).

**Portal session fails 401 repeatedly after sign-in**
- Browsers with strict third-party cookie settings block cross-site cookies even with `SameSite=None`. Short-term fix: use Chrome/Edge. Long-term fix (roadmap): custom domain so api + web share an eTLD+1.

---

## 6. Roadmap pointer

Feature requests and "why doesn't X work" items past pilot live in `docs/ROADMAP.md`. Don't ask for anything in that roadmap until pilot golive is signed off.

---

## 7. Support

- Issues with the product during pilot: open a GitHub issue at `github.com/Aglan-eng/erplaunch/issues` or email the pilot lead directly.
- Anything involving real client data: talk to the pilot lead before it goes in. ERPLaunch has no PII audit or encryption-in-transit guarantees beyond what Render + Vercel provide today.
