/**
 * Phase 48.1 — supportTicketAcceptor unit tests.
 *
 * Pins the contract of the SUPPORT_TICKET pending-submission acceptor:
 * accepting a portal-submitted ticket creates a real Phase 45.6 Ticket
 * row with the right severity / opener / message thread, and rejects
 * malformed payloads with a clear error.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import { supportTicketAcceptor } from '../../src/services/supportTicketAcceptor.js';
import {
  findTicketById,
  listTicketsByEngagement,
  listTicketMessages,
} from '../../src/db/tickets.js';
import { getDb } from '../../src/db/index.js';
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
    args: [
      id,
      engagementId,
      'Client',
      'Stakeholder',
      'CLIENT',
      `${id}@example.com`,
      new Date().toISOString(),
    ],
  });
  return id;
}

function makeSubmission(overrides: Partial<PendingSubmission> = {}): PendingSubmission {
  return {
    id: 'sub-test',
    engagementId: 'eng-test',
    memberId: 'mem-test',
    targetType: 'SUPPORT_TICKET',
    targetId: null,
    payload: {
      title: 'Login broken on mobile',
      severity: 'HIGH',
      description: 'iOS Safari users see a blank screen.',
    },
    status: 'PENDING',
    reviewerId: null,
    reviewedAt: null,
    reviewComment: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('supportTicketAcceptor', () => {
  it('creates a Ticket row with the submitted title + severity + description', async () => {
    const { engagementId, firmId } = await seedEngagementWithToken({ firmName: 'TicketAcceptorFirm' });
    const memberId = await seedClientMember(engagementId);

    await supportTicketAcceptor.accept(
      makeSubmission({
        engagementId,
        memberId,
        payload: {
          title: 'Login broken on mobile',
          severity: 'HIGH',
          description: 'iOS Safari users see a blank screen.',
        },
      }),
      { engagementId, reviewerId: 'rev-1', firmId },
    );

    const tickets = await listTicketsByEngagement(engagementId);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({
      title: 'Login broken on mobile',
      severity: 'HIGH',
      description: 'iOS Safari users see a blank screen.',
      status: 'OPEN',
      openedByMemberId: memberId,
      openedByUserId: null,
      firmId,
    });
  });

  it('seeds the message thread with a CLIENT-side description message', async () => {
    const { engagementId, firmId } = await seedEngagementWithToken({ firmName: 'TicketSeedFirm' });
    const memberId = await seedClientMember(engagementId);

    await supportTicketAcceptor.accept(
      makeSubmission({
        engagementId,
        memberId,
        payload: {
          title: 'Reports timing out',
          severity: 'CRITICAL',
          description: 'CFO dashboard hangs after 30s.',
        },
      }),
      { engagementId, reviewerId: 'rev', firmId },
    );

    const tickets = await listTicketsByEngagement(engagementId);
    const messages = await listTicketMessages(tickets[0].id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      senderType: 'CLIENT',
      senderMemberId: memberId,
      body: 'CFO dashboard hangs after 30s.',
    });
  });

  it('skips the seed message when description is missing', async () => {
    const { engagementId, firmId } = await seedEngagementWithToken({ firmName: 'TicketNoDescFirm' });
    const memberId = await seedClientMember(engagementId);

    await supportTicketAcceptor.accept(
      makeSubmission({
        engagementId,
        memberId,
        payload: { title: 'Issue', severity: 'LOW' },
      }),
      { engagementId, reviewerId: 'rev', firmId },
    );

    const tickets = await listTicketsByEngagement(engagementId);
    const messages = await listTicketMessages(tickets[0].id);
    expect(messages).toHaveLength(0);
  });

  it('throws on missing title', async () => {
    const { engagementId, firmId } = await seedEngagementWithToken({ firmName: 'TicketNoTitleFirm' });
    const memberId = await seedClientMember(engagementId);
    await expect(
      supportTicketAcceptor.accept(
        makeSubmission({
          engagementId,
          memberId,
          payload: { severity: 'HIGH' },
        }),
        { engagementId, reviewerId: 'rev', firmId },
      ),
    ).rejects.toThrow(/title/);
  });

  it('throws on invalid severity', async () => {
    const { engagementId, firmId } = await seedEngagementWithToken({ firmName: 'TicketBadSevFirm' });
    const memberId = await seedClientMember(engagementId);
    await expect(
      supportTicketAcceptor.accept(
        makeSubmission({
          engagementId,
          memberId,
          payload: { title: 'X', severity: 'BANANA' },
        }),
        { engagementId, reviewerId: 'rev', firmId },
      ),
    ).rejects.toThrow(/severity/);
  });

  it('every successful accept produces a fresh ticket — no idempotency dedup at acceptor level', async () => {
    // Idempotency is enforced at the route's transaction layer (the
    // submission flips to ACCEPTED so a retry 409s before this acceptor
    // re-runs). At the unit level, two raw accept() calls produce two
    // tickets — pin that so future maintainers know the dedup boundary.
    const { engagementId, firmId } = await seedEngagementWithToken({ firmName: 'TicketDupFirm' });
    const memberId = await seedClientMember(engagementId);
    const sub = makeSubmission({
      engagementId,
      memberId,
      payload: { title: 'Same', severity: 'MEDIUM' },
    });
    await supportTicketAcceptor.accept(sub, { engagementId, reviewerId: 'rev', firmId });
    await supportTicketAcceptor.accept(sub, { engagementId, reviewerId: 'rev', firmId });
    const tickets = await listTicketsByEngagement(engagementId);
    expect(tickets).toHaveLength(2);
  });

  it('written ticket is round-trippable via findTicketById', async () => {
    const { engagementId, firmId } = await seedEngagementWithToken({ firmName: 'TicketRoundtripFirm' });
    const memberId = await seedClientMember(engagementId);
    await supportTicketAcceptor.accept(
      makeSubmission({
        engagementId,
        memberId,
        payload: { title: 'Round-trip', severity: 'MEDIUM' },
      }),
      { engagementId, reviewerId: 'rev', firmId },
    );
    const tickets = await listTicketsByEngagement(engagementId);
    const fetched = await findTicketById(tickets[0].id);
    expect(fetched?.title).toBe('Round-trip');
    expect(fetched?.severity).toBe('MEDIUM');
  });
});
