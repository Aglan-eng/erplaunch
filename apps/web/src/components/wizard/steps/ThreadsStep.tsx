import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Plus, Send, ChevronLeft, CircleCheck } from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  getLastSeenMap,
  isThreadUnread,
  setThreadSeen,
  type LastSeenMap,
  type ThreadSummary,
} from '../threadsInboxHelpers';

/**
 * ThreadsStep (Phase 31, consultant side; Phase 40.4 polish).
 *
 * Two-pane consultant inbox with mobile fallback:
 *   - md and up: list on the left, detail on the right side-by-side.
 *   - below md: single pane — list, then detail with a Back button.
 *
 * Unread state is local-first: we persist a per-engagement
 * `{threadId → lastSeenAt}` map in localStorage and stamp it whenever
 * the consultant opens a thread. The sidebar reads the same store via
 * threadsInboxHelpers.getUnreadCount and shows a count pill.
 *
 * Client→consultant messages still flow through the Pending Review tab
 * via QaMessageCard. After the consultant accepts a QA_MESSAGE
 * submission, the message lands here in the thread (visible immediately
 * because the QA_MESSAGE acceptor stamps acknowledgedAt).
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
  senderMemberId: string | null;
  senderUserId: string | null;
  body: string;
  acknowledgedAt: string | null;
  sourceSubmissionId: string | null;
  createdAt: string;
}

function toSummary(t: ThreadRow): ThreadSummary {
  return { id: t.id, status: t.status, lastMessageAt: t.lastMessageAt };
}

export function ThreadsStep({ engagementId }: { engagementId: string }) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const qc = useQueryClient();
  const storage = typeof window !== 'undefined' ? window.localStorage : undefined;

  const { data: threads, isLoading } = useQuery({
    queryKey: ['threads', engagementId],
    queryFn: () => engagementsApi.listThreads(engagementId) as Promise<ThreadRow[]>,
    enabled: !!engagementId,
    staleTime: 15_000,
  });

  // Re-read on every render so when ThreadDetail stamps a new lastSeenAt we
  // reflect it without round-tripping through component state. The map is
  // small (per-engagement, per-thread) so the read is effectively free.
  // The version counter forces useMemo to re-run after a stamp; eslint
  // can't see why it's listed because it doesn't appear in the body.
  const [lastSeenVersion, setLastSeenVersion] = useState(0);
  const lastSeen: LastSeenMap = useMemo(
    () => getLastSeenMap(engagementId, storage),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engagementId, storage, lastSeenVersion]
  );

  // Memoise the list so its identity is stable across renders that don't
  // change the underlying query data — keeps the open-thread effect from
  // re-firing every time React reconciles.
  const list: ThreadRow[] = useMemo(() => (Array.isArray(threads) ? threads : []), [threads]);

  // Stamp the active thread as seen — runs whenever the active id flips.
  useEffect(() => {
    if (!activeThreadId) return;
    const t = list.find((x) => x.id === activeThreadId);
    if (!t) return;
    // We want the map to record the moment we OPENED it, not the
    // lastMessageAt — but lastMessageAt works just as well as long as it's
    // monotonically advancing. Using lastMessageAt avoids drift between
    // server clock and client clock.
    const stampAt = t.lastMessageAt || new Date().toISOString();
    setThreadSeen(engagementId, activeThreadId, stampAt, storage);
    setLastSeenVersion((v) => v + 1);
    // Sidebar reads from the same React Query cache — invalidate so the
    // unread pill recomputes against the fresh lastSeen map.
    qc.invalidateQueries({ queryKey: ['threads-unread', engagementId] });
  }, [activeThreadId, engagementId, storage, qc, list]);

  // ── Loading state ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto py-8 text-center">
        <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full mx-auto" />
        <p className="mt-3 text-sm text-slate-500">Loading threads…</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1 flex items-center gap-2">
            <MessageCircle className="h-6 w-6 text-brand-600" />
            Threads
            {list.length > 0 && (
              <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 tabular-nums">
                {list.length}
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500">
            Q&amp;A threads with the client. Your messages send immediately; client messages
            queue in Pending Review until you accept them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCompose(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors flex-shrink-0"
          data-testid="threads-new-button"
        >
          <Plus className="h-4 w-4" />
          New thread
        </button>
      </div>

      {showCompose && (
        <NewThreadInline
          engagementId={engagementId}
          onClose={() => setShowCompose(false)}
          onCreated={(t) => {
            setShowCompose(false);
            qc.invalidateQueries({ queryKey: ['threads', engagementId] });
            setActiveThreadId(t.id);
          }}
        />
      )}

      {list.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center"
          data-testid="threads-empty-state"
        >
          <div className="mx-auto w-14 h-14 rounded-full bg-slate-50 flex items-center justify-center mb-4">
            <MessageCircle className="h-7 w-7 text-slate-400" />
          </div>
          <p className="text-base font-semibold text-slate-700 mb-2">No threads yet</p>
          <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
            Start a new thread to ask the client a question. They can also start threads from the
            portal — those land in the Pending Review tab first.
          </p>
        </div>
      ) : (
        <TwoPaneLayout
          activeThreadId={activeThreadId}
          list={list}
          lastSeen={lastSeen}
          onSelect={(id) => setActiveThreadId(id)}
          onBack={() => setActiveThreadId(null)}
          engagementId={engagementId}
        />
      )}
    </div>
  );
}

// ─── Two-pane layout ─────────────────────────────────────────────────────────

function TwoPaneLayout({
  activeThreadId, list, lastSeen, onSelect, onBack, engagementId,
}: {
  activeThreadId: string | null;
  list: ThreadRow[];
  lastSeen: LastSeenMap;
  onSelect: (id: string) => void;
  onBack: () => void;
  engagementId: string;
}) {
  const showListOnMobile = activeThreadId === null;
  const showDetailOnMobile = activeThreadId !== null;

  return (
    <div className="md:grid md:grid-cols-[320px_minmax(0,1fr)] md:gap-4">
      {/* List pane — always visible on md+, hidden on mobile when a thread is open */}
      <div className={cn(
        'space-y-2',
        showListOnMobile ? 'block' : 'hidden md:block'
      )} data-testid="threads-list">
        {list.map((t) => (
          <ThreadListRow
            key={t.id}
            thread={t}
            isActive={t.id === activeThreadId}
            unread={isThreadUnread(toSummary(t), lastSeen)}
            onClick={() => onSelect(t.id)}
          />
        ))}
      </div>

      {/* Detail pane — visible on md+ when a thread is selected, full-width on mobile */}
      <div className={cn(showDetailOnMobile ? 'block' : 'hidden md:block')}>
        {activeThreadId ? (
          <ThreadDetail
            engagementId={engagementId}
            threadId={activeThreadId}
            onBack={onBack}
          />
        ) : (
          <ThreadDetailEmptyState />
        )}
      </div>
    </div>
  );
}

