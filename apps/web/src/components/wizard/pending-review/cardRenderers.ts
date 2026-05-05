/**
 * Per-targetType card renderer registry (Phase 29).
 *
 * §5 sprint pattern: each phase 29-32 owns its target-type's card UI.
 * The PendingReviewStep looks up the renderer at render time and falls
 * back to a generic JSON-pretty-print if no renderer is registered
 * (defensive — admin can manually create submissions of unwired types
 * via the API, and an empty card is worse than a usable stub).
 *
 * Phase 29 establishes the pattern + registers WIZARD_ANSWER.
 * Phase 30 will register DATA_FILE.
 * Phase 31 will register QA_MESSAGE.
 * Phase 32 will register DECISION_SIGNOFF.
 */

import type { ComponentType } from 'react';

export interface PendingSubmissionRow {
  id: string;
  engagementId: string;
  memberId: string;
  memberName: string | null;
  targetType: string;
  targetId: string | null;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  reviewerId: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  createdAt: string;
}

export interface CardRendererProps {
  submission: PendingSubmissionRow;
  onAccept: (comment: string) => void;
  onReject: (comment: string) => void;
  isReviewing: boolean;
}

export type CardRenderer = ComponentType<CardRendererProps>;

const REGISTRY: Map<string, CardRenderer> = new Map();

export function registerCardRenderer(targetType: string, renderer: CardRenderer): void {
  REGISTRY.set(targetType, renderer);
}

export function getCardRenderer(targetType: string): CardRenderer | null {
  return REGISTRY.get(targetType) ?? null;
}
