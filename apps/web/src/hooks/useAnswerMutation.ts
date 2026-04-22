import { useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { engagementsApi } from '@/lib/api';
import { useWizardStore } from '@/stores/wizardStore';
import { useConflictStore } from '@/stores/conflictStore';

const DEBOUNCE_MS = 500;

export function useAnswerMutation(engagementId: string) {
  const queryClient = useQueryClient();
  const setSaveStatus = useWizardStore((s) => s.setSaveStatus);
  const setConflicts = useConflictStore((s) => s.setConflicts);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation({
    mutationFn: (answers: Record<string, unknown>) =>
      engagementsApi.patchProfile(engagementId, answers),

    onMutate: async (newAnswers) => {
      setSaveStatus('saving');

      // Cancel outgoing refetches for optimistic update
      await queryClient.cancelQueries({ queryKey: ['profile', engagementId] });

      // Snapshot current profile
      const previous = queryClient.getQueryData(['profile', engagementId]);

      // Optimistically update
      queryClient.setQueryData(['profile', engagementId], (old: Record<string, unknown> | null) => ({
        ...(old ?? {}),
        answers: { ...((old as Record<string, unknown> | null)?.answers as Record<string, unknown> ?? {}), ...newAnswers },
      }));

      return { previous };
    },

    onSuccess: (data) => {
      setSaveStatus('saved');
      useWizardStore.getState().setLastSaved(new Date());

      // The patchProfile response returns raw rule-engine conflict objects where
      // the rule ID lives in `id`, not `ruleId`. Normalise before storing.
      //
      // IMPORTANT: we push the normalised array to BOTH the Zustand store AND the
      // React Query cache for ['conflicts', engagementId]. This prevents the
      // WizardShell useEffect from overwriting a cleared banner when the conflicts
      // query later refetches from the DB (the DB write in patchProfile and the
      // subsequent GET can race; writing the cache directly eliminates that window).
      // Debug: response data logged only in dev
      if (import.meta.env.DEV) console.debug('[useAnswerMutation] patchProfile response data:', data);
      const normalizedConflicts = Array.isArray(data?.conflicts)
        ? data.conflicts.map((c: Record<string, unknown>) => ({
            ...c,
            ruleId: (c.ruleId ?? c.id) as string,
          }))
        : [];

      if (import.meta.env.DEV) console.debug('[useAnswerMutation] setting conflicts:', normalizedConflicts);
      setConflicts(normalizedConflicts);

      queryClient.invalidateQueries({ queryKey: ['profile', engagementId] });
      // Force-refetch the conflicts query immediately. staleTime:0 on that query
      // guarantees this always hits the server, so the banner reflects the latest
      // evaluated state regardless of any prior cache.
      queryClient.refetchQueries({ queryKey: ['conflicts', engagementId] });
      queryClient.invalidateQueries({ queryKey: ['engagement', engagementId] });

      // Reset to idle after 2 seconds
      setTimeout(() => setSaveStatus('idle'), 2000);
    },

    onError: (_err, _vars, context) => {
      setSaveStatus('error');
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['profile', engagementId], context.previous);
      }
    },
  });

  // Debounced save
  const saveAnswer = useCallback(
    (key: string, value: unknown) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        mutation.mutate({ [key]: value });
      }, DEBOUNCE_MS);
    },
    [mutation]
  );

  // Immediate save (for selects/toggles that benefit from instant feedback)
  const saveAnswerNow = useCallback(
    (key: string, value: unknown) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      mutation.mutate({ [key]: value });
    },
    [mutation]
  );

  return { saveAnswer, saveAnswerNow, isPending: mutation.isPending };
}