function ThreadDetailEmptyState() {
  return (
    <div className="hidden md:flex h-full min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-3">
        <MessageCircle className="h-6 w-6 text-slate-400" />
      </div>
      <p className="text-sm font-semibold text-slate-700">Pick a thread to read</p>
      <p className="text-xs text-slate-500 mt-1 max-w-xs">
        Select a thread from the list to view messages and reply.
      </p>
    </div>
  );
}

function ThreadListRow({
  thread, isActive, unread, onClick,
}: {
  thread: ThreadRow;
  isActive: boolean;
  unread: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-xl border bg-white p-3.5 transition-colors',
        isActive
          ? 'border-brand-300 bg-brand-50/40 ring-1 ring-brand-200'
          : 'border-slate-200 hover:border-brand-200'
      )}
      data-testid={`thread-row-${thread.id}`}
      aria-current={isActive ? 'true' : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {unread && (
            <span
              className="h-2 w-2 rounded-full bg-brand-500 flex-shrink-0"
              data-testid={`thread-unread-dot-${thread.id}`}
              aria-label="Unread"
            />
          )}
          <p className={cn(
            'text-sm truncate',
            unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'
          )}>
            {thread.subject}
          </p>
        </div>
        {thread.status === 'RESOLVED' ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1 flex-shrink-0">
            <CircleCheck className="h-3 w-3" />
            Resolved
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-slate-400 mt-1">
        {new Date(thread.lastMessageAt).toLocaleString('en-GB', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        })}
      </p>
    </button>
  );
}

