import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Send, MessageCircle } from 'lucide-react';
import { portalApi } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * PortalClientQuestions (Phase 29).
 *
 * Renders the "Questions for you" section on the client portal page.
 * The list of allowlisted/unanswered questions comes from
 * GET /engagements/portal/:token/questions; submitting an answer
 * POSTs to /portal/submissions with targetType: 'WIZARD_ANSWER'.
 *
 * Per-inputType controls (BOOLEAN / SINGLE_SELECT / MULTI_SELECT /
 * TEXT / TEXTAREA / NUMBER / DATE / TABLE-as-textarea). After submit,
 * the question card collapses to "Submitted — awaiting consultant
 * review"; on consultant accept, the question disappears from the
 * list (server-side filter); on reject, it reappears so the client
 * can re-submit.
 */

interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

interface PortalQuestion {
  id: string;
  flow: string;
  section: string;
  inputType:
    | 'BOOLEAN'
    | 'SINGLE_SELECT'
    | 'MULTI_SELECT'
    | 'TEXT'
    | 'TEXTAREA'
    | 'NUMBER'
    | 'DATE'
    | 'TABLE';
  label: string;
  helpTitle?: string;
  helpBody?: string;
  exampleText?: string;
  options?: QuestionOption[];
  required?: boolean;
}

interface PortalClientQuestionsProps {
  token: string;
  authenticated: boolean;
}

