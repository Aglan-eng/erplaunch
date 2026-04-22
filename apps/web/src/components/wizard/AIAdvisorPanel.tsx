import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles, TriangleAlert, BookOpen, ClipboardList, RefreshCw,
  ChevronDown, ChevronRight, Loader, ArrowUpRight, Copy, Check,
  Zap, Shield, Database, Settings2
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { engagementsApi } from '@/lib/api';
import { cn } from '@/lib/utils';

interface AIAdvisorPanelProps {
  engagementId: string;
  sectionKey: string;
}

interface Suggestion {
  title: string;
  description: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'CONFIGURATION' | 'BEST_PRACTICE' | 'RISK' | 'DATA_MIGRATION';
}

interface Instruction {
  step: number;
  instruction: string;
  context: string;
}

interface KBArticle {
  title: string;
  description: string;
}

interface AdviceData {
  suggestions: Suggestion[];
  consultantInstructions: Instruction[];
  warnings: string[];
  relatedKBArticles: KBArticle[];
}

const PRIORITY_STYLES = {
  HIGH: 'bg-red-50 text-red-700 border-red-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  LOW: 'bg-blue-50 text-blue-700 border-blue-200',
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  CONFIGURATION: <Settings2 className="h-3 w-3" />,
  BEST_PRACTICE: <Zap className="h-3 w-3" />,
  RISK: <Shield className="h-3 w-3" />,
  DATA_MIGRATION: <Database className="h-3 w-3" />,
};

const CATEGORY_STYLES: Record<string, string> = {
  CONFIGURATION: 'bg-indigo-50 text-indigo-600',
  BEST_PRACTICE: 'bg-emerald-50 text-emerald-600',
  RISK: 'bg-red-50 text-red-600',
  DATA_MIGRATION: 'bg-purple-50 text-purple-600',
};

