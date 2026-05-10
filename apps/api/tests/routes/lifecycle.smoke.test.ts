/**
 * Phase 48.5 — Full-lifecycle smoke test.
 *
 * Walks one engagement from PROSPECT → SLA_ACTIVE through every linear
 * stage transition, plus the post-go-live actions (open ticket, run
 * Quarterly Health Check, mark renewal RENEWED). The intent is to catch
 * cross-phase regressions: a single failing assertion here means
 * something in the lifecycle pipeline broke without anyone's per-feature
 * test detecting it.
 *
 * Why a vitest integration test rather than a Playwright e2e test:
 *   - Runs in ~2s in CI vs. 30+ for a real-browser walkthrough
 *   - No SPA build, no port allocation, no flaky browser timing
 *   - Exercises the actual route handlers + DB layer end-to-end so
 *     the contract guarantees match what the frontend sees
 *   - The Playwright suite at apps/web-e2e/ stays as the prod
 *     deployment probe; this test covers the CI-on-every-commit
 *     "is the engine green?" question.
 *
 * What this DOESN'T cover (filed as out-of-scope in the spec):
 *   - The portal magic-link mint → email → click → JWT cookie flow.
 *     Tested separately by routes/portalAuth.test.ts. Here we trigger
 *     the SUPPORT_TICKET acceptor directly to simulate "client opens
 *     a ticket and SLA team accepts".
 *   - Visual regression — Playwright still owns that.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { engagementRoutes } from '../../src/routes/engagements.js';
import { closeoutRoutes } from '../../src/routes/closeout.js';
import { slaPortfolioRoutes } from '../../src/routes/slaPortfolio.js';
import { slaTicketsRoutes } from '../../src/routes/slaTickets.js';
import { slaRenewalsRoutes } from '../../src/routes/slaRenewals.js';
import { ticketRoutes } from '../../src/routes/tickets.js';
import { renewalRoutes } from '../../src/routes/renewal.js';
import { discoveryLiteRoutes } from '../../src/routes/discoveryLite.js';
import { firmTemplateRoutes } from '../../src/routes/firmTemplate.js';
import { generateProposal } from '../../src/services/generators/proposalGenerator.js';
import { getFirmTemplate } from '../../src/db/index.js';
import {
  getDb,
  bootstrapFirmAdmin,
} from '../../src/db/index.js';
import { createPendingSubmission } from '../../src/db/pendingSubmission.js';
import { listTicketsByEngagement } from '../../src/db/tickets.js';
import { supportTicketAcceptor } from '../../src/services/supportTicketAcceptor.js';

const JWT_SECRET = 'lifecycle-smoke-secret';
let cleanup: () => void;
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, { secret: JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  await f.register(jwt, {
    namespace: 'portal',
    secret: 'lifecycle-smoke-portal-secret',
    cookie: { cookieName: 'portal_token', signed: false },
  });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.register(closeoutRoutes, { prefix: '/api/v1' });
  await f.register(slaPortfolioRoutes, { prefix: '/api/v1' });
  await f.register(slaTicketsRoutes, { prefix: '/api/v1' });
  await f.register(slaRenewalsRoutes, { prefix: '/api/v1' });
  await f.register(ticketRoutes, { prefix: '/api/v1' });
  await f.register(renewalRoutes, { prefix: '/api/v1' });
  await f.register(discoveryLiteRoutes, { prefix: '/api/v1' });
  await f.register(firmTemplateRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

interface Fixture {
  firmId: string;
  userId: string;
  engagementId: string;
  memberId: string;
  token: string;
}

async function seedAtProspect(): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const engagementId = createId();
  const memberId = createId();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, displayName, primaryColor, secondaryColor, createdAt) VALUES (?,?,?,?,?,?,?,?)`,
    args: [firmId, 'Smoke Firm', `smoke-${createId()}`, 'STARTER', 'Smoke Firm', '#7c3aed', '#a78bfa', now],
  });
  const passwordHash = await bcrypt.hash('irrelevant', 4);
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Smoke Tester', passwordHash, 'CONSULTANT', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Smoke Client', 'PROSPECT', now, now],
  });
  // Client portal member (used as the "submittedBy" for the support ticket
  // PendingSubmission in step 7).
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [memberId, engagementId, 'Smoke Customer', 'Stakeholder', 'CLIENT', `member-${memberId}@example.com`, now],
  });
  await bootstrapFirmAdmin({ firmId, userId });

  const token = app.jwt.sign({
    userId,
    firmId,
    role: 'CONSULTANT',
    name: 'Smoke Tester',
    email: `${userId}@example.com`,
  });
  return { firmId, userId, engagementId, memberId, token };
}

async function advance(engagementId: string, token: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: `/api/v1/engagements/${engagementId}/advance`,
    cookies: { token },
  });
  if (r.statusCode !== 200) {
    throw new Error(`advance failed (${r.statusCode}): ${r.body}`);
  }
  const body = r.json() as { data: { status: string } };
  return body.data.status;
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

describe('Phase 48.5 — full lifecycle smoke test', () => {
  it('walks PROSPECT → SLA_ACTIVE → ticket → QHC → renewal in one pass', async () => {
    const f = await seedAtProspect();

    // ── 1. Sales: PROSPECT → PROPOSED → CONTRACTED ───────────────────────
    expect(await advance(f.engagementId, f.token)).toBe('PROPOSED');
    expect(await advance(f.engagementId, f.token)).toBe('CONTRACTED');

    // ── 2. Implementation: CONTRACTED → DISCOVERY → SCOPING → BUILD →
    //      UAT → GOLIVE ─────────────────────────────────────────────────
    expect(await advance(f.engagementId, f.token)).toBe('DISCOVERY');
    expect(await advance(f.engagementId, f.token)).toBe('SCOPING');
    expect(await advance(f.engagementId, f.token)).toBe('BUILD');
    expect(await advance(f.engagementId, f.token)).toBe('UAT');
    expect(await advance(f.engagementId, f.token)).toBe('GOLIVE');

    // ── 3. Closeout: GOLIVE → CLOSEOUT auto-creates the checklist. ──────
    expect(await advance(f.engagementId, f.token)).toBe('CLOSEOUT');
    const checklistRes = await app.inject({
      method: 'GET',
      url: `/api/v1/engagements/${f.engagementId}/closeout-checklist`,
      cookies: { token: f.token },
    });
    expect(checklistRes.statusCode).toBe(200);
    const checklist = (checklistRes.json() as { data: Array<{ key: string; status: string }> }).data;
    expect(checklist.length).toBeGreaterThan(0);
    expect(checklist.find((c) => c.key === 'CLIENT_SIGNOFF')).toBeDefined();
    expect(checklist.find((c) => c.key === 'SLA_TEAM_ACCEPT')).toBeDefined();

    // ── 4. Mark every checklist item DONE so the dual-signoff gate
    //      passes and CLOSEOUT → SLA_ACTIVE is allowed. ─────────────────
    for (const item of checklist) {
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/v1/engagements/${f.engagementId}/closeout-checklist/${item.key}`,
        cookies: { token: f.token },
        payload: { status: 'DONE' },
      });
      expect(r.statusCode).toBe(200);
    }

    // ── 5. CLOSEOUT → SLA_ACTIVE. The dual-signoff gate must accept
    //      because both blockers are DONE. ─────────────────────────────
    expect(await advance(f.engagementId, f.token)).toBe('SLA_ACTIVE');

    // ── 6. Verify the engagement appears on the SLA portfolio. ────────
    const portfolioRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/portfolio',
      cookies: { token: f.token },
    });
    expect(portfolioRes.statusCode).toBe(200);
    const portfolio = (portfolioRes.json() as { data: Array<{ engagementId: string }> }).data;
    expect(portfolio.find((p) => p.engagementId === f.engagementId)).toBeDefined();

    // ── 7. Portal: simulate a SUPPORT_TICKET pending submission. The
    //      acceptor creates a real Ticket row + seeds the message. ────
    const submission = await createPendingSubmission({
      engagementId: f.engagementId,
      memberId: f.memberId,
      targetType: 'SUPPORT_TICKET',
      targetId: null,
      payload: {
        title: 'Login broken on mobile',
        severity: 'HIGH',
        description: 'iOS Safari users see a blank screen.',
      },
    });
    await supportTicketAcceptor.accept(submission, {
      engagementId: f.engagementId,
      reviewerId: f.userId,
      firmId: f.firmId,
    });
    const tickets = await listTicketsByEngagement(f.engagementId);
    expect(tickets).toHaveLength(1);
    const ticket = tickets[0];
    expect(ticket.severity).toBe('HIGH');
    expect(ticket.status).toBe('OPEN');

    // ── 8. SLA team triages: assign + add SUPPORT message + close. ────
    const assignRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${ticket.id}`,
      cookies: { token: f.token },
      payload: { assigneeUserId: f.userId, status: 'IN_PROGRESS' },
    });
    expect(assignRes.statusCode).toBe(200);

    const replyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${ticket.id}/messages`,
      cookies: { token: f.token },
      payload: { body: 'Looking into this — will update within the hour.' },
    });
    expect(replyRes.statusCode).toBe(201);

    const resolveRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${ticket.id}`,
      cookies: { token: f.token },
      payload: { status: 'RESOLVED' },
    });
    expect(resolveRes.statusCode).toBe(200);
    const closeRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/tickets/${ticket.id}`,
      cookies: { token: f.token },
      payload: { status: 'CLOSED' },
    });
    expect(closeRes.statusCode).toBe(200);

    // ── 9. The firm-wide ticket queue surfaces the closed ticket
    //      when status=CLOSED is requested explicitly. The default
    //      ALL filter also includes it. ─────────────────────────────
    const ticketsAllRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/tickets?status=ALL',
      cookies: { token: f.token },
    });
    expect(ticketsAllRes.statusCode).toBe(200);
    const ticketsAll = (ticketsAllRes.json() as {
      data: Array<{ id: string; status: string }>;
    }).data;
    expect(ticketsAll.find((t) => t.id === ticket.id && t.status === 'CLOSED')).toBeDefined();

    // ── 10. Quarterly Health Check: kick off a job (no need to wait
    //       for processJob to finish — we just verify the route
    //       accepts the type and creates a row). ─────────────────────
    const qhcRes = await app.inject({
      method: 'POST',
      url: `/api/v1/engagements/${f.engagementId}/generate`,
      cookies: { token: f.token },
      payload: { type: 'QUARTERLY_HEALTH_CHECK' },
    });
    expect(qhcRes.statusCode).toBe(201);
    const qhcJob = (qhcRes.json() as { data: { id: string; type: string } }).data;
    expect(qhcJob.type).toBe('QUARTERLY_HEALTH_CHECK');

    // ── 11. Renewal: mark SIGNED. Verify the firm-wide pipeline
    //       reflects the change. ─────────────────────────────────────
    const renewalRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${f.engagementId}/renewal-state`,
      cookies: { token: f.token },
      payload: {
        contractEndAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
        renewalStatus: 'SIGNED',
        notes: 'Renewed for another year.',
      },
    });
    expect(renewalRes.statusCode).toBe(200);
    const renewals = await app.inject({
      method: 'GET',
      url: '/api/v1/sla/renewals',
      cookies: { token: f.token },
    });
    expect(renewals.statusCode).toBe(200);
    const renewalRows = (renewals.json() as {
      data: Array<{ engagementId: string; renewalStatus: string }>;
    }).data;
    const ourRenewal = renewalRows.find((r) => r.engagementId === f.engagementId);
    expect(ourRenewal).toBeDefined();
    expect(ourRenewal!.renewalStatus).toBe('SIGNED');
  });

  // ─── Phase 49.6 — Brand Pack ingest → firm-voice proposal ───────────────
  // Pinned acceptance: a firm that has ingested a Brand Pack produces
  // proposal copy in firm voice (methodology, vertical, CTA, etc.) on
  // every engagement. We don't run the full lifecycle here — the
  // earlier test already exercises the pipeline. This focuses on the
  // Phase 49 contract end-to-end: ingest → firmTemplate → generator
  // → output contains firm-specific strings.
  it('Phase 49 contract: ingest a Brand Pack and the proposal generator emits firm voice', async () => {
    const f = await seedAtProspect();

    const PACK = `# Test Pack

## 1. Tagline

Outcome-first ERP delivery — no buzzwords.

## 2. Subtitle

Sub.

## 3. Company Description

Test firm has shipped 100+ engagements across the GCC.

## 4. Why Us

We're outcome-first.

## 5. Methodology

### 5.1 Frame

Baseline the operating model in two weeks.

### 5.2 Build

Cut the new system in 2-week increments.

### 5.3 Land

Go live with confidence; hypercare included.

## 6. Roadmap

### 6.1 Foundation

Core modules live in 90 days.

## 7. Proposal Structure

### 7.1 Introduction

- Anchor the pain

## 8. Pricing Template

### 8.1 Discovery

**SKU:** TST-DISC-001
**Description:** scoping
**Annual:** $25,000

## 9. Industry Verticals

### 9.1 Retail and Wholesale Distribution

**Outcome:** Single source of truth for SKU-level margin.
**Strategic context:** Omnichannel operators consolidating ERP.
**Approach:** Phase 1 GL + AR/AP, Phase 2 inventory.

## 10. Voice Guide

Sentence case. No buzzwords.

## 11. CTA Options

### 11.1 Lock in your kickoff date this week.

cta body

## 12. Theme

**Font family:** Inter, sans-serif
**Headline case:** sentence
**Accent color:** #1a8754
`;

    // 1. Ingest the pack via the route — same path the seed + UI
    // both use. Confirms the round-trip works under auth.
    const ingestRes = await app.inject({
      method: 'POST',
      url: '/api/v1/firm/template-pack',
      cookies: { token: f.token },
      payload: { markdownPack: PACK },
    });
    expect(ingestRes.statusCode).toBe(200);

    // 2. Read back via getFirmTemplate to confirm the row landed.
    const template = await getFirmTemplate(f.firmId);
    expect(template?.tagline).toContain('Outcome-first ERP delivery');
    expect(template?.methodology.map((m) => m.title)).toEqual([
      'Frame',
      'Build',
      'Land',
    ]);

    // 3. Call the upgraded proposal generator with the firm template
    // pass-through. The Phase 49.2 changes mean the output should
    // contain Frame/Build/Land (not the platform default Discovery /
    // Configure / UAT / Go-Live / Hypercare list), the matched
    // industry vertical's outcome, and the firm's CTA.
    const proposal = generateProposal({
      clientName: 'Test Client',
      decisionMakerName: 'Jane',
      adaptorId: 'netsuite',
      adaptorName: 'NetSuite',
      pains: ['reporting-lag'],
      modulesOfInterest: [{ id: 'gl-ar-ap', label: 'GL / AR / AP' }],
      estimatedUsers: 50,
      estimatedLocations: 1,
      geographyMultiEntity: 'single',
      targetGoLive: '6-12m',
      perUserPricing: {},
      defaultPerUserPrice: 1000,
      firmName: 'Test Firm',
      preparedAt: '2026-05-10',
      firmTagline: template?.tagline ?? null,
      firmCompanyDescription: template?.companyDescription ?? null,
      firmMethodology: template?.methodology,
      firmRoadmap: template?.roadmap,
      firmIndustryVerticals: template?.industryVerticals,
      firmCtaOptions: template?.ctaOptions,
      industry: 'retail',
      firmCoverLetterTemplate: 'Hi {{decisionMaker}}, body. {{cta}}',
    });

    // Methodology was applied — Frame/Build/Land replace platform default.
    const impl = proposal['Proposal/Implementation_Approach.html'];
    expect(impl).toContain('<strong>Frame</strong>');
    expect(impl).toContain('<strong>Build</strong>');
    expect(impl).toContain('<strong>Land</strong>');
    expect(impl).not.toContain('<strong>Configure</strong>');
    expect(impl).toContain('a 3-phase methodology');

    // Roadmap section appended.
    expect(impl).toContain('<h2>Roadmap</h2>');
    expect(impl).toContain('<strong>Foundation</strong>');

    // Vertical match surfaced in Solution_Overview.
    const so = proposal['Proposal/Solution_Overview.html'];
    expect(so).toContain('For Retail and Wholesale Distribution');
    expect(so).toContain('SKU-level margin');

    // CTA injected into the cover letter.
    const cover = proposal['Proposal/Cover_Letter.docx'];
    expect(cover).toContain('Lock in your kickoff date this week');

    // Why Us picks up the tagline + description from the pack.
    const why = proposal['Proposal/Why_Us.docx'];
    expect(why).toContain('Outcome-first ERP delivery');
    expect(why).toContain('100+ engagements');
  });
});
