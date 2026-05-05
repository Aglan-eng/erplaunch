import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import {
  createPendingSubmission,
  findPendingSubmissionById,
  findPendingSubmissionsByEngagement,
  acceptPendingSubmission,
  rejectPendingSubmission,
} from '../../src/db/pendingSubmission.js';
import { getDb } from '../../src/db/index.js';

let cleanup: () => void;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
});

async function seedMember(engagementId: string, name = 'Client User'): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [id, engagementId, name, 'Stakeholder', 'CLIENT', `${id}@example.com`, new Date().toISOString()],
  });
  return id;
}

describe('pendingSubmission: createPendingSubmission', () => {
  it('inserts a row with PENDING status and the provided fields', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);

    const sub = await createPendingSubmission({
      engagementId,
      memberId,
      targetType: 'TEST',
      targetId: null,
      payload: { hello: 'world' },
    });

    expect(sub.id).toBeTruthy();
    expect(sub.engagementId).toBe(engagementId);
    expect(sub.memberId).toBe(memberId);
    expect(sub.targetType).toBe('TEST');
    expect(sub.targetId).toBeNull();
    expect(sub.payload).toEqual({ hello: 'world' });
    expect(sub.status).toBe('PENDING');
    expect(sub.reviewerId).toBeNull();
    expect(sub.reviewedAt).toBeNull();
    expect(sub.reviewComment).toBeNull();
    expect(sub.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('preserves a non-null targetId', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);

    const sub = await createPendingSubmission({
      engagementId,
      memberId,
      targetType: 'TEST',
      targetId: 'target-abc',
      payload: {},
    });

    expect(sub.targetId).toBe('target-abc');
  });

  it('round-trips a complex payload through JSON serialization', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);

    const payload = {
      questionId: 'r2r.entities.multiEntity',
      answer: true,
      meta: { source: 'wizard', nested: { foo: ['a', 'b'] } },
    };
    const sub = await createPendingSubmission({
      engagementId,
      memberId,
      targetType: 'TEST',
      payload,
    });
    expect(sub.payload).toEqual(payload);

    const fetched = await findPendingSubmissionById(sub.id);
    expect(fetched?.payload).toEqual(payload);
  });
});

describe('pendingSubmission: findPendingSubmissionById', () => {
  it('returns null for unknown id', async () => {
    const found = await findPendingSubmissionById('does-not-exist');
    expect(found).toBeNull();
  });

  it('returns the row for a known id', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);
    const created = await createPendingSubmission({
      engagementId,
      memberId,
      targetType: 'TEST',
      payload: { x: 1 },
    });
    const found = await findPendingSubmissionById(created.id);
    expect(found?.id).toBe(created.id);
  });

  it('survives a corrupt JSON payload (returns empty object instead of throwing)', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);
    const db = getDb();

    const id = createId();
    await db.execute({
      sql: `INSERT INTO PendingSubmission
              (id, engagementId, memberId, targetType, payload, status, createdAt)
              VALUES (?,?,?,?,?,?,?)`,
      args: [id, engagementId, memberId, 'TEST', '{not valid json', 'PENDING', new Date().toISOString()],
    });
    const found = await findPendingSubmissionById(id);
    expect(found?.payload).toEqual({});
  });
});

