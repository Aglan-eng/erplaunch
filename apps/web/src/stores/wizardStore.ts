import { create } from 'zustand';

interface WizardState {
  engagementId: string | null;
  currentSection: string;
  answers: Record<string, unknown>;
  pendingAnswers: Record<string, unknown>;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastSaved: Date | null;

  setEngagementId: (id: string) => void;
  setCurrentSection: (section: string) => void;
  setAnswers: (answers: Record<string, unknown>) => void;
  mergeAnswers: (delta: Record<string, unknown>) => void;
  setSaveStatus: (status: WizardState['saveStatus']) => void;
  setLastSaved: (date: Date) => void;
  reset: () => void;
}

export const useWizardStore = create<WizardState>((set) => ({
  engagementId: null,
  currentSection: 'project',
  answers: {},
  pendingAnswers: {},
  saveStatus: 'idle',
  lastSaved: null,

  setEngagementId: (id) => set({ engagementId: id }),
  setCurrentSection: (section) => set({ currentSection: section }),
  setAnswers: (answers) => set({ answers }),
  mergeAnswers: (delta) =>
    set((state) => ({ answers: { ...state.answers, ...delta } })),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setLastSaved: (lastSaved) => set({ lastSaved }),
  reset: () =>
    set({
      engagementId: null,
      currentSection: 'project',
      answers: {},
      pendingAnswers: {},
      saveStatus: 'idle',
      lastSaved: null,
    }),
}));
