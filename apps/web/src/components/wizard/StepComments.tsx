import React, { useState, useRef, useCallback, useEffect } from 'react';
import { MessageSquare, ChevronDown, ChevronRight, Check, Loader } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { engagementsApi } from '@/lib/api';

interface StepCommentsProps {
  engagementId: string;
  sectionKey: string;
}

export function StepComments({ engagementId, sectionKey }: StepCommentsProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadRef = useRef(false);

  // Load existing comment
  const { data: comments } = useQuery({
    queryKey: ['comments', engagementId],
    queryFn: () => engagementsApi.getComments(engagementId),
    enabled: !!engagementId,
  });

  // Find comment for this section
  useEffect(() => {
    if (comments && !initialLoadRef.current) {
      const existing = (comments as Array<{ sectionKey: string; text?: string }>).find((c) => c.sectionKey === sectionKey);
      if (existing?.text) {
        setText(existing.text);
        setIsOpen(true);
      }
      initialLoadRef.current = true;
    }
  }, [comments, sectionKey]);

  // Reset when section changes
  useEffect(() => {
    initialLoadRef.current = false;
  }, [sectionKey]);

  const mutation = useMutation({
    mutationFn: (newText: string) => engagementsApi.putComment(engagementId, sectionKey, newText),
    onMutate: () => setSaveStatus('saving'),
    onSuccess: () => {
      setSaveStatus('saved');
      queryClient.invalidateQueries({ queryKey: ['comments', engagementId] });
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onError: () => setSaveStatus('idle'),
  });

  const handleChange = useCallback((newText: string) => {
    setText(newText);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      mutation.mutate(newText);
    }, 800);
  }, [mutation]);

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-sm transition-all hover:shadow-md">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50/50 transition-colors"
      >
        <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
          <MessageSquare className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-bold text-slate-800">Consultant Notes</span>
          {text && (
            <span className="ml-2 text-xs text-slate-400">
              ({text.length} chars)
            </span>
          )}
        </div>

        {/* Save status indicator */}
        {saveStatus === 'saving' && (
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <Loader className="h-3 w-3 animate-spin" /> Saving…
          </span>
        )}
        {saveStatus === 'saved' && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3 w-3" /> Saved
          </span>
        )}

        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {isOpen && (
        <div className="px-5 pb-5 animate-in">
          <textarea
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            rows={4}
            placeholder="Add implementation notes, client feedback, or special requirements for this section…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-300 resize-none transition-all"
          />
          <p className="mt-2 text-[11px] text-slate-400">
            Notes auto-save and will be included in generated documentation (BRD, Solution Design, etc.)
          </p>
        </div>
      )}
    </div>
  );
}
