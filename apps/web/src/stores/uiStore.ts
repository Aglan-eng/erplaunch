import { create } from 'zustand';

interface UIState {
  helpOpen: boolean;
  helpQuestionId: string | null;
  exampleOpen: boolean;
  exampleQuestionId: string | null;

  openHelp: (questionId: string) => void;
  closeHelp: () => void;
  openExample: (questionId: string) => void;
  closeExample: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  helpOpen: false,
  helpQuestionId: null,
  exampleOpen: false,
  exampleQuestionId: null,

  openHelp: (questionId) => set({ helpOpen: true, helpQuestionId: questionId }),
  closeHelp: () => set({ helpOpen: false, helpQuestionId: null }),
  openExample: (questionId) => set({ exampleOpen: true, exampleQuestionId: questionId }),
  closeExample: () => set({ exampleOpen: false, exampleQuestionId: null }),
}));
