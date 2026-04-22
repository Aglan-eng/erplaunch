import React from 'react';
import { r2rQuestions } from '@ofoq/shared';
import { SectionIntroCard } from '../SectionIntroCard';
import { QuestionCard } from '../QuestionCard';
import { useWizardProgress } from '@/hooks/useWizardProgress';
import { useWizardStore } from '@/stores/wizardStore';

const SECTION_META: Record<string, { title: string; description: string }> = {
  entities: {
    title: 'Entities',
    description: 'Define the legal entity structure for this implementation. This determines if OneWorld is required.',
  },
  segmentation: {
    title: 'Segmentation',
    description: 'Configure reporting dimensions — departments, classes, and locations — used across all financial reports.',
  },
  accountingPeriods: {
    title: 'Accounting Periods',
    description: 'Set the fiscal calendar, period locking behaviour, and adjustment period configuration.',
  },
  currencies: {
    title: 'Currencies',
    description: 'Configure base currency and multi-currency requirements including exchange rate management.',
  },
  bankTransactions: {
    title: 'Bank Transactions',
    description: 'Define bank accounts, reconciliation frequency, and opening balance requirements.',
  },
  tax: {
    title: 'Tax',
    description: 'Configure tax regimes, VAT rates, and registration details for this entity.',
  },
  journalEntries: {
    title: 'Journal Entries',
    description: 'Define manual journal entry requirements, approval workflows, and intercompany transactions.',
  },
  fiscalClose: {
    title: 'Fiscal Close',
    description: 'Configure period close procedures, checklist requirements, and automated locking.',
  },
  reporting: {
    title: 'Reporting',
    description: 'Define standard and custom reporting needs, management pack frequency, and consolidation requirements.',
  },
};

interface R2RSectionStepProps {
  section: string; // e.g. 'entities', 'segmentation'
  engagementId: string;
}

export function R2RSectionStep({ section, engagementId }: R2RSectionStepProps) {
  const answers = useWizardStore((s) => s.answers);
  const { sectionProgress } = useWizardProgress(answers);

  const meta = SECTION_META[section] ?? { title: section, description: '' };
  const questions = r2rQuestions.filter((q) => q.section === section);
  const progress = sectionProgress[section] ?? 0;

  return (
    <div className="max-w-2xl mx-auto">
      <SectionIntroCard
        title={meta.title}
        description={meta.description}
        progress={progress}
        questionCount={questions.length}
      />

      <div className="space-y-4">
        {questions.map((q) => (
          <QuestionCard key={q.id} question={q} engagementId={engagementId} />
        ))}

        {questions.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
            No questions defined for this section yet.
          </div>
        )}
      </div>
    </div>
  );
}
