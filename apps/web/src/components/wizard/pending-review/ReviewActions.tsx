import React, { useState } from 'react';
import { Check, X, MessageSquare, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Phase 41.2 — shared accept/reject action footer for the four
 * pending-review cards.
 *
 * Replaces the four near-identical "comment textarea + Accept + Reject"
 * blocks that lived in WizardAnswerCard / DataFileCard / QaMessageCard
 * / DecisionSignoffCard. The audit found three sources of friction:
 *
 *   1. The comment textarea was always-visible and always 2 rows tall,
 *      which forced mouse travel past an empty box on every routine
 *      accept. We collapse it to a "+ Add comment" disclosure that
 *      only expands when the consultant actually wants to leave a note.
 *
 *   2. Three cards labelled the primary action "Accept", QaMessageCard
 *      labelled it "Acknowledge". Both call the same backend mutation;
 *      the verb split broke muscle memory for a consultant accepting
 *      10 submissions in a row. The label is now a prop with a sane
 *      default, and every card uses "Accept" by default.
 *
 *   3. The placeholder copy was inconsistent. Standardised to "Optional
 *      — visible to client in the audit log" so the consultant
 *      consistently knows the comment is client-visible.
 *
 * Keeping this component small + pure-render so a future "Cmd+Enter to
 * accept" keybind can layer in without refactoring the consumers.
 */

interface ReviewActionsProps {
  /** Stable id used to key the data-testid attributes (one card may
   *  render multiple ReviewActions in the future). */
  submissionId: string;
  /** Card-name prefix for testids (`wizard-answer`, `data-file`, etc.). */
  testIdPrefix: string;
  /** Override the primary button label. Defaults to "Accept" — the
   *  only special case today is QaMessageCard which used to say
   *  "Acknowledge"; we standardise on "Accept" but keep the prop so
   *  individual surfaces can override if a future card has a clearly
   *  different verb. */
  acceptLabel?: string;
  /** Set this to true while a parent mutation is in flight to disable
   *  both buttons and avoid double-click submits. */
  isReviewing: boolean;
  /** Receives the current comment text (empty string when not opened). */
  onAccept: (comment: string) => void;
  onReject: (comment: string) => void;
}

export function ReviewActions({
  submissionId,
  testIdPrefix,
  acceptLabel = 'Accept',
  isReviewing,
  onAccept,
  onReject,
}: ReviewActionsProps) {
  const [comment, setComment] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);

  return (
    <>
      {/* Comment disclosure */}
      {commentOpen ? (
        <div className="mb-3" data-testid={`${testIdPrefix}-comment-open-${submissionId}`}>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            <MessageSquare className="inline h-3 w-3 mr-1" />
            Comment (optional)
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional — visible to client in the audit log"
            rows={2}
            autoFocus
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow"
            data-testid={`${testIdPrefix}-comment-${submissionId}`}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCommentOpen(true)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 mb-3"
          data-testid={`${testIdPrefix}-comment-toggle-${submissionId}`}
        >
          <Plus className="h-3 w-3" />
          Add comment
        </button>
      )}

      {/* Accept / Reject */}
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
          data-testid={`${testIdPrefix}-accept-${submissionId}`}
        >
          <Check className="h-3.5 w-3.5" />
          {acceptLabel}
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
          data-testid={`${testIdPrefix}-reject-${submissionId}`}
        >
          <X className="h-3.5 w-3.5" />
          Reject
        </button>
      </div>
    </>
  );
}
