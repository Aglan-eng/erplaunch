import React, { useCallback, useMemo } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { useWizardStore } from '@/stores/wizardStore';
import { useAnswerMutation } from '@/hooks/useAnswerMutation';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────
//
// Mirrors StructuredTemplate + supporting enums in apps/api's
// sdfStructuredTemplatesGenerator.ts. Kept duplicated here per the
// Phase 23/25 frontend pattern.

type TemplateKind = 'INVOICE' | 'PURCHASE_ORDER' | 'STATEMENT' | 'DUNNING_EMAIL';

type TemplateSection =
  | 'LOGO'
  | 'BILL_TO'
  | 'SHIP_TO'
  | 'LINE_TABLE'
  | 'SUBTOTALS'
  | 'TAX_BREAKDOWN'
  | 'PAYMENT_INSTRUCTIONS'
  | 'FOOTER_TERMS'
  | 'DUNNING_TIER';

interface StructuredTemplate {
  name: string;
  kind: TemplateKind;
  preferred: boolean;
  sections: TemplateSection[];
  notes: string;
}

const ANSWER_KEY = 'ns.design.templatesStructured';

const KIND_OPTIONS: ReadonlyArray<{ value: TemplateKind; label: string }> = [
  { value: 'INVOICE', label: 'Invoice (PDF)' },
  { value: 'PURCHASE_ORDER', label: 'Purchase Order (PDF)' },
  { value: 'STATEMENT', label: 'Customer Statement (PDF)' },
  { value: 'DUNNING_EMAIL', label: 'Dunning Email' },
];

const SECTION_OPTIONS: ReadonlyArray<{ value: TemplateSection; label: string }> = [
  { value: 'LOGO', label: 'Company logo' },
  { value: 'BILL_TO', label: 'Bill-to address' },
  { value: 'SHIP_TO', label: 'Ship-to address' },
  { value: 'LINE_TABLE', label: 'Line-item table' },
  { value: 'SUBTOTALS', label: 'Subtotals' },
  { value: 'TAX_BREAKDOWN', label: 'Tax breakdown' },
  { value: 'PAYMENT_INSTRUCTIONS', label: 'Payment instructions' },
  { value: 'FOOTER_TERMS', label: 'Footer terms' },
  { value: 'DUNNING_TIER', label: 'Dunning tier message' },
];

// ─── Defaults ────────────────────────────────────────────────────────────────

function newRow(): StructuredTemplate {
  return {
    name: '',
    kind: 'INVOICE',
    preferred: true,
    sections: ['LOGO', 'BILL_TO', 'LINE_TABLE', 'SUBTOTALS'],
    notes: '',
  };
}