export function AIAdvisorPanel({ engagementId, sectionKey }: AIAdvisorPanelProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(true);
  const [copiedStep, setCopiedStep] = useState<number | null>(null);

  // Load cached advice
  const { data: cachedAdvice, isLoading } = useQuery({
    queryKey: ['ai-advice', engagementId, sectionKey],
    queryFn: () => engagementsApi.getAdvice(engagementId, sectionKey),
    enabled: !!engagementId && !!sectionKey,
  });

  const advice = cachedAdvice?.advice as AdviceData | undefined;

  // Generate/refresh mutation
  const generateMutation = useMutation({
    mutationFn: () => engagementsApi.generateAdvice(engagementId, sectionKey),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['ai-advice', engagementId, sectionKey],
      });
    },
  });

  const isGenerating = generateMutation.isPending;
  const hasAdvice = advice && (
    advice.suggestions?.length > 0 ||
    advice.consultantInstructions?.length > 0 ||
    advice.warnings?.length > 0
  );

  // ── Proactive AI: auto-generate advice when entering a section ──
  // Only triggers once per section (tracked by ref) and only when there's no
  // cached advice and no in-flight request.
  const autoTriggered = useRef<string | null>(null);
  useEffect(() => {
    if (
      !isLoading &&
      !hasAdvice &&
      !isGenerating &&
      sectionKey &&
      autoTriggered.current !== sectionKey
    ) {
      autoTriggered.current = sectionKey;
      // Short delay so the UI renders before triggering the network call
      const timer = setTimeout(() => {
        generateMutation.mutate();
      }, 800);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, hasAdvice, sectionKey]);

  const copyInstruction = (step: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedStep(step);
    setTimeout(() => setCopiedStep(null), 1500);
  };

  return (
    <div className="rounded-2xl border border-transparent bg-white overflow-hidden shadow-sm transition-all hover:shadow-md"
      style={{
        borderImage: 'linear-gradient(135deg, #8b5cf6, #6366f1, #3b82f6) 1',
      }}
    >
      {/* Header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-indigo-500/5 to-blue-500/5" />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="relative w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/50 transition-colors"
        >
          <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-200/50">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-black text-slate-900 tracking-tight">
              AI Implementation Expert
            </span>
            {hasAdvice && (
              <span className="ml-2 text-[10px] font-semibold text-violet-500 bg-violet-50 px-1.5 py-0.5 rounded-full">
                {advice.suggestions?.length || 0} insights
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              generateMutation.mutate();
            }}
            disabled={isGenerating}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95',
              hasAdvice
                ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                : 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-200/50 hover:shadow-lg'
            )}
          >
            {isGenerating ? (
              <>
                <Loader className="h-3 w-3 animate-spin" />
                Analyzing…
              </>
            ) : hasAdvice ? (
              <>
                <RefreshCw className="h-3 w-3" />
                Refresh
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                Generate Advice
              </>
            )}
          </button>

          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-slate-400 ml-1" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400 ml-1" />
          )}
        </button>
      </div>

      {/* Content */}
      {isOpen && (
        <div className="px-5 pb-5 animate-in">
          {/* Loading state */}
          {isGenerating && !hasAdvice && (
            <div className="flex flex-col items-center py-10 gap-3">
              <div className="relative">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center animate-pulse">
                  <Sparkles className="h-6 w-6 text-white" />
                </div>
              </div>
              <p className="text-sm font-semibold text-slate-600">Analyzing section…</p>
              <p className="text-xs text-slate-400 max-w-xs text-center">
                The AI expert is reviewing your answers and notes to generate NetSuite-specific implementation advice.
              </p>
            </div>
          )}

          {/* Empty state */}
          {!isGenerating && !hasAdvice && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="p-3 rounded-2xl bg-slate-50">
                <Sparkles className="h-6 w-6 text-slate-300" />
              </div>
              <p className="text-sm font-medium text-slate-500">Preparing advice…</p>
              <p className="text-xs text-slate-400 max-w-xs text-center">
                AI advice will auto-generate when you enter this section, or click
                "Generate Advice" to get implementation suggestions now.
              </p>
            </div>
          )}

          {/* Advice content */}
          {hasAdvice && (
            <div className="space-y-5">
              {/* Warnings */}
              {advice.warnings?.length > 0 && (
                <div className="space-y-2">
                  {advice.warnings.map((warning, i) => (
                    <div key={i} className="flex items-start gap-2.5 rounded-xl bg-red-50/70 border border-red-100 p-3">
                      <TriangleAlert className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-800 leading-relaxed font-medium">{warning}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Suggestions */}
              {advice.suggestions?.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-3">
                    Suggestions
                  </h4>
                  <div className="space-y-2">
                    {advice.suggestions.map((s, i) => (
                      <SuggestionCard key={i} suggestion={s} />
                    ))}
                  </div>
                </div>
              )}

              {/* Consultant Instructions */}
              {advice.consultantInstructions?.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-3 flex items-center gap-1.5">
                    <ClipboardList className="h-3 w-3" />
                    Step-by-Step Instructions
                  </h4>
                  <div className="space-y-1.5">
                    {advice.consultantInstructions.map((inst) => (
                      <div
                        key={inst.step}
                        className="group flex items-start gap-3 rounded-xl bg-slate-50/70 border border-slate-100 p-3 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-black mt-0.5">
                          {inst.step}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-800 leading-relaxed">
                            {inst.instruction}
                          </p>
                          {inst.context && (
                            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                              {inst.context}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => copyInstruction(inst.step, inst.instruction)}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-all"
                          title="Copy instruction"
                        >
                          {copiedStep === inst.step
                            ? <Check className="h-3 w-3 text-green-600" />
                            : <Copy className="h-3 w-3" />
                          }
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* KB Articles */}
              {advice.relatedKBArticles?.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-3 flex items-center gap-1.5">
                    <BookOpen className="h-3 w-3" />
                    Related Resources
                  </h4>
                  <div className="space-y-1.5">
                    {advice.relatedKBArticles.map((article, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2.5 rounded-xl bg-blue-50/50 border border-blue-100 p-3"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-blue-800">{article.title}</p>
                          <p className="text-[11px] text-blue-600/80 mt-0.5 leading-relaxed">{article.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Suggestion Card ──────────────────────────────────────────────────────────

function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-xl border border-slate-100 bg-white p-3 hover:shadow-sm transition-all cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex flex-col gap-1 flex-shrink-0 mt-0.5">
          <span className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border',
            PRIORITY_STYLES[suggestion.priority]
          )}>
            {suggestion.priority}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-xs font-bold text-slate-800">{suggestion.title}</p>
            <span className={cn(
              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold',
              CATEGORY_STYLES[suggestion.category] || 'bg-slate-50 text-slate-500'
            )}>
              {CATEGORY_ICONS[suggestion.category]}
              {suggestion.category.replace('_', ' ')}
            </span>
          </div>
          {expanded && (
            <p className="text-[11px] text-slate-600 leading-relaxed mt-1.5 animate-in">
              {suggestion.description}
            </p>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-slate-300 flex-shrink-0 mt-0.5" />
        ) : (
          <ChevronRight className="h-3 w-3 text-slate-300 flex-shrink-0 mt-0.5" />
        )}
      </div>
    </div>
  );
}
