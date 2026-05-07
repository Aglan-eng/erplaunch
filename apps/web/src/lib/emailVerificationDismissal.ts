/**
 * Phase 40.1 — localStorage-backed 7-day dismissal for the email
 * verification banner.
 *
 * The previous implementation only tracked dismissal in component state, so
 * the banner reappeared on every page load — useless for users who can't
 * receive the verification email at all (Resend free-tier sender restriction
 * was the original PO trigger).
 *
 * Storage shape: a single key "emailVerificationBannerDismissed" whose value
 * is "<userId>:<timestampMs>". Keying on userId means switching accounts
 * doesn't carry the dismissal forward; the TTL means a stale dismissal
 * eventually clears so the banner re-arms.
 *
 * Helpers accept an injected `Storage` argument so they're easy to unit-test
 * without standing up jsdom. In production the SPA passes window.localStorage.
 */

export const DISMISSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const STORAGE_KEY = 'emailVerificationBannerDismissed';

/**
 * Returns true when the user has dismissed the banner and the dismissal
 * hasn't yet expired. Defaults to false on any malformed value, missing
 * storage, or user-id mismatch — i.e. fail-open: better to nag than to
 * silently swallow a verification reminder.
 */
export function isBannerDismissed(userId: string, now: number, storage?: Storage): boolean {
  if (!storage) return false;
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return false;
  const sep = raw.indexOf(':');
  if (sep <= 0) return false;
  const storedUserId = raw.slice(0, sep);
  const tsRaw = raw.slice(sep + 1);
  if (storedUserId !== userId) return false;
  const ts = Number.parseInt(tsRaw, 10);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return now - ts < DISMISSAL_TTL_MS;
}

/**
 * Records that the user dismissed the banner at `now` (ms epoch). No-op
 * when storage is missing — production callers always pass
 * window.localStorage; the no-op covers SSR / first-paint hydration.
 */
export function dismissBanner(userId: string, now: number, storage?: Storage): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, `${userId}:${now}`);
  } catch {
    // QuotaExceededError or private-mode block — banner just keeps showing.
  }
}

/**
 * Clears the dismissal so the banner returns. Used when the consultant
 * clicks "Resend verification" elsewhere (re-arm semantics per PO spec).
 */
export function resetBannerDismissal(_userId: string, storage?: Storage): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Same fallthrough as dismissBanner — ignore quota / privacy errors.
  }
}
