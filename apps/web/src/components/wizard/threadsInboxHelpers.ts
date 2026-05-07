/**
 * Phase 40.4 — pure helpers for the consultant Threads inbox.
 *
 * The threads API doesn't ship a server-side "read state", so unread
 * tracking happens client-side: each thread carries a `lastMessageAt`,
 * and we persist a per-engagement `{threadId → lastSeenAt}` map in
 * localStorage. A thread is unread when `lastMessageAt > lastSeenAt`
 * (and isn't already RESOLVED — closed threads don't nag).
 *
 * Splitting these helpers out lets the test suite cover the read-state
 * arithmetic and the localStorage round-trip without rendering React or
 * standing up jsdom — same approach as Phase 40.1's email-verification
 * dismissal helpers.
 */

const STORAGE_PREFIX = 'threadsLastSeen';

export type ThreadStatus = 'OPEN' | 'RESOLVED';

export interface ThreadSummary {
  id: string;
  status: ThreadStatus;
  /** ISO timestamp of the most recent message. May be empty for brand-new
   * threads that haven't accepted any messages yet. */
  lastMessageAt: string;
}

export type LastSeenMap = Record<string, string>;

// ─── Read state queries ──────────────────────────────────────────────────────

export function isThreadUnread(thread: ThreadSummary, lastSeen: LastSeenMap): boolean {
  if (thread.status === 'RESOLVED') return false;
  if (!thread.lastMessageAt) return false;
  const seen = lastSeen[thread.id];
  if (!seen) return true;
  return new Date(thread.lastMessageAt).getTime() > new Date(seen).getTime();
}

export function getUnreadCount(threads: ThreadSummary[], lastSeen: LastSeenMap): number {
  let count = 0;
  for (const t of threads) {
    if (isThreadUnread(t, lastSeen)) count++;
  }
  return count;
}

// ─── Storage round-trip ──────────────────────────────────────────────────────

function storageKeyFor(engagementId: string): string {
  return `${STORAGE_PREFIX}:${engagementId}`;
}

export function getLastSeenMap(engagementId: string, storage?: Storage): LastSeenMap {
  if (!storage) return {};
  const raw = storage.getItem(storageKeyFor(engagementId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as LastSeenMap;
    }
    return {};
  } catch {
    // Malformed payload (corruption, hand-edited storage, version drift) —
    // pretend the user has read nothing rather than blowing up.
    return {};
  }
}

export function setThreadSeen(
  engagementId: string,
  threadId: string,
  seenAtIso: string,
  storage?: Storage
): void {
  if (!storage) return;
  const current = getLastSeenMap(engagementId, storage);
  const next = { ...current, [threadId]: seenAtIso };
  try {
    storage.setItem(storageKeyFor(engagementId), JSON.stringify(next));
  } catch {
    // QuotaExceededError or private-browsing block — silently swallow;
    // unread state will reset next session but nothing breaks.
  }
}