export function PortalClientQuestions({ token, authenticated }: PortalClientQuestionsProps) {
  const qc = useQueryClient();

  // Only fetch when the visitor has a portal session — otherwise the
  // server returns 401 and the section just stays hidden.
  const { data: questions, isLoading } = useQuery({
    queryKey: ['portal-questions', token],
    queryFn: () => portalApi.listPendingQuestions(token) as Promise<PortalQuestion[]>,
    enabled: !!token && authenticated,
    retry: false,
  });

  const submitMut = useMutation({
    mutationFn: ({ questionId, answer }: { questionId: string; answer: unknown }) =>
      portalApi.submitWizardAnswer(questionId, answer),
    onSuccess: () => {
      // Refetch — the question with the in-flight submission now has a
      // PENDING row and the server-side filter will drop it from the next
      // GET response.
      qc.invalidateQueries({ queryKey: ['portal-questions', token] });
    },
  });

  // Pre-auth or zero-questions state: render nothing. The section
  // wrapper in ClientPortalPage decides whether to render at all based
  // on this component returning a non-null DOM.
  if (!authenticated) return null;
  if (isLoading) return null;
  const list = questions ?? [];
  if (list.length === 0) return null;

  return (
    <div
      className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
      data-testid="portal-client-questions"
    >
      <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
          <MessageCircle className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-gray-900">Questions for you</h2>
        </div>
        <span
          className="text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full"
          data-testid="portal-client-questions-count"
        >
          {list.length} pending
        </span>
      </div>
      <div className="p-6">
        <p className="text-xs text-gray-400 mb-4 bg-blue-50/40 rounded-lg px-3 py-2 border border-blue-100/70">
          Your consultant has flagged the questions below for you to answer. Submissions are
          reviewed before they become part of the design — you can re-submit if a previous answer
          was rejected.
        </p>
        <div className="space-y-3">
          {list.map((q) => (
            <PortalQuestionCard
              key={q.id}
              question={q}
              isSubmitting={submitMut.isPending}
              onSubmit={(answer) => submitMut.mutate({ questionId: q.id, answer })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Single question card ────────────────────────────────────────────────────

function PortalQuestionCard({
  question,
  onSubmit,
  isSubmitting,
}: {
  question: PortalQuestion;
  onSubmit: (answer: unknown) => void;
  isSubmitting: boolean;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [answer, setAnswer] = useState<unknown>(initialFor(question.inputType));

  const handleSubmit = () => {
    onSubmit(answer);
    setSubmitted(true);
  };

  return (
    <div
      className={cn(
        'rounded-2xl border bg-white p-4 transition-colors',
        submitted ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-100',
      )}
      data-testid={`portal-question-${question.id}`}
    >
      <div className="flex items-start gap-2 mb-2">
        <MessageCircle className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            {question.flow} · {question.section}
          </p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">{question.label}</p>
          {question.helpBody && (
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{question.helpBody}</p>
          )}
        </div>
      </div>

      {submitted ? (
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 mt-3">
          <CircleCheck className="h-3.5 w-3.5" />
          Submitted — awaiting consultant review
        </div>
      ) : (
        <div className="mt-3">
          <QuestionInput question={question} value={answer} onChange={setAnswer} />
          <div className="flex justify-end mt-3">
            <button
              type="button"
              disabled={isSubmitting || isAnswerEmpty(answer, question.inputType)}
              onClick={handleSubmit}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
                'bg-blue-600 text-white hover:bg-blue-700',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              data-testid={`portal-question-submit-${question.id}`}
            >
              <Send className="h-3.5 w-3.5" />
              Submit answer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Per-inputType input control ─────────────────────────────────────────────

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: PortalQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (question.inputType) {
    case 'BOOLEAN':
      return (
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          {[true, false].map((v) => (
            <button
              type="button"
              key={String(v)}
              onClick={() => onChange(v)}
              className={cn(
                'px-4 py-2 text-sm font-semibold transition-colors',
                value === v
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {v ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      );

    case 'SINGLE_SELECT':
      return (
        <div className="space-y-1.5">
          {(question.options ?? []).map((opt) => (
            <label
              key={opt.value}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-2.5 cursor-pointer transition-colors',
                value === opt.value
                  ? 'border-blue-500 bg-blue-50/50'
                  : 'border-gray-200 bg-white hover:border-blue-300',
              )}
            >
              <input
                type="radio"
                name={`q-${question.id}`}
                checked={value === opt.value}
                onChange={() => onChange(opt.value)}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-slate-800">{opt.label}</p>
                {opt.description && (
                  <p className="text-xs text-slate-500 mt-0.5">{opt.description}</p>
                )}
              </div>
            </label>
          ))}
        </div>
      );

    case 'MULTI_SELECT': {
      const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-1.5">
          {(question.options ?? []).map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-2.5 cursor-pointer transition-colors',
                  checked ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 bg-white hover:border-blue-300',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...selected, opt.value]);
                    else onChange(selected.filter((v) => v !== opt.value));
                  }}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-slate-800">{opt.label}</p>
                  {opt.description && (
                    <p className="text-xs text-slate-500 mt-0.5">{opt.description}</p>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      );
    }

    case 'TEXTAREA':
    case 'TABLE':
      // TABLE rendering is intentionally textarea-as-list per Phase 29
      // design — full table editing stays consultant-side. The
      // consultant can refine the structure during review.
      return (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          placeholder={
            question.inputType === 'TABLE'
              ? 'One item per line — your consultant will refine this during review.'
              : 'Your answer'
          }
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
      );

    case 'NUMBER':
      return (
        <input
          type="number"
          value={typeof value === 'number' ? value : (value === '' ? '' : value as number)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="w-48 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
      );

    case 'DATE':
      return (
        <input
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-48 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
      );

    case 'TEXT':
    default:
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
      );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initialFor(inputType: PortalQuestion['inputType']): unknown {
  if (inputType === 'BOOLEAN') return null;
  if (inputType === 'MULTI_SELECT') return [];
  if (inputType === 'NUMBER') return '';
  return '';
}

function isAnswerEmpty(value: unknown, inputType: PortalQuestion['inputType']): boolean {
  if (value === null || value === undefined) return true;
  if (inputType === 'MULTI_SELECT') return !Array.isArray(value) || value.length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  if (typeof value === 'number') return Number.isNaN(value);
  return false;
}
