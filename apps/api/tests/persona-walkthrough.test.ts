/**
 * PERSONA WALKTHROUGH — full pilot-golive user journey.
 * Sarah Chen (Northlake Partners, consultant) + Marcus Okafor (Aurora Foods, client).
 * Runs 18 steps end-to-end against real Fastify handlers + ephemeral SQLite.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import nodemailer from 'nodemailer';
import { setupTestDb } from './_helpers/testDb.js';
import { authRoutes } from '../src/routes/auth.js';
import { engagementRoutes } from '../src/routes/engagements.js';
import { portalRoutes } from '../src/routes/portal.js';
import { portalAuthRoutes } from '../src/routes/portalAuth.js';
import { firmBrandingRoutes } from '../src/routes/firmBranding.js';
import { __setTestTransportFactory } from '../src/services/emailTransport.js';
import { registerBuiltinAdaptor, getAdaptorRegistry } from '@ofoq/adaptor-registry';
import { netsuiteAdaptor } from '@ofoq/adaptor-netsuite';
import { upsertPortalToken, upsertFirmEmailSettings, findFirmBySlug } from '../src/db/index.js';

function step(n: number, who: string, what: string) { console.log(`\n▸ Step ${n} — ${who}: ${what}`); }
function note(msg: string, detail?: unknown) { console.log(`    ${msg}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }

let app: FastifyInstance;
let cleanup: () => void;
const emails: Array<{ to: string; subject: string; text: string; html?: string }> = [];

beforeAll(async () => {
  process.env.ERPLAUNCH_MASTER_KEY = 'a'.repeat(64);
  process.env.PORTAL_SESSION_COOKIE_SECRET = 'walkthrough-portal-secret-64char-long-enough-for-ci-testing';
  process.env.JWT_SECRET = 'walkthrough-consultant-secret';
  process.env.APP_URL = 'https://erplaunch-web.vercel.app';

  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  if (!getAdaptorRegistry().has('netsuite')) registerBuiltinAdaptor(netsuiteAdaptor);

  __setTestTransportFactory(() => {
    const t = nodemailer.createTransport({ jsonTransport: true });
    const orig = t.sendMail.bind(t);
    t.sendMail = async (msg: Parameters<typeof t.sendMail>[0]) => {
      const info = await orig(msg as Parameters<typeof orig>[0]);
      emails.push({
        to: String(msg.to ?? ''), subject: String(msg.subject ?? ''),
        text: String(msg.text ?? ''), html: msg.html as string | undefined,
      });
      return info;
    };
    return t as unknown as ReturnType<typeof nodemailer.createTransport>;
  });

  app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(jwt, { secret: process.env.JWT_SECRET!, cookie: { cookieName: 'token', signed: false } });
  await app.register(jwt, { namespace: 'portal', secret: process.env.PORTAL_SESSION_COOKIE_SECRET!, cookie: { cookieName: 'portal_token', signed: false } });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(engagementRoutes, { prefix: '/api/v1' });
  await app.register(firmBrandingRoutes, { prefix: '/api/v1' });
  await app.register(portalAuthRoutes, { prefix: '/api/v1' });
  await app.register(portalRoutes, { prefix: '/api/v1' });
  await app.ready();
});

afterAll(async () => { await app.close(); cleanup(); });

describe('Persona walkthrough — Sarah (consultant) + Marcus (client)', () => {
  it('runs the full pilot happy path end-to-end', async () => {
    let consultantCookie = ''; let engagementId = ''; let portalToken = '';

    step(1, 'Sarah', 'signs up a new firm account for Northlake Partners');
    {
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: {
        firmName: 'Northlake Partners', firmSlug: 'northlake',
        adminName: 'Sarah Chen', adminEmail: 'sarah@northlakepartners.test',
        password: 'correct-horse-battery-staple',
      }});
      expect(r.statusCode).toBe(201);
      const setCookie = r.headers['set-cookie'];
      consultantCookie = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
      expect(consultantCookie).toContain('token=');

      const firm = await findFirmBySlug('northlake');
      await upsertFirmEmailSettings(firm!.id as string, {
        fromEmail: 'portal@northlakepartners.test', fromName: 'Northlake Partners',
        smtpHost: 'smtp.test.example', smtpPort: 587, smtpSecure: true,
        smtpUsername: 'portal@northlakepartners.test', smtpPassword: 'smtp-secret',
        inboundProtocol: 'NONE',
      });
      note('Firm + SMTP seeded');
    }

    step(2, 'Sarah', 'sets firm white-label branding');
    {
      const r = await app.inject({ method: 'PATCH', url: '/api/v1/firm/branding',
        headers: { cookie: consultantCookie },
        payload: { displayName: 'Northlake Partners', primaryColor: '#0F4C81', secondaryColor: '#F6A623', supportEmail: 'support@northlakepartners.test' },
      });
      expect(r.statusCode).toBe(200);
    }

    step(3, 'Sarah', 'creates an engagement for Aurora Foods Ltd');
    {
      const r = await app.inject({ method: 'POST', url: '/api/v1/engagements',
        headers: { cookie: consultantCookie }, payload: { clientName: 'Aurora Foods Ltd' } });
      expect(r.statusCode).toBe(201);
      engagementId = r.json().data.id;
    }

    step(4, 'Sarah', 'fills in engagement profile');
    {
      const r = await app.inject({ method: 'PATCH', url: `/api/v1/engagements/${engagementId}/profile`,
        headers: { cookie: consultantCookie },
        payload: { answers: { industry: 'Food & Beverage', employees: 240, annualRevenue: 85000000, countries: ['US', 'CA'], multiCurrency: true, intercompany: false } },
      });
      expect([200, 201]).toContain(r.statusCode);
    }

    step(5, 'Sarah', 'sets NetSuite license edition');
    {
      const r = await app.inject({ method: 'PUT', url: `/api/v1/engagements/${engagementId}/license`,
        headers: { cookie: consultantCookie },
        payload: { edition: 'STARTER', modules: ['GENERAL_LEDGER', 'AP', 'AR', 'INVENTORY'] },
      });
      expect([200, 201]).toContain(r.statusCode);
    }

    step(6, 'Sarah', 'sets 2 implementation phases');
    {
      const r = await app.inject({ method: 'PUT', url: `/api/v1/engagements/${engagementId}/phases`,
        headers: { cookie: consultantCookie },
        payload: [
          { name: 'Phase 1 — Foundation', order: 1, flows: ['R2R'], trigger: 'REQUIREMENT', status: 'PLANNED' },
          { name: 'Phase 2 — Operations', order: 2, flows: ['P2P', 'O2C'], trigger: 'REQUIREMENT', status: 'PLANNED' },
        ],
      });
      expect([200, 201]).toContain(r.statusCode);
    }

    step(7, 'Sarah', 'reviews rule-engine conflicts');
    {
      const r = await app.inject({ method: 'GET', url: `/api/v1/engagements/${engagementId}`, headers: { cookie: consultantCookie } });
      expect(r.statusCode).toBe(200);
      expect(Array.isArray(r.json().data?.conflicts ?? [])).toBe(true);
    }

    step(8, 'Sarah', 'adds Marcus as client portal member');
    {
      const r = await app.inject({ method: 'POST', url: `/api/v1/engagements/${engagementId}/members`,
        headers: { cookie: consultantCookie },
        payload: { name: 'Marcus Okafor', role: 'Client Sponsor', team: 'CLIENT', email: 'marcus@aurorafoods.test' },
      });
      expect(r.statusCode).toBe(201);
    }

    step(9, 'Sarah', 'adds a portal todo');
    let todoId = '';
    {
      const r = await app.inject({ method: 'POST', url: `/api/v1/engagements/${engagementId}/portal-todos`,
        headers: { cookie: consultantCookie },
        payload: { title: 'Upload FY25 trial balance (PDF or Excel)', description: 'Needed to seed opening balances.', dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
      });
      expect([200, 201]).toContain(r.statusCode);
      todoId = r.json().data?.id;
    }

    step(10, 'Sarah', 'sends portal invite');
    {
      const r = await app.inject({ method: 'POST', url: `/api/v1/engagements/${engagementId}/portal-invites`,
        headers: { cookie: consultantCookie }, payload: {} });
      expect(r.statusCode).toBe(200);
      expect(r.json().data?.sent).toBe(1);
      portalToken = await upsertPortalToken(engagementId);
      expect(portalToken).toBeTruthy();
    }

    let portalCookie = '';

    step(11, 'Marcus', 'requests a sign-in link');
    {
      emails.length = 0;
      const r = await app.inject({ method: 'POST', url: '/api/v1/engagements/portal/request-access',
        payload: { email: 'marcus@aurorafoods.test', engagementToken: portalToken } });
      expect(r.statusCode).toBe(202);
      const linkEmail = emails.find((e) => e.to === 'marcus@aurorafoods.test');
      expect(linkEmail).toBeTruthy();
    }

    step(12, 'Marcus', 'clicks magic link, extracts code');
    let code = '';
    {
      const linkEmail = emails.find((e) => e.to === 'marcus@aurorafoods.test');
      const m = /code=([A-Za-z0-9]+)/.exec(linkEmail?.text ?? linkEmail?.html ?? '');
      code = m?.[1] ?? '';
      expect(code).toBeTruthy();
    }

    step(13, 'Marcus', 'verifies and gets session cookie');
    {
      const r = await app.inject({ method: 'POST', url: '/api/v1/engagements/portal/verify',
        payload: { email: 'marcus@aurorafoods.test', engagementToken: portalToken, code } });
      expect(r.statusCode).toBe(200);
      const setCookie = r.headers['set-cookie'];
      portalCookie = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
      expect(portalCookie).toContain('portal_token=');
    }

    step(14, 'Marcus', 'loads portal view');
    {
      const r = await app.inject({ method: 'GET', url: `/api/v1/engagements/portal/${portalToken}`,
        headers: { cookie: portalCookie } });
      expect(r.statusCode).toBe(200);
    }

    step(15, 'Marcus', 'marks todo complete');
    {
      const r = await app.inject({ method: 'PATCH', url: `/api/v1/engagements/portal/${portalToken}/todos/${todoId}/complete`,
        headers: { cookie: portalCookie } });
      expect(r.statusCode).toBe(200);
      expect(r.json().data?.completedBy).toBe('Marcus Okafor');
    }

    step(16, 'Sarah', 'sees todo completion');
    {
      const r = await app.inject({ method: 'GET', url: `/api/v1/engagements/${engagementId}/portal-todos`,
        headers: { cookie: consultantCookie } });
      expect(r.statusCode).toBe(200);
      const theOne = (r.json().data ?? []).find((t: { id: string }) => t.id === todoId);
      expect(theOne?.completedAt).toBeTruthy();
      expect(theOne?.completedBy).toBe('Marcus Okafor');
    }

    step(17, 'Marcus', 'logs out');
    {
      const r = await app.inject({ method: 'POST', url: '/api/v1/engagements/portal/logout',
        headers: { cookie: portalCookie } });
      expect([200, 204]).toContain(r.statusCode);
    }

    step(18, 'Marcus', 'blocked from mutations after logout');
    {
      const r = await app.inject({ method: 'PATCH', url: `/api/v1/engagements/portal/${portalToken}/todos/${todoId}/reopen`,
        headers: { cookie: portalCookie } });
      expect([401, 403]).toContain(r.statusCode);
    }

    console.log('\n  WALKTHROUGH COMPLETE — all 18 steps passed\n');
  }, 30000);
});
