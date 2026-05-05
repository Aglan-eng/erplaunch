import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Inbox, Clock } from 'lucide-react';
import { engagementsApi } from '@/lib/api';

/**
 * Pending Review (Phase 28).
 *
 * §5.1 foundation surface. Phase 28 ships the empty-state placeholder ONLY
 * (per Option A trim approved with the design): no per-row card UI, no
 * accept / reject buttons. Phases 29-32 each add their target-type's
 * interactive review alongside the corresponding client-side capture
 * flow:
 *
 *   Phase 29 — WIZARD_ANSWER     (client answers wizard from portal)
 *   Phase 30 — DATA_FILE         (client uploads files from portal)
 *   Phase 31 — QA_MESSAGE        (threaded Q&A messaging)
 *   Phase 32 — DECISION_SIGNOFF  (client signs off on decisions)
 *
 * Why ship the round-trip + count display now:
 *   - Verifies the consultant API endpoint is wired correctly end-to-end.
 *   - If a TEST submission exists in dev (the Phase 28 unit-test acceptor
 *     leaves no rows behind, but a manual API call could create one), the
 *     consultant sees the count rather than a stale empty state.
 *   - Phase 29 inherits the data-fetch hook + sidebar surface unchanged.
 */

interface PendingReviewStepProps {
  engagementId: string;
}

export function PendingReviewStep({ engagementId }: PendingReviewStepProps) {
  const { data: submissions, isLoading } = useQuery({
    queryKey: ['pending-submissions', engagementId],
    queryFn: () => engagementsApi.listPendingSubmissions(engagementId),
    enabled: !!engagementId,
    staleTime: 30_000,
  });

  const pendingCount = Array.isArray(submissions) ? submissions.length : 0;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-2 flex items-center gap-2">
          <Inbox className="h-6 w-6 text-brand-600" />
          Pending Review
        </h1>
        <p className="text-sm text-slate-500">
          Items submitted by clients via the portal land here for your review. Per §5.1 of the
          feature brief, a submission becomes the engagement&apos;s source of truth only once you
          explicitly accept it (with an optional comment); rejected items are never adopted.
        </p>
      </div>

      {/* Phase 28 ships only the empty state. Phases 29-32 add the
          interactive accept/reject UI alongside the corresponding client
          capture flow. */}
      {isLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full mx-auto" />
          <p className="mt-3 text-sm text-slate-500">Loading review queue&hellip;</p>
        </div>
      ) : pendingCount === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center"
          data-testid="pending-review-empty-state"
        >
          <div className="mx-auto w-14 h-14 rounded-full bg-slate-50 flex items-center justify-center mb-4">
            <Inbox className="h-7 w-7 text-slate-400" />
          </div>
          <p className="text-base font-semibold text-slate-700 mb-2">No pending submissions yet</p>
          <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
            Clients can submit items via the portal once additional phases land. Phase 28 shipped
            the infrastructure; Phases 29&ndash;32 will wire up wizard answers, data-file uploads,
            Q&amp;A threads, and decision sign-offs.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 text-[11px] text-slate-400">
            <Clock className="h-3.5 w-3.5" />
            Coming next: Phase 29 &mdash; client wizard answering
          </div>
        </div>
      ) : (
        <div
          className="rounded-2xl border border-amber-200 bg-amber-50/40 p-8 text-center"
          data-testid="pending-review-count-state"
        >
          <p className="text-base font-semibold text-amber-900 mb-1">
            {pendingCount} submission{pendingCount === 1 ? '' : 's'} awaiting review
          </p>
          <p className="text-sm text-amber-700">
            The interactive accept/reject UI lands in Phase 29. For now, use the API directly to
            review (
            <code className="text-[11px] bg-amber-100 px-1 py-0.5 rounded">
              POST /api/v1/engagements/{engagementId}/pending-submissions/:id/accept
            </code>
            ).
          </p>
        </div>
      )}
    </div>
  );
}
