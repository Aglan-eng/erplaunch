import React from 'react';
import { ProgressBar } from '@/components/ui/ProgressBar';

interface SectionIntroCardProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  progress?: number;
  questionCount?: number;
}

export function SectionIntroCard({
  title,
  description,
  icon,
  progress,
  questionCount,
}: SectionIntroCardProps) {
  return (
    <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50 to-white p-5 mb-6">
      <div className="flex items-start gap-4">
        {icon && (
          <div className="flex-shrink-0 p-2 rounded-lg bg-brand-100 text-brand-600">
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <p className="mt-1 text-sm text-gray-600 leading-relaxed">{description}</p>
          {(progress !== undefined || questionCount !== undefined) && (
            <div className="mt-3 flex items-center gap-3">
              {progress !== undefined && (
                <ProgressBar value={progress} size="sm" className="flex-1 max-w-xs" />
              )}
              {questionCount !== undefined && (
                <span className="text-xs text-gray-400">{questionCount} question{questionCount !== 1 ? 's' : ''}</span>
              )}
              {progress !== undefined && (
                <span className="text-xs font-medium text-brand-600">{progress}%</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
