import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  registerAcceptor,
  getAcceptor,
  __resetTestAcceptorInvocations,
  __getTestAcceptorInvocations,
  type PendingSubmissionAcceptor,
  type AcceptorContext,
} from '../../src/services/pendingSubmissionAcceptors.js';
import {
  registerSubmissionPayloadSchema,
  getSubmissionPayloadSchema,
} from '../../src/services/pendingSubmissionPayloadSchemas.js';
import { z } from 'zod';
import type { PendingSubmission } from '../../src/db/pendingSubmission.js';

afterEach(() => {
  __resetTestAcceptorInvocations();
});

function makeSubmission(overrides: Partial<PendingSubmission> = {}): PendingSubmission {
  return {
    id: overrides.id ?? 'sub-test',
    engagementId: overrides.engagementId ?? 'eng-test',
    memberId: overrides.memberId ?? 'mem-test',
    targetType: overrides.targetType ?? 'TEST',
    targetId: overrides.targetId ?? null,
    payload: overrides.payload ?? { hello: 'world' },
    status: overrides.status ?? 'PENDING',
    reviewerId: overrides.reviewerId ?? null,
    reviewedAt: overrides.reviewedAt ?? null,
    reviewComment: overrides.reviewComment ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

describe('pendingSubmissionAcceptors: registry', () => {
  it('TEST acceptor is registered at module-load time', () => {
    const a = getAcceptor('TEST');
    expect(a).not.toBeNull();
    expect(a?.targetType).toBe('TEST');
  });

  it('returns null for an unregistered targetType', () => {
    // QA_MESSAGE acceptor is intentionally NOT registered in Phase 28 —
    // Phase 31 will add it. Until then it must read as missing so the
    // route handler can 500 NO_ACCEPTOR_REGISTERED.
    expect(getAcceptor('QA_MESSAGE')).toBeNull();
  });

  it('registerAcceptor is last-wins (re-registration emits a warn)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Use WIZARD_ANSWER (unregistered in Phase 28) for the first registration
    // so we don't shadow the TEST acceptor that other tests in this file
    // depend on. Second registration is the last-wins case under test.
    const calls: AcceptorContext[] = [];
    const first: PendingSubmissionAcceptor = {
      targetType: 'WIZARD_ANSWER',
      async accept(_, ctx) { calls.push(ctx); },
    };
    const second: PendingSubmissionAcceptor = {
      targetType: 'WIZARD_ANSWER',
      async accept() {},
    };
    registerAcceptor(first);
    expect(getAcceptor('WIZARD_ANSWER')).toBe(first);

    registerAcceptor(second);
    expect(getAcceptor('WIZARD_ANSWER')).toBe(second);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('re-registering acceptor for WIZARD_ANSWER'),
    );

    warnSpy.mockRestore();
  });
});

describe('pendingSubmissionAcceptors: TEST acceptor invocation log', () => {
  it('records every accept() call with submission + ctx', async () => {
    const acceptor = getAcceptor('TEST')!;
    const submission = makeSubmission({ id: 'sub-1' });
    await acceptor.accept(submission, {
      engagementId: 'eng-1',
      reviewerId: 'rev-1',
      firmId: 'firm-1',
    });

    const invocations = __getTestAcceptorInvocations();
    expect(invocations.length).toBe(1);
    expect(invocations[0].submission.id).toBe('sub-1');
    expect(invocations[0].ctx).toEqual({
      engagementId: 'eng-1',
      reviewerId: 'rev-1',
      firmId: 'firm-1',
    });
  });

  it('__resetTestAcceptorInvocations clears the log', async () => {
    const acceptor = getAcceptor('TEST')!;
    await acceptor.accept(makeSubmission(), {
      engagementId: 'eng-1',
      reviewerId: 'rev-1',
      firmId: 'firm-1',
    });
    expect(__getTestAcceptorInvocations().length).toBe(1);

    __resetTestAcceptorInvocations();
    expect(__getTestAcceptorInvocations().length).toBe(0);
  });

  it('is intentionally NON-idempotent — two accept() calls record two invocations', async () => {
    const acceptor = getAcceptor('TEST')!;
    const sub = makeSubmission();
    await acceptor.accept(sub, { engagementId: 'eng', reviewerId: 'rev', firmId: 'firm' });
    await acceptor.accept(sub, { engagementId: 'eng', reviewerId: 'rev', firmId: 'firm' });
    expect(__getTestAcceptorInvocations().length).toBe(2);
  });
});

describe('pendingSubmissionPayloadSchemas: registry', () => {
  it('TEST schema is registered at module-load time and accepts any object', () => {
    const schema = getSubmissionPayloadSchema('TEST');
    expect(schema).not.toBeNull();
    expect(schema!.safeParse({ anything: 'goes' }).success).toBe(true);
    expect(schema!.safeParse({}).success).toBe(true);
  });

  it('returns null for an unregistered targetType', () => {
    expect(getSubmissionPayloadSchema('DECISION_SIGNOFF')).toBeNull();
  });

  it('registerSubmissionPayloadSchema is last-wins (re-registration emits a warn)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    registerSubmissionPayloadSchema('TEST', z.object({ overridden: z.literal(true) }));
    const schema = getSubmissionPayloadSchema('TEST')!;
    expect(schema.safeParse({ overridden: true }).success).toBe(true);
    expect(schema.safeParse({ overridden: false }).success).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('re-registering schema for TEST'),
    );

    // Restore the original passthrough schema so other tests in the run
    // (route tests using TEST) keep working.
    registerSubmissionPayloadSchema('TEST', z.object({}).passthrough());
    warnSpy.mockRestore();
  });
});
