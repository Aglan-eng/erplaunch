import React from 'react';
import { X, HelpCircle, Wrench } from 'lucide-react';
import { allQuestions } from '@ofoq/shared';
import { useUIStore } from '@/stores/uiStore';

export function HelpDrawer() {
  const { helpOpen, helpQuestionId, closeHelp } = useUIStore();

  const question = helpQuestionId
    ? allQuestions.find((q) => q.id === helpQuestionId)
    : null;

  if (!helpOpen || !question) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={closeHelp}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-brand-50/40">
          <div className="flex items-center gap-2.5">
            <HelpCircle className="h-5 w-5 text-brand-500 flex-shrink-0" />
            <div>
              <h2 className="font-bold text-gray-900 text-sm leading-tight">
                {question.helpTitle || 'Why does this matter?'}
              </h2>
              <span className="text-[10px] font-semibold text-brand-500 uppercase tracking-wider">
                {question.flow} · {question.section}
              </span>
            </div>
          </div>
          <button
            onClick={closeHelp}
            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Question context */}
        <div className="px-6 py-3 bg-slate-50 border-b border-gray-100">
          <p className="text-xs font-medium text-slate-600 leading-snug italic">"{question.label}"</p>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-5">
          <div className="prose prose-sm max-w-none text-gray-700">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{question.helpBody}</p>
          </div>
          {question.exampleText && (
            <div className="rounded-xl bg-amber-50 border border-amber-100 p-4">
              <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider mb-1.5">Real-world example</p>
              <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">{question.exampleText}</p>
            </div>
          )}
          {question.consultantNote && (
            <div className="rounded-xl bg-violet-50 border border-violet-100 p-4">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Wrench className="h-3.5 w-3.5 text-violet-500" />
                <p className="text-[11px] font-bold text-violet-700 uppercase tracking-wider">Consultant implementation note</p>
              </div>
              <p className="text-sm text-violet-900 leading-relaxed whitespace-pre-wrap">{question.consultantNote}</p>
            </div>
          )}
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Field ID</p>
            <code className="text-[11px] font-mono text-slate-600">{question.id}</code>
          </div>
        </div>
      </div>
    </>
  );
}
