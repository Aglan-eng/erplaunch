import React from 'react';
import { useParams } from 'react-router-dom';
import { useWizardStore } from '@/stores/wizardStore';
import { useWizardProgress } from '@/hooks/useWizardProgress';
import { CircleCheck, ChevronRight, LayoutDashboard, FileText, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { AdaptorPanel } from '../AdaptorPanel';

export function SummaryView() {
  const { id: engagementId } = useParams<{ id: string }>();
  const { answers, setCurrentSection } = useWizardStore();
  const { sectionProgress, overall } = useWizardProgress(answers);

  const modules = [
    { id: 'r2r', label: 'Record to Report', icon: LayoutDashboard, color: 'text-blue-600', bg: 'bg-blue-50' },
    { id: 'p2p', label: 'Procure to Pay', icon: FileText, color: 'text-purple-600', bg: 'bg-purple-50' },
    { id: 'o2c', label: 'Order to Cash', icon: LayoutDashboard, color: 'text-green-600', bg: 'bg-green-50' },
    { id: 'mfg', label: 'Manufacturing', icon: Settings2, color: 'text-orange-600', bg: 'bg-orange-50' },
    { id: 'rtn', label: 'Returns', icon: LayoutDashboard, color: 'text-rose-600', bg: 'bg-rose-50' },
  ];

  const getModuleProgress = (moduleId: string) => {
    const moduleSections = Object.entries(sectionProgress)
      .filter(([key]) => key.startsWith(`${moduleId}.`));
    if (moduleSections.length === 0) return 0;
    const total = moduleSections.reduce((acc, [, val]) => acc + val, 0);
    return Math.round(total / moduleSections.length);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in">
      <div className="space-y-2">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">Implementation Summary</h2>
        <p className="text-slate-500">Review your progress across all workstreams before generating the final configuration package.</p>
      </div>

      {engagementId && <AdaptorPanel engagementId={engagementId} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Overall Progress Card */}
        <div className="md:col-span-2 glass rounded-3xl p-8 border-slate-200/60 shadow-xl overflow-hidden relative group">
           <div className="absolute top-0 right-0 -mt-12 -mr-12 w-48 h-48 bg-brand-500/10 rounded-full blur-3xl transition-all group-hover:bg-brand-500/20" />
           <div className="relative flex flex-col md:flex-row items-center gap-8">
              <div className="relative h-32 w-32 flex-shrink-0">
                 <svg className="h-full w-full transform -rotate-90">
                    <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-100" />
                    <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="12" fill="transparent"
                       strokeDasharray={364}
                       strokeDashoffset={364 - (364 * overall) / 100}
                       className="text-brand-600 transition-all duration-1000 ease-out"
                       strokeLinecap="round" />
                 </svg>
                 <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-black text-slate-900">{overall}%</span>
                 </div>
              </div>
              <div className="flex-1 text-center md:text-left">
                 <h3 className="text-xl font-bold text-slate-900 mb-2">Completion Readiness</h3>
                 <p className="text-sm text-slate-500 mb-4 max-w-sm">
                    {overall === 100 
                      ? "Ready to generate! All requirements have been captured." 
                      : `Capture ${100-overall}% more details for a complete NetSuite BRD scaffold.`}
                 </p>
                 <ProgressBar value={overall} className="h-2 bg-slate-100" />
              </div>
           </div>
        </div>

        {/* Module Breakdown */}
        {modules.map((m) => {
          const progress = getModuleProgress(m.id);
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              onClick={() => setCurrentSection(`${m.id}.${Object.keys(sectionProgress).find(k => k.startsWith(m.id))?.split('.')[1] || 'entities'}`)}
              className="group flex items-center gap-4 p-5 rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-all text-left"
            >
              <div className={cn("p-3 rounded-xl transition-colors", m.bg, m.color)}>
                <Icon className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-bold text-slate-800">{m.label}</span>
                  <span className={cn("text-xs font-black", progress === 100 ? "text-emerald-600" : "text-slate-400")}>
                    {progress}%
                  </span>
                </div>
                <ProgressBar value={progress} size="sm" className="h-1.5" />
              </div>
              <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-400 transition-colors" />
            </button>
          );
        })}
      </div>

      <div className="flex justify-center pt-4">
        <button
          onClick={() => setCurrentSection('generate')}
          className="px-8 py-4 rounded-2xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-all shadow-xl hover:-translate-y-0.5 active:translate-y-0"
        >
          Proceed to Package Generation
        </button>
      </div>
    </div>
  );
}
