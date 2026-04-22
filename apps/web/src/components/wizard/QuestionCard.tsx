import React from 'react';
import { HelpCircle, Lightbulb } from 'lucide-react';
import type { Question } from '@ofoq/shared';
import { QuestionInput } from './QuestionInput';
import { ConflictInline } from './ConflictBanner';
import { useUIStore } from '@/stores/uiStore';
import { useWizardStore } from '@/stores/wizardStore';
import { useAnswerMutation } from '@/hooks/useAnswerMutation';

interface QuestionCardProps {
  question: Question;
  engagementId: string;
}

export function QuestionCard({ question, engagementId }: QuestionCardProps) {
  const answers = useWizardStore((s) => s.answers);
  const mergeAnswers = useWizardStore((s) => s.mergeAnswers);
  const openHelp = useUIStore((s) => s.openHelp);
  const openExample = useUIStore((s) => s.openExample);
  const { saveAnswer, saveAnswerNow } = useAnswerMutation(engagementId);

  const value = answers[question.id];

  // Check dependency gate
  if (question.dependsOn) {
    const { questionId, value: requiredValue } = question.dependsOn;
    if (answers[questionId] !== requiredValue) {
      return null;
    }
  }

  const handleChange = (newValue: unknown) => {
    mergeAnswers({ [question.id]: newValue });

    // Immediate save for selects and booleans; debounced for text/number
    if (question.inputType === 'BOOLEAN' || question.inputType === 'SINGLE_SELECT' || question.inputType === 'MULTI_SELECT') {
      saveAnswerNow(question.id, newValue);
    } else {
      saveAnswer(question.id, newValue);
    }
  };

  return (
    <div className="group relative rounded-2xl border border-slate-100 bg-white p-6 shadow-sm ring-1 ring-slate-200/50 hover:shadow-lg hover:ring-brand-500/30 transition-all duration-300 animate-in">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <label className="text-sm font-bold text-slate-800 tracking-tight leading-tight">
              {question.label}
              {question.required && <span className="text-rose-500 ml-1 font-black">*</span>}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-semibold text-slate-400 uppercase tracking-widest bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
              {question.id}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {question.helpBody && (
            <button
              type="button"
              onClick={() => openHelp(question.id)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-all active:scale-95"
              title="Help"
            >
              <HelpCircle className="h-4.5 w-4.5" />
            </button>
          )}
          {question.exampleText && (
            <button
              type="button"
              onClick={() => openExample(question.id)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-all active:scale-95"
              title="Example"
            >
              <Lightbulb className="h-4.5 w-4.5" />
            </button>
          )}
        </div>
      </div>

      <div className="relative group-focus-within:ring-2 group-focus-within:ring-brand-500/20 rounded-lg transition-all">
        <QuestionInput question={question} value={value} onChange={handleChange} />
      </div>
      
      <ConflictInline questionId={question.id} />
    </div>
  );
}
