import React from 'react';
import { X, Lightbulb } from 'lucide-react';
import { allQuestions } from '@ofoq/shared';
import { useUIStore } from '@/stores/uiStore';

export function ExampleDrawer() {
  const { exampleOpen, exampleQuestionId, closeExample } = useUIStore();

  const question = exampleQuestionId
    ? allQuestions.find((q) => q.id === exampleQuestionId)
    : null;

  if (!exampleOpen || !question) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={closeExample}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            <h2 className="font-semibold text-gray-900">Example</h2>
          </div>
          <button
            onClick={closeExample}
            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-4">
            <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">
              {question.exampleText}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
