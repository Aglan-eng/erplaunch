import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, AlertTriangle, Loader2, Sparkles,
} from 'lucide-react';
import {
  discoveryLiteApi,
  isDiscoveryLiteAnswerValid,
  discoveryLiteProgressPct,
  type DiscoveryLiteQuestion,
} from '@/lib/api';
import { QuestionInput } from './SalesDiscoveryLitePage';
import {
  PortalBrandedHeader,
  getPortalBrandingStyle,
  type FirmBranding,
} from '@/components/portal/PortalBrandedHeader';

// Phase 48.4 — fall back to ERPLaunch defaults when the firm hasn't
// configured branding yet. Mirrors ClientPortalPage's pattern so the
// portal experience is consistent across self-serve flows.
const DEFAULT_PORTAL_BRANDING: FirmBranding = {
  displayName: 'ERPLaunch',
  logoUrl: null,
  primaryColor: '#7c3aed',
  secondaryColor: '#a78bfa',
  supportEmail: null,
};

/**
 * Phase 46.8.2 — Discovery Lite client self-serve portal.
 *
 * Mirrors Phase 46.8.1's consultant wizard but is keyed by an opaque
 * share token instead of an authenticated session. The token = auth;
 * the same UI affordances apply (one question per step, debounced
 * autosave, progress bar) with two differences:
 *
 *   1. No "Skip" button — the prospect's contact is filling this for
 *      the first time, so we want them to actually answer required
 *      questions. Submit is disabled until everything required is
 *      filled (the consultant version surfaces missing fields after
 *      the fact because they may already have draft answers).
 *
 *   2. Brand-light header — we don't have full firm branding plumbed
 *      through the public token endpoint yet (a subset of
 *      Phase 27 white-label propagation can land in a later sweep).
 *      For now we use the firm-name-less "Discovery Lite" header
 *      with a friendly "for <ClientName>" prefix from the GET
 *      response.
 *
 * After the prospect submits, the page swaps to a "thanks" confirmation
 * state with a note about next steps.
 */

const AUTOSAVE_DEBOUNCE_MS = 600;

