import { create } from 'zustand';

interface ConflictEntry {
  id: string;
  ruleId: string;
  severity: 'BLOCK' | 'WARN' | 'INFO';
  type: string;
  questionIds: string[];
  message: string;
  resolution: string;
}

interface ConflictState {
  conflicts: ConflictEntry[];
  setConflicts: (conflicts: ConflictEntry[]) => void;
  hasBlocks: () => boolean;
  conflictsForQuestion: (questionId: string) => ConflictEntry[];
}

export const useConflictStore = create<ConflictState>((set, get) => ({
  conflicts: [],

  setConflicts: (conflicts) => set({ conflicts }),

  hasBlocks: () => get().conflicts.some((c) => c.severity === 'BLOCK'),

  conflictsForQuestion: (questionId: string) =>
    get().conflicts.filter((c) => c.questionIds.includes(questionId)),
}));
