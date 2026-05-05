import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSignature, ThumbsUp, ThumbsDown, Send, Clock } from 'lucide-react';
import { portalApi } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * PortalDecisionSignoffs (Phase 32, final §5 phase).
 *
 * Renders the engagement's decisions in non-terminal client sign-off
 * state and lets the client sign or decline each one. Submission goes
 * through the standard pending-review flow (portalApi.submitDecisionSignoff
 * → POST /portal/submissions DECISION_SIGNOFF).
 *
 * After a successful submission, the card shows a "Submitted — awaiting
 * consultant review" badge per decision. Once the consultant accepts or
 * rejects, the server-side filter drops the decision from the next GET
 * response (terminal-state decisions disappear from the list).
 */

interface PortalDecision {
  id: string;
  engagementId: string;
  title: string;
  description: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  rationale: string | null;
  clientSignoffStatus: 'NONE' | 'PENDING' | 'SIGNED' | 'DECLINED' | 'REJECTED' | null;
  pendingSubmissionId: string | null;
}

export function PortalDecisionSignoffs({
  token,
  authenticated,
}: {
  token: string;
  authenticated: boolean;
}) {
  const { data: decisions, isLoading } = useQuery({
    queryKey: ['portal-decisions', token],
    queryFn: () => portalApi.listDecisions(token) as Promise<PortalDecision[]>,
    enabled: !!token && authenticated,
    retry: false,
  });

  if (!authenticated) return null;
  if (isLoading) return null;
  const list = decisions ?? [];
  if (list.length === 0) return null;

  return (
    <div
      className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
      data-testid="portal-decision-signoffs"
    >
      <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-violet-50 flex items-center justify-center text-violet-600 flex-shrink-0">
          <FileSignature className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-gray-900">Decisions for sign-off</h2>
        </div>
        <span
          className="text-[10px] font-bold bg-violet-100 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-full"
          data-testid="portal-decision-signoffs-count"
        >
          {list.length} pending
        </span>
      </div>
      <div className="p-6">
        <p className="text-xs text-gray-400 mb-4 bg-violet-50/40 rounded-lg px-3 py-2 border border-violet-100/70">
          Your consultant has flagged these decisions for your sign-off. You can sign (agree) or
          decline (disagree). Both responses are valid — declining records that you do not agree
          with the proposed decision.
        </p>
        <div className="space-y-3">
          {list.map((d) => (
            <DecisionCard key={d.id} token={token} decision={d} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Per-decision card ───────────────────────────────────────────────────────

function DecisionCard({ token, decision }: { token: string; decision: PortalDecision }) {
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(decision.pendingSubmissionId !== null);

  const signMut = useMutation({
    mutationFn: (signed: boolean) =>
      portalApi.submitDecisionSignoff({
        decisionItemId: decision.id,
        signed,
        comment: comment.trim(),
      }),
    onSuccess: () => {
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: ['portal-decisions', token] });
    },
  });

  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-4 transition-colors',
        submitted ? 'border-amber-200 bg-amber-50/30' : 'border-gray-100',
      )}
      data-testid={`portal-decision-${decision.id}`}
    >
      <div className="flex items-start gap-2 mb-2">
        <FileSignature className="h-4 w-4 text-violet-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{decision.title}</p>
          {decision.description && (
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{decision.description}</p>
          )}
          {decision.rationale && (
            <p className="text-[11px] text-gray-400 italic mt-1">{decision.rationale}</p>
          )}
        </div>
      </div>

      {submitted ? (
        <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-amber-700">
          <Clock className="h-3.5 w-3.5" />
          Submitted — awaiting consultant review
        </div>
      ) : (
        <>
          <textarea
            placeholder="Optional comment (visible to consultant)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/50 mt-3 mb-2"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => signMut.mutate(true)}
              disabled={signMut.isPending}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                'bg-emerald-600 text-white hover:bg-emerald-700',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              data-testid={`portal-decision-sign-${decision.id}`}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              Sign
            </button>
            <button
              type="button"
              onClick={() => signMut.mutate(false)}
              disabled={signMut.isPending}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                'bg-white border border-rose-200 text-rose-700 hover:bg-rose-50',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              data-testid={`portal-decision-decline-${decision.id}`}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              Decline
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// portalApi.submitDecisionSignoff is referenced above. Keep this as a
// reference symbol so tree-shake doesn't drop the import in obscure
// build configs.
void Send;
