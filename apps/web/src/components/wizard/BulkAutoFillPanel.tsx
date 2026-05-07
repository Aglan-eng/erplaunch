import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Loader, Check, X, Wand2, CircleCheck, Square, CheckSquare } from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { useWizardStore } from '@/stores/wizardStore';
import { useConflictStore } from '@/stores/conflictStore';
import { cn } from '@/lib/utils';
import { allQuestions } from '@ofoq/shared';
import type { Question } from '@ofoq/shared';
import { bridgeAdaptorSchema } from './adaptorBridge';
import {
  acceptSuggestion,
  clearSectionSelection,
  countUnresolvedSuggestions,
  isSuggestionResolved,
  selectAllSections,
  skipSuggestion,
  toggleSectionSelection,
  type AutoFillState,
  type SectionSuggestion,
  type SuggestionMap,
} from './bulkAutoFillHelpers';

/**
 * Phase 40.5 — Bulk AI Auto-Fill panel.
 *
 * Sister to the per-section SectionSuggestionPanel: instead of one
 * section at a time, the consultant ticks the sections they want
 * auto-filled, hits "Suggest", and Claude returns answers across all
 * selected sections in parallel. Each suggestion is then accepted or
 * skipped individually — Accept commits the answer to the profile,
 * Skip just dismisses the row from the panel without persisting.
 *
 * Engagement context (risks, decisions, members) is folded into the
 * suggestion prompt server-side (see engagements.ts route + buildContextBlock
 * in aiProfileGenerator.ts) so suggestions stay consistent with the
 * constraints the team has already agreed to.
 *
 * State arithmetic (selection set, accept/skip per question) lives in
 * bulkAutoFillHelpers.ts so it's unit-tested without React.
 */

interface SectionGroup {
  flowKey: string;
  flowLabel: string;
  sections: Array<{
    key: string;
    label: string;
    totalQuestions: number;
    unanswered: number;
  }>;
}

const FLOW_LABELS: Record<string, string> = {
  r2r: 'Record to Report',
  p2p: 'Procure to Pay',
  o2c: 'Order to Cash',
  mfg: 'Manufacturing',
  rtn: 'Returns',
  production: 'Manufacturing', // Adaptor canonical id
  returns: 'Returns',
};

function flowLabelFor(flowKey: string): string {
  return FLOW_LABELS[flowKey] ?? flowKey.toUpperCase();
}

function formatValue(val: unknown): string {
  if (val === true) return 'Yes';
  if (val === false) return 'No';
  if (Array.isArray(val)) return val.join(', ');
  if (val === null || val === undefined) return '—';
  return String(val);
}

