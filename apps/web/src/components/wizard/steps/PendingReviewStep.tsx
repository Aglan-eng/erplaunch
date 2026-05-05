import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Inbox, Clock, CircleAlert } from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import {
  getCardRenderer,
  type PendingSubmissionRow,
} from '../pending-review/cardRenderers';
// Side-effect imports — register card renderers at module load. Each
// phase 29-32 owns one card renderer:
//   Phase 29 — WizardAnswerCard
//   Phase 30 — DataFileCard
//   Phase 31 — QaMessageCard (TODO)
//   Phase 32 — DecisionSignoffCard (TODO)
import '../pending-review/WizardAnswerCard';
import '../pending-review/DataFileCard';

/**
 * Pending Review (Phase 28 foundation, Phase 29 first interactive cards).
 *
 * §5.1 surface. Phase 28 shipped the empty state + count banner. Phase 29
 * extends with:
 *   - Accept/reject mutations wired to the consultant endpoints
 *   - Per-targetType card renderer dispatch (WIZARD_ANSWER ships now;
 *     Phase 30-32 register their own).
 *   - Optimistic invalidation: a successful accept/reject removes the
 *     row from the pending list immediately; refetch confirms.
 *
 * Empty-state contract from Phase 28 preserved (still renders cleanly
 * when no rows; the "Coming next" footnote rotates through phases as
 * each ships).
 */

interface PendingReviewStepProps {
  engagementId: string;
}

function GenericFallbackCard({
  submission,
  onAccept,
  onReject,
  isReviewing,
}: {
  submission: PendingSubmissionRow;
  onAccept: (comment: string) => void;
  onReject: (comment: string) => void;
  isReviewing: boolean;
}) {
  const [comment, setComment] = React.useState('');
  return (
    <div
      className="rounded-2xl border border-amber-200 bg-amber-50/30 p-5 shadow-sm"
      data-testid={`generic-card-${submission.id}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <CircleAlert className="h-4 w-4 text-amber-600" />
        <p className="text-sm font-bold text-amber-900">
          Unknown targetType: {submission.targetType}
        </p>
      </div>
      <p className="text-xs text-amber-700 mb-3">
        No card renderer registered for this submission type. Showing raw payload — the
        corresponding phase has not landed yet.
      </p>
      <pre className="text-xs font-mono bg-white border border-amber-200 rounded-lg p-2.5 overflow-x-auto mb-3">
        {JSON.stringify(submission.payload, null, 2)}
      </pre>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (optional)"
        rows={2}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 mb-3"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isReviewing}
          onClick={() => onAccept(comment)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={isReviewing}
          onClick={() => onReject(comment)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-700 hover:text-rose-600 hover:border-rose-200 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

export function PendingReviewStep({ engagementId }: PendingReviewStepProps) {
  const qc = useQueryClient();
  const { data: submissions, isLoading } = useQuery({
    queryKey: ['pending-submissions', engagementId],
    queryFn: () =>
      engagementsApi.listPendingSubmissions(engagementId) as Promise<PendingSubmissionRow[]>,
    enabled: !!engagementId,
    staleTime: 30_000,
  });

  const acceptMut = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      engagementsApi.acceptPendingSubmission(engagementId, id, comment.trim() || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-submissions', engagementId] });
      // Phase 29 — accepting a WIZARD_ANSWER mutates BusinessProfile,
      // so refresh the wizard's profile/conflicts query too.
      qc.invalidateQueries({ queryKey: ['profile', engagementId] });
      qc.invalidateQueries({ queryKey: ['conflicts', engagementId] });
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      engagementsApi.rejectPendingSubmission(engagementId, id, comment.trim() || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-submissions', engagementId] });
    },
  });

  const isReviewing = acceptMut.isPending || rejectMut.isPending;
  const list: PendingSubmissionRow[] = Array.isArray(submissions) ? submissions : [];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-2 flex items-center gap-2">
          <Inbox className="h-6 w-6 text-brand-600" />
          Pending Review
          {list.length > 0 && (
            <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 tabular-nums">
              {list.length}
            </span>
          )}
        </h1>
        <p className="text-sm text-slate-500">
          Items submitted by clients via the portal land here for your review. Per §5.1 of the
          feature brief, a submission becomes the engagement&apos;s source of truth only once you
          explicitly accept it (with an optional comment); rejected items are never adopted.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full mx-auto" />
          <p className="mt-3 text-sm text-slate-500">Loading review queue&hellip;</p>
        </div>
      ) : list.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center"
          data-testid="pending-review-empty-state"
        >
          <div className="mx-auto w-14 h-14 rounded-full bg-slate-50 flex items-center justify-center mb-4">
            <Inbox className="h-7 w-7 text-slate-400" />
          </div>
          <p className="text-base font-semibold text-slate-700 mb-2">No pending submissions</p>
          <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
            Clients can submit wizard answers and upload data files from the portal once the
            consultant allowlists questions / sends data templates. Phase 31 will add Q&amp;A
            messaging.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 text-[11px] text-slate-400">
            <Clock className="h-3.5 w-3.5" />
            Coming next: Phase 31 &mdash; two-way Q&amp;A messaging
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((sub) => {
            const Card = getCardRenderer(sub.targetType);
            const RenderComp = Card ?? GenericFallbackCard;
            return (
              <RenderComp
                key={sub.id}
                submission={sub}
                isReviewing={isReviewing}
                onAccept={(comment) => acceptMut.mutate({ id: sub.id, comment })}
                onReject={(comment) => rejectMut.mutate({ id: sub.id, comment })}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