export function PortalDiscoveryLitePage() {
  const { token } = useParams<{ token: string }>();
  const safeToken = token ?? '';
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedAnswers = useRef<Record<string, unknown>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal-discovery-lite', safeToken],
    queryFn: () => discoveryLiteApi.getByToken(safeToken),
    enabled: !!safeToken,
    retry: (count, err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 410) return false;
      return count < 3;
    },
  });

  useEffect(() => {
    if (data?.answers) {
      setAnswers(data.answers);
      lastSavedAnswers.current = data.answers;
    }
    if (data?.completedAt) {
      setSubmittedAt(data.completedAt);
    }
  }, [data?.answers, data?.completedAt]);

  // Wrap in useMemo so the array reference is stable across renders —
  // otherwise downstream useMemo deps below recompute every render.
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

  // Predicate: every required question has a valid answer.
  const allRequiredFilled = useMemo(() => {
    if (questions.length === 0) return false;
    return questions
      .filter((q) => q.required)
      .every((q) => isDiscoveryLiteAnswerValid(q, answers[q.id]));
  }, [questions, answers]);

  const putMutation = useMutation({
    mutationFn: (next: Record<string, unknown>) => discoveryLiteApi.putByToken(safeToken, next),
    onMutate: () => setAutoSaveState('saving'),
    onSuccess: (_resp, variables) => {
      lastSavedAnswers.current = variables;
      setAutoSaveState('saved');
    },
    onError: () => setAutoSaveState('error'),
  });

  const completeMutation = useMutation({
    // Phase 48.3 — flush any pending autosave BEFORE marking complete
    // so the very last answer the prospect typed isn't lost.
    // completeByToken on the backend resolves against whatever was
    // last saved, not the in-memory React state, so this PUT must
    // succeed before the POST fires.
    mutationFn: async () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!shallowEqual(answers, lastSavedAnswers.current)) {
        await discoveryLiteApi.putByToken(safeToken, answers);
        lastSavedAnswers.current = answers;
      }
      return discoveryLiteApi.completeByToken(safeToken);
    },
    onSuccess: (resp) => setSubmittedAt(resp.completedAt),
  });

  // Debounced autosave on answer changes.
  useEffect(() => {
    if (!safeToken || submittedAt) return;
    if (Object.keys(answers).length === 0) return;
    if (shallowEqual(answers, lastSavedAnswers.current)) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      putMutation.mutate(answers);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, safeToken, submittedAt]);

  // Error states ────────────────────────────────────────────────────────────
  if (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 410) {
      return (
        <PortalErrorScreen
          title="This link has expired"
          body="Self-serve Discovery Lite links are valid for 14 days. Please ask your project lead to send a fresh one."
        />
      );
    }
    if (status === 404) {
      return (
        <PortalErrorScreen
          title="This link isn't valid"
          body="Double-check the link from your email. If the issue persists, contact your project lead."
        />
      );
    }
    return (
      <PortalErrorScreen
        title="Something went wrong"
        body="Try refreshing the page. If it keeps failing, get in touch with your project lead."
      />
    );
  }

  if (!safeToken) {
    return <PortalErrorScreen title="Missing link token" body="The URL is incomplete." />;
  }
  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  if (submittedAt) {
    // Phase 48.4 — branded confirmation screen. Names the sales rep
    // when known so the prospect knows who to expect a call from. The
    // firm display name + colour palette mirrors the wizard so the
    // post-submit experience doesn't feel like a different product.
    const branding: FirmBranding = data?.branding ?? DEFAULT_PORTAL_BRANDING;
    const portalStyle = getPortalBrandingStyle(branding);
    const repName = data?.salesRepName ?? null;
    const followUpName = repName ?? branding.displayName;
    return (
      <div
        className="min-h-screen bg-gradient-to-b from-slate-50 to-white"
        style={portalStyle}
        data-testid="portal-discovery-lite-thanks"
      >
        <div className="h-1 w-full bg-gradient-to-r from-[var(--portal-primary)] to-[var(--portal-secondary)]" />
        <div className="max-w-xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
          <PortalBrandedHeader
            branding={branding}
            clientName={data?.clientName ?? null}
            className="mb-8"
          />
          <div className="text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              Thanks — that's all we needed.
            </h1>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              {repName
                ? `${repName} will be in touch within 24 hours with next steps and a tailored proposal.`
                : `${followUpName} will be in touch within 24 hours with next steps and a tailored proposal.`}
            </p>
            <p className="text-xs text-slate-400 mt-6">
              Submitted{' '}
              {new Date(submittedAt).toLocaleString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  function setAnswer(qid: string, value: unknown): void {
    setAnswers((a) => ({ ...a, [qid]: value }));
  }

  // Phase 48.3 — flush the autosave debounce BEFORE advancing the
  // step. Without this, a prospect who types an answer and clicks
  // "Next" within the 600ms debounce window can lose their answer:
  // the timer fires after the navigation but the closure captures
  // the stale `answers` map. Mirrors the consultant-side
  // SalesDiscoveryLitePage.flushAndAdvance fix from Phase 46.8.1.
  function flushAndAdvance(): void {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    putMutation.mutate(answers);
    setStepIndex((i) => Math.min(i + 1, totalSteps - 1));
  }

  // Phase 48.4 — branding propagation. Falls back to ERPLaunch
  // defaults when the firm hasn't configured colours yet so a fresh
  // signup still looks coherent. Inline style sets the CSS custom
  // properties used by Tailwind arbitrary-value classes below.
  const branding: FirmBranding = data.branding ?? DEFAULT_PORTAL_BRANDING;
  const portalStyle = getPortalBrandingStyle(branding);

  return (
    <div
      className="min-h-screen bg-slate-50"
      style={portalStyle}
      data-testid="portal-discovery-lite-root"
    >
      {/* Phase 48.4 — branded gradient strip + responsive container.
          max-w-2xl already capped width well; the px-4 padding +
          py-6 (was py-10) gives mobile a tighter, less-scrolled feel
          while still breathing on desktop. */}
      <div className="h-1 w-full bg-gradient-to-r from-[var(--portal-primary)] to-[var(--portal-secondary)]" />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        {/* Phase 48.4 — branded header tile + firm name. Sits above
            both the welcome card and the mini header so the prospect
            sees who's asking before the questions start. */}
        <PortalBrandedHeader
          branding={branding}
          clientName={data.clientName}
          className="mb-6"
        />

        {/* Welcome header */}
        {stepIndex === 0 && Object.keys(answers).length === 0 && (
          <div
            className="mb-6 rounded-2xl border border-slate-200 bg-gradient-to-br from-[var(--portal-primary)]/5 to-white p-5 sm:p-6"
            data-testid="portal-discovery-lite-welcome"
          >
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-5 w-5 text-[var(--portal-primary)]" />
              <h2 className="text-base font-bold text-slate-900">
                Hi {data.clientName} — {branding.displayName} wants to learn about your operations.
              </h2>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Take a few minutes to answer {totalSteps} quick questions. This usually takes about
              ten minutes. Your answers help us scope the right solution and prepare a tailored
              proposal. Your progress saves automatically.
            </p>
          </div>
        )}

        {/* Mini header (after first answer) */}
        {!(stepIndex === 0 && Object.keys(answers).length === 0) && (
          <div className="mb-4">
            <p className="text-xs uppercase tracking-wider font-bold text-[var(--portal-primary)]">
              Discovery Lite — for {data.clientName}
            </p>
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
              className="h-full bg-gradient-to-r from-[var(--portal-primary)] to-[var(--portal-secondary)] transition-all"
              style={{ width: `${progressPct}%` }}
              data-testid="portal-discovery-lite-progress-bar"
            />
          </div>
          <p className="text-[11px] text-slate-400 tabular-nums">{progressPct}% answered</p>
        </div>

        {/* Question card */}
        {currentQuestion && (
          <div
            className="bg-white rounded-2xl border border-slate-200 p-5"
            data-testid={`portal-discovery-lite-question-${currentQuestion.id}`}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{currentQuestion.label}</h2>
                {currentQuestion.helpText && (
                  <p className="text-xs text-slate-500 mt-0.5">{currentQuestion.helpText}</p>
                )}
              </div>
              {currentQuestion.required && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 flex-shrink-0">
                  Required
                </span>
              )}
            </div>
            <div className="mt-3">
              <QuestionInput
                question={currentQuestion}
                value={answers[currentQuestion.id]}
                onChange={(v) => setAnswer(currentQuestion.id, v)}
              />
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
            data-testid="portal-discovery-lite-prev"
          >
            <ArrowLeft className="h-4 w-4" />
            Previous
          </button>
          {stepIndex < totalSteps - 1 ? (
            <button
              type="button"
              onClick={flushAndAdvance}
              disabled={
                !currentQuestion ||
                (currentQuestion.required &&
                  !isDiscoveryLiteAnswerValid(currentQuestion, answers[currentQuestion.id]))
              }
              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-[var(--portal-primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40"
              data-testid="portal-discovery-lite-next"
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => completeMutation.mutate()}
              disabled={!allRequiredFilled || completeMutation.isPending}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-[var(--portal-primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40"
              data-testid="portal-discovery-lite-submit"
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

        {!allRequiredFilled && stepIndex === totalSteps - 1 && (
          <p
            className="mt-3 text-xs text-amber-700 text-right inline-flex items-center justify-end gap-1 w-full"
            data-testid="portal-discovery-lite-incomplete-note"
          >
            <AlertTriangle className="h-3 w-3" />
            Please answer the required questions before submitting.
          </p>
        )}

        {/* Footer */}
        <p className="mt-12 text-[11px] text-slate-400 text-center">
          Powered by <span className="font-semibold">ERPLaunch</span>. Your answers are
          encrypted in transit and only visible to your project team.
        </p>
      </div>
    </div>
  );
}

function PortalErrorScreen({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mb-4">
          <AlertTriangle className="h-7 w-7 text-amber-600" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900 mb-1">{title}</h1>
        <p className="text-sm text-slate-500">{body}</p>
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
        Save failed
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
