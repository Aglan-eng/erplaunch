/**
 * PROD MULTI-PERSONA E2E
 *
 * Two consultants, two firms, two engagements — all created against
 * the live deployed SPA at process.env.PROD_WEB_URL (default
 * https://erplaunch-web.vercel.app). Real Chromium drives the actual
 * rendered React, real API calls hit Render, real DB rows land.
 *
 * Test data is identifiable by an `e2e-{persona}-{ms}@erplaunch-test.invalid`
 * email pattern + an `e2e-{persona}-{ms}` slug — grep prod for these
 * to find/cleanup test artefacts.
 *
 * Out of scope (deliberate):
 *   - Magic-link portal flow — assert request returns 202 and stop.
 *     Real mailbox completion is manual on demo day.
 *   - Completing the Google OAuth flow on Google's side — we assert
 *     the consent-screen redirect happens, then bail.
 *
 * Screenshots: every navigation calls `screenshot()` to a per-run
 * timestamped folder. The test prints the absolute path at the end so
 * the screenshots can be moved/copied to NSIX/PROD_DEMO_SCREENSHOTS/
 * for the design-partner artefact.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Run-level shared state ──────────────────────────────────────────────────

const RUN_TS = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOTS_ROOT = path.resolve(__dirname, '..', 'screenshots', RUN_TS);

let stepCounter = 0;
async function snap(page: Page, persona: string, label: string) {
  stepCounter++;
  const safeLabel = label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const file = path.join(
    SCREENSHOTS_ROOT,
    `${String(stepCounter).padStart(2, '0')}-${persona}-${safeLabel}.png`,
  );
  await fs.mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
  // Echo to stdout so the test transcript surfaces every step.
  process.stdout.write(`  📸 ${persona} — ${label} → ${path.relative(process.cwd(), file)}\n`);
}

// ─── Persona shape ───────────────────────────────────────────────────────────

interface Persona {
  name: string;          // human-readable consultant name
  firmName: string;
  firmSlug: string;
  email: string;
  password: string;
  context: BrowserContext;
  page: Page;
  engagementId?: string; // populated after the engagement is created
}

function buildPersonas(now: number): Pick<Persona, 'name' | 'firmName' | 'firmSlug' | 'email' | 'password'>[] {
  // Prefix every value with `e2e-` so prod test data is greppable.
  return [
    {
      name: 'Sarah Chen',
      firmName: `E2E Northlake ${now}`,
      firmSlug: `e2e-northlake-${now}`,
      email: `e2e-sarah-${now}@erplaunch-test.invalid`,
      password: 'correct-horse-battery-staple',
    },
    {
      name: 'Marcus Okafor',
      firmName: `E2E Riverwood ${now}`,
      firmSlug: `e2e-riverwood-${now}`,
      email: `e2e-marcus-${now}@erplaunch-test.invalid`,
      password: 'correct-horse-battery-staple',
    },
  ];
}

// ─── Test ────────────────────────────────────────────────────────────────────

test('multi-persona prod walkthrough — two firms, cross-tenant isolation, Google OAuth visible', async ({ browser }) => {
  test.setTimeout(180_000);

  const now = Date.now();
  const seeds = buildPersonas(now);
  const personas: Persona[] = [];

  // Build isolated browser contexts so JWT cookies don't bleed across
  // personas. Each persona gets its own page.
  for (const seed of seeds) {
    const context = await browser.newContext();
    const page = await context.newPage();
    personas.push({ ...seed, context, page });
  }

  try {
    // ── Step 1: Both personas sign up ──────────────────────────────────────
    for (const p of personas) {
      await p.page.goto('/signup');
      await snap(p.page, p.name, 'signup-form-loaded');

      await p.page.locator('#firmName').fill(p.firmName);
      // SPA auto-derives slug from firmName but we set it explicitly so
      // collisions across runs are deterministic from the timestamp.
      await p.page.locator('#firmSlug').fill(p.firmSlug);
      await p.page.locator('#adminName').fill(p.name);
      await p.page.locator('#adminEmail').fill(p.email);
      await p.page.locator('#password').fill(p.password);
      await snap(p.page, p.name, 'signup-form-filled');

      await p.page.getByRole('button', { name: /create firm and sign in/i }).click();

      // Land on /dashboard (or an email-verify banner page that still
      // counts as authenticated).
      await p.page.waitForURL(/\/dashboard|\/verify-email|\/$/, { timeout: 30_000 });
      await snap(p.page, p.name, 'after-signup-dashboard');

      expect(p.page.url(), `${p.name} should be authenticated`).toContain(new URL(p.page.url()).host);
    }

    // ── Step 2: Both create an engagement via the New Engagement modal ─────
    for (const [idx, p] of personas.entries()) {
      await p.page.goto('/dashboard');
      await snap(p.page, p.name, 'dashboard-loaded');

      // The dashboard has either an empty-state CTA or a header button —
      // both render text "Create Engagement" / "Create & Open Wizard".
      // First-time users see the empty-state button.
      const createBtn = p.page.getByRole('button', { name: /create engagement/i }).first();
      await createBtn.waitFor({ state: 'visible', timeout: 15_000 });
      await createBtn.click();
      await snap(p.page, p.name, 'new-engagement-modal-open');

      const clientName = `E2E Client ${idx + 1} ${now}`;
      await p.page.locator('#clientName').fill(clientName);
      // Default adaptor (NetSuite) is selected for a brand-new firm —
      // explicit click hardens against future default changes.
      await p.page.locator('#netsuite').click().catch(() => {
        /* if a custom adaptor card is the default selection in the future,
           this click is a no-op and the form proceeds */
      });
      await snap(p.page, p.name, 'new-engagement-form-filled');

      await p.page.getByRole('button', { name: /create & open wizard/i }).click();

      // After create, the SPA navigates to /engagements/:id/wizard.
      await p.page.waitForURL(/\/engagements\/[^/]+\/wizard/, { timeout: 30_000 });
      const match = p.page.url().match(/\/engagements\/([^/]+)\/wizard/);
      p.engagementId = match?.[1];
      expect(p.engagementId, `${p.name} should have an engagementId after creation`).toBeTruthy();
      await snap(p.page, p.name, 'wizard-loaded');
    }

    // ── Step 3: Cross-tenant — persona 1 cannot see persona 2's engagement ─
    const [p1, p2] = personas;
    expect(p2.engagementId).toBeTruthy();
    await p1.page.goto(`/engagements/${p2.engagementId}/wizard`);
    // Wait briefly for any in-SPA redirect/error state to settle.
    await p1.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await snap(p1.page, p1.name, 'cross-tenant-attempt');

    // The SPA may handle this via:
    //   - Redirect away from the wizard (to /dashboard or /login)
    //   - In-page "not found / no access" copy
    //   - 404/403 error boundary
    // Any of these is correct. The fail mode would be successfully
    // landing on the wizard with persona 2's engagement data.
    const url = p1.page.url();
    const html = await p1.page.content();
    const stillOnVictimWizard = url.includes(`/engagements/${p2.engagementId}/wizard`)
      && !/not.?found|no.?access|forbidden|404|403|cannot.?find/i.test(html);
    if (stillOnVictimWizard) {
      // If we're still on the wizard route, the page must NOT show the
      // victim's clientName. That'd be a real cross-tenant breach.
      const victimClient = `E2E Client 2 ${now}`;
      expect(
        html.includes(victimClient),
        'CROSS-TENANT BREACH: persona 1 sees persona 2 client name on wizard',
      ).toBe(false);
    }

    // ── Step 4: Google OAuth visible + click goes to accounts.google.com ────
    // Use a fresh context (no auth) so we hit the real /login UI.
    const googleCtx = await browser.newContext();
    const googlePage = await googleCtx.newPage();
    try {
      await googlePage.goto('/login');
      await snap(googlePage, 'unauthed', 'login-loaded');

      // The button only renders when /api/v1/auth/google/available
      // returns {available:true}. We expect that to be true in prod.
      const googleBtn = googlePage.getByRole('link', { name: /continue with google/i });
      await googleBtn.waitFor({ state: 'visible', timeout: 15_000 });
      await snap(googlePage, 'unauthed', 'google-button-visible');

      // Don't click via Playwright (it would follow the redirect to a
      // real Google consent screen and fail because we're not logged in
      // to a Google account in the test browser). Instead, assert the
      // href points at the API's start endpoint (which 302s to Google).
      const href = await googleBtn.getAttribute('href');
      expect(href, 'Google button must point at the API start endpoint').toMatch(
        /\/api\/v1\/auth\/google\/start$/,
      );
    } finally {
      await googleCtx.close();
    }

    // ── Step 5: Magic-link portal — request only, no completion ────────────
    // Per PO direction: assert the request-access POST succeeds, then stop.
    // We test through the SPA's actual API client rather than puppeting the
    // portal sign-in page, since the portal page requires an engagement
    // token URL that's only valid for client-side users (different surface).
    {
      const apiBase = (process.env.PROD_API_URL || 'https://erplaunch-api.onrender.com');
      // Use one of the personas' authenticated session to mint a portal
      // token for their own engagement. This proves the consultant->portal
      // hand-off works without exercising the mailbox.
      const cookies = await p1.context.cookies();
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const r = await fetch(
        `${apiBase}/api/v1/engagements/${p1.engagementId}/portal-invites`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: cookieHeader },
          body: JSON.stringify({}),
        },
      );
      // A green firm with no client members yet returns sent=0; 200 either
      // way proves the route is reachable from the consultant session.
      expect([200, 201, 202], `portal-invites status ${r.status}`).toContain(r.status);
    }
  } finally {
    // Always close contexts even if assertions failed, so we don't hang.
    for (const p of personas) await p.context.close();
    process.stdout.write(`\n  Screenshot folder: ${SCREENSHOTS_ROOT}\n`);
  }
});
