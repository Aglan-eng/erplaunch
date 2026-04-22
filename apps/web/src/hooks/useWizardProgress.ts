import { useMemo } from 'react';
import { r2rQuestions, p2pQuestions, o2cQuestions, mfgQuestions, rtnQuestions } from '@ofoq/shared';
import type { Question } from '@ofoq/shared';

// All questions with their full section keys (flow.section)
const ALL_QUESTIONS: Question[] = [
  ...r2rQuestions,
  ...p2pQuestions,
  ...o2cQuestions,
  ...mfgQuestions,
  ...rtnQuestions,
];

// Derive section key from question ID (e.g. "mfg.productionFlow.type" → "mfg.productionFlow")
// This is safer than using q.flow which can be 'PRODUCTION' instead of 'mfg'.
const getSectionKey = (q: Question): string => {
  const parts = q.id.split('.');
  return `${parts[0]}.${parts[1]}`;
};

const ALL_SECTION_KEYS: string[] = Array.from(
  new Set(ALL_QUESTIONS.map(getSectionKey))
);

export function useWizardProgress(answers: Record<string, unknown>) {
  return useMemo(() => {
    const sectionProgress: Record<string, number> = {};

    for (const sectionKey of ALL_SECTION_KEYS) {
      const sectionQuestions = ALL_QUESTIONS.filter(
        (q) =>
          getSectionKey(q) === sectionKey &&
          q.required
      );

      if (sectionQuestions.length === 0) {
        sectionProgress[sectionKey] = 100;
        continue;
      }

      const answered = sectionQuestions.filter(
        (q) =>
          answers[q.id] !== undefined &&
          answers[q.id] !== null &&
          answers[q.id] !== '' &&
          !(Array.isArray(answers[q.id]) && (answers[q.id] as unknown[]).length === 0)
      );

      sectionProgress[sectionKey] = Math.round(
        (answered.length / sectionQuestions.length) * 100
      );
    }

    // Overall % across all required questions
    const allRequired = ALL_QUESTIONS.filter((q) => q.required);
    const allAnswered = allRequired.filter(
      (q) =>
        answers[q.id] !== undefined &&
        answers[q.id] !== null &&
        answers[q.id] !== '' &&
        !(Array.isArray(answers[q.id]) && (answers[q.id] as unknown[]).length === 0)
    );

    return {
      sectionProgress,
      overall: allRequired.length > 0
        ? Math.round((allAnswered.length / allRequired.length) * 100)
        : 0,
    };
  }, [answers]);
}
