import React from 'react';
import { CircleCheck, Loader, CircleAlert } from 'lucide-react';
import { useWizardStore } from '@/stores/wizardStore';

export function AutoSaveIndicator() {
  const saveStatus = useWizardStore((s) => s.saveStatus);
  const lastSaved = useWizardStore((s) => s.lastSaved);

  if (saveStatus === 'idle' && !lastSaved) return null;

  return (
    <div className="flex items-center gap-2 text-xs font-medium">
      {saveStatus === 'saving' && (
        <div className="flex items-center gap-1.5 text-slate-400 animate-pulse">
          <Loader className="h-3.5 w-3.5 animate-spin" />
          <span>Saving updates…</span>
        </div>
      )}
      {(saveStatus === 'saved' || (saveStatus === 'idle' && lastSaved)) && (
        <div className="flex items-center gap-1.5 text-emerald-600 transition-all">
          <CircleCheck className="h-3.5 w-3.5" />
          <span>
            {saveStatus === 'saved' ? 'Saved' : 'Last saved'}{' '}
            {lastSaved ? lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
          </span>
        </div>
      )}
      {saveStatus === 'error' && (
        <div className="flex items-center gap-1.5 text-rose-600">
          <CircleAlert className="h-3.5 w-3.5" />
          <span>Save failed</span>
        </div>
      )}
    </div>
  );
}
