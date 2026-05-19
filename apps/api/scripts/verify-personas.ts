/**
 * Phase 52.9 — Persona verification.
 *
 * After `seed-lifecycle` runs, this script reads the same DB and
 * asserts that each persona's primary view contains the data they
 * need to do their job:
 *
 *   - Sales rep   → owns LEAD/QUALIFIED demos; Inbox For-You ≥ 2;
 *                   Customers list filtered to their stages ≥ 2;
 *                   Pipeline funnel has data; Utilization shows them.
 *   - Project Lead → owns DISCOVERY..GOLIVE demos; Inbox For-You ≥ 1;
 *                   Customers list delivery stages ≥ 5; Delivery
 *                   dashboard has active count + forecast.
 *   - CSM         → owns HYPERCARE..RENEWAL_DUE demos; Inbox has a
 *                   Renewal-Due alert; Customer Health managed > 0;
 *                   Renewals next-90 includes Mike Renewal Due.
 *   - AR owner    → every customer has an arOwnerUserId.
 *
 * Prints `[verify] ✅ <persona> <assertion>` on pass, `[verify] ❌`
 * on fail. Exit code 1 if any assertion fails.
 */
import { initDb, getDb } from '../src/db/index.js';
import { listCustomerSummaries } from '../src/db/customerSummary.js';
import { buildInbox } from '../src/services/inbox/buildInbox.js';
import {
  buildPipelineReport,
  buildDeliveryReport,
  buildHealthReport,
  buildRenewalsReport,
  buildUtilizationReport,
} from '../src/services/reports/buildReports.js';

interface AssertionResult {
  persona: string;
  name: string;
  pass: boolean;
  detail: string;
}

const results: AssertionResult[] = [];

function record(persona: string, name: string, pass: boolean, detail: string): void {
  results.push({ persona, name, pass, detail });
  const symbol = pass ? '✅' : '❌';
  // eslint-disable-next-line no-console
  console.log(`[verify] ${symbol} ${persona} — ${name}: ${detail}`);
}

