import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import { wizardAnswerAcceptor } from '../../src/services/wizardAnswerAcceptor.js';
import { getProfile, upsertProfile, getDb } from '../../src/db/index.js';
import type { PendingSubmission } from '../../src/db/pendingSubmission.js';

let cleanup: () => void;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
});

async function seedClientMember(engagementId: string): Promise<string> {
  const db = getDb();
  const id = createId();
  await db.execute({
    sql: `INSERT INTO ProjectMember (id, engagementId, name, role, team, email, createdAt)
          VALUES (?,?,?,?,?,?,?)`,
    args: [id, engagementId, 'Client', 'Stakeholder', 'CLIENT', `${id}@example.com`, new Date().toISOString()],
  });
  return id;
}

function makeSubmission(overrides: Partial<PendingSubmission> = {}): PendingSubmission {
  return {
    id: 'sub-test',
    engagementId: 'eng-test',
    memberId: 'mem-test',
    targetType: 'WIZARD_ANSWER',
    targetId: null,
    payload: { questionId: 'r2r.entities.multiEntity', answer: true },
    status: 'PENDING',
    reviewerId: null,
    reviewedAt: null,
    reviewComment: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('wizardAnswerAcceptor', () => {
  it('creates BusinessProfile and writes the answer when no profile exists', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'NoProfileFirm' });
    const memberId = await seedClientMember(engagementId);

    const sub = makeSubmission({
      engagementId,
      memberId,
      payload: { questionId: 'r2r.entities.multiEntity', answer: true },
    });

    await wizardAnswerAcceptor.accept(sub, {
      engagementId,
      reviewerId: 'rev-1',
      firmId: 'firm-1',
    });

    const profile = await getProfile(engagementId);
    expect(profile).not.toBeNull();
    expect((profile?.answers as Record<string, unknown>)['r2r.entities.multiEntity']).toBe(true);
  });

  it('merges into existing answers without dropping other keys', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'MergeFirm' });
    const memberId = await seedClientMember(engagementId);

    await upsertProfile(engagementId, {
      'r2r.tax.gstEnabled': true,
      'p2p.purchasing.usePurchaseOrders': true,
    });

    await wizardAnswerAcceptor.accept(
      makeSubmission({
        engagementId,
        memberId,
        payload: { questionId: 'o2c.customers.creditLimits', answer: false },
      }),
      { engagementId, reviewerId: 'rev', firmId: 'firm' },
    );

    const profile = await getProfile(engagementId);
    const answers = profile?.answers as Record<string, unknown>;
    expect(answers['r2r.tax.gstEnabled']).toBe(true);
    expect(answers['p2p.purchasing.usePurchaseOrders']).toBe(true);
    expect(answers['o2c.customers.creditLimits']).toBe(false);
  });

  it('overwrites the same questionId on a follow-up accept (last-write-wins)', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'OverwriteFirm' });
    const memberId = await seedClientMember(engagementId);

    await wizardAnswerAcceptor.accept(
      makeSubmission({
        engagementId,
        memberId,
        payload: { questionId: 'q.x', answer: 'first' },
      }),
      { engagementId, reviewerId: 'rev', firmId: 'firm' },
    );
    await wizardAnswerAcceptor.accept(
      makeSubmission({
        engagementId,
        memberId,
        payload: { questionId: 'q.x', answer: 'second' },
      }),
      { engagementId, reviewerId: 'rev', firmId: 'firm' },
    );

    const profile = await getProfile(engagementId);
    expect((profile?.answers as Record<string, unknown>)['q.x']).toBe('second');
  });

  it('is idempotent — re-accepting the same submission produces identical state', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'IdempotentFirm' });
    const memberId = await seedClientMember(engagementId);

    const sub = makeSubmission({
      engagementId,
      memberId,
      payload: { questionId: 'q.idempotent', answer: 42 },
    });

    await wizardAnswerAcceptor.accept(sub, { engagementId, reviewerId: 'r', firmId: 'f' });
    const after1 = (await getProfile(engagementId))?.answers as Record<string, unknown>;
    await wizardAnswerAcceptor.accept(sub, { engagementId, reviewerId: 'r', firmId: 'f' });
    const after2 = (await getProfile(engagementId))?.answers as Record<string, unknown>;

    expect(after1).toEqual(after2);
    expect(after2['q.idempotent']).toBe(42);
  });

  it('preserves complex answer shapes (arrays, nested objects)', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'ComplexFirm' });
    const memberId = await seedClientMember(engagementId);

    const complexAnswer = {
      tiers: [
        { min: 0, max: 5000, approver: 'manager' },
        { min: 5000, max: 50000, approver: 'cfo' },
      ],
      currency: 'USD',
    };

    await wizardAnswerAcceptor.accept(
      makeSubmission({
        engagementId,
        memberId,
        payload: { questionId: 'p2p.purchasing.poApprovalTiers', answer: complexAnswer },
      }),
      { engagementId, reviewerId: 'rev', firmId: 'firm' },
    );

    const profile = await getProfile(engagementId);
    expect((profile?.answers as Record<string, unknown>)['p2p.purchasing.poApprovalTiers']).toEqual(complexAnswer);
  });

  it('throws on missing questionId', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'BadPayloadFirm' });
    const memberId = await seedClientMember(engagementId);

    await expect(
      wizardAnswerAcceptor.accept(
        makeSubmission({
          engagementId,
          memberId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payload: { answer: 'orphan' } as any,
        }),
        { engagementId, reviewerId: 'r', firmId: 'f' },
      ),
    ).rejects.toThrow(/questionId/i);
  });

  it('throws on non-string questionId', async () => {
    const { engagementId } = await seedEngagementWithToken({ firmName: 'NonStringFirm' });
    const memberId = await seedClientMember(engagementId);

    await expect(
      wizardAnswerAcceptor.accept(
        makeSubmission({
          engagementId,
          memberId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payload: { questionId: 123, answer: 'x' } as any,
        }),
        { engagementId, reviewerId: 'r', firmId: 'f' },
      ),
    ).rejects.toThrow();
  });
});
