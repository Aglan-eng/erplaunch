import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * Portal magic-link verifier.
 * Renders at `/portal/:token/verify?email=…&code=…`. Auto-POSTs to
 * /portal/verify on mount. On success the server sets the portal_token
 * cookie and we redirect to /portal/:token.
 */
export function PortalVerifyPage() {
  const { token } = useParams<{ token: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const email = search.get('email') ?? '';
  const code = search.get('code') ?? '';

  const [state, setState] = useState<'pending' | 'error'>('pending');
  const [message, setMessage] = useState<string>('Signing you in…');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token || !email || !code) {
        setState('error');
        setMessage('This sign-in link is missing required information. Please request a new one.');
        return;
      }
      try {
        await api.post('/engagements/portal/verify', { engagementToken: token, email, code });
        if (cancelled) return;
        navigate(`/portal/${token}`, { replace: true });
      } catch (err) {
        if (cancelled) return;
        const status = (err as { response?: { status?: number; data?: { error?: { code?: string } } } }).response?.status;
        const serverCode = (err as { response?: { data?: { error?: { code?: string } } } }).response?.data?.error?.code;
        setState('error');
        if (status === 429 || serverCode === 'RATE_LIMITED') {
          setMessage('Too many attempts. Please wait a minute and request a new sign-in link.');
        } else if (serverCode === 'NO_ACTIVE_LINK') {
          setMessage('This sign-in link has expired or already been used. Please request a new one.');
        } else if (serverCode === 'INVALID_CODE' || status === 401) {
          setMessage('Sign-in failed. Please request a new sign-in link.');
        } else {
          setMessage('Something went wrong. Please try again.');
        }
      }
    }
    run();
    return () => { cancelled = true; };
  }, [token, email, code, navigate]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 text-center">
        {state === 'pending' ? (
          <>
            <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-sm text-slate-600">{message}</p>
          </>
        ) : (
          <>
            <div className="mx-auto w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-rose-600" aria-hidden="true">
                <path d="M12 8v4m0 4h.01M4.93 19h14.14a2 2 0 001.74-3L13.73 4a2 2 0 00-3.46 0L3.2 16a2 2 0 001.73 3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-slate-900 mb-2">Couldn't sign you in</h1>
            <p className="text-sm text-slate-600 mb-6">{message}</p>
            <Link
              to={`/portal/${token}/login`}
              className="inline-block rounded-lg bg-brand-600 text-white text-sm font-medium px-5 py-2.5 hover:bg-brand-700 transition-colors"
            >
              Request a new sign-in link
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