describe('pendingSubmission: findPendingSubmissionsByEngagement', () => {
  it('defaults to PENDING-only', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);

    const a = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });
    const b = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });
    await acceptPendingSubmission(a.id, 'reviewer-1', null);
    void b;

    const pending = await findPendingSubmissionsByEngagement(engagementId);
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('PENDING');
  });

  it('returns ALL when status=ALL', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);

    await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: { i: 1 } });
    const b = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: { i: 2 } });
    await rejectPendingSubmission(b.id, 'reviewer-1', 'no thanks');

    const all = await findPendingSubmissionsByEngagement(engagementId, { status: 'ALL' });
    expect(all.length).toBe(2);
    expect(all.map((s) => s.status).sort()).toEqual(['PENDING', 'REJECTED']);
  });

  it('filters to a specific terminal status', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);

    const a = await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: {} });
    await acceptPendingSubmission(a.id, 'reviewer-1', null);

    const accepted = await findPendingSubmissionsByEngagement(engagementId, { status: 'ACCEPTED' });
    expect(accepted.length).toBe(1);
    expect(accepted[0].status).toBe('ACCEPTED');

    const rejected = await findPendingSubmissionsByEngagement(engagementId, { status: 'REJECTED' });
    expect(rejected.length).toBe(0);
  });

  it('does not leak rows across engagements', async () => {
    const { engagementId: engA } = await seedEngagementWithToken();
    const { engagementId: engB } = await seedEngagementWithToken();
    const memberA = await seedMember(engA);
    const memberB = await seedMember(engB);

    await createPendingSubmission({ engagementId: engA, memberId: memberA, targetType: 'TEST', payload: { who: 'A' } });
    await createPendingSubmission({ engagementId: engB, memberId: memberB, targetType: 'TEST', payload: { who: 'B' } });

    const aOnly = await findPendingSubmissionsByEngagement(engA);
    expect(aOnly.length).toBe(1);
    expect(aOnly[0].payload).toEqual({ who: 'A' });
  });

  it('orders results by createdAt DESC (newest first)', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);

    await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: { i: 1 } });
    await new Promise((r) => setTimeout(r, 15));
    await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: { i: 2 } });
    await new Promise((r) => setTimeout(r, 15));
    await createPendingSubmission({ engagementId, memberId, targetType: 'TEST', payload: { i: 3 } });

    const list = await findPendingSubmissionsByEngagement(engagementId);
    expect(list.map((s) => s.payload.i)).toEqual([3, 2, 1]);
  });
});

describe('pendingSubmission: acceptPendingSubmission', () => {
  it('flips status PENDING → ACCEPTED with reviewerId / reviewedAt / comment', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);
    const created = await createPendingSubmission({
      engagementId,
      memberId,
      targetType: 'TEST',
      payload: {},
    });

    const updated = await acceptPendingSubmission(created.id, 'reviewer-x', 'looks good');
    expect(updated?.status).toBe('ACCEPTED');
    expect(updated?.reviewerId).toBe('reviewer-x');
    expect(updated?.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(updated?.reviewComment).toBe('looks good');
  });

  it('returns null on a non-existent id', async () => {
    const updated = await acceptPendingSubmission('no-such-id', 'reviewer-x', null);
    expect(updated).toBeNull();
  });

  it('is idempotent — second accept on an ACCEPTED row returns null', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);
    const created = await createPendingSubmission({
      engagementId,
      memberId,
      targetType: 'TEST',
      payload: {},
    });
    const first = await acceptPendingSubmission(created.id, 'reviewer-1', null);
    expect(first?.status).toBe('ACCEPTED');

    const second = await acceptPendingSubmission(created.id, 'reviewer-2', null);
    expect(second).toBeNull();
  });

  it('cannot transition REJECTED → ACCEPTED (terminal-state guard)', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);
    const created = await createPendingSubmission({
      engagementId,
      memberId,
      targetType: 'TEST',
      payload: {},
    });
    await rejectPendingSubmission(created.id, 'reviewer-1', null);

    const accepted = await acceptPendingSubmission(created.id, 'reviewer-2', null);
    expect(accepted).toBeNull();
  });
});

describe('pendingSubmission: rejectPendingSubmission', () => {
  it('flips status PENDING → REJECTED with the comment', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);
    const created = await createPendingSubmission({
      engagementId,
      memberId,
      targetType: 'TEST',
      payload: {},
    });

    const updated = await rejectPendingSubmission(created.id, 'reviewer-y', 'wrong period');
    expect(updated?.status).toBe('REJECTED');
    expect(updated?.reviewerId).toBe('reviewer-y');
    expect(updated?.reviewComment).toBe('wrong period');
  });

  it('returns null on second reject (terminal-state guard)', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);
    const created = await createPendingSubmission({
      engagementId,
      memberId,
      targetType: 'TEST',
      payload: {},
    });
    await rejectPendingSubmission(created.id, 'reviewer-1', null);

    const second = await rejectPendingSubmission(created.id, 'reviewer-2', null);
    expect(second).toBeNull();
  });

  it('cannot transition ACCEPTED → REJECTED (terminal-state guard)', async () => {
    const { engagementId } = await seedEngagementWithToken();
    const memberId = await seedMember(engagementId);
    const created = await createPendingSubmission({
      engagementId,
      memberId,
      targetType: 'TEST',
      payload: {},
    });
    await acceptPendingSubmission(created.id, 'reviewer-1', null);

    const rejected = await rejectPendingSubmission(created.id, 'reviewer-2', null);
    expect(rejected).toBeNull();
  });
});
