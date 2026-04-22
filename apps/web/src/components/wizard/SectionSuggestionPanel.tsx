import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, Loader, CircleCheck, AlertTriangle, Check, CheckCheck, X,
} from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { useWizardStore } from '@/stores/wizardStore';
import { useConflictStore } from '@/stores/conflictStore';
import { cn } from '@/lib/utils';
import type { Question } from '@ofoq/shared';

interface SectionSuggestionPanelProps {
  engagementId: string;
  sectionKey: string;
  questions: Question[];
  clientInfo?: { industry: string; companySize: string; country: string };
}

interface SuggestionData {
  suggestedAnswers: Record<string, unknown>;
  reasoning: Record<string, string>;
}

function formatValue(val: unknown): string {
  if (val === true) return 'Yes';
  if (val === false) return 'No';
  if (Array.isArray(val)) return val.join(', ');
  if (val === null || val === undefined) return '—';
  return String(val);
}

export function SectionSuggestionPanel({
  engagementId,
  sectionKey,
  questions,
  clientInfo,
}: SectionSuggestionPanelProps) {
  const queryClient = useQueryClient();
  const answers = useWizardStore((s) => s.answers);
  const mergeAnswers = useWizardStore((s) => s.mergeAnswers);
  const setConflicts = useConflictStore((s) => s.setConflicts);

  const [suggestions, setSuggestions] = useState<SuggestionData | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);

  // Count unanswered questions in this section
  const unansweredCount = questions.filter((q) => !(q.id in answers)).length;

  const fetchMutation = useMutation({
    mutationFn: () =>
      engagementsApi.suggestAnswers(engagementId, sectionKey, clientInfo ?? {
        industry: 'General',
        companySize: 'MEDIUM',
        country: 'United Arab Emirates',
      }),
    onSuccess: (data) => {
      setSuggestions(data);
      setAccepted(new Set());
      setDismissed(false);
    },
  });

  const saveMutation = useMutation({
    mutationFn: (answersToSave: Record<string, unknown>) =>
      engagementsApi.patchProfile(engagementId, answersToSave),
    onSuccess: (data) => {
      // Normalize conflicts
      const normalizedConflicts = Array.isArray(data?.conflicts)
        ? data.conflicts.map((c: Record<string, unknown>) => ({
            ...c,
            ruleId: (c.ruleId ?? c.id) as string,
          }))
        : [];
      setConflicts(normalizedConflicts);
      queryClient.invalidateQueries({ queryKey: ['profile', engagementId] });
      queryClient.refetchQueries({ queryKey: ['conflicts', engagementId] });
      queryClient.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
  });

  // Accept a single suggestion
  const acceptOne = (questionId: string) => {
    if (!suggestions) return;
    const value = suggestions.suggestedAnswers[questionId];
    mergeAnswers({ [questionId]: value });
    saveMutation.mutate({ [questionId]: value });
    setAccepted((prev) => new Set(prev).add(questionId));
  };

  // Accept all remaining suggestions
  const acceptAll = () => {
    if (!suggestions) return;
    const toAccept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(suggestions.suggestedAnswers)) {
      if (!accepted.has(key)) {
        toAccept[key] = value;
      }
    }
    if (Object.keys(toAccept).length === 0) return;
    mergeAnswers(toAccept);
    saveMutation.mutate(toAccept);
    setAccepted((prev) => {
      const next = new Set(prev);
      for (const key of Object.keys(toAccept)) next.add(key);
      return next;
    });
  };

  // Dismiss panel
  if (dismissed) return null;

  // No suggestions fetched yet — show trigger button
  if (!suggestions) {
    if (unansweredCount === 0) return null; // All questions answered

    return (
      <div className="rounded-xl bg-gradient-to-r from-violet-50 to-brand-50 border border-violet-200 p-4 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Sparkles className="h-5 w-5 text-violet-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-violet-900">
                {unansweredCount} question{unansweredCount > 1 ? 's' : ''} unanswered
              </p>
              <p className="text-xs text-violet-600 mt-0.5">
                Let AI suggest answers based on industry best practices
              </p>
            </div>
          </div>
          <button
            onClick={() => fetchMutation.mutate()}
            disabled={fetchMutation.isPending}
            className={cn(
              'flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-2 transition-colors',
              fetchMutation.isPending
                ? 'bg-violet-200 text-violet-500 cursor-wait'
                : 'bg-violet-600 text-white hover:bg-violet-700'
            )}
          >
            {fetchMutation.isPending ? (
              <>
                <Loader className="h-3.5 w-3.5 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Suggest Answers
              </>
            )}
          </button>
        </div>
        {fetchMutation.isError && (
          <p className="text-xs text-red-600 mt-2">
            Failed to generate suggestions. Please try again.
          </p>
        )}
      </div>
    );
  }

  // Suggestions loaded — show each one
  const suggestionEntries = Object.entries(suggestions.suggestedAnswers);
  const allAccepted = suggestionEntries.every(([key]) => accepted.has(key));

  if (suggestionEntries.length === 0) {
    return (
      <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <CircleCheck className="h-4 w-4 text-green-500" />
          AI has no additional suggestions for this section.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-white overflow-hidden mb-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-50 to-brand-50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" />
          <p className="text-sm font-bold text-violet-900">
            AI Suggestions ({suggestionEntries.length})
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!allAccepted && (
            <button
              onClick={acceptAll}
              disabled={saveMutation.isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-violet-600 text-white text-xs font-semibold px-2.5 py-1.5 hover:bg-violet-700 transition-colors disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Accept All
            </button>
          )}
          <button
            onClick={() => setDismissed(true)}
            className="text-violet-400 hover:text-violet-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Suggestion rows */}
      <div className="divide-y divide-violet-100">
        {suggestionEntries.map(([key, value]) => {
          const isAccepted = accepted.has(key);
          const reasoning = suggestions.reasoning[key];
          const question = questions.find((q) => q.id === key);

          return (
            <div
              key={key}
              className={cn(
                'px-4 py-3 flex items-start gap-3 transition-colors',
                isAccepted ? 'bg-green-50/50' : 'hover:bg-violet-50/30'
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800">
                  {question?.label ?? key}
                </p>
                <p className="text-sm font-medium text-gray-900 mt-1">
                  {formatValue(value)}
                </p>
                {reasoning && (
                  <p className="text-xs text-gray-500 mt-1 italic">{reasoning}</p>
                )}
              </div>
              {isAccepted ? (
                <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-green-600">
                  <CircleCheck className="h-4 w-4" />
                  Applied
                </span>
              ) : (
                <button
                  onClick={() => acceptOne(key)}
                  disabled={saveMutation.isPending}
                  className="flex-shrink-0 inline-flex items-center gap-1 rounded-lg bg-white border border-violet-200 text-violet-700 text-xs font-semibold px-2.5 py-1.5 hover:bg-violet-50 transition-colors disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  Accept
                </button>
              )}
            </div>
          );
        })}
      </div>

      {allAccepted && (
        <div className="px-4 py-3 bg-green-50 border-t border-green-200">
          <p className="text-xs font-semibold text-green-700 flex items-center gap-1.5">
            <CircleCheck className="h-4 w-4" />
            All suggestions accepted! You can still edit any answer manually.
          </p>
        </div>
      )}
    </div>
  );
}
