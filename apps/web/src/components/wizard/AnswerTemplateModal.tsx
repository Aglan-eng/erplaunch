import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Copy, CircleCheck, Loader } from 'lucide-react';
import { cn } from '@/lib/utils';
import { engagementsApi } from '@/lib/api';
import { useWizardStore } from '@/stores/wizardStore';
import { Modal } from '@/components/ui/Modal';

const STATUS_LABELS: Record<string, string> = {
  DISCOVERY: 'Discovery', SCOPING: 'Scoping', BUILD: 'Build', UAT: 'UAT', GO_LIVE: 'Go-Live',
};
const STATUS_COLORS: Record<string, string> = {
  DISCOVERY: 'bg-sky-100 text-sky-700',
  SCOPING:   'bg-violet-100 text-violet-700',
  BUILD:     'bg-amber-100 text-amber-700',
  UAT:       'bg-orange-100 text-orange-700',
  GO_LIVE:   'bg-green-100 text-green-700',
};

interface AnswerTemplateModalProps {
  engagementId: string;
  onClose: () => void;
}

export function AnswerTemplateModal({ engagementId, onClose }: AnswerTemplateModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const queryClient = useQueryClient();
  const setAnswers = useWizardStore((s) => s.setAnswers);

  const { data: allEngagements = [], isLoading } = useQuery({
    queryKey: ['engagements'],
    queryFn: () => engagementsApi.list(),
  });

  // Exclude current engagement
  const sources = (allEngagements as Array<any>).filter((e: any) => e.id !== engagementId);

  const copyMutation = useMutation({
    mutationFn: (sourceId: string) => engagementsApi.copyAnswers(engagementId, sourceId),
    onSuccess: async () => {
      // Reload profile into store
      const profile = await engagementsApi.getProfile(engagementId);
      if (profile?.answers) setAnswers(profile.answers as Record<string, unknown>);
      queryClient.invalidateQueries({ queryKey: ['profile', engagementId] });
      setDone(true);
    },
  });

  return (
    <Modal>
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl w-full max-w-lg overflow-hidden" style={{ boxShadow: '0 25px 60px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06)' }}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-gray-900">Copy from Template</h2>
            <p className="text-sm text-gray-500 mt-0.5">Import answers from an existing engagement</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-96 overflow-y-auto">
          {done ? (
            <div className="py-10 text-center">
              <div className="h-14 w-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <CircleCheck className="h-7 w-7 text-green-500" />
              </div>
              <p className="text-base font-bold text-gray-900">Answers copied!</p>
              <p className="text-sm text-gray-500 mt-1">Your blank fields have been filled from the selected engagement.</p>
            </div>
          ) : isLoading ? (
            <div className="py-10 flex justify-center">
              <Loader className="h-6 w-6 animate-spin text-brand-500" />
            </div>
          ) : sources.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-gray-500">No other engagements found to copy from.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Select source engagement</p>
              {sources.map((eng: any) => (
                <button
                  key={eng.id}
                  onClick={() => setSelected(eng.id)}
                  className={cn(
                    'w-full text-left px-4 py-3 rounded-xl border transition-all',
                    selected === eng.id
                      ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-300'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{eng.clientName}</p>
                      {eng.contractEndDate && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          Ends {new Date(eng.contractEndDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0', STATUS_COLORS[eng.status] ?? 'bg-gray-100 text-gray-600')}>
                      {STATUS_LABELS[eng.status] ?? eng.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!done && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">
              Cancel
            </button>
            <button
              disabled={!selected || copyMutation.isPending}
              onClick={() => selected && copyMutation.mutate(selected)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {copyMutation.isPending ? (
                <><Loader className="h-4 w-4 animate-spin" />Copying…</>
              ) : (
                <><Copy className="h-4 w-4" />Copy Answers</>
              )}
            </button>
          </div>
        )}
        {done && (
          <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-700 transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
    </Modal>
  );
}