function preSeedRow(): StructuredTemplate {
  return {
    name: 'Acme Custom Invoice',
    kind: 'INVOICE',
    preferred: true,
    sections: ['LOGO', 'BILL_TO', 'SHIP_TO', 'LINE_TABLE', 'SUBTOTALS', 'TAX_BREAKDOWN', 'PAYMENT_INSTRUCTIONS', 'FOOTER_TERMS'],
    notes: 'Use Acme corporate red (#c8102e) for header bar. Logo top-left at 1.2in x 0.5in.',
  };
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

function loadFromAnswer(raw: unknown): StructuredTemplate[] {
  if (raw === null || raw === undefined) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const allowedKinds = new Set(KIND_OPTIONS.map((o) => o.value));
  const allowedSections = new Set(SECTION_OPTIONS.map((o) => o.value));

  return parsed
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
    .map((row) => ({
      name: typeof row.name === 'string' ? row.name : '',
      kind:
        typeof row.kind === 'string' && allowedKinds.has(row.kind as TemplateKind)
          ? (row.kind as TemplateKind)
          : 'INVOICE',
      preferred: row.preferred === true,
      sections: Array.isArray(row.sections)
        ? (row.sections as unknown[]).filter(
            (s): s is TemplateSection =>
              typeof s === 'string' && allowedSections.has(s as TemplateSection),
          )
        : [],
      notes: typeof row.notes === 'string' ? row.notes : '',
    }));
}

// ─── Validation (inline UI feedback) ─────────────────────────────────────────

interface RowError {
  rowIndex: number;
  field: 'name';
  message: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function validateRows(rows: StructuredTemplate[]): RowError[] {
  const errs: RowError[] = [];
  // Dedup buckets per scriptid prefix — emails and PDFs collide independently.
  const seenPdf = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const trimmed = r.name.trim();
    if (trimmed.length === 0) {
      errs.push({ rowIndex: i, field: 'name', message: 'name is required' });
      continue;
    }
    const slug = slugify(trimmed);
    if (slug.length === 0) {
      errs.push({
        rowIndex: i,
        field: 'name',
        message: 'name must contain at least one alphanumeric character',
      });
      continue;
    }
    const isEmail = r.kind === 'DUNNING_EMAIL';
    const seen = isEmail ? seenEmail : seenPdf;
    if (seen.has(slug)) {
      errs.push({
        rowIndex: i,
        field: 'name',
        message: `duplicate of row ${(seen.get(slug) ?? 0) + 1} after slugify (${isEmail ? 'email' : 'PDF'} prefix)`,
      });
    } else {
      seen.set(slug, i);
    }
  }
  return errs;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface TemplatesStepProps {
  engagementId: string;
}

export function TemplatesStep({ engagementId }: TemplatesStepProps) {
  const answers = useWizardStore((s) => s.answers);
  const mergeAnswers = useWizardStore((s) => s.mergeAnswers);
  const { saveAnswerNow } = useAnswerMutation(engagementId);

  const rows = useMemo(() => loadFromAnswer(answers[ANSWER_KEY]), [answers]);
  const errors = useMemo(() => validateRows(rows), [rows]);

  const persist = useCallback(
    (next: StructuredTemplate[]) => {
      const json = JSON.stringify(next);
      mergeAnswers({ [ANSWER_KEY]: json });
      saveAnswerNow(ANSWER_KEY, json);
    },
    [mergeAnswers, saveAnswerNow],
  );

  const updateRow = useCallback(
    (idx: number, patch: Partial<StructuredTemplate>) => {
      const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      persist(next);
    },
    [rows, persist],
  );

  const addRow = useCallback(() => {
    persist([...rows, rows.length === 0 ? preSeedRow() : newRow()]);
  }, [rows, persist]);

  const removeRow = useCallback(
    (idx: number) => {
      persist(rows.filter((_, i) => i !== idx));
    },
    [rows, persist],
  );

  const toggleSection = useCallback(
    (idx: number, section: TemplateSection) => {
      const r = rows[idx];
      const next = r.sections.includes(section)
        ? r.sections.filter((s) => s !== section)
        : [...r.sections, section];
      updateRow(idx, { sections: next });
    },
    [rows, updateRow],
  );

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Templates</h1>
        <p className="text-sm text-slate-500">
          Capture custom NetSuite templates per kind (Invoice / PO / Statement /
          Dunning Email). The generator emits one SDF{' '}
          <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">advancedpdftemplate</code>
          {' '}or{' '}
          <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">emailtemplate</code>
          {' '}per row with a stub body containing TODO markers for each captured
          content section. Consultants edit the real FreeMarker / BFO content in
          NetSuite UI after deploy. Total templates configured:{' '}
          <span className="font-semibold text-slate-700">{rows.length}</span>.
        </p>
      </div>

      {/* Empty state */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-sm text-slate-400 mb-4">No templates defined yet.</p>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add first template (pre-seeded sample)
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, idx) => {
            const rowErr = errors.find((e) => e.rowIndex === idx);
            return (
              <div
                key={idx}
                className={cn(
                  'rounded-xl border bg-white p-4 transition-colors',
                  rowErr ? 'border-red-300 bg-red-50/30' : 'border-slate-200',
                )}
                data-testid={`template-row-${idx}`}
              >
                {/* Top row: name + kind + preferred + delete */}
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-5">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Template name *
                    </label>
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateRow(idx, { name: e.target.value })}
                      placeholder="e.g. Acme Custom Invoice"
                      className={cn(
                        'w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow',
                        rowErr?.field === 'name' ? 'border-red-300' : 'border-slate-200',
                      )}
                      data-testid={`template-name-${idx}`}
                    />
                    {rowErr?.field === 'name' && (
                      <p className="text-[10px] text-red-600 mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {rowErr.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-4">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Kind
                    </label>
                    <select
                      value={row.kind}
                      onChange={(e) => updateRow(idx, { kind: e.target.value as TemplateKind })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                      data-testid={`template-kind-${idx}`}
                    >
                      {KIND_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2 flex items-end">
                    <label
                      className={cn(
                        'inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium cursor-pointer transition-colors',
                        row.kind === 'DUNNING_EMAIL'
                          ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                          : row.preferred
                          ? 'border-brand-300 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-brand-300',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={row.preferred}
                        disabled={row.kind === 'DUNNING_EMAIL'}
                        onChange={(e) => updateRow(idx, { preferred: e.target.checked })}
                        className="rounded border-slate-300"
                        data-testid={`template-preferred-${idx}`}
                      />
                      Preferred
                    </label>
                  </div>
                  <div className="col-span-1 flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      title="Remove template"
                      aria-label={`Remove template ${idx + 1}`}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      data-testid={`template-remove-${idx}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Sections multi-select (chip toggles) */}
                <div className="mt-4">
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                    Content sections
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {SECTION_OPTIONS.map((opt) => {
                      const active = row.sections.includes(opt.value);
                      return (
                        <button
                          type="button"
                          key={opt.value}
                          onClick={() => toggleSection(idx, opt.value)}
                          className={cn(
                            'px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors',
                            active
                              ? 'border-brand-300 bg-brand-50 text-brand-700'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:text-brand-600',
                          )}
                          data-testid={`template-section-${idx}-${opt.value}`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Notes */}
                <div className="mt-4">
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Notes (deploy hints, branding, palette)
                  </label>
                  <input
                    type="text"
                    value={row.notes}
                    onChange={(e) => updateRow(idx, { notes: e.target.value })}
                    placeholder="e.g. Use Acme corporate red (#c8102e) for header bar"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                    data-testid={`template-notes-${idx}`}
                  />
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 transition-colors"
            data-testid="template-add"
          >
            <Plus className="h-3.5 w-3.5" />
            Add template
          </button>
        </div>
      )}
    </div>
  );
}
