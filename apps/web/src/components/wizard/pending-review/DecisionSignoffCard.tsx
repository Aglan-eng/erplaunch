import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, ThumbsUp, ThumbsDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { engagementsApi } from '@/lib/api';
import {
  registerCardRenderer,
  type CardRendererProps,
} from './cardRenderers';
import { ReviewActions } from './ReviewActions';

/**
 * DecisionSignoffCard (Phase 32, final §5 phase).
 *
 * Renders a pending DECISION_SIGNOFF submission. The client either
 * signed (signed=true) or declined (signed=false) — both states are
 * visible to the consultant. Accept → flips DecisionItem to
 * SIGNED/DECLINED + dedicated ActivityLog action. Reject → flips to
 * REJECTED (rare; e.g. signature on the wrong decision).
 */

interface DecisionRow {
  id: string;
  title?: string;
  context?: string;
  decision?: string;
  rationale?: string;
}

function DecisionSignoffCard({ submission, onAccept, onReject, isReviewing }: CardRendererProps) {
  const payload = submission.payload as {
    decisionItemId?: string;
    signed?: boolean;
    comment?: string;
  };
  const isSigned = payload.signed === true;

  // Phase 41.2 — hydrate the referenced decision so the consultant
  // sees the title + body, not just the UUID. The audit flagged this
  // as the single biggest demo blocker: it was impossible to make an
  // informed accept/reject without leaving the page to look up the
  // decision elsewhere.
  //
  // Query reuses the same `decisions` queryKey other parts of the
  // wizard already populate, so cache hits are common.
  const { data: decisions } = useQuery<DecisionRow[]>({
    queryKey: ['decisions', submission.engagementId],
    queryFn: () => engagementsApi.listDecisions(submission.engagementId) as Promise<DecisionRow[]>,
    enabled: !!submission.engagementId && !!payload.decisionItemId,
    staleTime: 60_000,
  });
  const decision = decisions?.find((d) => d.id === payload.decisionItemId);

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      data-testid={`decision-signoff-card-${submission.id}`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <FileSignature className="h-3 w-3" />
            Decision sign-off
            <span
              className={cn(
                'ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1',
                isSigned ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700',
              )}
            >
              {isSigned ? (
                <>
                  <ThumbsUp className="h-2.5 w-2.5" />
                  SIGNED
                </>
              ) : (
                <>
                  <ThumbsDown className="h-2.5 w-2.5" />
                  DECLINED
                </>
              )}
            </span>
          </p>
          <p className="mt-0.5 text-sm font-bold text-slate-900">
            {submission.memberName ?? 'Client'}{' '}
            <span className="font-normal text-slate-500">
              {isSigned ? 'signed off on a decision' : 'declined to sign a decision'}
            </span>
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {new Date(submission.createdAt).toLocaleString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
      </div>

      {/* Decision reference — Phase 41.2 hydrates the title/body so
          the consultant doesn't have to leave the page to evaluate
          the sign-off. Falls back to the UUID display when the lookup
          fails (decision deleted, query error, etc.) so the card
          never renders empty. */}
      <div className="rounded-xl bg-slate-50/70 border border-slate-100 p-4 mb-4" data-testid={`decision-signoff-decision-${submission.id}`}>
        {decision ? (
          <>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Decision
            </p>
            <p className="text-sm font-bold text-slate-900 mb-2">{decision.title ?? '(untitled)'}</p>
            {decision.context && decision.context.trim().length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Context</p>
                <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed mb-2">{decision.context}</p>
              </>
            )}
            {decision.decision && decision.decision.trim().length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Decision</p>
                <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed mb-2">{decision.decision}</p>
              </>
            )}
            {decision.rationale && decision.rationale.trim().length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Rationale</p>
                <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{decision.rationale}</p>
              </>
            )}
          </>
        ) : (
          <>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Decision ID
            </p>
            <p className="text-xs font-mono text-slate-700">{payload.decisionItemId ?? '(unknown)'}</p>
            <p className="text-[11px] text-slate-400 mt-1 italic">
              Decision details unavailable — the decision may have been removed since the client signed.
            </p>
          </>
        )}

        {payload.comment && payload.comment.trim().length > 0 && (
          <>
            <hr className="my-3 border-slate-200" />
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Client comment
            </p>
            <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
              {payload.comment}
            </p>
          </>
        )}
      </div>

      <ReviewActions
        submissionId={submission.id}
        testIdPrefix="decision-signoff"
        isReviewing={isReviewing}
        onAccept={onAccept}
        onReject={onReject}
      />
    </div>
  );
}

registerCardRenderer('DECISION_SIGNOFF', DecisionSignoffCard);

export default DecisionSignoffCard;
