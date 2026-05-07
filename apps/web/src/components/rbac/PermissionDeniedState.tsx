import React from 'react';
import { Lock, Mail } from 'lucide-react';

/**
 * Phase 44.5 — friendly empty state for 403 responses.
 *
 * Replaces the red error toast that fires when an API call returns
 * `{ error: { code: 'FORBIDDEN', requiredRole: 'X' } }`. The empty
 * state renders inline where the data should have been (decisions
 * list, risk register, generators panel, etc.) so the consultant
 * sees a calm "talk to your admin" message instead of a noisy
 * notification ribbon.
 *
 * Inputs are kept primitive so the component is callable from
 * anywhere without dragging in the API client. The page-level wrapper
 * pulls `requiredRole` and the optional admin contact from its own
 * useQuery's error payload.
 */

export interface PermissionDeniedStateProps {
  /** The role from the API's 403 payload (`error.requiredRole`). */
  requiredRole?: string;
  /** Optional verb hint ("view", "edit") so the body reads naturally
   *  for the requested action. Defaults to "view". */
  verb?: 'view' | 'edit' | 'create';
  /** Optional resource label ("decisions", "the risk register").
   *  Used inside the body. */
  resourceLabel?: string;
  /** Optional admin email — when present, the CTA renders. */
  adminEmail?: string;
  /** Override the default title — useful when the parent page has
   *  its own framing copy. */
  title?: string;
}

export function PermissionDeniedState({
  requiredRole,
  verb = 'view',
  resourceLabel,
  adminEmail,
  title = "You don't have permission to view this",
}: PermissionDeniedStateProps) {
  const role = requiredRole ?? 'a higher role';
  const what = resourceLabel ? `to ${verb} ${resourceLabel}` : 'to access this surface';
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-10 text-center max-w-md mx-auto my-8"
      data-testid="permission-denied-state"
    >
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-slate-100 mb-3">
        <Lock className="h-6 w-6 text-slate-500" />
      </div>
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500 mt-2 leading-relaxed">
        Talk to your App Admin if you need access. The role required is{' '}
        <span className="font-mono font-semibold text-slate-700">{role}</span>{' '}
        {what}.
      </p>
      {adminEmail && (
        <a
          href={`mailto:${encodeURIComponent(adminEmail)}?subject=${encodeURIComponent(`Requesting ${role} access`)}`}
          className="inline-flex items-center gap-1.5 mt-4 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold"
          data-testid="permission-denied-cta"
        >
          <Mail className="h-3.5 w-3.5" />
          Email {adminEmail}
        </a>
      )}
    </div>
  );
}

// ─── Helpers for callers ─────────────────────────────────────────────────────

export interface ApiErrorPayload {
  response?: {
    status?: number;
    data?: {
      error?: {
        code?: string;
        message?: string;
        requiredRole?: string;
      };
    };
  };
}

/**
 * Extract the {requiredRole, message} from an API error if it's a 403
 * with the FORBIDDEN code. Returns null otherwise so callers can fall
 * through to their generic error path.
 *
 * Usage:
 *   const denied = extractPermissionDenied(query.error);
 *   if (denied) return <PermissionDeniedState {...denied} />;
 *   if (query.error) return <GenericErrorBanner />;
 */
export function extractPermissionDenied(
  err: unknown,
): { requiredRole?: string; message?: string } | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as ApiErrorPayload;
  if (e.response?.status !== 403) return null;
  const payload = e.response?.data?.error;
  if (!payload || payload.code !== 'FORBIDDEN') return null;
  return {
    requiredRole: payload.requiredRole,
    message: payload.message,
  };
}
