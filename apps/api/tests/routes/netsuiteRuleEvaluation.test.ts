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

// ─── NS Pack 3 — Localization & SuiteSuccess through the route ───────────────

describe('NetSuite engagement — NS Pack 3 Localization rules through the route', () => {
  it('R1: multi-sub paid edition + bundle list populated fires custom-bundle-on-mid-market-or-above-warn (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Multi-Sub Custom-Bundle Co');
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
        'ns.foundation.edition': 'ONEWORLD',
        'ns.localization.bundlePerSubsidiary': 'Atlas US | Custom — no bundle\nAtlas UK | UK',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.localization.custom-bundle-on-mid-market-or-above-warn');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R2: subsidiaryCount>1 + bundlePerSubsidiary empty fires bundle-list-must-cover-all-subsidiaries (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Multi-Sub No-Bundle Co');
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
        'ns.localization.bundlePerSubsidiary': '',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.localization.bundle-list-must-cover-all-subsidiaries');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R3: statutoryReports populated + taxReportingSuiteApps empty fires statutory-reports-need-framework (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Statutory No-Framework Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.localization.statutoryReports': 'US: 1099-NEC, FBAR\nUK: VAT 100',
        'ns.localization.taxReportingSuiteApps': '',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.localization.statutory-reports-need-framework');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R4: gdprApplicable=true + dpa=NO fires gdpr-needs-dpa (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'GDPR No-DPA Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.localization.gdprApplicable': true,
        'ns.localization.dpaSignedWithNetsuite': 'NO',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.localization.gdpr-needs-dpa');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R5: residency required + jurisdiction outside US/EU/AU fires data-residency-may-not-be-supported (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Saudi Residency Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.localization.dataResidencyRequired': true,
        'ns.localization.dataResidencyJurisdiction': 'Saudi Arabia',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.localization.data-residency-may-not-be-supported');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R6: languagesPerSubsidiary populated + edition=MID_MARKET fires multi-language-needs-oneworld (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Multi-Lang Mid-Market Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.localization.languagesPerSubsidiary': 'Sub A | en\nSub B | de',
        'ns.foundation.edition': 'MID_MARKET',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.localization.multi-language-needs-oneworld');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R7: countrySpecificGlAccounts=true + coaCustomScope empty fires coa-custom-modifications-need-scope (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Country GL No-Scope Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.localization.countrySpecificGlAccounts': true,
        'ns.localization.coaCustomScope': '',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.localization.coa-custom-modifications-need-scope');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R8: fiscalCalendarPerSubsidiary=true + edition=ENTERPRISE fires fiscal-calendar-per-subsidiary-needs-oneworld (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Multi-Calendar Enterprise Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.localization.fiscalCalendarPerSubsidiary': true,
        'ns.foundation.edition': 'ENTERPRISE',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.localization.fiscal-calendar-per-subsidiary-needs-oneworld');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R9: customLocalizationDev=true + suiteCloudPlus=false fires custom-localization-dev-needs-suitecloud-plus (INFO)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Custom Loc Dev No-Plus Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'ns.localization.customLocalizationDev': true,
        'ns.foundation.suiteCloudPlus': false,
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'ns.localization.custom-localization-dev-needs-suitecloud-plus');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('INFO');
  });
});

// ─── Kickoff Pack — universal rules through the route (NetSuite) ─────────────

describe('NetSuite engagement — Kickoff Pack rules through the route', () => {
  it('R1: empty sponsor fires kickoff.mandate.sponsor-required (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'No Sponsor Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: { 'kickoff.mandate.sponsor': '' } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'kickoff.mandate.sponsor-required');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R2: empty successCriteria fires success-criteria-required (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'No Success Criteria Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: { 'kickoff.mandate.successCriteria': '' } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'kickoff.mandate.success-criteria-required');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R3: ad-hoc steering fires steering-cadence-monthly-warn (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Ad-Hoc Steering Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: { 'kickoff.governance.steeringCadence': 'AD_HOC' } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'kickoff.governance.steering-cadence-monthly-warn');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R4: empty escalationPath fires escalation-path-required (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'No Escalation Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: { 'kickoff.governance.escalationPath': '' } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'kickoff.governance.escalation-path-required');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R5: targetGoLiveDate set + ns.foundation.edition=ONEWORLD fires tight-timeline-on-multi-entity (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'Tight Timeline OneWorld Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ONEWORLD', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'kickoff.mandate.targetGoLiveDate': '2026-11-15',
        'ns.foundation.edition': 'ONEWORLD',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'kickoff.tight-timeline-on-multi-entity');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R6: empty statusReportAudience fires audience-empty (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createNetSuiteEngagement(firmId, 'No Audience Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'MID_MARKET', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: { 'kickoff.communication.statusReportAudience': '' } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'kickoff.communication.audience-empty');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });
});
