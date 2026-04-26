#!/usr/bin/env node
/**
 * PROD SMOKE — read-only checks against the live deployed API.
 * Pollutes no state. Creates no firms, engagements, members, or sessions.
 * Run: node apps/api/tests/prod-smoke.mjs
 */
const API = process.env.PROD_API_URL || 'https://erplaunch-api.onrender.com';
const APP_URL = process.env.APP_URL || 'https://erplaunch-web.vercel.app';

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let pass = 0, fail = 0;

async function check(label, fn) {
  process.stdout.write(`  ${label}\n    `);
  try {
    const detail = await fn();
    console.log(`${GREEN}✅ PASS${RESET}  ${DIM}${detail}${RESET}`);
    pass++;
  } catch (e) {
    console.log(`${RED}❌ FAIL${RESET}  ${e.message}`);
    fail++;
  }
}

console.log(`\n══════════ PROD API SMOKE ══════════\n  API: ${API}\n`);

await check('1. /health returns 200 + correct version', async () => {
  const r = await fetch(`${API}/health`);
  if (r.status !== 200) throw new Error(`expected 200, got ${r.status}`);
  const body = await r.json();
  if (!body.ok) throw new Error(`expected ok:true, got ${JSON.stringify(body)}`);
  if (!body.version) throw new Error(`expected version field, got ${JSON.stringify(body)}`);
  return `200  ${JSON.stringify(body)}`;
});

await check('2. /auth/login with invalid creds → 401', async () => {
  const r = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody+prod-smoke@erplaunch.test', password: 'definitely-wrong-password-xyz' }),
  });
  if (![401, 429].includes(r.status)) throw new Error(`expected 401 or 429, got ${r.status}`);
  const body = await r.json().catch(() => ({}));
  return `${r.status}  code=${body.error?.code ?? 'n/a'}`;
});

await check('3. /engagements/portal/<unknown> → 404', async () => {
  const r = await fetch(`${API}/api/v1/engagements/portal/UNKNOWN_TOKEN_smoke_${Date.now()}`);
  if (![404, 400].includes(r.status)) throw new Error(`expected 404, got ${r.status}`);
  return `${r.status}  (unknown token rejected)`;
});

await check('4. CORS preflight from APP_URL → ACAO header reflects allowlist', async () => {
  const r = await fetch(`${API}/api/v1/auth/login`, {
    method: 'OPTIONS',
    headers: {
      'Origin': APP_URL,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  const acao = r.headers.get('access-control-allow-origin');
  const acac = r.headers.get('access-control-allow-credentials');
  if (![200, 204].includes(r.status)) throw new Error(`expected 204, got ${r.status}`);
  if (!acao || (acao !== APP_URL && acao !== '*')) throw new Error(`ACAO header missing or wrong: ${acao}`);
  if (acac !== 'true') throw new Error(`ACAC must be 'true' for cookie auth: ${acac}`);
  return `${r.status}  ACAO=${acao}  ACAC=${acac}`;
});

await check('5. /auth/register with reserved slug "admin" → 400 SLUG_RESERVED', async () => {
  const r = await fetch(`${API}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      firmName: 'Smoke Test Firm', firmSlug: 'admin',
      adminName: 'Smoke Tester', adminEmail: `smoke+${Date.now()}@erplaunch.test`,
      password: 'this-must-not-create-anything',
    }),
  });
  if (![400, 429].includes(r.status)) throw new Error(`expected 400, got ${r.status}`);
  const body = await r.json().catch(() => ({}));
  if (r.status === 400 && body.error?.code !== 'SLUG_RESERVED') {
    throw new Error(`expected SLUG_RESERVED, got ${body.error?.code}`);
  }
  return `${r.status}  code=${body.error?.code ?? 'n/a'}  (no firm created)`;
});

await check('6. CORS preflight from legacy origin → blocked', async () => {
  const r = await fetch(`${API}/api/v1/auth/login`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://erplaunch.vercel.app',
      'Access-Control-Request-Method': 'POST',
    },
  });
  const acao = r.headers.get('access-control-allow-origin');
  if (acao === 'https://erplaunch.vercel.app') {
    throw new Error(`legacy origin echoed back as allowed: ${acao}`);
  }
  return `ACAO=${acao ?? 'absent'}  (correctly not echoed)`;
});

await check('7. /api/v1/auth/google/start → 302 to accounts.google.com', async () => {
  const r = await fetch(`${API}/api/v1/auth/google/start`, { redirect: 'manual' });
  if (![302, 303, 307].includes(r.status)) throw new Error(`expected 302, got ${r.status}`);
  const loc = r.headers.get('location') ?? '';
  if (!loc.startsWith('https://accounts.google.com/')) {
    throw new Error(`Location not Google: ${loc}`);
  }
  return `${r.status}  → ${new URL(loc).hostname}`;
});

await check('8. /health (warm) returns 200 stable', async () => {
  const r = await fetch(`${API}/health`);
  if (r.status !== 200) throw new Error(`expected 200, got ${r.status}`);
  return `200`;
});

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`  ${pass} passed,  ${fail} failed`);
console.log(`══════════════════════════════════════════════════════════\n`);
process.exit(fail === 0 ? 0 : 1);
