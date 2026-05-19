import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, Check, ChevronLeft, Loader2, Save, Sparkles, Share2,
  CheckCircle2, AlertTriangle,
} from 'lucide-react';
import {
  discoveryLiteApi,
  isDiscoveryLiteAnswerValid,
  discoveryLiteProgressPct,
  type DiscoveryLiteQuestion,
  type DiscoveryLiteResponse,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  PermissionDeniedState,
  extractPermissionDenied,
} from '@/components/rbac/PermissionDeniedState';

/**
 * Phase 46.8.1 — Discovery Lite consultant wizard.
 *
 * Multi-step form rendering the 14 questions returned by the API.
 * One question per step + progress bar; auto-saves the current answer
 * 600ms after the operator stops typing. Submit calls /complete
 * which 409s with missingFields when something required is empty —
 * we surface that in the UI rather than guessing client-side.
 *
 * Visibility rules + edit RBAC are enforced server-side:
 *   - SALES_REP can edit own engagements (Phase 44.1 visibility scope)
 *   - SALES_MANAGER + APP_ADMIN can edit any
 *   - Anyone else gets 403 → PermissionDeniedState
 */

const AUTOSAVE_DEBOUNCE_MS = 600;

export function SalesDiscoveryLitePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const engagementId = id ?? '';
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [completionBanner, setCompletionBanner] = useState(false);
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedAnswers = useRef<Record<string, unknown>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['discovery-lite', engagementId],
    queryFn: () => discoveryLiteApi.get(engagementId),
    enabled: !!engagementId,
    retry: (count, err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) return false;
      return count < 3;
    },
  });

  // Hydrate local state from server once.
  useEffect(() => {
    if (data?.record.answers) {
      setAnswers(data.record.answers);
      lastSavedAnswers.current = data.record.answers;
    }
  }, [data?.record.answers]);

  // Wrap in useMemo so the array reference is stable across renders —
  // otherwise downstream useMemo deps recompute every render.
  const questions: ReadonlyArray<DiscoveryLiteQuestion> = useMemo(
    () => data?.questions ?? [],
    [data?.questions],
  );
  const totalSteps = questions.length;
  const currentQuestion = questions[stepIndex];
  const progressPct = useMemo(
    () => discoveryLiteProgressPct(questions, answers),
    [questions, answers],
  );

  const completed = !!data?.record.completedAt;

  const putMutation = useMutation({
    mutationFn: (next: Record<string, unknown>) => discoveryLiteApi.put(engagementId, next),
    onMutate: () => setAutoSaveState('saving'),
    onSuccess: (_record, variables) => {
      lastSavedAnswers.current = variables;
      setAutoSaveState('saved');
    },
    onError: () => setAutoSaveState('error'),
  });

  const completeMutation = useMutation({
    mutationFn: () => discoveryLiteApi.complete(engagementId),
    onSuccess: () => {
      setMissingFields([]);
      setCompletionBanner(true);
      qc.invalidateQueries({ queryKey: ['discovery-lite', engagementId] });
      qc.invalidateQueries({ queryKey: ['sales-pipeline'] });
      // Brief banner flash, then bounce to pipeline.
      setTimeout(() => navigate('/reports?tab=pipeline'), 1500);
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: { error?: { missingFields?: string[] } } } })
        ?.response?.data;
      const missing = data?.error?.missingFields ?? [];
      setMissingFields(missing);
      // Jump to the first missing question for the operator.
      if (missing.length > 0) {
        const idx = questions.findIndex((q) => q.id === missing[0]);
        if (idx >= 0) setStepIndex(idx);
      }
    },
  });

  // Debounced autosave on answer changes.
  useEffect(() => {
    if (!engagementId) return;
    if (Object.keys(answers).length === 0) return;
    // Skip save when answers match the last persisted snapshot — avoids
    // a redundant write when the hydration effect re-seeds local state.
    if (shallowEqual(answers, lastSavedAnswers.current)) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      putMutation.mutate(answers);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, engagementId]);

  const denied = extractPermissionDenied(error);
  if (denied) {
    return (
      <PermissionDeniedState
        requiredRole={denied.requiredRole}
        verb="edit"
        resourceLabel="this prospect's Discovery Lite"
      />
    );
  }

  if (!engagementId) {
    return <p className="p-8 text-sm text-slate-500">Missing prospect id.</p>;
  }
  if (isLoading || !data) {
    return (
      <div className="p-12 flex items-center justify-center text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading Discovery Lite…
      </div>
    );
  }

  function setAnswer(qid: string, value: unknown): void {
    setAnswers((a) => ({ ...a, [qid]: value }));
  }

  function flushAndAdvance(): void {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    putMutation.mutate(answers);
    setStepIndex((i) => Math.min(i + 1, totalSteps - 1));
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-5">
          <Link
            to="/reports?tab=pipeline"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-3"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to pipeline
          </Link>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-5 w-5 text-violet-600" />
            <h1 className="text-2xl font-bold text-slate-900">Discovery Lite</h1>
          </div>
          <p className="text-sm text-slate-500">
            Answer 14 quick questions to scope the proposal. Your answers carry forward to the
            full Discovery wizard once the engagement is signed.
          </p>
        </div>

        {/* Completion banner */}
        {completionBanner && (
          <div
            className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3"
            data-testid="discovery-lite-complete-banner"
          >
            <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-900">Discovery Lite complete</p>
              <p className="text-xs text-emerald-700 mt-0.5">Returning you to the pipeline…</p>
            </div>
          </div>
        )}

        {/* Already-complete state */}
        {completed && !completionBanner && (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 flex items-center gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            Submitted on{' '}
            {new Date(data.record.completedAt as string).toLocaleString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
            . Answers below are read-only — edit by reopening from the prospect card.
          </div>
        )}

        {/* Progress + autosave indicator */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-sm font-semibold text-slate-700">
              Step {Math.min(stepIndex + 1, totalSteps)} of {totalSteps}
            </p>
            <AutoSaveIndicator state={autoSaveState} />
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-1">
            <div
              className="h-full bg-gradient-to-r from-violet-400 to-violet-600 transition-all"
              style={{ width: `${progressPct}%` }}
              data-testid="discovery-lite-progress-bar"
            />
          </div>
          <p className="text-[11px] text-slate-400 tabular-nums">{progressPct}% answered</p>
        </div>

        {/* Question card */}
        {currentQuestion && (
          <QuestionCard
            question={currentQuestion}
            value={answers[currentQuestion.id]}
            onChange={(v) => setAnswer(currentQuestion.id, v)}
            highlightMissing={missingFields.includes(currentQuestion.id)}
            readOnly={completed}
          />
        )}

        {/* Missing fields callout (after a Submit attempt) */}
        {missingFields.length > 0 && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold">A few required answers are still missing.</p>
              <ul className="text-xs mt-1 list-disc pl-4">
                {missingFields.map((id) => (
                  <li key={id}>{questions.find((q) => q.id === id)?.label ?? id}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Footer nav */}
        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={stepIndex === 0}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            data-testid="discovery-lite-prev"
          >
            <ArrowLeft className="h-4 w-4" />
            Previous
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => putMutation.mutate(answers)}
              disabled={putMutation.isPending || completed}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
              data-testid="discovery-lite-save-draft"
            >
              <Save className="h-4 w-4" />
              Save draft
            </button>
            {stepIndex < totalSteps - 1 ? (
              <button
                type="button"
                onClick={flushAndAdvance}
                disabled={!currentQuestion || (currentQuestion.required && !isDiscoveryLiteAnswerValid(currentQuestion, answers[currentQuestion.id]))}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-40"
                data-testid="discovery-lite-next"
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending || completed}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40"
                data-testid="discovery-lite-submit"
              >
                {completeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Submit
              </button>
            )}
          </div>
        </div>

        {/* Share link control */}
        {!completed && (
          <ShareLinkPanel
            engagementId={engagementId}
            currentToken={data.record.shareToken}
            currentExpiresAt={data.record.shareTokenExpiresAt}
            onChanged={() => qc.invalidateQueries({ queryKey: ['discovery-lite', engagementId] })}
          />
        )}
      </div>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

interface QuestionCardProps {
  question: DiscoveryLiteQuestion;
  value: unknown;
  onChange: (v: unknown) => void;
  highlightMissing: boolean;
  readOnly: boolean;
}

function QuestionCard({ question, value, onChange, highlightMissing, readOnly }: QuestionCardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-2xl border p-5',
        highlightMissing ? 'border-amber-300 ring-2 ring-amber-200/60' : 'border-slate-200',
      )}
      data-testid={`discovery-lite-question-${question.id}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{question.label}</h2>
          {question.helpText && (
            <p className="text-xs text-slate-500 mt-0.5">{question.helpText}</p>
          )}
        </div>
        {question.required && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 flex-shrink-0">
            Required
          </span>
        )}
      </div>

      <div className="mt-3">
        <QuestionInput question={question} value={value} onChange={onChange} disabled={readOnly} />
      </div>
    </div>
  );
}

interface QuestionInputProps {
  question: DiscoveryLiteQuestion;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}

export function QuestionInput({ question, value, onChange, disabled }: QuestionInputProps) {
  switch (question.type) {
    case 'text':
      return (
        <input
          type="text"
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:bg-slate-50 disabled:text-slate-500"
          data-testid={`discovery-lite-input-${question.id}`}
        />
      );
    case 'long_text':
      return (
        <textarea
          disabled={disabled}
          rows={4}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:bg-slate-50 disabled:text-slate-500"
          data-testid={`discovery-lite-input-${question.id}`}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          disabled={disabled}
          min={question.min}
          max={question.max}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? null : Number(v));
          }}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:bg-slate-50 disabled:text-slate-500"
          data-testid={`discovery-lite-input-${question.id}`}
        />
      );
    case 'single_select': {
      const opts = question.options ?? [];
      return (
        <div className="space-y-1.5" data-testid={`discovery-lite-input-${question.id}`}>
          {opts.map((o) => {
            const checked = value === o.value;
            return (
              <button
                type="button"
                key={o.value}
                disabled={disabled}
                onClick={() => onChange(o.value)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors disabled:opacity-50',
                  checked
                    ? 'border-violet-300 bg-violet-50 ring-1 ring-violet-200'
                    : 'border-slate-200 hover:border-violet-200',
                )}
                aria-pressed={checked}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    case 'multi_select': {
      const opts = question.options ?? [];
      const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
      return (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
          data-testid={`discovery-lite-input-${question.id}`}
        >
          {opts.map((o) => {
            const checked = selected.has(o.value);
            return (
              <button
                type="button"
                key={o.value}
                disabled={disabled}
                onClick={() => {
                  const next = new Set(selected);
                  if (checked) next.delete(o.value);
                  else next.add(o.value);
                  onChange([...next]);
                }}
                className={cn(
                  'text-left px-3 py-2 rounded-lg border text-sm transition-colors disabled:opacity-50',
                  checked
                    ? 'border-violet-300 bg-violet-50 ring-1 ring-violet-200'
                    : 'border-slate-200 hover:border-violet-200',
                )}
                aria-pressed={checked}
              >
                <span className="inline-flex items-center gap-2">
                  <span
                    className={cn(
                      'h-3 w-3 rounded border flex items-center justify-center',
                      checked ? 'border-violet-500 bg-violet-500' : 'border-slate-300 bg-white',
                    )}
                  >
                    {checked && <Check className="h-2 w-2 text-white" />}
                  </span>
                  {o.label}
                </span>
              </button>
            );
          })}
        </div>
      );
    }
    default:
      return null;
  }
}

// ─── Self-serve share link panel ────────────────────────────────────────────

interface ShareLinkPanelProps {
  engagementId: string;
  currentToken: string | null;
  currentExpiresAt: string | null;
  onChanged: () => void;
}

function ShareLinkPanel({
  engagementId,
  currentToken,
  currentExpiresAt,
  onChanged,
}: ShareLinkPanelProps) {
  const [copied, setCopied] = useState(false);
  const mintMutation = useMutation({
    mutationFn: () => discoveryLiteApi.mintShareToken(engagementId),
    onSuccess: () => onChanged(),
  });
  const revokeMutation = useMutation({
    mutationFn: () => discoveryLiteApi.revokeShareToken(engagementId),
    onSuccess: () => onChanged(),
  });

  const shareUrl = useMemo(() => {
    if (!currentToken) return '';
    if (typeof window === 'undefined') return `/portal/discovery-lite/${currentToken}`;
    return `${window.location.origin}/portal/discovery-lite/${currentToken}`;
  }, [currentToken]);

  async function copyLink(): Promise<void> {
    if (!shareUrl) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Clipboard write can fail in browsers without permission;
      // the textarea below still lets the operator copy manually.
    }
  }

  if (!currentToken) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-white p-4 flex items-start gap-3">
        <Share2 className="h-4 w-4 text-slate-400 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-slate-700 text-sm">Want the prospect to fill this out?</p>
          <p className="text-xs text-slate-500 mt-0.5 mb-3">
            Generate a self-serve link valid for 14 days. The recipient gets a branded form
            with no login required.
          </p>
          <button
            type="button"
            onClick={() => mintMutation.mutate()}
            disabled={mintMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-40"
            data-testid="discovery-lite-mint-link"
          >
            {mintMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Share2 className="h-3.5 w-3.5" />
            )}
            Generate self-serve link
          </button>
          {mintMutation.isError && (
            <p className="text-xs text-red-600 mt-2">
              Couldn't generate the link — please try again or contact support.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex items-start gap-3 mb-3">
        <Share2 className="h-4 w-4 text-violet-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="font-semibold text-slate-800 text-sm">Self-serve link is live</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Send the prospect this link to fill the questionnaire themselves. Expires{' '}
            {currentExpiresAt
              ? new Date(currentExpiresAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
              : 'in 14 days'}
            .
          </p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          readOnly
          value={shareUrl}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          data-testid="discovery-lite-share-url"
          onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
        />
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700"
          data-testid="discovery-lite-copy-link"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={() => revokeMutation.mutate()}
          disabled={revokeMutation.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40"
          data-testid="discovery-lite-revoke-link"
        >
          Revoke
        </button>
      </div>
    </div>
  );
}

function AutoSaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
        <Check className="h-3 w-3" />
        Saved
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-red-600">
        <AlertTriangle className="h-3 w-3" />
        Save failed — try again
      </span>
    );
  }
  return null;
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const av = a[k];
    const bv = b[k];
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (av.length !== bv.length) return false;
      for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
      continue;
    }
    if (av !== bv) return false;
  }
  return true;
}

// Re-export the type so component tests can import it via the page module.
export type { DiscoveryLiteResponse };
