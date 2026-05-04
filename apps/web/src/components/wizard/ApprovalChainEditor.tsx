import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, AlertCircle, Info } from 'lucide-react';
import { useWizardStore } from '@/stores/wizardStore';
import { useAnswerMutation } from '@/hooks/useAnswerMutation';
import { cn } from '@/lib/utils';

/**
 * Phase 24 — Approval Chain Editor.
 *
 * Inline structured editor that renders below an approval boolean
 * question (when boolean === true) inside a FlowSectionStep. Captures
 * per-currency tier sets, escalation, alternates, self-approval bypass,
 * and free-form notes. Persists as a JSON-stringified payload under the
 * structured answer key passed in via props.
 *
 * Validation is warn-and-allow at the editor level — gaps / overlaps /
 * missing roles surface inline as ⚠ icons but don't block save. The
 * generator-side validator surfaces the same issues at render time as
 * a ⚠ callout in the Solution Design (defence in depth).
 *
 * NetSuite-only feature — but the editor itself is adaptor-agnostic.
 * The Solution Design renderer self-gates on adaptor.id === 'netsuite'
 * so opening this editor on a non-NetSuite engagement is harmless.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApprovalTier {
  lowerBound: number;
  upperBound: number | null;
  role: string;
  escalationHours: number;
  alternateApprover: string;
}

interface ApprovalChain {
  byCurrency: Record<string, ApprovalTier[]>;
  selfApprovalBypassUpTo: Record<string, number>;
  notes: string;
}

interface ApprovalChainEditorProps {
  /** Engagement id — passed through to useAnswerMutation. */
  engagementId: string;
  /** The structured answer key this editor reads + writes. */
  structuredKey: string;
  /** Human label for the heading (e.g. "Purchase Order Approval"). */
  flowLabel: string;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

function newTier(): ApprovalTier {
  return {
    lowerBound: 0,
    upperBound: null,
    role: '',
    escalationHours: 24,
    alternateApprover: '',
  };
}

function emptyChain(baseCurrency: string): ApprovalChain {
  // Pre-seed with a single default tier per design refinement #3 — visual
  // blank is a worse UX than a placeholder row.
  return {
    byCurrency: {
      [baseCurrency]: [newTier()],
    },
    selfApprovalBypassUpTo: {
      [baseCurrency]: 0,
    },
    notes: '',
  };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadChain(raw: unknown, baseCurrency: string): ApprovalChain {
  if (raw === null || raw === undefined) return emptyChain(baseCurrency);
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return emptyChain(baseCurrency);
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return emptyChain(baseCurrency);
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return emptyChain(baseCurrency);
  }
  const obj = parsed as Record<string, unknown>;
  const byCurrency: Record<string, ApprovalTier[]> = {};
  if (obj.byCurrency !== null && obj.byCurrency !== undefined && typeof obj.byCurrency === 'object') {
    for (const [c, tiers] of Object.entries(obj.byCurrency as Record<string, unknown>)) {
      if (!Array.isArray(tiers)) continue;
      byCurrency[c.toUpperCase()] = tiers
        .filter((t): t is Record<string, unknown> => t !== null && typeof t === 'object')
        .map((t) => ({
          lowerBound: typeof t.lowerBound === 'number' ? t.lowerBound : 0,
          upperBound:
            t.upperBound === null
              ? null
              : typeof t.upperBound === 'number'
                ? t.upperBound
                : null,
          role: typeof t.role === 'string' ? t.role : '',
          escalationHours: typeof t.escalationHours === 'number' ? t.escalationHours : 0,
          alternateApprover: typeof t.alternateApprover === 'string' ? t.alternateApprover : '',
        }));
    }
  }
  if (Object.keys(byCurrency).length === 0) {
    return emptyChain(baseCurrency);
  }
  const selfApprovalBypassUpTo: Record<string, number> = {};
  if (
    obj.selfApprovalBypassUpTo !== null &&
    obj.selfApprovalBypassUpTo !== undefined &&
    typeof obj.selfApprovalBypassUpTo === 'object'
  ) {
    for (const [c, amt] of Object.entries(obj.selfApprovalBypassUpTo as Record<string, unknown>)) {
      selfApprovalBypassUpTo[c.toUpperCase()] = typeof amt === 'number' ? amt : 0;
    }
  }
  const notes = typeof obj.notes === 'string' ? obj.notes : '';
  return { byCurrency, selfApprovalBypassUpTo, notes };
}

