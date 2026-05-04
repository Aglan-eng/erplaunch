import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { useWizardStore } from '@/stores/wizardStore';
import { useAnswerMutation } from '@/hooks/useAnswerMutation';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────
//
// Mirrors the StructuredCustomField interface in apps/api's
// sdfStructuredCustomFieldsGenerator.ts. Kept duplicated here (rather than
// imported from a shared package) to avoid a cross-app dependency for one
// small interface.

type FieldType = 'CHECKBOX' | 'DATE' | 'CURRENCY' | 'SELECT' | 'TEXTAREA' | 'FREEFORMTEXT';

interface StructuredCustomField {
  name: string;
  displayLabel: string;
  type: FieldType;
  required: boolean;
  defaultValue: string;
  helpText: string;
  showInList: boolean;
  isSearchable: boolean;
}

const RECORD_TYPES = [
  'Customer',
  'Vendor',
  'Item',
  'Employee',
  'Sales Order',
  'Purchase Order',
  'Invoice',
  'Vendor Bill',
] as const;

type RecordType = (typeof RECORD_TYPES)[number];

const TYPE_OPTIONS: ReadonlyArray<{ value: FieldType; label: string }> = [
  { value: 'FREEFORMTEXT', label: 'Free-form text' },
  { value: 'TEXTAREA', label: 'Textarea (multi-line)' },
  { value: 'CHECKBOX', label: 'Checkbox' },
  { value: 'DATE', label: 'Date' },
  { value: 'CURRENCY', label: 'Currency' },
  { value: 'SELECT', label: 'Select (drop-down)' },
];

const ANSWER_KEY = 'ns.design.customFieldsStructured';

// ─── Defaults ────────────────────────────────────────────────────────────────

function newRow(): StructuredCustomField {
  return {
    name: '',
    displayLabel: '',
    type: 'FREEFORMTEXT',
    required: false,
    defaultValue: '',
    helpText: '',
    showInList: false,
    isSearchable: true,
  };
}

