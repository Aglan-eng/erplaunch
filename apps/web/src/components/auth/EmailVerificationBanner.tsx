import React, { useState } from 'react';
import { Info, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { authApi } from '@/lib/api';
import {
  isBannerDismissed,
  dismissBanner,
  resetBannerDismissal,
} from '@/lib/emailVerificationDismissal';

/**
 * Phase 40.1 — dismissible email-verification banner.
 *
 * Surfaces a low-key informational reminder when the signed-in user
 * hasn't verified their email. The "Skip for now" action stores a 7-day
 * dismissal in localStorage so users who can't receive the verification
 * email (Resend free-tier sender restriction was the original trigger)
 * aren't nagged on every page load. Clicking "Resend verification"
 * re-arms the banner.
 *
 * Cosmetic: switched from amber/orange (read as "warning") to a muted
 * blue with an ℹ icon (read as "informational"). The original colour
 * implied an error state, which set the wrong expectation given the
 * banner is benign.
 */
type SendError =
  | { kind: 'domain'; recipient: string; message: string }
  | { kind: 'generic'; message: string };

export function EmailVerificationBanner() {
  const { user } = useAuth();
  const storage = typeof window !== 'undefined' ? window.localStorage : undefined;
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [error, setError] = useState<SendError | null>(null);
  // Track dismissal in state so toggling it re-renders without forcing a
  // page reload. Initialised from localStorage on first render.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!user) return false;
    return isBannerDismissed(user.id, Date.now(), storage);
  });

  if (!user || user.emailVerifiedAt || dismissed) return null;

  async function handleResend() {
    if (!user) return;
    setSending(true);
    setError(null);
    try {
      await authApi.requestEmailVerification();
      setSentAt(Date.now());
      // Re-arm the banner — if the user proactively asks for a fresh email,
      // they're engaging with the flow, so a future "Skip" should reset
      // its TTL window from this point.
      resetBannerDismissal(user.id, storage);
    } catch (err: unknown) {
      // Phase 41.4 — branch on the structured error code so the
      // "domain not verified" failure surfaces a Settings → Email
      // Domain CTA instead of a generic toast that the consultant
      // can't act on.
      const errorPayload = (err as {
        response?: { data?: { error?: { code?: string; message?: string; recipient?: string } } };
      }).response?.data?.error;
      if (errorPayload?.code === 'EMAIL_DOMAIN_NOT_VERIFIED') {
        setError({
          kind: 'domain',
          recipient: errorPayload.recipient ?? user.email,
          message: errorPayload.message ?? 'Email domain isn\'t verified yet.',
        });
      } else {
        setError({
          kind: 'generic',
          message: errorPayload?.message ?? 'Could not send. Try again in a moment.',
        });
      }
    } finally {
      setSending(false);
    }
  }

  function handleSkip() {
    if (!user) return;
    dismissBanner(user.id, Date.now(), storage);
    setDismissed(true);
  }

  return (
    <div
      data-testid="email-verification-banner"
      className="mb-5 bg-blue-50/70 border border-blue-200 rounded-xl px-4 py-2.5 flex items-start gap-3"
    >
      <div className="h-7 w-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
        <Info className="h-3.5 w-3.5 text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-blue-900">
          Verify your email when you have a chance
        </p>
        <p className="text-[11px] text-blue-800/80 mt-0.5">
          We sent a link to <span className="font-mono font-semibold">{user.email}</span>. Click it to confirm you own this address.
        </p>
        {sentAt && !error && (
          <p className="text-[11px] text-green-700 mt-1 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Sent. Check your inbox (and spam folder).
          </p>
        )}
        {error?.kind === 'domain' && (
          <div
            className="mt-1.5 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5"
            data-testid="email-verification-domain-error"
          >
            <p className="text-[11px] text-amber-800 inline-flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-px" />
              <span>
                We couldn't send to <span className="font-mono font-semibold">{error.recipient}</span>.
                Your firm's email domain isn't verified yet.{' '}
                <Link
                  to="/settings/email-domain"
                  className="font-semibold underline underline-offset-2 hover:text-amber-900"
                  data-testid="email-domain-cta"
                >
                  Visit Settings → Email Domain to fix this.
                </Link>
              </span>
            </p>
          </div>
        )}
        {error?.kind === 'generic' && <p className="text-[11px] text-red-700 mt-1">{error.message}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleResend}
          disabled={sending}
          className="text-[11px] font-semibold text-blue-900 hover:text-blue-950 px-2.5 py-1 rounded-md bg-white/70 hover:bg-white border border-blue-200 disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Resend email'}
        </button>
        <button
          onClick={handleSkip}
          className="text-[11px] font-semibold text-blue-700/80 hover:text-blue-900 px-2 py-1 rounded-md hover:bg-white/60"
          title="Hide for 7 days"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
