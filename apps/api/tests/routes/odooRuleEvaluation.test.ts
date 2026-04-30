import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { engagementRoutes } from '../../src/routes/engagements.js';
import { registerBuiltinAdaptor, getAdaptorRegistry, AdaptorRegistry } from '@ofoq/adaptor-registry';
import odooAdaptor from '@ofoq/adaptor-odoo';
import { getDb, createEngagement } from '../../src/db/index.js';

const JWT_SECRET = 'test-odoo-rule-eval-secret';

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
    args: [firmId, 'Rule Test Firm', slug, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?,?)`,
    args: [userId, firmId, `${userId}@example.com`, 'Tester', 'not-used', 'CONSULTANT', now],
  });
  const token = app.jwt.sign({ userId, firmId, role: 'CONSULTANT', name: 'Tester', email: `${userId}@example.com` });
  return { firmId, token };
}

function authHeaders(token: string): Record<string, string> {
  return { cookie: `token=${token}`, 'content-type': 'application/json' };
}

async function createOdooEngagement(firmId: string, clientName: string): Promise<string> {
  const eng = await createEngagement({ firmId, clientName, adaptorId: 'odoo' });
  if (!eng) throw new Error('engagement create failed');
  return eng.id as string;
}

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
  // Register the Odoo adaptor into the process registry if it isn't already
  // (other test suites may have registered it; the registry refuses
  // duplicates so guard with has()).
  try {
    const reg = getAdaptorRegistry();
    if (!reg.has('odoo')) registerBuiltinAdaptor(odooAdaptor);
  } catch {
    // fallback: use a fresh registry — unlikely in practice, but safe
    const reg = new AdaptorRegistry();
    reg.register(odooAdaptor);
  }
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  cleanup();
});

describe('Odoo engagement — PUT /license triggers adaptor rule evaluation', () => {
  it('licensing Studio on COMMUNITY fires odoo.studio-is-enterprise-only', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Studio Conflict Co');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'COMMUNITY', modules: ['ENTERPRISE_STUDIO'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const ids = body.data.conflicts.map((c) => c.id);
    expect(ids).toContain('odoo.studio-is-enterprise-only');
    const r = body.data.conflicts.find((c) => c.id === 'odoo.studio-is-enterprise-only');
    expect(r?.severity).toBe('BLOCK');
  });

  it('ENTERPRISE + full module set on a new engagement yields only data-completeness warnings', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Clean Scoping Co');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: ['MRP', 'QUALITY', 'ENTERPRISE_STUDIO'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    // Without answers the fiscal-year-start DATA_WARNING fires, but no
    // LICENSE_GAP BLOCKs should be present.
    const blocks = body.data.conflicts.filter((c) => c.severity === 'BLOCK');
    expect(blocks).toEqual([]);
  });
});

describe('Odoo engagement — PATCH /profile fires answer-driven rules', () => {
  it('enabling MRP without the MRP module fires a BLOCK conflict', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'MRP Gap Co');

    // License has no MRP module
    await app.inject({
      method: 'PUT',
      url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });

    // Turn on MRP in the answers
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: { 'odoo.mrp.enabled': true, 'odoo.company.fiscalYearStart': '01-01' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const ids = body.data.conflicts.map((c) => c.id);
    expect(ids).toContain('odoo.mrp.requires-mrp-module');
    expect(body.data.conflicts.find((c) => c.id === 'odoo.mrp.requires-mrp-module')?.severity).toBe('BLOCK');
  });

  it('resolving the license gap (add MRP module) clears the conflict on next save', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Fix-Me Co');

    // Initial state: MRP enabled but no module → conflict
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token), payload: { edition: 'ENTERPRISE', modules: [] },
    });
    await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: { 'odoo.mrp.enabled': true, 'odoo.company.fiscalYearStart': '01-01' } },
    });

    // Fix it: provision the MRP module
    const fixed = await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token), payload: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    const body = fixed.json() as { data: { conflicts: Array<{ id: string }> } };
    const ids = body.data.conflicts.map((c) => c.id);
    expect(ids).not.toContain('odoo.mrp.requires-mrp-module');
  });

  it('MRP sub-setting without parent emits a WARN', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Parentless MRP Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token), payload: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.mrp.enabled': false,
        'odoo.mrp.workCenters': true,
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.mrp.sub-settings-without-parent');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });
});

// ─── Pack 1 — Foundation rules through the route ─────────────────────────────
//
// Each test seeds the triggering combination via PATCH /profile (and
// PUT /license where needed) and asserts the rule id surfaces in the
// route's response. Mirrors the per-rule list in pack-1.

describe('Odoo engagement — Pack 1 Foundation rules through the route', () => {
  it('R1: deployment=ONLINE + ENTERPRISE_STUDIO in license fires online-disallows-custom-modules (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Online Studio Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: ['ENTERPRISE_STUDIO'] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.foundation.deploymentMode': 'ONLINE',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.foundation.online-disallows-custom-modules');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R3: deployment=ODOOSH on COMMUNITY edition fires odoosh-requires-enterprise (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Odoo.sh Community Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'COMMUNITY', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.foundation.deploymentMode': 'ODOOSH',
        'odoo.foundation.edition': 'COMMUNITY',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.foundation.odoosh-requires-enterprise');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R4: multiCompany=true + empty entityList fires multi-company-needs-entities (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Multi-Co Empty Entities Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.foundation.multiCompany': true,
        'odoo.foundation.entityList': '',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.foundation.multi-company-needs-entities');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R4: filling entityList clears the conflict on next save', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Multi-Co Fix Entities Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });
    // First save — empty entityList → R4 fires.
    await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.foundation.multiCompany': true,
        'odoo.foundation.entityList': '',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    // Second save — entityList populated → R4 should clear.
    const fixed = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.foundation.multiCompany': true,
        'odoo.foundation.entityList': 'Sahel Holding, AE, AED\nSahel Trading, EG, EGP',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = fixed.json() as { data: { conflicts: Array<{ id: string }> } };
    expect(body.data.conflicts.map((c) => c.id))
      .not.toContain('odoo.foundation.multi-company-needs-entities');
  });

  it('R5: multiCurrency=true + empty reportingCurrency fires multi-currency-needs-reporting-currency (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Multi-FX Empty Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.foundation.multiCurrency': true,
        'odoo.foundation.reportingCurrency': '',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.foundation.multi-currency-needs-reporting-currency');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R6: ONLINE + Y3 users > 50 fires online-cost-warning-at-scale (INFO)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Big-Online Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.foundation.deploymentMode': 'ONLINE',
        'odoo.foundation.usersInternalY3': 75,
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.foundation.online-cost-warning-at-scale');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('INFO');
  });

  it('R7: primaryCountry=SA fires country-mandates-einvoicing (INFO)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Saudi E-Invoice Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.foundation.country-mandates-einvoicing');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('INFO');
  });

  it('R7: primaryCountry=US does NOT fire country-mandates-einvoicing', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'US No-Mandate Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.foundation.primaryCountry': 'US',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string }> } };
    expect(body.data.conflicts.map((c) => c.id))
      .not.toContain('odoo.foundation.country-mandates-einvoicing');
  });
});

// ─── Pack 2 — Tax Engine rules through the route ─────────────────────────────

describe('Odoo engagement — Pack 2 Tax rules through the route', () => {
  it('R1: salesPriceMode=INCLUDED + purchasePriceMode=EXCLUDED fires price-mode-mismatch (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Mismatched Price Mode Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.tax.salesPriceMode': 'INCLUDED',
        'odoo.tax.purchasePriceMode': 'EXCLUDED',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.tax.price-mode-mismatch');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R2: einvoicing=YES with no l10n module licensed fires einvoicing-yes-needs-l10n (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'No-l10n Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: ['BASE_ACCOUNTING'] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.tax.einvoicingRequired': 'YES',
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.tax.einvoicing-yes-needs-l10n');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R3: reverseCharge=true without Accounting module fires reverse-charge-needs-base-accounting (BLOCK)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'No-Accounting Reverse-Charge Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.tax.reverseCharge': true,
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.tax.reverse-charge-needs-base-accounting');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('BLOCK');
  });

  it('R4: withholding=true fires withholding-needs-coa-accounts (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Withholding Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: ['BASE_ACCOUNTING'] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.tax.withholding': true,
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.tax.withholding-needs-coa-accounts');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R5: fiscalPositions=true with empty fiscalPositionList fires fiscal-positions-need-list (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Empty Fiscal Positions Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.tax.fiscalPositions': true,
        'odoo.tax.fiscalPositionList': '',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.tax.fiscal-positions-need-list');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });

  it('R6: salesPriceMode=INCLUDED with no POS / eCommerce module fires b2c-mode-on-services-only (INFO)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'B2C-mode Services-only Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: ['BASE_ACCOUNTING'] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.tax.salesPriceMode': 'INCLUDED',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.tax.b2c-mode-on-services-only');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('INFO');
  });

  it('R7: regionalVariation=true with empty fiscalPositionList fires regional-variation-needs-multiple-tax-codes (INFO)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Regional Variation Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.tax.regionalVariation': true,
        'odoo.tax.fiscalPositionList': '',
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.tax.regional-variation-needs-multiple-tax-codes');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('INFO');
  });

  it('R8: hasExemptCustomers=true with fiscalPositions=false fires exempt-customers-need-fiscal-position (WARN)', async () => {
    const { firmId, token } = await seedFirmAndToken();
    const engId = await createOdooEngagement(firmId, 'Exempt-no-position Co');
    await app.inject({
      method: 'PUT', url: `/api/v1/engagements/${engId}/license`,
      headers: authHeaders(token),
      payload: { edition: 'ENTERPRISE', modules: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/engagements/${engId}/profile`,
      headers: authHeaders(token),
      payload: { answers: {
        'odoo.tax.hasExemptCustomers': true,
        'odoo.tax.fiscalPositions': false,
        'odoo.company.fiscalYearStart': '01-01',
      } },
    });
    const body = res.json() as { data: { conflicts: Array<{ id: string; severity: string }> } };
    const hit = body.data.conflicts.find((c) => c.id === 'odoo.tax.exempt-customers-need-fiscal-position');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('WARN');
  });
});
