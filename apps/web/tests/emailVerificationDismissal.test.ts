import { describe, it, expect, beforeEach } from 'vitest';
import {
  isBannerDismissed,
  dismissBanner,
  resetBannerDismissal,
  DISMISSAL_TTL_MS,
} from '../src/lib/emailVerificationDismissal';

// Minimal in-memory localStorage shim for the tests. Vitest in node mode
// doesn't ship a browser env unless we configure jsdom; the helpers we're
// testing accept an injected storage so we can avoid pulling jsdom in.
function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (idx) => Array.from(store.keys())[idx] ?? null,
    get length() { return store.size; },
  } as Storage;
}

const USER = 'user-abc';
const NOW = 1_700_000_000_000;

describe('emailVerificationDismissal', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage();
  });

  it('reports not-dismissed for a fresh storage', () => {
    expect(isBannerDismissed(USER, NOW, storage)).toBe(false);
  });

  it('persists dismissal and reads it back as dismissed within TTL', () => {
    dismissBanner(USER, NOW, storage);
    expect(isBannerDismissed(USER, NOW, storage)).toBe(true);
    expect(isBannerDismissed(USER, NOW + 60_000, storage)).toBe(true);
  });

  it('expires the dismissal after 7 days', () => {
    dismissBanner(USER, NOW, storage);
    expect(isBannerDismissed(USER, NOW + DISMISSAL_TTL_MS - 1, storage)).toBe(true);
    expect(isBannerDismissed(USER, NOW + DISMISSAL_TTL_MS + 1, storage)).toBe(false);
  });

  it('keys dismissals by user id — another user is not dismissed', () => {
    dismissBanner(USER, NOW, storage);
    expect(isBannerDismissed('other-user', NOW, storage)).toBe(false);
  });

  it('resetBannerDismissal clears the persisted entry', () => {
    dismissBanner(USER, NOW, storage);
    resetBannerDismissal(USER, storage);
    expect(isBannerDismissed(USER, NOW, storage)).toBe(false);
  });

  it('treats malformed storage values as not-dismissed', () => {
    storage.setItem('emailVerificationBannerDismissed', 'not-a-valid-payload');
    expect(isBannerDismissed(USER, NOW, storage)).toBe(false);
  });

  it('treats a non-numeric timestamp as not-dismissed', () => {
    storage.setItem('emailVerificationBannerDismissed', `${USER}:not-a-number`);
    expect(isBannerDismissed(USER, NOW, storage)).toBe(false);
  });

  it('handles a missing storage gracefully (no-op)', () => {
    // Some SSR / test environments don't expose localStorage. The helpers
    // should silently treat that as "not dismissed" rather than throw.
    expect(isBannerDismissed(USER, NOW, undefined)).toBe(false);
    expect(() => dismissBanner(USER, NOW, undefined)).not.toThrow();
    expect(() => resetBannerDismissal(USER, undefined)).not.toThrow();
  });
});
