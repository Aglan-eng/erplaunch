/**
 * Phase 55.2 — Context-aware AI assistant.
 *
 * Slide-in panel from the right edge. Openable on any page from the
 * Phase 55.1 sidebar (or via Cmd/Ctrl+J). Reads the current route +
 * customerId from React Router; the server-side context builder
 * never trusts the client for the actual data.
 *
 * Behaviour:
 *   - Closed by default. Opens via `<AssistantTrigger />` (mounted in
 *     SideNav) or the keyboard shortcut.
 *   - On open, shows the current context line so the user sees that
 *     the assistant knows where they are.
 *   - Each send hits `POST /api/v1/assistant/chat` with the message
 *     + conversationId + { page, customerId }. The reply renders as
 *     a chat bubble; suggestedActions render as buttons that
 *     `navigate(target)` for kind='navigate'.
 *   - Conversation persists per (user, customer) — on next open the
 *     latest conversation for the current context is restored.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Bot, X, ArrowRight, Send, Loader2 } from 'lucide-react';
import {
  assistantApi,
  type AssistantMessage,
  type AssistantSuggestedAction,
} from '@/lib/api';
import { cn } from '@/lib/utils';

interface AssistantPanelContextValue {
  open: boolean;
  setOpen: (next: boolean) => void;
}

const AssistantPanelContext = React.createContext<AssistantPanelContextValue>({
  open: false,
  setOpen: () => {},
});

/**
 * Read the current customer id from the URL if we're on a customer
 * route. Used so the panel knows what to ask the server to scope to.
 */
function useCurrentCustomerId(): string | null {
  const params = useParams<{ id?: string }>();
  const location = useLocation();
  if (params.id && location.pathname.startsWith('/customers/')) {
    return params.id;
  }
  return null;
}

export function AssistantProvider({
  children,
  initialOpen = false,
}: {
  children: React.ReactNode;
  /** Test-only — render the panel already open so SSR snapshots
   *  can verify the open-state DOM without exercising click events. */
  initialOpen?: boolean;
}) {
  const [open, setOpenState] = useState(initialOpen);

  // Stable setter — `setOpenState` is itself stable from useState, but
  // wrapping in useCallback makes the intent explicit and lets us pass
  // it through useMemo'd context without React triggering re-renders
  // of every consumer on every parent render.
  const setOpen = useCallback((next: boolean) => setOpenState(next), []);

  // Cmd/Ctrl+J global shortcut. Only registers on the client.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpenState((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Phase 55.2 hotfix — memoize the context value. Without this, every
  // re-render of AssistantProvider creates a new {open, setOpen} object,
  // which invalidates every consumer of useAssistantPanel() and ripples
  // re-renders into the sidebar trigger + the panel itself. The Phase
  // 55.1 sidebar + 6-useQuery dashboard rendered AssistantProvider on
  // every page mount; combined with the unmemoized context, this
  // produced a render storm that pegged the main thread.
  const value = useMemo(() => ({ open, setOpen }), [open, setOpen]);

  return (
    <AssistantPanelContext.Provider value={value}>
      {children}
      <AssistantPanel />
    </AssistantPanelContext.Provider>
  );
}

export function useAssistantPanel(): AssistantPanelContextValue {
  return React.useContext(AssistantPanelContext);
}

/**
 * Sidebar trigger — render inside `SideNav` so the assistant is
 * reachable from every page.
 */
export function AssistantTrigger({ collapsed = false }: { collapsed?: boolean }) {
  const { setOpen } = useAssistantPanel();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      data-testid="assistant-trigger"
      title="Open AI assistant (Ctrl+J)"
      className="w-full group relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-brand-50 hover:text-brand-700 transition-colors"
    >
      <Bot className="h-4 w-4 flex-shrink-0 text-brand-600" />
      {!collapsed && (
        <>
          <span className="flex-1 text-left">Assistant</span>
          <span className="text-[10px] text-gray-400 font-mono">⌘J</span>
        </>
      )}
    </button>
  );
}

