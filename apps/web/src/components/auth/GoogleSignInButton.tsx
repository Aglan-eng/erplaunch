import { useEffect, useState } from 'react';
import { authApi } from '@/lib/api';

/**
 * "Continue with Google" button + "or sign in with email" divider.
 *
 * Renders nothing until the API confirms Google OAuth is configured
 * (probe to /auth/google/available). When available, renders a single
 * anchor that navigates the browser to the API's start endpoint —
 * which @fastify/oauth2 redirects on to Google's consent screen — plus
 * a divider so the email/password form below feels intentional.
 *
 * Why an anchor and not a fetch: the OAuth start URL must be a real
 * navigation; fetch/XHR can't follow the cross-origin redirect Google
 * issues to the consent screen.
 *
 * Why probe: dev / preview environments may not have GOOGLE_CLIENT_ID
 * etc. set on the API. Showing a non-functional button would confuse
 * the consultant — the probe lets us hide it cleanly.
 */
export function GoogleSignInButton({
  label = 'Continue with Google',
  dividerLabel = 'or sign in with email',
}: {
  label?: string;
  dividerLabel?: string;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    authApi.googleAvailable().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    return () => { cancelled = true; };
  }, []);

  if (available !== true) return null;

  return (
    <>
      <a
        href={authApi.googleStartUrl()}
        className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
        // No JS click handler — let the browser handle navigation directly
        // so the consent-screen redirect chain is preserved.
      >
        <GoogleLogo />
        {label}
      </a>
      <div className="flex items-center gap-3 my-4 text-xs text-gray-400">
        <div className="flex-1 border-t border-gray-200" />
        <span>{dividerLabel}</span>
        <div className="flex-1 border-t border-gray-200" />
      </div>
    </>
  );
}

/** Inline Google G logo (official 4-color mark). */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" />
    </svg>
  );
}
