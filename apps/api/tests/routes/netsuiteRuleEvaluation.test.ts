import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { engagementRoutes } from '../../src/routes/engagements.js';
import { registerBuiltinAdaptor, getAdaptorRegistry, AdaptorRegistry } from '@ofoq/adaptor-registry';
import netsuiteAdaptor from '@ofoq/adaptor-netsuite';
import { getDb, createEngagement } from '../../src/db/index.js';

/**
 * NS Pack 1 — route-level rule evaluation through PUT /license + PATCH
 * /profile, mirroring odooRuleEvaluation.test.ts. Each test seeds the
 * triggering combination and asserts the rule id surfaces in the
 * response's conflicts array. NetSuite-specific Foundation rules
 * (multi-subsidiary requires OneWorld, multi-currency requires
 * OneWorld, etc.) are exercised end-to-end here.
 */

const JWT_SECRET = 'test-netsuite-rule-eval-secret';

let cleanup: () => void;
let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(cookie);
  await f.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });
  await f.register(engagementRoutes, { prefix: '/api/v1' });
  await f.ready();
  return f;
}

async function seedFirmAndToken(): Promise<{ firmId: string; token: string }> {
  const db = getDb();
  const firmId = createId();
  const userId = createId();
  const slug = `firm-${createId().slice(0, 8)}`;
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'NS Rule Test Firm', slug, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'NS Tester', 'not-used', 'CONSULTANT', now],
  });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'NS Tester', email: `${userId}@example.com` });
  return { firmId, token };
}

function authHeaders(token: string): Record<string, string> {
  return { cookie: `token=${token}`, 'content-type': 'application/json' };
}