export function BulkAutoFillPanel({ engagementId }: { engagementId: string }) {
  const qc = useQueryClient();
  const answers = useWizardStore((s) => s.answers);
  const mergeAnswers = useWizardStore((s) => s.mergeAnswers);
  const setConflicts = useConflictStore((s) => s.setConflicts);

  const adaptorQuery = useQuery({
    queryKey: ['engagement-adaptor', engagementId],
    queryFn: () => engagementsApi.getAdaptor(engagementId),
    enabled: !!engagementId,
    retry: false,
    staleTime: 60_000,
  });

  const engagementQuery = useQuery({
    queryKey: ['engagement', engagementId],
    queryFn: () => engagementsApi.get(engagementId),
    enabled: !!engagementId,
  });

  // Build the section list from the active adaptor schema if available;
  // otherwise fall back to the shared NetSuite question bank so pilot
  // engagements without adaptor schemas keep working.
  const sectionGroups: SectionGroup[] = useMemo(() => {
    const bridged = bridgeAdaptorSchema(adaptorQuery.data?.schema);
    const groupMap = new Map<string, SectionGroup>();

    if (bridged.size > 0) {
      for (const [key, section] of bridged.entries()) {
        const flowKey = key.split('.')[0]!;
        const unanswered = section.questions.filter((q) => !(q.id in answers)).length;
        if (!groupMap.has(flowKey)) {
          groupMap.set(flowKey, { flowKey, flowLabel: flowLabelFor(flowKey), sections: [] });
        }
        groupMap.get(flowKey)!.sections.push({
          key,
          label: section.sectionLabel,
          totalQuestions: section.questions.length,
          unanswered,
        });
      }
    } else {
      // Fallback: derive section list from the shared NetSuite bank.
      const byKey = new Map<string, Question[]>();
      for (const q of allQuestions) {
        const k = `${q.flow.toLowerCase()}.${q.section}`;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k)!.push(q);
      }
      for (const [key, qs] of byKey.entries()) {
        const flowKey = key.split('.')[0]!;
        const unanswered = qs.filter((q) => !(q.id in answers)).length;
        if (!groupMap.has(flowKey)) {
          groupMap.set(flowKey, { flowKey, flowLabel: flowLabelFor(flowKey), sections: [] });
        }
        groupMap.get(flowKey)!.sections.push({
          key,
          label: key.split('.').slice(1).join('.'),
          totalQuestions: qs.length,
          unanswered,
        });
      }
    }

    // Stable order: flow groups in canonical order, sections alphabetically
    const flowOrder = ['r2r', 'p2p', 'o2c', 'mfg', 'production', 'rtn', 'returns'];
    const sorted = [...groupMap.values()].sort(
      (a, b) => flowOrder.indexOf(a.flowKey) - flowOrder.indexOf(b.flowKey)
    );
    for (const g of sorted) g.sections.sort((a, b) => a.label.localeCompare(b.label));
    return sorted;
  }, [adaptorQuery.data, answers]);

  const allSectionKeys = useMemo(
    () => sectionGroups.flatMap((g) => g.sections.map((s) => s.key)),
    [sectionGroups]
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<SuggestionMap>({});
  const [autoFillState, setAutoFillState] = useState<AutoFillState>({ accepted: {}, skipped: {} });
  const [errorBySection, setErrorBySection] = useState<Record<string, string>>({});

  const suggestMut = useMutation({
    mutationFn: async (sectionKeys: string[]) => {
      const eng = engagementQuery.data as Record<string, unknown> | undefined;
      const clientInfo = {
        industry: (eng?.industry as string) || 'General',
        companySize: 'MEDIUM',
        country: (eng?.country as string) || 'United Arab Emirates',
      };
      const results = await Promise.allSettled(
        sectionKeys.map(async (sectionKey) => {
          const data = (await engagementsApi.suggestAnswers(
            engagementId,
            sectionKey,
            clientInfo
          )) as SectionSuggestion;
          return { sectionKey, data };
        })
      );
      const ok: Record<string, SectionSuggestion> = {};
      const errs: Record<string, string> = {};
      for (const [i, r] of results.entries()) {
        const key = sectionKeys[i]!;
        if (r.status === 'fulfilled') ok[r.value.sectionKey] = r.value.data;
        else errs[key] = (r.reason instanceof Error && r.reason.message) || 'Failed to suggest';
      }
      return { ok, errs };
    },
    onSuccess: ({ ok, errs }) => {
      setSuggestions((prev) => ({ ...prev, ...ok }));
      setErrorBySection((prev) => ({ ...prev, ...errs }));
    },
  });

  const saveMut = useMutation({
    mutationFn: (toSave: Record<string, unknown>) =>
      engagementsApi.patchProfile(engagementId, toSave),
    onSuccess: (data) => {
      const normalisedConflicts = Array.isArray(data?.conflicts)
        ? data.conflicts.map((c: Record<string, unknown>) => ({
            ...c,
            ruleId: (c.ruleId ?? c.id) as string,
          }))
        : [];
      setConflicts(normalisedConflicts);
      qc.invalidateQueries({ queryKey: ['profile', engagementId] });
      qc.refetchQueries({ queryKey: ['conflicts', engagementId] });
      qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
  });

  const handleAccept = (sectionKey: string, qId: string) => {
    const value = suggestions[sectionKey]?.suggestedAnswers[qId];
    if (value === undefined) return;
    mergeAnswers({ [qId]: value });
    saveMut.mutate({ [qId]: value });
    setAutoFillState((s) => acceptSuggestion(s, sectionKey, qId));
  };

  const handleSkip = (sectionKey: string, qId: string) => {
    setAutoFillState((s) => skipSuggestion(s, sectionKey, qId));
  };

  const unresolved = useMemo(
    () => countUnresolvedSuggestions(suggestions, autoFillState),
    [suggestions, autoFillState]
  );

  const totalSuggested = useMemo(() => {
    let total = 0;
    for (const s of Object.values(suggestions)) total += Object.keys(s.suggestedAnswers).length;
    return total;
  }, [suggestions]);

  const isSuggesting = suggestMut.isPending;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-violet-600" />
            AI Auto-Fill
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Pick the sections you want auto-filled, then let AI suggest answers in bulk.
            Each suggestion can be accepted or skipped individually. Suggestions use the
            engagement's risks, decisions, and team members as context.
          </p>
        </div>
      </div>

      {/* Section selection card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-slate-50/50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Sections ({selected.size} selected)
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(selectAllSections(allSectionKeys))}
              className="text-[11px] font-semibold text-violet-700 hover:text-violet-900"
              data-testid="autofill-select-all"
            >
              Select all
            </button>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              onClick={() => setSelected(clearSectionSelection())}
              className="text-[11px] font-semibold text-slate-600 hover:text-slate-900"
              data-testid="autofill-clear"
            >
              Clear
            </button>
          </div>
        </div>

        {sectionGroups.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No sections available for this engagement.
          </div>
        ) : (
          <div className="divide-y divide-slate-100" data-testid="autofill-section-list">
            {sectionGroups.map((group) => (
              <div key={group.flowKey} className="p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 px-1">
                  {group.flowLabel}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {group.sections.map((section) => {
                    const checked = selected.has(section.key);
                    return (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() => setSelected((s) => toggleSectionSelection(s, section.key))}
                        className={cn(
                          'flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors',
                          checked ? 'bg-violet-50 text-violet-900' : 'hover:bg-slate-50 text-slate-700'
                        )}
                        data-testid={`autofill-checkbox-${section.key}`}
                        aria-pressed={checked}
                      >
                        {checked ? (
                          <CheckSquare className="h-4 w-4 text-violet-600 flex-shrink-0" />
                        ) : (
                          <Square className="h-4 w-4 text-slate-300 flex-shrink-0" />
                        )}
                        <span className="text-xs font-medium truncate flex-1">{section.label}</span>
                        <span className={cn(
                          'text-[10px] font-bold tabular-nums flex-shrink-0',
                          section.unanswered === 0 ? 'text-emerald-600' : 'text-slate-400'
                        )}>
                          {section.unanswered}/{section.totalQuestions}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-slate-50/50 border-t border-slate-200 px-4 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => suggestMut.mutate([...selected])}
            disabled={selected.size === 0 || isSuggesting}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
              selected.size === 0 || isSuggesting
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-violet-600 text-white hover:bg-violet-700'
            )}
            data-testid="autofill-suggest-button"
          >
            {isSuggesting ? (
              <>
                <Loader className="h-3.5 w-3.5 animate-spin" />
                Suggesting…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Suggest for {selected.size || 0} section{selected.size === 1 ? '' : 's'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Suggestion results */}
      {totalSuggested > 0 && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-bold text-gray-900">
              Suggestions ({unresolved} pending)
            </h3>
            <p className="text-[11px] text-gray-400">
              Accept commits the answer · Skip dismisses without saving
            </p>
          </div>

          {Object.entries(suggestions).map(([sectionKey, sec]) => (
            <SuggestionsBlock
              key={sectionKey}
              sectionKey={sectionKey}
              suggestion={sec}
              autoFillState={autoFillState}
              error={errorBySection[sectionKey]}
              onAccept={handleAccept}
              onSkip={handleSkip}
            />
          ))}
        </div>
      )}

      {Object.keys(errorBySection).length > 0 && totalSuggested === 0 && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Failed to generate suggestions for any selected section. Try again in a moment.
        </div>
      )}
    </div>
  );
}

