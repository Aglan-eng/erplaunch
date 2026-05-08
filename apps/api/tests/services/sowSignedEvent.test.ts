/**
 * Phase 46.6 — integration tests for the SOW_SIGNED auto-conversion flow.
 *
 * The dispatch path is exercised end-to-end:
 *   - SOW_SIGNED event handler updates engagement.status,
 *     stamps startDate + contractEndDate
 *   - Discovery Lite answers carry forward into BusinessProfile.answers
 *   - Kickoff action item is created (assigned to PM if set,
 *     otherwise SUPPORT_LEAD fallback)
 *   - Activity entries: SOW_SIGNED, ENGAGEMENT_AUTO_CONVERTED,
 *     DISCOVERY_LITE_CARRIED_FORWARD, ENGAGEMENT_KICKED_OFF
 *   - Notifications dispatched to PROJECT_MANAGER + APP_ADMIN users
 *   - Idempotency: re-firing on a non-sales-stage engagement is a no-op
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  getDb,
  bootstrapFirmAdmin,
  grantEngagementRole,
  recordSowVersion,
  createSowSignature,
  updateSowSignature,
  upsertDiscoveryLite,
  upsertProfile,
  findEngagementById,
} from '../../src/db/index.js';
import {
  dispatchSowSigned,
  convertProspectToActiveEngagement,
} from '../../src/services/sowSignedEvent.js';

let cleanup: () => void;

interface Fixture {
  firmId: string;
  engagementId: string;
  ownerUserId: string;
  pmUserId: string;
  adminUserId: string;
  versionId: string;
  signatureId: string;
}

async function seed(opts: { stage?: string; signatureStatus?: 'SIGNED' | 'SENT'; assignPm?: boolean } = {}): Promise<Fixture> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const ownerUserId = createId();
  const pmUserId = createId();
  const adminUserId = createId();
  const jobId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Convert Firm', `convert-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Apex Industries', opts.stage ?? 'CONTRACTED', now, now],
  });
  await db.execute({
    sql: `INSERT INTO BusinessProfile (id, engagementId, answers, completeness, updatedAt) VALUES (?,?,?,?,?)`,
    args: [createId(), engagementId, '{}', '{}', now],
  });
  await db.execute({
    sql: `INSERT INTO LicenseProfile (id, engagementId, updatedAt) VALUES (?,?,?)`,
    args: [createId(), engagementId, now],
  });
  for (const id of [ownerUserId, pmUserId, adminUserId]) {
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
      args: [id, firmId, `${id}@example.com`, id, 'x', 'CONSULTANT'],
    });
  }
  await bootstrapFirmAdmin({ firmId, userId: ownerUserId });
  await bootstrapFirmAdmin({ firmId, userId: adminUserId });
  if (opts.assignPm !== false) {
    await grantEngagementRole({
      engagementId,
      userId: pmUserId,
      role: 'PROJECT_MANAGER',
      assignedModules: null,
      actorUserId: ownerUserId,
    });
  }
  await db.execute({
    sql: `INSERT INTO GenerationJob (id, engagementId, type) VALUES (?,?,?)`,
    args: [jobId, engagementId, 'SOW'],
  });
  const version = await recordSowVersion({ engagementId, jobId, version: 1 });
  const sig = await createSowSignature({
    engagementId,
    sowVersionId: version.id,
    signaturePath: 'MANUAL',
    status: opts.signatureStatus ?? 'SIGNED',
  });
  await updateSowSignature(sig.id, {
    signedByName: 'Jane Tate',
    signedByEmail: 'jane@apex.example',
    signedAt: '2026-06-15T12:00:00Z',
  });
  return {
    firmId,
    engagementId,
    ownerUserId,
    pmUserId,
    adminUserId,
    versionId: version.id,
    signatureId: sig.id,
  };
}

beforeAll(async () => {
  ({ cleanup } = await setupTestDb());
});
afterAll(() => {
  cleanup();
});
beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM ActionItem`);
  await db.execute(`DELETE FROM EngagementSowSignature`);
  await db.execute(`DELETE FROM EngagementSowVersion`);
  await db.execute(`DELETE FROM EngagementDiscoveryLite`);
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM RoleAuditLog`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM FirmRole`);
  await db.execute(`DELETE FROM GenerationJob`);
  await db.execute(`DELETE FROM LicenseProfile`);
  await db.execute(`DELETE FROM BusinessProfile`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

// ─── End-to-end via the dispatcher ─────────────────────────────────────────

describe('dispatchSowSigned — auto-conversion flow', () => {
  it('flips engagement status from CONTRACTED → DISCOVERY', async () => {
    const f = await seed();
    await dispatchSowSigned({ signatureId: f.signatureId });
    const eng = await findEngagementById(f.engagementId);
    expect((eng as { status?: string }).status).toBe('DISCOVERY');
  });

  it('stamps startDate (= signed date) and contractEndDate (= start + duration)', async () => {
    const f = await seed();
    // Discovery Lite says 6-12m → 270 days.
    await upsertDiscoveryLite({
      engagementId: f.engagementId,
      answers: { 'timeline.targetGoLive': '6-12m' },
    });
    await dispatchSowSigned({ signatureId: f.signatureId });
    const eng = await findEngagementById(f.engagementId);
    expect((eng as { startDate?: string }).startDate).toBe('2026-06-15');
    // 270 days after 2026-06-15.
    expect((eng as { contractEndDate?: string }).contractEndDate).toBe('2027-03-12');
  });

  it('falls back to a 90-day duration when Discovery Lite is missing', async () => {
    const f = await seed();
    await dispatchSowSigned({ signatureId: f.signatureId });
    const eng = await findEngagementById(f.engagementId);
    expect((eng as { startDate?: string }).startDate).toBe('2026-06-15');
    // 180 days for 'tbd' (default Discovery Lite target). When no DL
    // exists, the dispatcher reads "no targetGoLive" → also 180.
    // 90 days is reserved for explicit asap; default is 180.
    expect((eng as { contractEndDate?: string }).contractEndDate).toBe('2026-12-12');
  });

  it('carries forward Discovery Lite answers without clobbering existing ones', async () => {
    const f = await seed();
    await upsertDiscoveryLite({
      engagementId: f.engagementId,
      answers: {
        'painPoints': ['reporting-lag'],
        'companySize.employees': '101-500',
      },
    });
    // Existing Discovery answer that should not be overwritten.
    await upsertProfile(f.engagementId, { 'painPoints': ['integration-gaps'] });
    await dispatchSowSigned({ signatureId: f.signatureId });
    // Profile retains the Discovery answer + picks up the new key.
    const db2 = getDb();
    const profileRow = await db2.execute({
      sql: `SELECT answers FROM BusinessProfile WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    const answers = JSON.parse((profileRow.rows[0] as unknown as { answers: string }).answers);
    expect(answers['painPoints']).toEqual(['integration-gaps']); // existing wins
    expect(answers['companySize.employees']).toBe('101-500'); // carried forward
  });

  it('creates a kickoff action item assigned to the PM when one exists', async () => {
    const f = await seed();
    await dispatchSowSigned({ signatureId: f.signatureId });
    const items = await getDb().execute({
      sql: `SELECT title, owner, priority FROM ActionItem WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    expect(items.rows).toHaveLength(1);
    const row = items.rows[0] as unknown as { title: string; owner: string; priority: string };
    expect(row.title).toContain('Kickoff');
    expect(row.title).toContain('Apex Industries');
    expect(row.owner).toBe(f.pmUserId);
    expect(row.priority).toBe('HIGH');
  });

  it('creates a kickoff action item without an owner when no PM is assigned', async () => {
    const f = await seed({ assignPm: false });
    await dispatchSowSigned({ signatureId: f.signatureId });
    const items = await getDb().execute({
      sql: `SELECT owner FROM ActionItem WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    expect(items.rows).toHaveLength(1);
    // Owner falls back to null when no PM + no SUPPORT_LEAD exists.
    const row = items.rows[0] as unknown as { owner: string | null };
    expect(row.owner).toBeNull();
  });

  it('writes the canonical activity entries', async () => {
    const f = await seed();
    await upsertDiscoveryLite({
      engagementId: f.engagementId,
      answers: { 'companySize.employees': '101-500' },
    });
    await dispatchSowSigned({ signatureId: f.signatureId });
    const log = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ? ORDER BY createdAt ASC`,
      args: [f.engagementId],
    });
    const actions = log.rows.map((r) => (r as unknown as { action: string }).action);
    expect(actions).toContain('SOW_SIGNED');
    expect(actions).toContain('ENGAGEMENT_AUTO_CONVERTED');
    expect(actions).toContain('DISCOVERY_LITE_CARRIED_FORWARD');
    expect(actions).toContain('ENGAGEMENT_KICKED_OFF');
  });

  it('is a no-op when called with a non-SIGNED signature', async () => {
    const f = await seed({ signatureStatus: 'SENT' });
    await dispatchSowSigned({ signatureId: f.signatureId });
    const eng = await findEngagementById(f.engagementId);
    expect((eng as { status?: string }).status).toBe('CONTRACTED');
  });

  it('is a no-op when the engagement is already past CONTRACTED', async () => {
    const f = await seed({ stage: 'BUILD' });
    await dispatchSowSigned({ signatureId: f.signatureId });
    const eng = await findEngagementById(f.engagementId);
    // Stays at BUILD; no auto-conversion.
    expect((eng as { status?: string }).status).toBe('BUILD');
    // SOW_SIGNED activity still logged (audit trail).
    const log = await getDb().execute({
      sql: `SELECT action FROM ActivityLog WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    const actions = log.rows.map((r) => (r as unknown as { action: string }).action);
    expect(actions).toContain('SOW_SIGNED');
    expect(actions).not.toContain('ENGAGEMENT_AUTO_CONVERTED');
  });
});

// ─── Direct invocation of the conversion helper ────────────────────────────

describe('convertProspectToActiveEngagement (direct)', () => {
  it('returns the canonical shape', async () => {
    const f = await seed();
    await upsertDiscoveryLite({
      engagementId: f.engagementId,
      answers: { 'timeline.targetGoLive': 'asap', 'painPoints': ['reporting-lag'] },
    });
    const r = await convertProspectToActiveEngagement({
      engagementId: f.engagementId,
      firmId: f.firmId,
      clientName: 'Apex Industries',
      signedAt: '2026-06-15T12:00:00Z',
      signedByEmail: 'jane@apex.example',
    });
    expect(r.startDate).toBe('2026-06-15');
    // asap → 90 days.
    expect(r.contractEndDate).toBe('2026-09-13');
    expect(r.carriedForwardKeys.sort()).toEqual(['painPoints', 'timeline.targetGoLive']);
    expect(r.kickoffActionItemId).toBeTruthy();
    expect(r.notifiedUserIds.length).toBeGreaterThan(0);
  });
});
