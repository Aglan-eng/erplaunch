import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  PortalBrandedHeader,
  getPortalBrandingStyle,
  type FirmBranding,
} from '@/components/portal/PortalBrandedHeader';
import { PortalSupportFooter } from '@/components/portal/PortalSupportFooter';

/**
 * Portal sign-in (Phase 5A, Phase 27 white-label).
 *
 * Renders at `/portal/:token/login`. Submits email → POST /portal/request-access.
 * Success is indistinguishable from a not-a-member response by design
 * (server always returns 202) so we show the "check your email" screen either way.
 *
 * Phase 27: pre-auth branding fetch via GET /engagements/portal/:token/branding
 * lets the firm's logo, colours, displayName, and support email show on the
 * sign-in screen *before* the magic-link auth completes — so the very first
 * surface a client sees still feels like the firm's portal, not ERPLaunch's.
 */

// Defensive fallback for when the lightweight branding endpoint 404s
// (revoked / unknown token) — keeps the form rendering with a neutral look
// rather than a hard error, since the form submit itself will surface the
// 404 with a friendlier message.
const DEFAULT_PORTAL_BRANDING: FirmBranding = {
  displayName: 'ERPLaunch',
  logoUrl: null,
  primaryColor: '#4f46e5',
  secondaryColor: '#818cf8',
  supportEmail: null,
};

interface BrandingResponse {
  branding: FirmBranding;
  clientName: string;
}

async function fetchPortalBranding(token: string): Promise<BrandingResponse> {
  const r = await api.get(`/engagements/portal/${token}/branding`);
  return r.data.data as BrandingResponse;
}

export function PortalLoginPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 27 — pre-auth branding fetch. retry: false so a 404 (revoked /
  // unknown token) doesn't spin forever; we just fall back to defaults and
  // let the form-submit handler surface the link-invalid message.
  const { data: brandingData, isLoading: brandingLoading } = useQuery({
    queryKey: ['portal-branding', token],
    queryFn: () => fetchPortalBranding(token!),
    enabled: !!token,
    retry: false,
  });

  const branding: FirmBranding = brandingData?.branding ?? DEFAULT_PORTAL_BRANDING;
  const portalStyle = getPortalBrandingStyle(branding);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      await api.post('/engagements/portal/request-access', { email, engagementToken: token });
      setSubmitted(true);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 404) setError('This portal link is no longer valid. Ask your consultant for a fresh invite.');
      else if (status === 400) setError('That email address doesn\'t look right.');
      else setError('Something went wrong. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }

  // Loading: show a minimal branded skeleton while branding resolves so the
  // first paint isn't a flash of unbranded form. ~50ms in practice on a warm
  // backend; the skeleton just prevents layout jitter.
  if (brandingLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 animate-pulse">
          <div className="h-11 w-11 rounded-xl bg-slate-200 mb-4" />
          <div className="h-4 w-48 bg-slate-200 rounded mb-3" />
          <div className="h-3 w-64 bg-slate-100 rounded mb-6" />
          <div className="h-10 w-full bg-slate-100 rounded mb-4" />
          <div className="h-10 w-full bg-slate-200 rounded" />
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" style={portalStyle}>
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 text-center">
            <PortalBrandedHeader branding={branding} className="!justify-center mb-6" />
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-emerald-600" aria-hidden="true">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-slate-900 mb-2">Check your email</h1>
            <p className="text-sm text-slate-600 mb-6">
              If <span className="font-medium text-slate-900">{email}</span> is on the invite list,
              we've sent a sign-in link. The link expires in 10 minutes.
            </p>
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="text-sm text-[var(--portal-primary)] hover:underline"
            >
              Use a different email
            </button>
          </div>
          <PortalSupportFooter branding={branding} className="mt-6 text-center" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" style={portalStyle}>
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8">
          {/* Phase 27 — firm-branded header on the sign-in surface. clientName
              is intentionally omitted here: PortalLoginPage doesn't load
              engagement context, and the prefix label alone is enough to
              ground the user that they're on the right firm's portal. */}
          <PortalBrandedHeader branding={branding} className="mb-6" />

          <h1 className="text-lg font-semibold text-slate-900 mb-1">Sign in to the client portal</h1>
          <p className="text-sm text-slate-600 mb-6">Enter the email your consultant invited. We'll send a one-time sign-in link.</p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">Email address</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[var(--portal-primary)] focus:ring-1 focus:ring-[var(--portal-primary)] outline-none"
                placeholder="you@example.com"
              />
            </div>

            {error && <p className="text-sm text-rose-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[var(--portal-primary)] text-white text-sm font-medium py-2.5 hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-200 text-center">
            <Link to={`/portal/${token}`} onClick={() => navigate(`/portal/${token}`)} className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to portal
            </Link>
          </div>
        </div>
        <PortalSupportFooter branding={branding} className="mt-6 text-center" />
      </div>
    </div>
  );
}
