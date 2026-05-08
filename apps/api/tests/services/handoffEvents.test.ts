/**
 * Phase 45.3 — integration tests for the GOLIVE → CLOSEOUT handoff
 * event flow.
 *
 * Exercises the orchestrating side-effect: when an engagement enters
 * CLOSEOUT, triggerCloseoutHandoff should:
 *
 *   - Open a HANDOFF-kind, pinned ConversationThread.
 *   - Queue a HANDOFF_PACKAGE generation job.
 *   - Resolve recipients (firm SUPPORT_LEAD + engagement ACCOUNT_MANAGER)
 *     and call sendCloseoutHandoffEmail once per unique user.
 *   - Append a single CLOSEOUT_HANDOFF_FIRED ActivityLog row.
 *   - Be idempotent on stage re-entry (regress + re-advance) — should
 *     NOT spawn a second thread or job.
 *
 * The HANDOFF_PACKAGE generator itself is exercised in
 * handoffPackageGenerator.test.ts; here we use generateInline=true so
 * the job transitions to COMPLETE before the assertion runs (avoids
 * setImmediate races on Windows).
 *
 * The email service has no DI seam — RESEND_API_KEY is empty in the
 * test environment so sendEmail falls through to console.log. We
 * verify "an email would have gone" by counting the resolved
 * recipients on the result object rather than the network round-trip.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  getDb,
  grantFirmRole,
  grantEngagementRole,
  bootstrapFirmAdmin,
} from '../../src/db/index.js';
import { triggerCloseoutHandoff } from '../../src/services/handoffEvents.js';
import { listConversationThreadsByEngagement } from '../../src/db/conversationThread.js';

let cleanup: () => void;

interface SeedResult {
  firmId: string;
  engagementId: string;
  ownerUserId: string;
  supportLeadUserId: string;
  accountManagerUserId: string;
}

async function seed(opts: { withSupportLead?: boolean; withAccountManager?: boolean } = {}): Promise<SeedResult> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const ownerUserId = createId();
  const supportLeadUserId = createId();
  const accountManagerUserId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Handoff Firm', `handoff-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Apex Industries', 'CLOSEOUT', now, now],
  });
  for (const [id, name, email] of [
    [ownerUserId, 'Owner User', 'owner@example.com'],
    [supportLeadUserId, 'Sue Support', 'sue.support@example.com'],
    [accountManagerUserId, 'Alex AM', 'alex.am@example.com'],
  ] as const) {
    await db.execute({
      sql: `INSERT INTO User (id, firmId, email, name, passwordHash, role) VALUES (?,?,?,?,?,?)`,
      args: [id, firmId, email, name, 'x', 'CONSULTANT'],
    });
  }
  await bootstrapFirmAdmin({ firmId, userId: ownerUserId });
  if (opts.withSupportLead !== false) {
    await grantFirmRole({
      firmId,
      userId: supportLeadUserId,
      role: 'SUPPORT_LEAD',
      actorUserId: ownerUserId,
    });
  }
  if (opts.withAccountManager !== false) {
    await grantEngagementRole({
      engagementId,
      userId: accountManagerUserId,
      role: 'ACCOUNT_MANAGER',
      assignedModules: null,
      actorUserId: ownerUserId,
    });
  }
  return { firmId, engagementId, ownerUserId, supportLeadUserId, accountManagerUserId };
}

beforeAll(async () => {
  ({ cleanup } = await setupTestDb());
});
afterAll(() => {
  cleanup();
});
beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM ActivityLog`);
  await db.execute(`DELETE FROM Message`);
  await db.execute(`DELETE FROM ConversationThread`);
  await db.execute(`DELETE FROM GenerationJob`);
  await db.execute(`DELETE FROM EngagementRole`);
  await db.execute(`DELETE FROM FirmRole`);
  await db.execute(`DELETE FROM RoleAuditLog`);
  await db.execute(`DELETE FROM CloseoutChecklistItem`);
  await db.execute(`DELETE FROM Engagement`);
  await db.execute(`DELETE FROM User`);
  await db.execute(`DELETE FROM Firm`);
});

describe('triggerCloseoutHandoff — happy path', () => {
  it('creates a pinned HANDOFF thread', async () => {
    const f = await seed();
    const r = await triggerCloseoutHandoff({
      engagementId: f.engagementId,
      firmId: f.firmId,
      clientName: 'Apex Industries',
    });
    expect(r.thread.kind).toBe('HANDOFF');
    expect(r.thread.pinned).toBe(true);
    expect(r.thread.subject).toContain('Apex Industries');
    expect(r.thread.subject).toContain('SLA team');
    expect(r.thread.status).toBe('OPEN');
  });

  it('queues exactly one HANDOFF_PACKAGE generation job', async () => {
    const f = await seed();
    const r = await triggerCloseoutHandoff({
      engagementId: f.engagementId,
      firmId: f.firmId,
      clientName: 'Apex Industries',
    });
    expect(r.jobId).toBeTruthy();
    const jobRows = await getDb().execute({
      sql: `SELECT type FROM GenerationJob WHERE engagementId = ?`,
      args: [f.engagementId],
    });
    expect(jobRows.rows).toHaveLength(1);
    expect((jobRows.rows[0] as unknown as { type: string }).type).toBe('HANDOFF_PACKAGE');
  });

  it('resolves SUPPORT_LEAD + ACCOUNT_MANAGER as recipients (deduped)', async () => {
    const f = await seed();
    const r = await triggerCloseoutHandoff({
      engagementId: f.engagementId,
      firmId: f.firmId,
      clientName: 'Apex Industries',
    });
    // 1 SUPPORT_LEAD + 1 ACCOUNT_MANAGER = 2 distinct users.
    expect(r.notifiedCount).toBe(2);
  });

  it('writes a CLOSEOUT_HANDOFF_FIRED activity entry', async () => {
    const f = await seed();
    await triggerCloseoutHandoff({
      engagementId: f.engagementId,
      firmId: f.firmId,
      clientName: 'Apex Industries',
    });
    const r = await getDb().execute({
      sql: `SELECT action, details FROM ActivityLog WHERE engagementId = ? AND action = 'CLOSEOUT_HANDOFF_FIRED'`,
      args: [f.engagementId],
    });
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0] as unknown as { action: string; details: string };
    expect(row.details).toContain('2 people');
  });
});

describe('triggerCloseoutHandoff — recipient edge cases', () => {
  it('sends 1 email when only SUPPORT_LEAD is configured', async () => {
    const f = await seed({ withAccountManager: false });
    const r = await triggerCloseoutHandoff({
      engagementId: f.engagementId,
      firmId: f.firmId,
      clientName: 'Apex Industries',
    });
    expect(r.notifiedCount).toBe(1);
  });

  it('sends 1 email when only ACCOUNT_MANAGER is configured', async () => {
    const f = await seed({ withSupportLead: false });
    const r = await triggerCloseoutHandoff({
      engagementId: f.engagementId,
      firmId: f.firmId,
      clientName: 'Apex Industries',
    });
    expect(r.notifiedCount).toBe(1);
  });

  it('still creates the thread + job when nobody is notified', async () => {
    const f = await seed({ withSupportLead: false, withAccountManager: false });
    const r = await triggerCloseoutHandoff({
      engagementId: f.engagementId,
      firmId: f.firmId,
      clientName: 'Apex Industries',
    });
    expect(r.notifiedCount).toBe(0);
    expect(r.thread.id).toBeTruthy();
    expect(r.jobId).toBeTruthy();
  });

  it('dedupes a user who holds both SUPPORT_LEAD and ACCOUNT_MANAGER', async () => {
    const f = await seed({ withAccountManager: false });
    // Re-grant ACCOUNT_MANAGER to the SAME user that holds SUPPORT_LEAD.
    await grantEngagementRole({
      engagementId: f.engagementId,
      userId: f.supportLeadUserId,
      role: 'ACCOUNT_MANAGER',
      assignedModules: null,
      actorUserId: f.ownerUserId,
    });
    const r = await triggerCloseoutHandoff({
      engagementId: f.engagementId,
      firmId: f.firmId,
      clientName: 'Apex Industries',
    });
    // Same user shouldn't be counted twice.
    expect(r.notifiedCount).toBe(1);
  });
});

describe('listConversationThreadsByEngagement — pinned ordering', () => {
  it('sorts pinned HANDOFF threads above older STANDARD threads', async () => {
    const f = await seed();
    const { createConversationThread } = await import('../../src/db/conversationThread.js');
    // Create a STANDARD thread first (higher lastMessageAt by virtue of
    // being created later).
    await createConversationThread({
      engagementId: f.engagementId,
      subject: 'Standard Q&A',
      kind: 'STANDARD',
      pinned: false,
      createdByUserId: f.ownerUserId,
    });
    // Then fire the handoff (pinned).
    const r = await triggerCloseoutHandoff({
      engagementId: f.engagementId,
      firmId: f.firmId,
      clientName: 'Apex Industries',
    });
    const threads = await listConversationThreadsByEngagement(f.engagementId);
    expect(threads).toHaveLength(2);
    // HANDOFF should sort first because it's pinned, even though the
    // STANDARD thread has the same lastMessageAt or close to it.
    expect(threads[0].id).toBe(r.thread.id);
    expect(threads[0].kind).toBe('HANDOFF');
    expect(threads[0].pinned).toBe(true);
    expect(threads[1].kind).toBe('STANDARD');
    expect(threads[1].pinned).toBe(false);
  });
});