// ─── New-thread inline form ──────────────────────────────────────────────────

function NewThreadInline({
  engagementId,
  onClose,
  onCreated,
}: {
  engagementId: string;
  onClose: () => void;
  onCreated: (t: ThreadRow) => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const mut = useMutation({
    mutationFn: () => engagementsApi.createThread(engagementId, { subject, body }) as Promise<ThreadRow>,
    onSuccess: (t) => onCreated(t),
  });
  const canSubmit = subject.trim().length > 0 && body.trim().length > 0 && !mut.isPending;

  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50/30 p-5 mb-4" data-testid="threads-new-inline">
      <p className="text-sm font-bold text-brand-900 mb-3">New thread</p>
      <input
        type="text"
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 mb-2"
      />
      <textarea
        placeholder="Your message"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 mb-3"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => mut.mutate()}
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          Create thread
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Thread detail view ──────────────────────────────────────────────────────

function ThreadDetail({
  engagementId,
  threadId,
  onBack,
}: {
  engagementId: string;
  threadId: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['thread', engagementId, threadId],
    queryFn: () =>
      engagementsApi.getThread(engagementId, threadId) as Promise<{
        thread: ThreadRow;
        messages: MessageRow[];
      }>,
    enabled: !!threadId,
    refetchInterval: 30_000,
  });

  const sendMut = useMutation({
    mutationFn: () => engagementsApi.postThreadMessage(engagementId, threadId, draft.trim()),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['thread', engagementId, threadId] });
      qc.invalidateQueries({ queryKey: ['threads', engagementId] });
    },
  });

  const resolveMut = useMutation({
    mutationFn: () =>
      engagementsApi.patchThreadStatus(engagementId, threadId, 'RESOLVED') as Promise<ThreadRow>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thread', engagementId, threadId] });
      qc.invalidateQueries({ queryKey: ['threads', engagementId] });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
      {/* Mobile-only back button — on md+ the list is always visible alongside */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex md:hidden items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        data-testid="thread-detail-back"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to threads
      </button>
      <div className="flex items-start justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold text-slate-900 break-words">{data.thread.subject}</h2>
        {data.thread.status === 'OPEN' ? (
          <button
            type="button"
            onClick={() => resolveMut.mutate()}
            disabled={resolveMut.isPending}
            className="text-xs font-semibold text-slate-500 hover:text-emerald-600 underline-offset-2 hover:underline flex-shrink-0"
            data-testid="thread-detail-resolve"
          >
            Mark resolved
          </button>
        ) : (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1 flex-shrink-0">
            <CircleCheck className="h-3 w-3" />
            Resolved
          </span>
        )}
      </div>

      <div className="space-y-3 mb-4 max-h-[55vh] overflow-y-auto pr-1" data-testid="thread-messages">
        {data.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      {data.thread.status === 'OPEN' && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply to the client…"
            rows={3}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 mb-2"
            data-testid="thread-detail-composer"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => sendMut.mutate()}
              disabled={draft.trim().length === 0 || sendMut.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
              data-testid="thread-detail-send"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: MessageRow }) {
  const isConsultant = message.senderType === 'CONSULTANT';
  return (
    <div className={cn('flex', isConsultant ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5',
          isConsultant
            ? 'bg-brand-600 text-white rounded-tr-sm'
            : 'bg-slate-100 text-slate-800 rounded-tl-sm',
        )}
      >
        <p
          className={cn(
            'text-[10px] font-bold uppercase tracking-wider mb-0.5',
            isConsultant ? 'text-white/70' : 'text-slate-500',
          )}
        >
          {isConsultant ? 'You' : 'Client'}
        </p>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.body}</p>
        <p
          className={cn(
            'text-[10px] mt-1.5',
            isConsultant ? 'text-white/60' : 'text-slate-400',
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