// ─── Sub-component ───────────────────────────────────────────────────────────

function SuggestionsBlock({
  sectionKey, suggestion, autoFillState, error, onAccept, onSkip,
}: {
  sectionKey: string;
  suggestion: SectionSuggestion;
  autoFillState: AutoFillState;
  error?: string;
  onAccept: (sectionKey: string, qId: string) => void;
  onSkip: (sectionKey: string, qId: string) => void;
}) {
  const entries = Object.entries(suggestion.suggestedAnswers);

  return (
    <div className="rounded-xl border border-violet-200 bg-white overflow-hidden shadow-sm">
      <div className="bg-gradient-to-r from-violet-50 to-brand-50 px-4 py-2.5 flex items-center justify-between">
        <p className="text-sm font-bold text-violet-900">{sectionKey}</p>
        <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
          {entries.length} suggestion{entries.length === 1 ? '' : 's'}
        </span>
      </div>

      {error ? (
        <div className="px-4 py-3 text-sm text-red-600">{error}</div>
      ) : entries.length === 0 ? (
        <div className="px-4 py-3 text-sm text-slate-500 italic">
          AI has no additional suggestions for this section.
        </div>
      ) : (
        <div className="divide-y divide-violet-100">
          {entries.map(([qId, value]) => {
            const accepted = autoFillState.accepted[sectionKey]?.has(qId) === true;
            const skipped = autoFillState.skipped[sectionKey]?.has(qId) === true;
            const resolved = isSuggestionResolved(autoFillState, sectionKey, qId);
            const reasoning = suggestion.reasoning[qId];

            return (
              <div
                key={qId}
                className={cn(
                  'px-4 py-3 flex items-start gap-3 transition-colors',
                  accepted && 'bg-emerald-50/40',
                  skipped && 'bg-slate-50 opacity-60'
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-mono font-semibold text-slate-500 truncate">{qId}</p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5">
                    {formatValue(value)}
                  </p>
                  {reasoning && (
                    <p className="text-xs text-slate-500 mt-1 italic">{reasoning}</p>
                  )}
                </div>

                {accepted ? (
                  <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                    <CircleCheck className="h-4 w-4" />
                    Applied
                  </span>
                ) : skipped ? (
                  <span className="flex-shrink-0 text-xs font-semibold text-slate-400">
                    Skipped
                  </span>
                ) : (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => onAccept(sectionKey, qId)}
                      className="inline-flex items-center gap-1 rounded-md bg-violet-600 text-white text-xs font-semibold px-2.5 py-1 hover:bg-violet-700"
                      data-testid={`autofill-accept-${sectionKey}-${qId}`}
                    >
                      <Check className="h-3 w-3" />
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => onSkip(sectionKey, qId)}
                      className="inline-flex items-center gap-1 rounded-md bg-white border border-slate-200 text-slate-700 text-xs font-semibold px-2 py-1 hover:bg-slate-50"
                      data-testid={`autofill-skip-${sectionKey}-${qId}`}
                    >
                      <X className="h-3 w-3" />
                      Skip
                    </button>
                  </div>
                )}
                {resolved && false /* keep for future polish like undo */}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