function emptyState(): Record<RecordType, StructuredCustomField[]> {
  const out = {} as Record<RecordType, StructuredCustomField[]>;
  for (const rt of RECORD_TYPES) out[rt] = [];
  return out;
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

function loadFromAnswer(raw: unknown): Record<RecordType, StructuredCustomField[]> {
  const fresh = emptyState();
  if (raw === null || raw === undefined) return fresh;

  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return fresh;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return fresh;
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fresh;

  const map = parsed as Record<string, unknown>;
  for (const rt of RECORD_TYPES) {
    const arr = map[rt];
    if (!Array.isArray(arr)) continue;
    fresh[rt] = arr
      .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
      .map((row) => ({
        name: typeof row.name === 'string' ? row.name : '',
        displayLabel: typeof row.displayLabel === 'string' ? row.displayLabel : '',
        type: TYPE_OPTIONS.some((o) => o.value === row.type)
          ? (row.type as FieldType)
          : 'FREEFORMTEXT',
        required: row.required === true,
        defaultValue: typeof row.defaultValue === 'string' ? row.defaultValue : '',
        helpText: typeof row.helpText === 'string' ? row.helpText : '',
        showInList: row.showInList === true,
        isSearchable: row.isSearchable !== false, // default true
      }));
  }
  return fresh;
}

// ─── Validation (inline UI feedback) ─────────────────────────────────────────

interface RowError {
  rowIndex: number;
  field: 'name' | 'displayLabel';
  message: string;
}

function validateTab(rows: StructuredCustomField[]): RowError[] {
  const errs: RowError[] = [];
  const seen = new Map<string, number>(); // lower-name → first rowIndex
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const trimmed = r.name.trim();
    if (trimmed.length === 0) {
      errs.push({ rowIndex: i, field: 'name', message: 'name is required' });
      continue;
    }
    // Slugify-empty check (matches generator's rule).
    const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (slug.length === 0) {
      errs.push({
        rowIndex: i,
        field: 'name',
        message: 'name must contain at least one alphanumeric character',
      });
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      errs.push({
        rowIndex: i,
        field: 'name',
        message: `duplicate of row ${(seen.get(key) ?? 0) + 1}`,
      });
    } else {
      seen.set(key, i);
    }
  }
  return errs;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface CustomFieldsStepProps {
  engagementId: string;
}

export function CustomFieldsStep({ engagementId }: CustomFieldsStepProps) {
  const answers = useWizardStore((s) => s.answers);
  const mergeAnswers = useWizardStore((s) => s.mergeAnswers);
  const { saveAnswerNow } = useAnswerMutation(engagementId);

  const [activeTab, setActiveTab] = useState<RecordType>('Customer');
  const state = useMemo(() => loadFromAnswer(answers[ANSWER_KEY]), [answers]);
  const tabRows = state[activeTab];
  const tabErrors = useMemo(() => validateTab(tabRows), [tabRows]);

  const persist = useCallback(
    (next: Record<RecordType, StructuredCustomField[]>) => {
      // Store as JSON string for explicit, predictable wire format.
      const json = JSON.stringify(next);
      mergeAnswers({ [ANSWER_KEY]: json });
      saveAnswerNow(ANSWER_KEY, json);
    },
    [mergeAnswers, saveAnswerNow],
  );

  const updateRow = useCallback(
    (rowIndex: number, patch: Partial<StructuredCustomField>) => {
      const nextTab = state[activeTab].map((r, i) => (i === rowIndex ? { ...r, ...patch } : r));
      const next = { ...state, [activeTab]: nextTab };
      persist(next);
    },
    [state, activeTab, persist],
  );

  const addRow = useCallback(() => {
    const next = { ...state, [activeTab]: [...state[activeTab], newRow()] };
    persist(next);
  }, [state, activeTab, persist]);

  const removeRow = useCallback(
    (rowIndex: number) => {
      const next = {
        ...state,
        [activeTab]: state[activeTab].filter((_, i) => i !== rowIndex),
      };
      persist(next);
    },
    [state, activeTab, persist],
  );

  const tabHasErrors = (rt: RecordType): boolean =>
    validateTab(state[rt]).length > 0;

  const totalCount = useMemo(
    () => RECORD_TYPES.reduce((sum, rt) => sum + state[rt].length, 0),
    [state],
  );

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Custom Fields</h1>
        <p className="text-sm text-slate-500">
          Define custom fields per NetSuite record type. Each row emits one SDF XML
          (<code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">cust&lt;entity|item|body&gt;_nsix_&lt;slug&gt;</code>)
          on Generate Package. Total fields configured:{' '}
          <span className="font-semibold text-slate-700">{totalCount}</span>.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-4">
        <nav className="flex gap-1 -mb-px overflow-x-auto" aria-label="Record types">
          {RECORD_TYPES.map((rt) => {
            const isActive = activeTab === rt;
            const hasErr = tabHasErrors(rt);
            const count = state[rt].length;
            return (
              <button
                key={rt}
                onClick={() => setActiveTab(rt)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  isActive
                    ? 'border-brand-500 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300',
                )}
              >
                {rt}
                {count > 0 && (
                  <span
                    className={cn(
                      'text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums',
                      isActive ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {count}
                  </span>
                )}
                {hasErr && <AlertCircle className="h-3.5 w-3.5 text-red-500" />}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Empty state */}
      {tabRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-sm text-slate-400 mb-4">
            No custom fields defined for {activeTab} yet.
          </p>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add first field
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tabRows.map((row, idx) => {
            const rowErr = tabErrors.find((e) => e.rowIndex === idx);
            return (
              <div
                key={idx}
                className={cn(
                  'rounded-xl border bg-white p-4 transition-colors',
                  rowErr ? 'border-red-300 bg-red-50/30' : 'border-slate-200',
                )}
              >
                <div className="grid grid-cols-12 gap-3">
                  {/* Name (slugged into scriptid) */}
                  <div className="col-span-3">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Name *
                    </label>
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateRow(idx, { name: e.target.value })}
                      placeholder="e.g. Tier"
                      className={cn(
                        'w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow',
                        rowErr?.field === 'name' ? 'border-red-300' : 'border-slate-200',
                      )}
                    />
                    {rowErr?.field === 'name' && (
                      <p className="text-[10px] text-red-600 mt-1">{rowErr.message}</p>
                    )}
                  </div>

                  {/* Display label */}
                  <div className="col-span-3">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Display label
                    </label>
                    <input
                      type="text"
                      value={row.displayLabel}
                      onChange={(e) => updateRow(idx, { displayLabel: e.target.value })}
                      placeholder="defaults to Name"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow"
                    />
                  </div>

                  {/* Type */}
                  <div className="col-span-2">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Type
                    </label>
                    <select
                      value={row.type}
                      onChange={(e) => updateRow(idx, { type: e.target.value as FieldType })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow"
                    >
                      {TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Default value */}
                  <div className="col-span-3">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Default value
                    </label>
                    <input
                      type="text"
                      value={row.defaultValue}
                      onChange={(e) => updateRow(idx, { defaultValue: e.target.value })}
                      placeholder="(none)"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow"
                    />
                  </div>

                  {/* Remove button */}
                  <div className="col-span-1 flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="p-2 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Remove field"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Help text — full width */}
                  <div className="col-span-12">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Help text
                    </label>
                    <input
                      type="text"
                      value={row.helpText}
                      onChange={(e) => updateRow(idx, { helpText: e.target.value })}
                      placeholder="Tooltip / description shown to NS users"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow"
                    />
                  </div>

                  {/* Boolean flags row */}
                  <div className="col-span-12 flex items-center gap-6 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={row.required}
                        onChange={(e) => updateRow(idx, { required: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-xs font-medium text-slate-600">Required</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={row.showInList}
                        onChange={(e) => updateRow(idx, { showInList: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-xs font-medium text-slate-600">Show in list view</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={row.isSearchable}
                        onChange={(e) => updateRow(idx, { isSearchable: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-xs font-medium text-slate-600">Searchable</span>
                    </label>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Add row button */}
          <button
            type="button"
            onClick={addRow}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-dashed border-slate-300 text-xs font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add field to {activeTab}
          </button>
        </div>
      )}

      {/* Footer hint */}
      <div className="mt-6 text-[11px] text-slate-400 leading-relaxed">
        On Generate Package, each row emits one Oracle SDF XML in{' '}
        <code className="bg-slate-100 px-1 py-0.5 rounded">SDF/Objects/</code>.
        SELECT-typed fields also emit a placeholder customlist for the consultant to populate
        in NetSuite UI. NetSuite-only — not emitted on Odoo or other adaptors.
      </div>
    </div>
  );
}
