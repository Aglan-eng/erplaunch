import React, { useMemo, useState } from 'react';
import { Copy, Check, Code2 } from 'lucide-react';
import { tokensByGroup, type TokenGroup, type TokenEntry } from '@/lib/tokenCatalog';

/**
 * Phase 50.5 — Variable palette for the template editor.
 *
 * Renders the TOKEN_CATALOG grouped by category. Click a chip to copy
 * `{{token.name}}` to the clipboard — the editor's textarea is
 * uncontrolled enough that a paste is the cheapest "insert" UX
 * without forcing a controlled-input rewrite.
 *
 * Clipboard write uses the modern async API with a graceful fallback
 * to a hidden textarea + execCommand so the chip still works under
 * insecure HTTP origins where navigator.clipboard is undefined.
 */
export function TemplateVariablePalette() {
  const [copied, setCopied] = useState<string | null>(null);
  const groups = useMemo(() => tokensByGroup(), []);

  async function copyToken(token: string): Promise<void> {
    const literal = `{{${token}}}`;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(literal);
      } catch {
        fallbackCopy(literal);
      }
    } else {
      fallbackCopy(literal);
    }
    setCopied(token);
    window.setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
  }

  return (
    <aside
      className="rounded-2xl border border-slate-200 bg-white p-4"
      data-testid="template-variable-palette"
    >
      <div className="flex items-center gap-2 mb-3">
        <Code2 className="h-4 w-4 text-violet-600" />
        <h3 className="text-sm font-bold text-slate-900">Variable palette</h3>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Click any chip to copy <code>{'{{token}}'}</code> to the clipboard,
        then paste it into a template body.
      </p>
      <div className="space-y-3">
        {[...groups.entries()].map(([group, entries]) => (
          <GroupSection
            key={group}
            group={group}
            entries={entries}
            copied={copied}
            onCopy={copyToken}
          />
        ))}
      </div>
    </aside>
  );
}

function GroupSection({
  group,
  entries,
  copied,
  onCopy,
}: {
  group: TokenGroup;
  entries: ReadonlyArray<TokenEntry>;
  copied: string | null;
  onCopy: (token: string) => void;
}) {
  return (
    <div data-testid={`palette-group-${group}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
        {group}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {entries.map((entry) => (
          <button
            key={entry.token}
            onClick={() => onCopy(entry.token)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors ${
              copied === entry.token
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700'
            }`}
            title={entry.description}
            data-testid={`palette-token-${entry.token}`}
          >
            {copied === entry.token ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {entry.token}
          </button>
        ))}
      </div>
    </div>
  );
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    // swallow — the user can read the chip's tooltip and type the
    // token manually as a last resort.
  }
  document.body.removeChild(ta);
}
