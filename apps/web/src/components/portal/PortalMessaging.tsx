import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Send, Plus, Clock, ChevronLeft, CircleCheck } from 'lucide-react';
import { portalApi } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * PortalMessaging (Phase 31, client side).
 *
 * Two views: thread list and thread detail. Outbound messages POST
 * through portalApi.submitQaMessage which lands a PENDING submission
 * (consultant must accept before the message persists). Inbound
 * (consultant→client) messages are visible immediately because they
 * bypass pending-review per §5.1 asymmetry.
 *
 * Pending-but-not-yet-accepted client messages show a "awaiting consultant
 * review" badge so the client sees their submission state. Phase 31 ships
 * the basic visual without polling-via-PendingSubmission detail; Phase 32+
 * can refine if needed.
 */

interface ThreadRow {
  id: string;
  engagementId: string;
  subject: string;
  status: 'OPEN' | 'RESOLVED';
  createdByMemberId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  lastMessageAt: string;
}

interface MessageRow {
  id: string;
  threadId: string;
  senderType: 'CLIENT' | 'CONSULTANT';
  body: string;
  acknowledgedAt: string | null;
  createdAt: string;
}

export function PortalMessaging({ token, authenticated }: { token: string; authenticated: boolean }) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);

  const { data: threads, isLoading } = useQuery({
    queryKey: ['portal-threads', token],
    queryFn: () => portalApi.listThreads(token) as Promise<ThreadRow[]>,
    enabled: !!token && authenticated,
    retry: false,
    refetchInterval: 30_000,
  });

  if (!authenticated) return null;
  // Mount only when there ARE threads or the user clicks "new thread".
  // No lurking empty section in the client portal.
  const list = threads ?? [];
  if (!isLoading && list.length === 0 && !showCompose) {
    return (
      <div
        className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
        data-testid="portal-messaging-empty"
      >
        <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
            <MessageCircle className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-bold text-gray-900 flex-1">Messages</h2>
          <button
            type="button"
            onClick={() => setShowCompose(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
            data-testid="portal-messaging-new-button"
          >
            <Plus className="h-3.5 w-3.5" />
            New thread
          </button>
        </div>
        <div className="p-6 text-center">
          <p className="text-xs text-gray-400">
            No messages yet. Start a thread if you have a question for your consultant.
          </p>
        </div>
      </div>
    );
  }

  if (activeThreadId) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <PortalThreadDetail
          token={token}
          threadId={activeThreadId}
          onBack={() => setActiveThreadId(null)}
        />
      </div>
    );
  }

  return (
    <div
      className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
      data-testid="portal-messaging"
    >
      <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
          <MessageCircle className="h-4 w-4" />
        </div>
        <h2 className="text-sm font-bold text-gray-900 flex-1">Messages</h2>
        <button
          type="button"
          onClick={() => setShowCompose(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
          data-testid="portal-messaging-new-button"
        >
          <Plus className="h-3.5 w-3.5" />
          New thread
        </button>
      </div>
      <div className="p-6">
        {showCompose && (
          <PortalNewThread
            onSent={() => setShowCompose(false)}
            onCancel={() => setShowCompose(false)}
          />
        )}
        {isLoading ? (
          <p className="text-xs text-gray-400 text-center py-4">Loading&hellip;</p>
        ) : (
          <div className="space-y-2">
            {list.map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => setActiveThreadId(t.id)}
                className="w-full text-left rounded-xl border border-gray-100 bg-white p-3 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
                data-testid={`portal-thread-${t.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-gray-900 truncate">{t.subject}</p>
                  {t.status === 'RESOLVED' && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1">
                      <CircleCheck className="h-3 w-3" />
                      Resolved
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Last activity: {new Date(t.lastMessageAt).toLocaleString('en-GB', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── New-thread inline form (client) ─────────────────────────────────────────

function PortalNewThread({ onSent, onCancel }: { onSent: () => void; onCancel: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submittedTick, setSubmittedTick] = useState(false);
  const mut = useMutation({
    mutationFn: () =>
      portalApi.submitQaMessage({ threadId: null, subject: subject.trim(), body: body.trim() }),
    onSuccess: () => {
      setSubmittedTick(true);
      setTimeout(onSent, 1500);
    },
  });
  const canSubmit = subject.trim().length > 0 && body.trim().length > 0 && !mut.isPending;

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-3 mb-3" data-testid="portal-messaging-new-inline">
      <p className="text-xs font-bold text-blue-900 mb-2">New thread</p>
      <input
        type="text"
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 mb-2"
      />
      <textarea
        placeholder="Your question"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 mb-2"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => mut.mutate()}
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          <Send className="h-3 w-3" />
          {submittedTick ? 'Sent — awaiting review' : 'Send'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Thread detail (client) ──────────────────────────────────────────────────

function PortalThreadDetail({
  token,
  threadId,
  onBack,
}: {
  token: string;
  threadId: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [submittedTick, setSubmittedTick] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['portal-thread', token, threadId],
    queryFn: () =>
      portalApi.getThread(token, threadId) as Promise<{
        thread: ThreadRow;
        messages: MessageRow[];
      }>,
    enabled: !!threadId,
    refetchInterval: 30_000,
  });

  const sendMut = useMutation({
    mutationFn: () =>
      portalApi.submitQaMessage({ threadId, body: draft.trim() }),
    onSuccess: () => {
      setSubmittedTick(true);
      setDraft('');
      qc.invalidateQueries({ queryKey: ['portal-thread', token, threadId] });
      setTimeout(() => setSubmittedTick(false), 2500);
    },
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 text-center">
        <div className="animate-spin h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  return (
    <div>
      <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-50"
          data-testid="portal-thread-detail-back"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-sm font-bold text-gray-900 flex-1 truncate">{data.thread.subject}</h2>
        {data.thread.status === 'RESOLVED' && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1">
            <CircleCheck className="h-3 w-3" />
            Resolved
          </span>
        )}
      </div>
      <div className="p-6 space-y-3" data-testid="portal-thread-messages">
        {data.messages.map((m) => (
          <PortalMessageBubble key={m.id} message={m} />
        ))}
      </div>
      {data.thread.status === 'OPEN' && (
        <div className="px-6 pb-6">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply&hellip;"
            rows={2}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 mb-2"
            data-testid="portal-thread-detail-composer"
          />
          <div className="flex items-center justify-between">
            {submittedTick && (
              <p className="text-[10px] text-blue-600 inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Sent — awaiting consultant review
              </p>
            )}
            <button
              type="button"
              onClick={() => sendMut.mutate()}
              disabled={draft.trim().length === 0 || sendMut.isPending}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
              data-testid="portal-thread-detail-send"
            >
              <Send className="h-3 w-3" />
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PortalMessageBubble({ message }: { message: MessageRow }) {
  const isClient = message.senderType === 'CLIENT';
  return (
    <div className={cn('flex', isClient ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-3 py-2',
          isClient
            ? 'bg-blue-600 text-white rounded-tr-sm'
            : 'bg-gray-100 text-gray-800 rounded-tl-sm',
        )}
      >
        <p
          className={cn(
            'text-[10px] font-bold uppercase tracking-wider mb-0.5',
            isClient ? 'text-white/70' : 'text-gray-500',
          )}
        >
          {isClient ? 'You' : 'Consultant'}
        </p>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.body}</p>
        <p
          className={cn(
            'text-[10px] mt-1.5',
            isClient ? 'text-white/60' : 'text-gray-400',
          )}
        >
          {new Date(message.createdAt).toLocaleString('en-GB', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
}
