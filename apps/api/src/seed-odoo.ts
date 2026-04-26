/**
 * Demo Odoo engagement seed (Phase 11)
 *
 * Creates a self-contained Odoo engagement so a consultant can click through
 * the adaptor-driven wizard end-to-end without standing everything up by hand.
 *
 *   Run:  npx tsx src/seed-odoo.ts   (from apps/api)
 *
 * Idempotent — re-running replaces the existing "demo-odoo" firm's Odoo
 * engagement so you can script repeatable demos. Exits cleanly (non-zero)
 * if prerequisites aren't met.
 */
import { createId } from '@paralleldrive/cuid2';
import bcrypt from 'bcryptjs';
import {
  initDb, getDb,
  findFirmBySlug, createFirm,
  findUserByEmail, createUser,
  createEngagement, updateEngagement,
  upsertLicense, replacePhases,
  addMember,
  upsertSectionComment,
  createRisk, createIssue, createDecision,
  logActivity,
  upsertPortalToken,
} from './db/index.js';

const FIRM_SLUG = 'demo-odoo';
const FIRM_NAME = 'ERPLaunch Demo (Odoo)';
const USER_EMAIL = 'demo-odoo@erplaunch.app';
const USER_NAME = 'Demo Consultant';
const USER_PASSWORD = 'demo-odoo-password'; // dev-only; rotate for real demos
const CLIENT_NAME = 'Sahel Logistics Ltd.';

async function wipeOdooEngagementsForFirm(db: ReturnType<typeof getDb>, firmId: string): Promise<number> {
  // Remove any prior demo Odoo engagements so reruns stay clean. Non-Odoo
  // engagements on the same firm stay untouched.
  const existing = await db.execute({
    sql: `SELECT id FROM Engagement WHERE firmId = ? AND adaptorId = 'odoo'`,
    args: [firmId],
  });
  const ids = (existing.rows as Array<Record<string, unknown>>).map((r) => r.id as string);
  if (ids.length === 0) return 0;

  for (const id of ids) {
    // Mirror the order from reseed.ts so FK-cascaded children go first.
    for (const table of [
      'ConflictLog', 'SectionComment', 'SectionImage', 'AIAdvice', 'RiskItem',
      'IssueItem', 'DecisionItem', 'MeetingNote', 'MigrationItem', 'ActivityLog',
      'ProjectMember', 'GenerationJob', 'ClientPortalToken',
      'DataCollectionItem', 'DataTemplateSchema', 'Phase',
      'BusinessProfile', 'LicenseProfile',
    ]) {
      await db.execute({ sql: `DELETE FROM ${table} WHERE engagementId = ?`, args: [id] });
    }
    await db.execute({ sql: `DELETE FROM Engagement WHERE id = ?`, args: [id] });
  }
  return ids.length;
}

