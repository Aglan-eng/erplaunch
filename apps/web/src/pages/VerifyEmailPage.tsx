import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ShieldAlert, Loader2 } from 'lucide-react';
import { authApi } from '@/lib/api';

/**
 * Email verification landing page (Phase 19).
 *
 * Reads ?token=... from the URL and POSTs it immediately on mount —
 * verification is a single-click flow, no form needed. Three terminal
 * states:
 *   - verifying: in-flight (spinner)
 *   - ok: flips to success UI and redirects to /dashboard after 2.5s
 *   - failed: "Invalid or expired" with a recovery link back to /login
 *     (where a signed-in user can hit the Resend from the banner).
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<'verifying' | 'ok' | 'failed' | 'missing'>(token.trim() ? 'verifying' : 'missing');

  useEffect(() => {
    if (!token.trim()) return;
    let cancelled = false;
    (async () => {
      try {
        await authApi.verifyEmail(token);
        if (!cancelled) setStatus('ok');
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (status !== 'ok') return;
    const t = setTimeout(() => navigate('/dashboard'), 2500);
    return () => clearTimeout(t);
  }, [status, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-900 to-emerald-700 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-white/10 mb-4">
            <span className="text-white font-bold text-xl">E</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Verify your email</h1>
          <p className="mt-1 text-emerald-100 text-sm">Just a second…</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 text-center">
          {status === 'verifying' && (
            <div className="space-y-3">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-emerald-50">
                <Loader2 className="h-5 w-5 text-emerald-600 animate-spin" />
              </div>
              <p className="text-sm text-gray-500">Checking your verification link…</p>
            </div>
          )}
          {status === 'ok' && (
            <div className="space-y-3">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-green-50">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Email verified</h2>
              <p className="text-sm text-gray-500">Sending you to the dashboard…</p>
              <Link to="/dashboard" className="inline-block text-sm text-emerald-700 hover:text-emerald-900 font-medium">
                Take me there now →
              </Link>
            </div>
          )}
          {status === 'failed' && (
            <div className="space-y-3">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-rose-50">
                <ShieldAlert className="h-5 w-5 text-rose-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Link is invalid or expired</h2>
              <p className="text-sm text-gray-500">
                Sign in and use the "Resend verification" banner on your dashboard to get a fresh link.
              </p>
              <Link to="/login" className="inline-block text-sm text-emerald-700 hover:text-emerald-900 font-medium">
                Sign in
              </Link>
            </div>
          )}
          {status === 'missing' && (
            <div className="space-y-3">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-amber-50">
                <ShieldAlert className="h-5 w-5 text-amber-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Link is incomplete</h2>
              <p className="text-sm text-gray-500">
                The verification link is missing its token. Open it again from your email, or request a fresh one from the dashboard.
              </p>
              <Link to="/login" className="inline-block text-sm text-emerald-700 hover:text-emerald-900 font-medium">
                Sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
