/**
 * ERPLaunch landing chatbot — vanilla client.
 * No dependencies. Streams SSE from /api/chat.
 */
(() => {
  'use strict';

  /** @type {Array<{role: 'user'|'assistant', content: string}>} */
  const messages = [];
  let streaming = false;
  let abortController = null;

  // ── Elements ───────────────────────────────────────────────────────────
  const fab = document.getElementById('chat-fab');
  const panel = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close');
  const list = document.getElementById('chat-messages');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const welcome = document.getElementById('chat-welcome');

  if (!fab || !panel || !form || !input || !list) return;

  // ── Panel open/close ──────────────────────────────────────────────────
  function openPanel() {
    panel.classList.remove('translate-y-full', 'opacity-0', 'pointer-events-none');
    panel.classList.add('translate-y-0', 'opacity-100');
    panel.setAttribute('aria-hidden', 'false');
    fab.setAttribute('aria-expanded', 'true');
    setTimeout(() => input.focus(), 200);
  }
  function closePanel() {
    panel.classList.add('translate-y-full', 'opacity-0', 'pointer-events-none');
    panel.classList.remove('translate-y-0', 'opacity-100');
    panel.setAttribute('aria-hidden', 'true');
    fab.setAttribute('aria-expanded', 'false');
    fab.focus();
  }
  fab.addEventListener('click', () => {
    if (panel.getAttribute('aria-hidden') === 'false') closePanel();
    else openPanel();
  });
  closeBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.getAttribute('aria-hidden') === 'false') closePanel();
  });

  // ── Rendering ─────────────────────────────────────────────────────────
  function bubbleEl(role, text, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = role === 'user' ? 'flex justify-end' : 'flex justify-start';
    const bub = document.createElement('div');
    bub.className = role === 'user'
      ? 'max-w-[85%] rounded-2xl rounded-br-md bg-brand-500 text-white px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words'
      : 'max-w-[85%] rounded-2xl rounded-bl-md bg-white/5 ring-1 ring-white/10 text-ink-100 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words';
    bub.textContent = text;
    if (opts.id) bub.id = opts.id;
    if (role === 'assistant') bub.setAttribute('aria-live', 'polite');
    wrap.appendChild(bub);
    return { wrap, bubble: bub };
  }

  function scrollToBottom() {
    list.scrollTop = list.scrollHeight;
  }

  function appendMessage(role, text) {
    if (welcome && !welcome.classList.contains('hidden')) welcome.classList.add('hidden');
    const { wrap, bubble } = bubbleEl(role, text);
    list.appendChild(wrap);
    scrollToBottom();
    return bubble;
  }

  function appendTyping() {
    const wrap = document.createElement('div');
    wrap.className = 'flex justify-start';
    wrap.id = 'chat-typing';
    wrap.innerHTML = `
      <div class="rounded-2xl rounded-bl-md bg-white/5 ring-1 ring-white/10 px-4 py-3 flex items-center gap-1.5" aria-label="Assistant is typing">
        <span class="w-1.5 h-1.5 rounded-full bg-brand-300 animate-pulse"></span>
        <span class="w-1.5 h-1.5 rounded-full bg-brand-300 animate-pulse" style="animation-delay:0.15s"></span>
        <span class="w-1.5 h-1.5 rounded-full bg-brand-300 animate-pulse" style="animation-delay:0.3s"></span>
      </div>`;
    list.appendChild(wrap);
    scrollToBottom();
  }

  function removeTyping() {
    const el = document.getElementById('chat-typing');
    if (el) el.remove();
  }

  function setSendingState(isSending) {
    streaming = isSending;
    sendBtn.disabled = isSending;
    input.disabled = isSending;
    sendBtn.setAttribute('aria-busy', String(isSending));
    sendBtn.innerHTML = isSending
      ? '<svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="50" stroke-dashoffset="10"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12l14-7-7 14-2-5-5-2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  }

  // ── Send handler ──────────────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (streaming) return;

    const text = input.value.trim();
    if (!text) return;

    messages.push({ role: 'user', content: text });
    appendMessage('user', text);
    input.value = '';
    input.style.height = 'auto';
    setSendingState(true);
    appendTyping();

    abortController = new AbortController();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        removeTyping();
        let detail = 'unknown_error';
        try { const j = await res.json(); detail = j.error || detail; } catch {}
        appendMessage('assistant', `Sorry — something went wrong (${detail}). Try again, or email hello@erplaunch.app.`);
        setSendingState(false);
        return;
      }

      removeTyping();
      const assistantBubble = appendMessage('assistant', '');
      let assistantContent = '';
      messages.push({ role: 'assistant', content: '' });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          if (raw === '[DONE]') { break; }
          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) {
              assistantContent += `\n\n(Error: ${parsed.error})`;
            } else if (parsed.text) {
              assistantContent += parsed.text;
            }
            assistantBubble.textContent = assistantContent;
            messages[messages.length - 1].content = assistantContent;
            scrollToBottom();
          } catch {
            // ignore partial frames
          }
        }
      }
    } catch (err) {
      removeTyping();
      if (err && err.name !== 'AbortError') {
        appendMessage('assistant', `Connection lost. Please retry.`);
      }
    } finally {
      setSendingState(false);
      input.focus();
    }
  });

  // Autosize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });
  // Enter submits (Shift+Enter newline)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // Suggested-question chips
  document.querySelectorAll('[data-suggest]').forEach((btn) => {
    btn.addEventListener('click', () => {
      input.value = btn.getAttribute('data-suggest') || '';
      form.requestSubmit();
    });
  });
})();
