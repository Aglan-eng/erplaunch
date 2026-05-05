import React, { useMemo, useState } from 'react';
import { Check, X, MessageSquare } from 'lucide-react';
import { allQuestions } from '@ofoq/shared';
import { cn } from '@/lib/utils';
import {
  registerCardRenderer,
  type CardRendererProps,
} from './cardRenderers';

/**
 * WizardAnswerCard (Phase 29).
 *
 * Renders a pending WIZARD_ANSWER submission with full question context
 * (label, helpBody, expected inputType) and Accept/Reject buttons that
 * thread the optional comment back to the parent mutation.
 *
 * Design choices:
 *   - Question metadata comes from `@ofoq/shared` allQuestions, so the
 *     consultant sees what the client was asked, not just the raw
 *     answer value.
 *   - Answer is formatted per inputType: BOOLEAN → Yes/No pill,
 *     SINGLE_SELECT → option label, MULTI_SELECT → comma-separated
 *     option labels, TEXTAREA → pre-wrapped block, etc.
 *   - Comment is optional. Per §5.1 the consultant SHOULD comment, but
 *     forcing it would create UX friction on routine accepts.
 */

interface QuestionLite {
  id: string;
  flow: string;
  section: string;
  inputType: string;
  label: string;
  helpBody?: string;
  options?: Array<{ value: string; label: string; description?: string }>;
}

function findQuestionById(id: string): QuestionLite | undefined {
  // Cheap linear scan over ~300 questions — runs once per card on render,
  // and the card list rarely exceeds a handful at any time. Pre-building
  // a Map would micro-optimize but adds module-load cost no one needs.
  return (allQuestions as QuestionLite[]).find((q) => q.id === id);
}

function formatAnswer(answer: unknown, q: QuestionLite | undefined): string {
  if (answer === null || answer === undefined) return '—';
  if (q?.inputType === 'BOOLEAN') return answer === true ? 'Yes' : answer === false ? 'No' : '—';
  if (q?.inputType === 'SINGLE_SELECT' && q.options) {
    return q.options.find((o) => o.value === answer)?.label ?? String(answer);
  }
  if (q?.inputType === 'MULTI_SELECT' && Array.isArray(answer)) {
    if (answer.length === 0) return 'None selected';
    return answer
      .map((v) => q.options?.find((o) => o.value === v)?.label ?? String(v))
      .join(', ');
  }
  if (typeof answer === 'object') return JSON.stringify(answer, null, 2);
  return String(answer);
}

function WizardAnswerCard({ submission, onAccept, onReject, isReviewing }: CardRendererProps) {
  const [comment, setComment] = useState('');
  const payload = submission.payload as { questionId?: string; answer?: unknown };
  const question = useMemo(
    () => (typeof payload.questionId === 'string' ? findQuestionById(payload.questionId) : undefined),
    [payload.questionId],
  );

  const formattedAnswer = useMemo(() => formatAnswer(payload.answer, question), [payload.answer, question]);
  const isComplexAnswer = typeof payload.answer === 'object' && payload.answer !== null;

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      data-testid={`wizard-answer-card-${submission.id}`}
    >
      {/* Header: who + when */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Wizard answer
            {question && (
              <>
                <span className="mx-1.5 text-slate-300">·</span>
                <span className="text-slate-500">
                  {question.flow} / {question.section}
                </span>
              </>
            )}
          </p>
          <p className="mt-0.5 text-sm font-bold text-slate-900">
            {submission.memberName ?? 'Client'}{' '}
            <span className="font-normal text-slate-500">submitted an answer</span>
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {new Date(submission.createdAt).toLocaleString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
      </div>

      {/* Question + answer */}
      {question ? (
        <div className="rounded-xl bg-slate-50/70 border border-slate-100 p-4 mb-4">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Question
          </p>
          <p className="text-sm font-semibold text-slate-800 mb-2">{question.label}</p>
          {question.helpBody && (
            <p className="text-xs text-slate-500 leading-relaxed mb-3">{question.helpBody}</p>
          )}
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Client answer
          </p>
          {isComplexAnswer ? (
            <pre className="text-xs font-mono bg-white border border-slate-200 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-words">
              {formattedAnswer}
            </pre>
          ) : (
            <p className="text-sm font-medium text-slate-900 whitespace-pre-wrap">{formattedAnswer}</p>
          )}
        </div>
      ) : (
        // Defensive — question may have been removed from the bank since
        // submission time. Show the raw payload + an explanatory note.
        <div className="rounded-xl bg-amber-50/60 border border-amber-200 p-4 mb-4">
          <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider mb-1">
            Unknown question
          </p>
          <p className="text-xs text-amber-700 mb-2">
            Question ID <code className="font-mono">{String(payload.questionId)}</code> is not in the
            current question bank. The client submitted an answer that no longer maps to a known wizard
            slot — review carefully before accepting.
          </p>
          <pre className="text-xs font-mono bg-white border border-amber-200 rounded-lg p-2.5 overflow-x-auto">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      )}

      {/* Comment */}
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
        <MessageSquare className="inline h-3 w-3 mr-1" />
        Comment (optional)
      </label>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional — visible to client in the audit log"
        rows={2}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow mb-3"
        data-testid={`wizard-answer-comment-${submission.id}`}
      />

      {/* Actions */}
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
          data-testid={`wizard-answer-accept-${submission.id}`}
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
          data-testid={`wizard-answer-reject-${submission.id}`}
        >
          <X className="h-3.5 w-3.5" />
          Reject
        </button>
      </div>
    </div>
  );
}

// Register at module-load so PendingReviewStep finds the renderer when
// the user lands on the surface. Side-effect import in WizardShell drives
// the registration chain; see Phase 30+ for the same pattern per type.
registerCardRenderer('WIZARD_ANSWER', WizardAnswerCard);

export default WizardAnswerCard;
