import { describe, it, expect } from 'vitest';
import {
  isThreadUnread,
  getUnreadCount,
  getLastSeenMap,
  setThreadSeen,
  type ThreadSummary,
  type LastSeenMap,
} from '../src/components/wizard/threadsInboxHelpers';

// In-memory storage shim — vitest runs without jsdom for these tests, so
// we hand-roll a Map-backed Storage rather than touching window.localStorage.
function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? (m.get(k) ?? null) : null),
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, v); },
  };
}

const baseThread = (overrides: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: 't1',
  status: 'OPEN',
  lastMessageAt: '2026-05-07T12:00:00.000Z',
  ...overrides,
});

// ─── isThreadUnread ──────────────────────────────────────────────────────────

describe('isThreadUnread', () => {
  it('returns true when the thread has never been seen', () => {
    expect(isThreadUnread(baseThread(), {})).toBe(true);
  });

  it('returns false when last-seen is at or after the latest message', () => {
    const lastSeen: LastSeenMap = { t1: '2026-05-07T12:00:00.000Z' };
    expect(isThreadUnread(baseThread(), lastSeen)).toBe(false);
  });

  it('returns true when a newer message arrives after last-seen', () => {
    const lastSeen: LastSeenMap = { t1: '2026-05-07T11:00:00.000Z' };
    expect(isThreadUnread(baseThread({ lastMessageAt: '2026-05-07T12:00:00.000Z' }), lastSeen)).toBe(
      true
    );
  });

  it('returns false for resolved threads regardless of last-seen', () => {
    expect(isThreadUnread(baseThread({ status: 'RESOLVED' }), {})).toBe(false);
  });

  it('handles a thread with no lastMessageAt by treating it as read', () => {
    expect(isThreadUnread(baseThread({ lastMessageAt: '' }), {})).toBe(false);
  });
});

// ─── getUnreadCount ──────────────────────────────────────────────────────────

describe('getUnreadCount', () => {
  it('counts only OPEN threads with newer activity than last-seen', () => {
    const threads: ThreadSummary[] = [
      baseThread({ id: 'a', lastMessageAt: '2026-05-07T12:00:00.000Z' }),
      baseThread({ id: 'b', lastMessageAt: '2026-05-07T08:00:00.000Z' }),
      baseThread({ id: 'c', status: 'RESOLVED', lastMessageAt: '2026-05-07T13:00:00.000Z' }),
    ];
    const lastSeen: LastSeenMap = {
      a: '2026-05-07T11:00:00.000Z', // unread
      b: '2026-05-07T09:00:00.000Z', // already seen
      // c is resolved → never counted
    };
    expect(getUnreadCount(threads, lastSeen)).toBe(1);
  });

  it('returns 0 when all threads are resolved', () => {
    const threads: ThreadSummary[] = [
      baseThread({ id: 'a', status: 'RESOLVED' }),
      baseThread({ id: 'b', status: 'RESOLVED' }),
    ];
    expect(getUnreadCount(threads, {})).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(getUnreadCount([], {})).toBe(0);
  });
});

// ─── getLastSeenMap ──────────────────────────────────────────────────────────

describe('getLastSeenMap', () => {
  it('returns an empty map when storage is missing', () => {
    expect(getLastSeenMap('eng1', undefined)).toEqual({});
  });

  it('returns an empty map when nothing has been stored yet', () => {
    expect(getLastSeenMap('eng1', makeStorage())).toEqual({});
  });

  it('returns the stored map keyed by engagement id', () => {
    const s = makeStorage();
    s.setItem('threadsLastSeen:eng1', JSON.stringify({ t1: '2026-05-07T11:00:00.000Z' }));
    expect(getLastSeenMap('eng1', s)).toEqual({ t1: '2026-05-07T11:00:00.000Z' });
  });

  it('keeps each engagement scoped — eng2 does not see eng1 data', () => {
    const s = makeStorage();
    s.setItem('threadsLastSeen:eng1', JSON.stringify({ t1: '2026-05-07T11:00:00.000Z' }));
    expect(getLastSeenMap('eng2', s)).toEqual({});
  });

  it('falls back to an empty map on malformed JSON', () => {
    const s = makeStorage();
    s.setItem('threadsLastSeen:eng1', '{not-json}');
    expect(getLastSeenMap('eng1', s)).toEqual({});
  });
});

// ─── setThreadSeen ───────────────────────────────────────────────────────────

describe('setThreadSeen', () => {
  it('writes a fresh map when nothing exists yet', () => {
    const s = makeStorage();
    setThreadSeen('eng1', 't1', '2026-05-07T12:00:00.000Z', s);
    expect(getLastSeenMap('eng1', s)).toEqual({ t1: '2026-05-07T12:00:00.000Z' });
  });

  it('merges into an existing engagement map', () => {
    const s = makeStorage();
    setThreadSeen('eng1', 't1', '2026-05-07T11:00:00.000Z', s);
    setThreadSeen('eng1', 't2', '2026-05-07T12:00:00.000Z', s);
    expect(getLastSeenMap('eng1', s)).toEqual({
      t1: '2026-05-07T11:00:00.000Z',
      t2: '2026-05-07T12:00:00.000Z',
    });
  });

  it('overwrites an older timestamp for the same thread', () => {
    const s = makeStorage();
    setThreadSeen('eng1', 't1', '2026-05-07T10:00:00.000Z', s);
    setThreadSeen('eng1', 't1', '2026-05-07T12:00:00.000Z', s);
    expect(getLastSeenMap('eng1', s)).toEqual({ t1: '2026-05-07T12:00:00.000Z' });
  });

  it('is a no-op when storage is missing', () => {
    expect(() => setThreadSeen('eng1', 't1', '2026-05-07T12:00:00.000Z', undefined)).not.toThrow();
  });
});