async function createNetSuiteEngagement(firmId: string, clientName: string): Promise<string> {
  const eng = await createEngagement({ firmId, clientName, adaptorId: 'netsuite' });
  if (!eng) throw new Error('engagement create failed');
  return eng.id as string;
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  // Register the NetSuite adaptor into the process registry if it isn't
  // already (other test suites may have registered it; the registry
  // refuses duplicates so guard with has()).
  try {
    const reg = getAdaptorRegistry();
    if (!reg.has('netsuite')) registerBuiltinAdaptor(netsuiteAdaptor);
  } catch {
    const reg = new AdaptorRegistry();
    reg.register(netsuiteAdaptor);
  }
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

// ─── NS Pack 1 — Foundation rules through the route ──────────────────────────

describe('NetSuite engagement — NS Pack 1 Foundation rules through the route', () => {
  it('R1: subsidiaryCount>1 + edition!=ONEWORLD fires multi-subsidiary-requires-oneworld (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Multi-Sub Wrong-Edition Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.foundation.subsidiaryCount': 3,
        'ns.foundation.edition': 'ENTERPRISE',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.foundation.multi-subsidiary-requires-oneworld');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R2: multiCurrencyInScope=true + edition!=ONEWORLD fires multi-currency-requires-oneworld (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Multi-FX Wrong-Edition Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.foundation.multiCurrencyInScope': true,
        'ns.foundation.edition': 'MID_MARKET',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.foundation.multi-currency-requires-oneworld');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R3: multiBookAccounting=true + edition!=ONEWORLD fires multi-book-requires-oneworld (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Multi-Book Wrong-Edition Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.foundation.multiBookAccounting': true,
        'ns.foundation.edition': 'ENTERPRISE',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.foundation.multi-book-requires-oneworld');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R4: sandboxAccount=NONE + edition=ENTERPRISE fires no-sandbox-on-mid-market-or-above (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'No-Sandbox Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.foundation.sandboxAccount': 'NONE',
        'ns.foundation.edition': 'ENTERPRISE',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.foundation.no-sandbox-on-mid-market-or-above');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R5: customRolesRequired=true + edition=STARTER fires custom-roles-on-starter-restricted (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Starter Custom-Roles Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'STARTER', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.foundation.customRolesRequired': true,
        'ns.foundation.edition': 'STARTER',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.foundation.custom-roles-on-starter-restricted');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R6: ssoInScope=true + suiteCloudPlus=false fires sso-better-with-suitecloud-plus (INFO)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'SSO No-Plus Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.foundation.ssoInScope': true,
        'ns.foundation.suiteCloudPlus': false,
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.foundation.sso-better-with-suitecloud-plus');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('INFO');
  });

  it('R7: subsidiaryCount>1 + subsidiaryList empty fires subsidiary-list-required-when-count-gt-one (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Multi-Sub No-List Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ONEWORLD', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.foundation.subsidiaryCount': 4,
        'ns.foundation.subsidiaryList': '',
        'ns.foundation.edition': 'ONEWORLD',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.foundation.subsidiary-list-required-when-count-gt-one');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R8: subsidiaryCount>1 + eliminationEntity empty fires elimination-entity-required-for-consolidation (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Multi-Sub No-Elim Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ONEWORLD', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.foundation.subsidiaryCount': 3,
        'ns.foundation.eliminationEntity': '',
        'ns.foundation.edition': 'ONEWORLD',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.foundation.elimination-entity-required-for-consolidation');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R9: ARM in scope + edition=STANDARD fires advanced-revrec-recommends-mid-market-or-above (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Standard ARM Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.foundation.advancedRevRecInScope': true,
        'ns.foundation.edition': 'STANDARD',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.foundation.advanced-revrec-recommends-mid-market-or-above');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });
});

// ─── NS Pack 2 — Tax Engine through the route ────────────────────────────────

describe('NetSuite engagement — NS Pack 2 Tax rules through the route', () => {
  it('R1: engine=LEGACY + suiteSuccessBundle populated fires legacy-engine-on-new-account (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Legacy Engine New Account Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.tax.engine': 'LEGACY',
        'ns.foundation.suiteSuccessBundle': 'US',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.tax.legacy-engine-on-new-account');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R2: subsidiaryCount>1 + nexusList empty fires oneworld-multi-sub-needs-nexus-list (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Multi-Sub No-Nexus Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ONEWORLD', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.foundation.subsidiaryCount': 3,
        'ns.tax.nexusList': '',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.tax.oneworld-multi-sub-needs-nexus-list');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R3: einvoicingMandatory=YES + einvoicingSuiteApp empty fires einvoicing-yes-needs-suiteapp (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'E-invoicing No-SuiteApp Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.tax.einvoicingMandatory': 'YES',
        'ns.tax.einvoicingSuiteApp': '',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.tax.einvoicing-yes-needs-suiteapp');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R4: withholdingInScope=true fires withholding-needs-suiteapp (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Withholding Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: { 'ns.tax.withholdingInScope': true } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.tax.withholding-needs-suiteapp');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R5: useTaxInScope=true + primaryCountry=GB fires use-tax-only-in-us (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'UK Use-Tax Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.tax.useTaxInScope': true,
        'ns.foundation.primaryCountry': 'GB',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.tax.use-tax-only-in-us');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R6: salesTaxAutomation=true + nexusList empty fires automation-needs-nexus-list (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Avalara No-Nexus Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.tax.salesTaxAutomation': true,
        'ns.tax.nexusList': '',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.tax.automation-needs-nexus-list');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R7: multiJurisdictionReporting=true + nexusList empty fires multi-jurisdiction-needs-multiple-nexuses (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Multi-Juris No-Nexus Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.tax.multiJurisdictionReporting': true,
        'ns.tax.nexusList': '',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.tax.multi-jurisdiction-needs-multiple-nexuses');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R8: taxExemptCustomers=true fires exempt-customers-need-certificate-management (INFO)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Exempt Customers Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: { 'ns.tax.taxExemptCustomers': true } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.tax.exempt-customers-need-certificate-management');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('INFO');
  });

  it('R9: reverseChargeInScope=true + foundation.edition=MID_MARKET fires reverse-charge-typical-on-oneworld (INFO)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Single-Sub Reverse-Charge Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.tax.reverseChargeInScope': true,
        'ns.foundation.edition': 'MID_MARKET',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.tax.reverse-charge-typical-on-oneworld');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('INFO');
  });
});
