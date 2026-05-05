import React, { useState } from 'react';
import { Check, X, MessageSquare, FileSignature, ThumbsUp, ThumbsDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  registerCardRenderer,
  type CardRendererProps,
} from './cardRenderers';

/**
 * DecisionSignoffCard (Phase 32, final §5 phase).
 *
 * Renders a pending DECISION_SIGNOFF submission. The client either
 * signed (signed=true) or declined (signed=false) — both states are
 * visible to the consultant. Accept → flips DecisionItem to
 * SIGNED/DECLINED + dedicated ActivityLog action. Reject → flips to
 * REJECTED (rare; e.g. signature on the wrong decision).
 */

function DecisionSignoffCard({ submission, onAccept, onReject, isReviewing }: CardRendererProps) {
  const [comment, setComment] = useState('');
  const payload = submission.payload as {
    decisionItemId?: string;
    signed?: boolean;
    comment?: string;
  };
  const isSigned = payload.signed === true;

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

      {/* Decision reference */}
      <div className="rounded-xl bg-slate-50/70 border border-slate-100 p-4 mb-4">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
          Decision ID
        </p>
        <p className="text-xs font-mono text-slate-700 mb-2">{payload.decisionItemId ?? '(unknown)'}</p>
        {payload.comment && payload.comment.trim().length > 0 && (
          <>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Client comment
            </p>
            <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
              {payload.comment}
            </p>
          </>
        )}
      </div>

      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
        <MessageSquare className="inline h-3 w-3 mr-1" />
        Comment (optional)
      </label>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional"
        rows={2}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 mb-3"
        data-testid={`decision-signoff-comment-${submission.id}`}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isReviewing}
          onClick={() => onAccept(comment)}
          className={cn(
            'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
            'bg-emerald-600 text-white hover:bg-emerald-700',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          data-testid={`decision-signoff-accept-${submission.id}`}
        >
          <Check className="h-3.5 w-3.5" />
          Accept
        </button>
        <button
          type="button"
          disabled={isReviewing}
          onClick={() => onReject(comment)}
          className={cn(
            'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
            'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-rose-600 hover:border-rose-200',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          data-testid={`decision-signoff-reject-${submission.id}`}
        >
          <X className="h-3.5 w-3.5" />
          Reject
        </button>
      </div>
    </div>
  );
}

registerCardRenderer('DECISION_SIGNOFF', DecisionSignoffCard);

export default DecisionSignoffCard;
