import React from 'react';
import { MessageCircle } from 'lucide-react';
import {
  registerCardRenderer,
  type CardRendererProps,
} from './cardRenderers';
import { ReviewActions } from './ReviewActions';

/**
 * QaMessageCard (Phase 31).
 *
 * Renders a pending QA_MESSAGE submission. Highlights whether the
 * client is starting a new thread or replying to an existing one
 * (thread subject from payload — when `threadId` is null we show the
 * NEW THREAD badge + subject; otherwise we show the inline subject is
 * derived consultant-side from the existing thread).
 */

function QaMessageCard({ submission, onAccept, onReject, isReviewing }: CardRendererProps) {
  const payload = submission.payload as {
    threadId?: string | null;
    subject?: string;
    body?: string;
  };
  const isNewThread = payload.threadId === null || payload.threadId === undefined;

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      data-testid={`qa-message-card-${submission.id}`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <MessageCircle className="h-3 w-3" />
            Q&amp;A message
            {isNewThread && (
              <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                NEW THREAD
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm font-bold text-slate-900">
            {submission.memberName ?? 'Client'}{' '}
            <span className="font-normal text-slate-500">sent a message</span>
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {new Date(submission.createdAt).toLocaleString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
      </div>

      {/* Subject (only when new thread) */}
      {isNewThread && payload.subject && (
        <div className="rounded-xl bg-violet-50/40 border border-violet-100 p-3 mb-3">
          <p className="text-[10px] font-semibold text-violet-700 uppercase tracking-wider mb-1">
            Subject
          </p>
          <p className="text-sm font-semibold text-slate-800">{payload.subject}</p>
        </div>
      )}

      {/* Message body */}
      <div className="rounded-xl bg-slate-50/70 border border-slate-100 p-4 mb-4">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          Message
        </p>
        <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
          {payload.body ?? '(empty)'}
        </p>
      </div>

      {/* Phase 41.2 — comment + actions extracted into shared
          ReviewActions. Verb standardised from "Acknowledge" to
          "Accept" for consistency with the other three card types
          (same backend mutation; the verb split was breaking muscle
          memory across the queue). */}
      <ReviewActions
        submissionId={submission.id}
        testIdPrefix="qa-message"
        isReviewing={isReviewing}
        onAccept={onAccept}
        onReject={onReject}
      />
    </div>
  );
}

registerCardRenderer('QA_MESSAGE', QaMessageCard);

export default QaMessageCard;