async function main(): Promise<void> {
  await initDb();
  const db = getDb();

  // ── Firm ────────────────────────────────────────────────────────────────
  let firm = await findFirmBySlug(FIRM_SLUG);
  if (!firm) {
    firm = await createFirm({ name: FIRM_NAME, slug: FIRM_SLUG, plan: 'STARTER' });
    if (!firm) throw new Error('failed to create demo firm');
    console.log(`[seed-odoo] created firm "${FIRM_NAME}" (${FIRM_SLUG})`);
  } else {
    console.log(`[seed-odoo] reusing firm "${FIRM_NAME}" (${FIRM_SLUG})`);
  }
  const firmId = firm.id;

  // ── Admin user ──────────────────────────────────────────────────────────
  let user = await findUserByEmail(USER_EMAIL);
  if (!user) {
    const passwordHash = await bcrypt.hash(USER_PASSWORD, 10);
    user = await createUser({ firmId, email: USER_EMAIL, name: USER_NAME, passwordHash, role: 'CONSULTANT' });
    if (!user) throw new Error('failed to create demo user');
    console.log(`[seed-odoo] created user ${USER_EMAIL}`);
  } else if (user.firmId !== firmId) {
    throw new Error(`user ${USER_EMAIL} already exists but belongs to a different firm — pick another USER_EMAIL`);
  } else {
    console.log(`[seed-odoo] reusing user ${USER_EMAIL}`);
  }

  // ── Wipe prior Odoo engagements on this firm ────────────────────────────
  const removed = await wipeOdooEngagementsForFirm(db, firmId);
  if (removed > 0) console.log(`[seed-odoo] removed ${removed} prior Odoo engagement(s)`);

  // ── Engagement ──────────────────────────────────────────────────────────
  const eng = await createEngagement({ firmId, clientName: CLIENT_NAME, adaptorId: 'odoo' });
  if (!eng) throw new Error('failed to create engagement');
  const engId = eng.id as string;
  await updateEngagement(engId, {
    status: 'SCOPING',
    startDate: '2026-05-01',
    contractEndDate: '2026-12-31',
  });
  console.log(`[seed-odoo] created engagement ${engId} for ${CLIENT_NAME} (adaptorId=odoo)`);

  // ── License (Odoo-shaped, not NetSuite) ─────────────────────────────────
  await upsertLicense(engId, {
    edition: 'ENTERPRISE',
    modules: [
      'BASE_ACCOUNTING', 'BASE_SALES', 'BASE_PURCHASE', 'BASE_INVENTORY',
      'ENTERPRISE_ACCOUNTING', 'ENTERPRISE_STUDIO', 'ENTERPRISE_DOCUMENTS',
      'MRP', 'QUALITY', 'CRM', 'PROJECT', 'TIMESHEETS',
    ],
  });

  // ── Answers — Odoo-namespaced ───────────────────────────────────────────
  const answers: Record<string, unknown> = {
    'odoo.company.multiCompany': true,
    'odoo.company.currency': 'AED',
    'odoo.company.fiscalYearStart': '01-01',
    'odoo.coa.template': 'LOCALIZATION',
    'odoo.coa.analyticAccounting': true,
    'odoo.purchase.approvalTiers': 'DOUBLE',
    'odoo.purchase.threeWayMatch': true,
    'odoo.sales.quoteTemplate': true,
    'odoo.sales.priceListStrategy': 'CUSTOMER_TIER',
    'odoo.invoicing.policy': 'DELIVERED',
    'odoo.mrp.enabled': true,
    'odoo.mrp.workCenters': true,
    'odoo.mrp.quality': true,
    'odoo.returns.policy': 'AUTO_REFUND',
  };
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE BusinessProfile SET answers = ?, updatedAt = ? WHERE engagementId = ?`,
    args: [JSON.stringify(answers), now, engId],
  });

  // ── Phases — Odoo's 6-phase default ─────────────────────────────────────
  await replacePhases(engId, [
    { name: 'Discovery',       order: 1, flows: ['R2R'],            trigger: 'REQUIREMENT', status: 'COMPLETED',   targetDate: '2026-05-15' },
    { name: 'Configuration',   order: 2, flows: ['R2R', 'P2P'],     trigger: 'REQUIREMENT', status: 'IN_PROGRESS', targetDate: '2026-07-15' },
    { name: 'Data Migration',  order: 3, flows: ['R2R', 'P2P', 'O2C'], trigger: 'REQUIREMENT', status: 'PLANNED',  targetDate: '2026-08-31' },
    { name: 'Training',        order: 4, flows: ['O2C', 'MFG'],     trigger: 'REQUIREMENT', status: 'PLANNED',     targetDate: '2026-10-15' },
    { name: 'UAT',             order: 5, flows: ['R2R', 'P2P', 'O2C', 'MFG'], trigger: 'REQUIREMENT', status: 'PLANNED', targetDate: '2026-11-30' },
    { name: 'Go Live',         order: 6, flows: ['R2R', 'P2P', 'O2C', 'MFG', 'RTN'], trigger: 'REQUIREMENT', status: 'PLANNED', targetDate: '2026-12-15' },
  ] as Array<{ name: string; order: number; flows: string[]; trigger: string; status: string; targetDate: string }>);

  // ── Members ─────────────────────────────────────────────────────────────
  await addMember(engId, { name: 'Rania Khoury',  role: 'CFO',                team: 'CLIENT',     email: 'r.khoury@sahel.example' });
  await addMember(engId, { name: 'Omar Nasser',   role: 'IT Director',         team: 'CLIENT',     email: 'o.nasser@sahel.example' });
  await addMember(engId, { name: 'Hadi Farah',    role: 'Warehouse Manager',   team: 'CLIENT',     email: 'h.farah@sahel.example' });
  await addMember(engId, { name: 'Mira Abbas',    role: 'Odoo Functional Lead', team: 'CONSULTANT', email: 'm.abbas@erplaunch.app' });
  await addMember(engId, { name: 'Sam Tawil',     role: 'Odoo Technical Lead',  team: 'CONSULTANT', email: 's.tawil@erplaunch.app' });

  // ── Section comments ────────────────────────────────────────────────────
  await upsertSectionComment(engId, 'license',
    'Enterprise edition confirmed; Studio + Documents required for approval matrix + contract storage. MRP + Quality modules for the two production lines. Helpdesk deferred to a later phase.');
  await upsertSectionComment(engId, 'r2r.company',
    'Two legal entities: Sahel Logistics Holding (parent) and Sahel Freight Forwarding (sub). Multi-company enabled to share partners and pricelists. Fiscal year Jan–Dec for both.');
  await upsertSectionComment(engId, 'o2c.sales',
    'Pricelist tiers: Wholesale, Retail, Contract. Customers tagged at onboarding. Automated renewal reminders for contract-tier customers go via Studio flow.');

  // ── Risks / issues / decisions — short set, enough to demo the UI ───────
  await createRisk(engId, {
    title: 'Studio customizations at Go Live',
    description: 'Large Studio form changes on Sales Order would slow Enterprise upgrades mid-year.',
    probability: 'MEDIUM', impact: 'HIGH', owner: 'Mira Abbas',
    mitigation: 'Cap Studio changes to minor field adds until stabilization; review upgrade compatibility monthly.',
  });
  await createRisk(engId, {
    title: 'Localization CoA gaps for UAE VAT',
    description: 'Default localization CoA is missing two expense accounts for cross-emirate reverse charge.',
    probability: 'MEDIUM', impact: 'MEDIUM', owner: 'Rania Khoury',
    mitigation: 'Add accounts manually during configuration; verify with external auditor before Go Live.',
  });

  await createIssue(engId, {
    title: 'Warehouse barcode printers not yet procured',
    description: 'Picking + receipt flow depends on Zebra printers at both docks.',
    priority: 'HIGH', owner: 'Hadi Farah',
  });

  await createDecision(engId, {
    title: 'Invoicing policy: Delivered quantities (not Ordered)',
    description: 'Client occasionally partials shipments; invoicing on delivered avoids credit-note churn.',
    decidedBy: 'Rania Khoury, Mira Abbas', decidedAt: '2026-05-12',
    rationale: 'With >10% of orders shipped across multiple waves, invoice-on-ordered produces frequent credit notes. Invoice-on-delivered keeps AR aligned with what customers actually received.',
  });

  // ── Portal token + activity breadcrumb ──────────────────────────────────
  const portalToken = await upsertPortalToken(engId);
  await logActivity(engId, firmId, 'ENGAGEMENT_CREATED', 'Seeded via seed-odoo.ts (Odoo adaptor demo)');
  await logActivity(engId, firmId, 'LICENSE_UPDATED', 'ENTERPRISE + 12 modules including MRP + Quality');
  await logActivity(engId, firmId, 'PROFILE_UPDATED', '14 Odoo-namespaced answers loaded');
  await logActivity(engId, firmId, 'PHASE_UPDATED', '6 phases — Discovery through Go Live');

  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  console.log('\n✅  Odoo demo seed complete!');
  console.log(`    Client:     ${CLIENT_NAME}`);
  console.log(`    Adaptor:    odoo (ENTERPRISE edition, 12 modules)`);
  console.log(`    Engagement: ${engId}`);
  console.log(`    Login:      ${USER_EMAIL} / ${USER_PASSWORD}`);
  console.log(`    Dashboard:  ${appUrl}/dashboard`);
  console.log(`    Portal:     ${appUrl}/portal/${portalToken}`);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[seed-odoo] failed:', msg);
  process.exit(1);
});
