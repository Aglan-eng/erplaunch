import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Flag, Loader2 } from 'lucide-react';
import { portalApi } from '@/lib/api';

/**
 * Phase 45.4 — Closeout sign-off card on the client portal.
 *
 * Renders only when the engagement is in CLOSEOUT and the client member
 * is authenticated. Shows three states:
 *
 *   1. NOT_STARTED   — large green CTA button: "Sign off the closeout"
 *   2. DONE          — green confirmation block: "Signed off by <name> on <date>"
 *   3. NA / other    — falls back to NOT_STARTED CTA so the client can still
 *                      sign if needed (an admin can mark NA via override).
 *
 * The portal/:token/closeout-signoff GET returns ready=false outside
 * CLOSEOUT, in which case this component renders null so the page
 * isn't cluttered with a non-actionable card.
 */
export function PortalCloseoutSignoff({
  token,
  authenticated,
}: {
  token: string;
  authenticated: boolean;
}) {
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['portal-closeout-signoff', token],
    queryFn: () => portalApi.getCloseoutSignoff(token),
    enabled: !!token && authenticated,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: () => portalApi.postCloseoutSignoff(token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-closeout-signoff', token] });
      setConfirmOpen(false);
    },
  });

  // Don't render anything when the engagement isn't in CLOSEOUT — the
  // portal already shows other cards for the active stage.
  if (!authenticated) return null;
  if (isLoading) return null;
  if (!data || !data.ready) return null;

  const isSigned = data.status === 'DONE';

  return (
    <section
      className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 md:p-6"
      data-testid="portal-closeout-signoff"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
          <Flag className="h-4 w-4 text-emerald-700" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">Closeout sign-off</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            We've wrapped up the implementation. Once you confirm everything
            is in order, we'll hand over to our SLA support team.
          </p>
        </div>
      </div>

      {isSigned ? (
        <div
          className="rounded-xl bg-emerald-100/60 border border-emerald-200 px-4 py-3 flex items-center gap-3"
          data-testid="portal-closeout-signoff-done"
        >
          <CircleCheck className="h-5 w-5 text-emerald-700 flex-shrink-0" />
          <div className="text-sm text-emerald-900">
            <p className="font-semibold">
              Signed off{data.signedBy ? ` by ${humanName(data.signedBy)}` : ''}
            </p>
            {data.signedAt && (
              <p className="text-xs text-emerald-700/80 mt-0.5">
                on{' '}
                {new Date(data.signedAt).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
          </div>
        </div>
      ) : !confirmOpen ? (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
          data-testid="portal-closeout-signoff-cta"
        >
          <Flag className="h-4 w-4" />
          Sign off the closeout
        </button>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <p className="text-sm text-amber-900 font-semibold mb-2">
            Confirm closeout sign-off
          </p>
          <p className="text-xs text-amber-800 mb-3 leading-relaxed">
            By signing off you confirm that the implementation is complete and
            you accept the handover to the SLA support team. This action is
            recorded against your name and cannot be reversed from the portal.
          </p>
          <div className="flex flex-col-reverse sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={mutation.isPending}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
              data-testid="portal-closeout-signoff-confirm"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Flag className="h-4 w-4" />
              )}
              Yes, sign off
            </button>
          </div>
          {mutation.isError && (
            <p
              className="text-xs text-red-600 mt-2"
              data-testid="portal-closeout-signoff-error"
            >
              Couldn't record your sign-off. Please try again or contact your project lead.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Server-side stamp: "Signed off by <name> via portal".
 * The card looks cleaner with just the name, so strip the trailing
 * preamble. Defensive — falls back to the raw string if the format
 * shifts in a future API change.
 */
function humanName(notes: string): string {
  const m = notes.match(/^Signed off by (.+?) via portal$/);
  return m ? m[1] : notes;
}