async function pickFirstFirm(): Promise<string> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT id FROM Firm ORDER BY createdAt ASC LIMIT 1` });
  const row = r.rows[0] as { id?: string } | undefined;
  if (!row?.id) throw new Error('No firms in DB');
  return row.id;
}

interface OwnerMap {
  salesUserId: string;
  pmUserId: string;
  csmUserId: string;
  arUserId: string;
}

async function resolveDemoOwners(firmId: string): Promise<OwnerMap> {
  // Read owner ids off the seeded LEAD/DISCOVERY/HYPERCARE demos.
  const db = getDb();
  const grab = async (stage: string, col: 'salesOwnerUserId' | 'projectLeadUserId' | 'csmUserId' | 'arOwnerUserId') => {
    const r = await db.execute({
      sql: `SELECT ${col} AS uid FROM Customer
            WHERE firmId = ? AND name LIKE '[DEMO]%' AND currentStage = ? LIMIT 1`,
      args: [firmId, stage],
    });
    const row = r.rows[0] as { uid?: string | null } | undefined;
    return row?.uid ?? null;
  };
  const salesUserId = (await grab('LEAD', 'salesOwnerUserId')) ?? '';
  const pmUserId = (await grab('DISCOVERY', 'projectLeadUserId')) ?? '';
  // CSM persona is resolved from the RENEWAL_DUE customer (Mike) so the
  // Renewal-Due alert assertion targets the actual owner of the alerting
  // customer rather than an unrelated post-go-live owner.
  const csmUserId = (await grab('RENEWAL_DUE', 'csmUserId')) ?? '';
  const arUserId = (await grab('LEAD', 'arOwnerUserId')) ?? '';
  if (!salesUserId || !pmUserId || !csmUserId || !arUserId) {
    throw new Error('Persona owner resolution failed — did seed-lifecycle run?');
  }
  return { salesUserId, pmUserId, csmUserId, arUserId };
}

export interface VerifyResult {
  pass: boolean;
  assertions: AssertionResult[];
}

export async function verifyPersonasForFirm(firmId: string): Promise<VerifyResult> {
  const owners = await resolveDemoOwners(firmId);

  // ─── Sales rep ────────────────────────────────────────────────────
  const salesInbox = await buildInbox({ firmId, userId: owners.salesUserId, isAdmin: false });
  record(
    'Sales',
    'Inbox For-You ≥ 2',
    salesInbox.forYou.length >= 2,
    `forYou=${salesInbox.forYou.length}`,
  );
  const salesCustomers = await listCustomerSummaries(firmId, {
    ownerUserId: owners.salesUserId,
    stages: ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON'],
  });
  record(
    'Sales',
    'Customers in sales stages ≥ 2',
    salesCustomers.length >= 2,
    `count=${salesCustomers.length}`,
  );
  const pipeline = await buildPipelineReport(firmId);
  record(
    'Sales',
    'Pipeline funnel has data',
    pipeline.funnel.some((s) => s.count > 0),
    `nonZeroStages=${pipeline.funnel.filter((s) => s.count > 0).length}`,
  );
  const util = await buildUtilizationReport(firmId);
  const onUtilization = util.byUser.some((u) => u.userId === owners.salesUserId);
  record('Sales', 'Sales user on Utilization bar', onUtilization, `users=${util.byUser.length}`);

  // ─── Project Lead ─────────────────────────────────────────────────
  const pmInbox = await buildInbox({ firmId, userId: owners.pmUserId, isAdmin: false });
  record(
    'Project Lead',
    'Inbox For-You ≥ 1',
    pmInbox.forYou.length >= 1,
    `forYou=${pmInbox.forYou.length}`,
  );
  const pmCustomers = await listCustomerSummaries(firmId, {
    ownerUserId: owners.pmUserId,
    stages: ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GOLIVE'],
  });
  record(
    'Project Lead',
    'Customers in delivery stages ≥ 5',
    pmCustomers.length >= 5,
    `count=${pmCustomers.length}`,
  );
  const delivery = await buildDeliveryReport(firmId);
  record(
    'Project Lead',
    'Delivery dashboard active > 0',
    delivery.activeProjects > 0,
    `active=${delivery.activeProjects} forecast=${delivery.forecastedGoLives.length}`,
  );

  // ─── CSM ──────────────────────────────────────────────────────────
  const csmInbox = await buildInbox({ firmId, userId: owners.csmUserId, isAdmin: false });
  const renewalAlert = csmInbox.forYou.some((it) => it.itemType === 'RENEWAL_DUE_SOON');
  record(
    'CSM',
    'Inbox has Renewal-Due alert',
    renewalAlert,
    `forYouItems=${csmInbox.forYou.length}`,
  );
  const health = await buildHealthReport(firmId);
  record(
    'CSM',
    'Customer Health managed > 0',
    health.totalManagedCustomers > 0,
    `managed=${health.totalManagedCustomers}`,
  );
  const renewals = await buildRenewalsReport(firmId);
  const mikeInList = renewals.next90Days.some((r) => r.customerName.includes('Mike Renewal Due'));
  record('CSM', 'Renewals next-90 includes Mike', mikeInList, `next90=${renewals.next90Days.length}`);

  // ─── AR owner ─────────────────────────────────────────────────────
  const db = getDb();
  const arRows = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM Customer
          WHERE firmId = ? AND name LIKE '[DEMO]%' AND arOwnerUserId IS NULL`,
    args: [firmId],
  });
  const missingAr = Number((arRows.rows[0] as { c?: number | string } | undefined)?.c ?? 0);
  record('AR', 'Every demo customer has arOwnerUserId', missingAr === 0, `missing=${missingAr}`);

  const pass = results.every((r) => r.pass);
  return { pass, assertions: [...results] };
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function runCli(): Promise<void> {
  await initDb();
  const firmId = process.env.VERIFY_FIRM_ID ?? (await pickFirstFirm());
  const result = await verifyPersonasForFirm(firmId);
  // eslint-disable-next-line no-console
  if (result.pass) {
    // eslint-disable-next-line no-console
    console.log('[verify] ✅ all 4 personas validated');
    process.exit(0);
  } else {
    const failed = result.assertions.filter((a) => !a.pass);
    // eslint-disable-next-line no-console
    console.error(`[verify] ❌ ${failed.length} assertion(s) failed`);
    process.exit(1);
  }
}

const isDirectInvocation = (() => {
  try {
    const argv1 = process.argv[1] ?? '';
    return argv1.replace(/\\/g, '/').endsWith('scripts/verify-personas.ts');
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  runCli().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[verify] failed:', e);
    process.exit(1);
  });
}
