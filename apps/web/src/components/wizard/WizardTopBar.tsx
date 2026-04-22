import React, { useState } from 'react';
import { ArrowLeft, ChevronRight, Loader, Copy, Sparkles, FileText } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { AutoSaveIndicator } from './AutoSaveIndicator';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { AnswerTemplateModal } from './AnswerTemplateModal';
import { IndustryPresetModal } from './IndustryPresetModal';

interface WizardTopBarProps {
  clientName: string;
  overallProgress: number;
  status?: string;
  nextStage?: string | null;
  onAdvanceStage?: () => void;
  isAdvancing?: boolean;
}

const STAGES = ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GO_LIVE'];

const STAGE_LABELS: Record<string, string> = {
  DISCOVERY: 'Discovery',
  SCOPING: 'Scoping',
  BUILD: 'Build',
  UAT: 'UAT',
  GO_LIVE: 'Go-Live',
};

export function WizardTopBar({
  clientName,
  overallProgress,
  status = 'DISCOVERY',
  nextStage,
  onAdvanceStage,
  isAdvancing = false,
}: WizardTopBarProps) {
  const navigate = useNavigate();
  const { id: engagementId } = useParams<{ id: string }>();
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);

  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-slate-200/60 px-6 py-4 flex items-center gap-6 z-20">
      <button
        onClick={() => navigate('/dashboard')}
        className="p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all active:scale-95"
        title="Back to dashboard"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
           <h1 className="text-base font-black text-slate-900 tracking-tight truncate">{clientName}</h1>
           <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-50 text-brand-700 border border-brand-100 uppercase tracking-wider">
              {STAGE_LABELS[status] ?? status.replace('_', ' ')}
           </span>
        </div>
        <div className="flex items-center gap-3 mt-1.5 overflow-hidden">
           <div className="flex items-center gap-1">
              {STAGES.map((s, idx) => {
                 const currentIdx = STAGES.indexOf(status);
                 const isCompleted = currentIdx >= idx;
                 const isActive = status === s;
                 return (
                    <div
                       key={s}
                       className={cn(
                          "h-1.5 w-8 rounded-full transition-all duration-500",
                          isCompleted ? "bg-brand-500" : "bg-slate-100",
                          isActive && "ring-2 ring-brand-500/30 w-12"
                       )}
                       title={STAGE_LABELS[s] ?? s}
                    />
                 );
              })}
           </div>
           <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">
              Stage: {STAGE_LABELS[status] ?? status.replace('_', ' ')}
           </span>
        </div>
      </div>

      <div className="hidden lg:flex items-center gap-4 border-l border-slate-100 pl-6 mr-6">
         <div className="text-right">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Eng. Progress</div>
            <div className="flex items-center gap-2">
               <span className="text-sm font-black text-slate-900">{overallProgress}%</span>
               <ProgressBar value={overallProgress} size="sm" className="w-20 bg-slate-100" />
            </div>
         </div>
      </div>

      {/* Advance Stage button */}
      {nextStage && onAdvanceStage && (
        <button
          onClick={onAdvanceStage}
          disabled={isAdvancing}
          className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm whitespace-nowrap"
          title={`Advance to ${STAGE_LABELS[nextStage] ?? nextStage}`}
        >
          {isAdvancing ? (
            <Loader className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {STAGE_LABELS[nextStage] ?? nextStage}
        </button>
      )}

      {/* Export Status Report */}
      {engagementId && (
        <a
          href={`/engagements/${engagementId}/status-report`}
          target="_blank"
          rel="noreferrer"
          className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm whitespace-nowrap"
          title="Export status report"
        >
          <FileText className="h-3.5 w-3.5" />
          Report
        </a>
      )}

      {/* Industry Preset button */}
      <button
        onClick={() => setShowPresetModal(true)}
        className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm whitespace-nowrap"
        title="Apply industry preset"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Preset
      </button>

      {/* Copy Template button */}
      <button
        onClick={() => setShowTemplateModal(true)}
        className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm whitespace-nowrap"
        title="Copy answers from another engagement"
      >
        <Copy className="h-3.5 w-3.5" />
        Template
      </button>

      <AutoSaveIndicator />

      {showPresetModal && engagementId && (
        <IndustryPresetModal
          engagementId={engagementId}
          onClose={() => setShowPresetModal(false)}
        />
      )}
      {showTemplateModal && engagementId && (
        <AnswerTemplateModal
          engagementId={engagementId}
          onClose={() => setShowTemplateModal(false)}
        />
      )}
    </header>
  );
}

// Helper for class merging if not already globally available
function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}