// ─── Inline validation (matches the generator validator surface) ────────────

interface RowIssue {
  currency: string;
  tierIndex: number;
  message: string;
}

function validateChain(chain: ApprovalChain): RowIssue[] {
  const out: RowIssue[] = [];
  for (const [currency, tiers] of Object.entries(chain.byCurrency)) {
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      if (t.role.trim().length === 0) {
        out.push({ currency, tierIndex: i, message: 'role is required' });
      }
      if (i > 0) {
        const prev = tiers[i - 1];
        if (prev.upperBound === null) {
          out.push({
            currency,
            tierIndex: i,
            message: 'tier sits after an "unlimited" tier — only the highest tier may have an open upper bound',
          });
        } else if (t.lowerBound > prev.upperBound + 1) {
          out.push({
            currency,
            tierIndex: i,
            message: `gap with previous tier (ends ${prev.upperBound}, this starts ${t.lowerBound})`,
          });
        } else if (t.lowerBound <= prev.upperBound) {
          out.push({
            currency,
            tierIndex: i,
            message: `overlaps previous tier (ends ${prev.upperBound}, this starts ${t.lowerBound})`,
          });
        }
      }
    }
    if (tiers.length > 0 && tiers[tiers.length - 1].upperBound !== null) {
      out.push({
        currency,
        tierIndex: tiers.length - 1,
        message: 'top tier should have unlimited upper bound',
      });
    }
  }
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ApprovalChainEditor({
  engagementId,
  structuredKey,
  flowLabel,
}: ApprovalChainEditorProps) {
  const answers = useWizardStore((s) => s.answers);
  const mergeAnswers = useWizardStore((s) => s.mergeAnswers);
  const { saveAnswerNow } = useAnswerMutation(engagementId);

  // Pull the engagement's base currency for default tier currency. Falls
  // back to USD if R2R section isn't filled in yet.
  const baseCurrency = useMemo(() => {
    const raw = answers['r2r.currencies.baseCurrency'];
    return typeof raw === 'string' && raw.trim().length === 3 ? raw.trim().toUpperCase() : 'USD';
  }, [answers]);

  const chain = useMemo(
    () => loadChain(answers[structuredKey], baseCurrency),
    [answers, structuredKey, baseCurrency],
  );
  const issues = useMemo(() => validateChain(chain), [chain]);

  const [activeCurrency, setActiveCurrency] = useState<string>(() => {
    const currencies = Object.keys(chain.byCurrency);
    return currencies[0] ?? baseCurrency;
  });
  const [collapsed, setCollapsed] = useState(false);

  const persist = useCallback(
    (next: ApprovalChain) => {
      const json = JSON.stringify(next);
      mergeAnswers({ [structuredKey]: json });
      saveAnswerNow(structuredKey, json);
    },
    [mergeAnswers, saveAnswerNow, structuredKey],
  );

  // ── Tier ops ──
  const updateTier = useCallback(
    (currency: string, tierIndex: number, patch: Partial<ApprovalTier>) => {
      const tiers = (chain.byCurrency[currency] ?? []).map((t, i) =>
        i === tierIndex ? { ...t, ...patch } : t,
      );
      persist({ ...chain, byCurrency: { ...chain.byCurrency, [currency]: tiers } });
    },
    [chain, persist],
  );

  const addTier = useCallback(
    (currency: string) => {
      const tiers = chain.byCurrency[currency] ?? [];
      // Smart default: new tier picks up where the last one ends.
      const last = tiers[tiers.length - 1];
      const next: ApprovalTier =
        last && last.upperBound !== null
          ? { ...newTier(), lowerBound: last.upperBound + 1 }
          : newTier();
      persist({
        ...chain,
        byCurrency: { ...chain.byCurrency, [currency]: [...tiers, next] },
      });
    },
    [chain, persist],
  );

  const removeTier = useCallback(
    (currency: string, tierIndex: number) => {
      const tiers = (chain.byCurrency[currency] ?? []).filter((_, i) => i !== tierIndex);
      persist({ ...chain, byCurrency: { ...chain.byCurrency, [currency]: tiers } });
    },
    [chain, persist],
  );

  // ── Currency ops ──
  const addCurrency = useCallback(
    (currency: string) => {
      const code = currency.trim().toUpperCase();
      if (code.length !== 3 || chain.byCurrency[code]) return;
      persist({
        ...chain,
        byCurrency: { ...chain.byCurrency, [code]: [newTier()] },
        selfApprovalBypassUpTo: { ...chain.selfApprovalBypassUpTo, [code]: 0 },
      });
      setActiveCurrency(code);
    },
    [chain, persist],
  );

  const removeCurrency = useCallback(
    (currency: string) => {
      const { [currency]: _removed, ...rest } = chain.byCurrency;
      const { [currency]: _bypassRemoved, ...bypassRest } = chain.selfApprovalBypassUpTo;
      void _removed;
      void _bypassRemoved;
      persist({ ...chain, byCurrency: rest, selfApprovalBypassUpTo: bypassRest });
      const remaining = Object.keys(rest);
      if (remaining.length > 0) setActiveCurrency(remaining[0]);
    },
    [chain, persist],
  );

  // ── Bypass + notes ──
  const updateBypass = useCallback(
    (currency: string, amount: number) => {
      persist({
        ...chain,
        selfApprovalBypassUpTo: { ...chain.selfApprovalBypassUpTo, [currency]: amount },
      });
    },
    [chain, persist],
  );

  const updateNotes = useCallback(
    (notes: string) => {
      persist({ ...chain, notes });
    },
    [chain, persist],
  );

  const currencies = useMemo(() => Object.keys(chain.byCurrency).sort(), [chain]);
  const tiers = chain.byCurrency[activeCurrency] ?? [];
  const tierIssues = issues.filter((i) => i.currency === activeCurrency);

  // ── Render ──

  return (
    <div className="my-3 rounded-xl border border-violet-200 bg-violet-50/30 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-violet-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {collapsed ? (
            <ChevronRight className="h-4 w-4 text-violet-700" />
          ) : (
            <ChevronDown className="h-4 w-4 text-violet-700" />
          )}
          <span className="text-sm font-semibold text-violet-900">
            Approval Chain — {flowLabel}
          </span>
          {issues.length > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
              <AlertCircle className="h-3 w-3" />
              {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
            </span>
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-violet-600 font-bold">
          Phase 24
        </span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-4 border-t border-violet-100">
          {/* Currency tabs */}
          <div className="flex items-center gap-1 mt-3 -mb-px overflow-x-auto">
            {currencies.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCurrency(c)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap',
                  activeCurrency === c
                    ? 'border-violet-500 text-violet-800'
                    : 'border-transparent text-slate-500 hover:text-slate-800',
                )}
              >
                {c}
                {chain.byCurrency[c].length > 0 && (
                  <span className="text-[10px] text-slate-400 tabular-nums">
                    {chain.byCurrency[c].length}
                  </span>
                )}
                {currencies.length > 1 && activeCurrency === c && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCurrency(c);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        removeCurrency(c);
                      }
                    }}
                    className="ml-1 inline-flex items-center text-slate-300 hover:text-red-500 cursor-pointer"
                    title={`Remove ${c} chain`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </span>
                )}
              </button>
            ))}
            <AddCurrencyButton existing={currencies} onAdd={addCurrency} />
          </div>

          {/* Tier rows */}
          <div className="space-y-2">
            {tiers.map((tier, idx) => {
              const issue = tierIssues.find((i) => i.tierIndex === idx);
              return (
                <div
                  key={idx}
                  className={cn(
                    'rounded-lg border bg-white p-3',
                    issue ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200',
                  )}
                >
                  <div className="grid grid-cols-12 gap-2 items-end">
                    {/* Tier number */}
                    <div className="col-span-1 text-center">
                      <div className="text-[9px] font-bold text-slate-400 uppercase">Tier</div>
                      <div className="text-sm font-bold text-violet-700 mt-1">{idx + 1}</div>
                    </div>

                    {/* Lower bound */}
                    <div className="col-span-2">
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">
                        From
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={tier.lowerBound}
                        onChange={(e) =>
                          updateTier(activeCurrency, idx, {
                            lowerBound: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500"
                      />
                    </div>

                    {/* Upper bound */}
                    <div className="col-span-2">
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">
                        To
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          value={tier.upperBound ?? ''}
                          disabled={tier.upperBound === null}
                          placeholder={tier.upperBound === null ? '∞' : ''}
                          onChange={(e) =>
                            updateTier(activeCurrency, idx, {
                              upperBound: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:bg-slate-50 disabled:text-slate-400"
                        />
                        <label className="flex items-center gap-1 text-[9px] text-slate-500 whitespace-nowrap cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tier.upperBound === null}
                            onChange={(e) =>
                              updateTier(activeCurrency, idx, {
                                upperBound: e.target.checked ? null : 0,
                              })
                            }
                            className="h-3 w-3"
                          />
                          ∞
                        </label>
                      </div>
                    </div>

                    {/* Role */}
                    <div className="col-span-3">
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">
                        Approver Role *
                      </label>
                      <input
                        type="text"
                        value={tier.role}
                        placeholder="e.g. Department Manager"
                        onChange={(e) =>
                          updateTier(activeCurrency, idx, { role: e.target.value })
                        }
                        className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500"
                      />
                    </div>

                    {/* Escalation hours */}
                    <div className="col-span-1">
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">
                        Esc h
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={tier.escalationHours}
                        onChange={(e) =>
                          updateTier(activeCurrency, idx, {
                            escalationHours: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500"
                      />
                    </div>

                    {/* OOO Alternate */}
                    <div className="col-span-2">
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">
                        OOO Alt
                      </label>
                      <input
                        type="text"
                        value={tier.alternateApprover}
                        placeholder="(optional)"
                        onChange={(e) =>
                          updateTier(activeCurrency, idx, { alternateApprover: e.target.value })
                        }
                        className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500"
                      />
                    </div>

                    {/* Remove button */}
                    <div className="col-span-1 flex items-end justify-end">
                      <button
                        type="button"
                        onClick={() => removeTier(activeCurrency, idx)}
                        className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Remove tier"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {issue && (
                    <p className="mt-2 text-[10px] text-amber-700 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {issue.message}
                    </p>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => addTier(activeCurrency)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-violet-300 text-xs font-medium text-violet-600 hover:border-violet-400 hover:bg-violet-50 transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add tier
            </button>
          </div>

          {/* Self-approval bypass */}
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">
              Self-approval bypass ({activeCurrency})
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={chain.selfApprovalBypassUpTo[activeCurrency] ?? 0}
                onChange={(e) => updateBypass(activeCurrency, Number(e.target.value) || 0)}
                className="flex-1 rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              <span className="text-[10px] text-slate-500">
                Requesters self-approve up to this amount; 0 = no bypass.
              </span>
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">
              Notes
            </label>
            <textarea
              value={chain.notes}
              placeholder="Free-form context for the consultant — e.g. 'Credit-hold transition triggers when customer overdue >30d'"
              onChange={(e) => updateNotes(e.target.value)}
              rows={2}
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
            />
          </div>

          {/* Footer */}
          <div className="flex items-start gap-1.5 text-[10px] text-violet-700 bg-violet-50 rounded p-2">
            <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
            <span>
              On Generate Package, these tiers render into the Solution Design with concrete
              SuiteFlow build steps. NetSuite-only — Phase 6 architectural decision: workflow
              XML is authored in the NS UI, not emitted from SDF.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add-currency button ─────────────────────────────────────────────────────

function AddCurrencyButton({
  existing,
  onAdd,
}: {
  existing: string[];
  onAdd: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');

  const submit = () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length === 3 && !existing.includes(trimmed)) {
      onAdd(trimmed);
      setCode('');
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-violet-600 hover:bg-violet-50 rounded"
      >
        <Plus className="h-3 w-3" />
        Add currency
      </button>
    );
  }

  return (
    <div className="ml-auto flex items-center gap-1">
      <input
        type="text"
        value={code}
        autoFocus
        maxLength={3}
        placeholder="USD"
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') setOpen(false);
        }}
        className="w-14 rounded border border-violet-200 px-1.5 py-1 text-[11px] font-mono uppercase focus:outline-none focus:ring-1 focus:ring-violet-500"
      />
      <button
        type="button"
        onClick={submit}
        className="px-2 py-1 text-[10px] font-bold rounded bg-violet-600 text-white hover:bg-violet-700"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-1.5 py-1 text-[10px] text-slate-400 hover:text-slate-600"
      >
        ✕
      </button>
    </div>
  );
}