function AssistantPanel() {
  const { open, setOpen } = useAssistantPanel();
  const location = useLocation();
  const navigate = useNavigate();
  const customerId = useCurrentCustomerId();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reset conversation when context changes (different customer).
  useEffect(() => {
    setConversationId(null);
    setMessages([]);
    setError(null);
  }, [customerId]);

  // Scroll the transcript to the bottom whenever messages update.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const contextLine = useMemo(() => {
    if (customerId) {
      return `Assisting with customer ${customerId} (route ${location.pathname})`;
    }
    return `Firm-wide context (route ${location.pathname})`;
  }, [customerId, location.pathname]);

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    // Optimistically append the user's bubble.
    const userMsg: AssistantMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      suggestedActions: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    try {
      const resp = await assistantApi.chat({
        message: text,
        conversationId: conversationId ?? undefined,
        context: {
          page: location.pathname,
          customerId: customerId ?? undefined,
        },
      });
      setConversationId(resp.conversationId);
      const reply: AssistantMessage = {
        id: `srv-${resp.conversationId}-${Date.now()}`,
        role: 'assistant',
        content: resp.reply,
        suggestedActions: resp.suggestedActions,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, reply]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to reach the assistant';
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  const onActionClick = (action: AssistantSuggestedAction): void => {
    if (action.kind === 'navigate' && action.target.startsWith('/')) {
      navigate(action.target);
      setOpen(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ERPLaunch AI assistant"
      data-testid="assistant-panel"
      data-customer-id={customerId ?? ''}
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[420px] bg-white border-l border-gray-200 shadow-xl flex flex-col"
    >
      {/* ── Header ───────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-md bg-brand-50 text-brand-700 flex items-center justify-center flex-shrink-0">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">Assistant</h2>
            <p
              data-testid="assistant-context-line"
              className="text-[10px] text-gray-500 truncate"
            >
              {contextLine}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          data-testid="assistant-close"
          aria-label="Close assistant"
          className="text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded p-1 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* ── Transcript ───────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        data-testid="assistant-transcript"
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50"
      >
        {messages.length === 0 && (
          <div
            className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-center"
            data-testid="assistant-empty"
          >
            <Bot className="h-5 w-5 text-brand-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-900">
              Ask me anything about {customerId ? 'this customer' : 'your firm'}.
            </p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Try "what's blocking this project?", "summarise this customer", or
              "which documents do I still need?"
            </p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} onAction={onActionClick} />
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-gray-500" data-testid="assistant-sending">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Thinking…
          </div>
        )}
      </div>

      {/* ── Composer ─────────────────────────────────────────────── */}
      <div className="border-t border-gray-100 p-3">
        {error && (
          <p className="text-xs text-rose-600 mb-2" data-testid="assistant-error">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={customerId ? 'Ask about this customer…' : 'Ask about your firm…'}
            rows={2}
            data-testid="assistant-input"
            className="flex-1 resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || input.trim().length === 0}
            data-testid="assistant-send"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send
          </button>
        </div>
        <p className="mt-2 text-[10px] text-gray-400">
          Advisory only — the assistant suggests; you click to act.
        </p>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onAction,
}: {
  message: AssistantMessage;
  onAction: (a: AssistantSuggestedAction) => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div
      data-testid={isUser ? 'assistant-msg-user' : 'assistant-msg-assistant'}
      className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed',
          isUser
            ? 'bg-brand-600 text-white rounded-br-sm'
            : 'bg-white border border-gray-200 text-gray-900 rounded-bl-sm shadow-sm',
        )}
      >
        {message.content}
      </div>
      {!isUser && message.suggestedActions.length > 0 && (
        <div
          className="mt-2 flex flex-wrap gap-1.5 max-w-[85%]"
          data-testid="assistant-suggested-actions"
        >
          {message.suggestedActions.map((a, i) =>
            a.kind === 'navigate' && a.target.startsWith('/') ? (
              <button
                key={`${a.label}-${i}`}
                type="button"
                onClick={() => onAction(a)}
                data-testid={`assistant-action-${i}`}
                className="inline-flex items-center gap-1 rounded-full bg-white border border-brand-200 px-2.5 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-50"
              >
                {a.label}
                <ArrowRight className="h-3 w-3" />
              </button>
            ) : (
              <span
                key={`${a.label}-${i}`}
                data-testid={`assistant-action-${i}`}
                className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600"
              >
                {a.label}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}

