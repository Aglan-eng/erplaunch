import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * Portal sign-in (Phase 5A).
 * Renders at `/portal/:token/login`. Submits email → POST /portal/request-access.
 * Success is indistinguishable from a not-a-member response by design
 * (server always returns 202) so we show the "check your email" screen either way.
 */
export function PortalLoginPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 text-center">
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
            className="text-sm text-brand-600 hover:text-brand-700"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8">
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
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              placeholder="you@example.com"
            />
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 text-white text-sm font-medium py-2.5 hover:bg-brand-700 disabled:opacity-50 transition-colors"
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
    </div>
  );
}
