import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Trash2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useWizardStore } from '@/stores/wizardStore';
import { useAnswerMutation } from '@/hooks/useAnswerMutation';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────
//
// Mirrors StructuredRole + supporting enums in apps/api's
// sdfStructuredRolesGenerator.ts. Kept duplicated here (rather than
// imported from a shared package) to avoid a cross-app dependency for
// one small interface — same approach as Phase 23's CustomFieldsStep.

type CenterId =
  | 'CLASSIC'
  | 'ACCOUNTING_CENTER'
  | 'SALES_CENTER'
  | 'INVENTORY_CENTER'
  | 'PURCHASE_CENTER'
  | 'MANUFACTURING_CENTER'
  | 'EXECUTIVE_CENTER';

type PermLevel = 'NONE' | 'VIEW' | 'CREATE' | 'EDIT' | 'FULL';
type SubsidiaryRestriction = 'NONE' | 'OWN' | 'OWN_AND_HIERARCHY';

interface PermissionRow {
  permkey: string;
  permlevel: PermLevel;
}

interface StructuredRole {
  name: string;
  centerOverride: CenterId | null;
  permissionOverrides: PermissionRow[] | null;
  restrictionOverride: SubsidiaryRestriction | null;
  customizationNotes: string;
}

const ANSWER_KEY = 'ns.design.standardRolesStructured';

const CENTER_OPTIONS: ReadonlyArray<{ value: CenterId; label: string }> = [
  { value: 'CLASSIC', label: 'Classic Center' },
  { value: 'ACCOUNTING_CENTER', label: 'Accounting Center' },
  { value: 'SALES_CENTER', label: 'Sales Center' },
  { value: 'INVENTORY_CENTER', label: 'Inventory Center' },
  { value: 'PURCHASE_CENTER', label: 'Purchase Center' },
  { value: 'MANUFACTURING_CENTER', label: 'Manufacturing Center' },
  { value: 'EXECUTIVE_CENTER', label: 'Executive Center' },
];

const PERMLEVEL_OPTIONS: ReadonlyArray<{ value: PermLevel; label: string }> = [
  { value: 'NONE', label: 'None' },
  { value: 'VIEW', label: 'View' },
  { value: 'CREATE', label: 'Create' },
  { value: 'EDIT', label: 'Edit' },
  { value: 'FULL', label: 'Full' },
];

const RESTRICTION_OPTIONS: ReadonlyArray<{ value: SubsidiaryRestriction; label: string }> = [
  { value: 'NONE', label: 'None (group-wide)' },
  { value: 'OWN', label: 'Own subsidiary only' },
  { value: 'OWN_AND_HIERARCHY', label: 'Own + hierarchy' },
];

// ─── Defaults ────────────────────────────────────────────────────────────────

function newRow(): StructuredRole {
  return {
    name: '',
    centerOverride: null,
    permissionOverrides: null,
    restrictionOverride: null,
    customizationNotes: '',
  };
}

function preSeedRow(): StructuredRole {
  // Pre-seeded sample so the consultant sees the classifier + overlay
  // in action — same UX pattern as Phase 24 ApprovalChainEditor.
  return {
    name: 'AP Clerk',
    centerOverride: null,
    permissionOverrides: null,
    restrictionOverride: null,
    customizationNotes: 'subsidiary-scoped, remove Approve Bills permission',
  };
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

function loadFromAnswer(raw: unknown): StructuredRole[] {
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

  const allowedCenters = new Set(CENTER_OPTIONS.map((o) => o.value));
  const allowedRestrictions = new Set(RESTRICTION_OPTIONS.map((o) => o.value));
  const allowedPermlevels = new Set(PERMLEVEL_OPTIONS.map((o) => o.value));

  return parsed
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
    .map((row) => {
      const center = row.centerOverride;
      const restriction = row.restrictionOverride;
      const perms = row.permissionOverrides;
      let permList: PermissionRow[] | null = null;
      if (Array.isArray(perms)) {
        permList = perms
          .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
          .map((p) => ({
            permkey: typeof p.permkey === 'string' ? p.permkey : '',
            permlevel: allowedPermlevels.has(p.permlevel as PermLevel)
              ? (p.permlevel as PermLevel)
              : 'VIEW',
          }));
      }
      return {
        name: typeof row.name === 'string' ? row.name : '',
        centerOverride:
          typeof center === 'string' && allowedCenters.has(center as CenterId)
            ? (center as CenterId)
            : null,
        permissionOverrides: permList,
        restrictionOverride:
          typeof restriction === 'string' && allowedRestrictions.has(restriction as SubsidiaryRestriction)
            ? (restriction as SubsidiaryRestriction)
            : null,
        customizationNotes:
          typeof row.customizationNotes === 'string' ? row.customizationNotes : '',
      };
    });
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

function validateRows(rows: StructuredRole[]): RowError[] {
  const errs: RowError[] = [];
  const seen = new Map<string, number>();
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
    if (seen.has(slug)) {
      errs.push({
        rowIndex: i,
        field: 'name',
        message: `duplicate of row ${(seen.get(slug) ?? 0) + 1} after slugify`,
      });
    } else {
      seen.set(slug, i);
    }
  }
  return errs;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface StandardRolesStepProps {
  engagementId: string;
}

export function StandardRolesStep({ engagementId }: StandardRolesStepProps) {
  const answers = useWizardStore((s) => s.answers);
  const mergeAnswers = useWizardStore((s) => s.mergeAnswers);
  const { saveAnswerNow } = useAnswerMutation(engagementId);

  const rows = useMemo(() => loadFromAnswer(answers[ANSWER_KEY]), [answers]);
  const errors = useMemo(() => validateRows(rows), [rows]);

  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const persist = useCallback(
    (next: StructuredRole[]) => {
      const json = JSON.stringify(next);
      mergeAnswers({ [ANSWER_KEY]: json });
      saveAnswerNow(ANSWER_KEY, json);
    },
    [mergeAnswers, saveAnswerNow],
  );

  const updateRow = useCallback(
    (idx: number, patch: Partial<StructuredRole>) => {
      const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      persist(next);
    },
    [rows, persist],
  );

  const addRow = useCallback(() => {
    const next = [...rows, rows.length === 0 ? preSeedRow() : newRow()];
    persist(next);
  }, [rows, persist]);

  const removeRow = useCallback(
    (idx: number) => {
      persist(rows.filter((_, i) => i !== idx));
      setExpanded((p) => {
        const { [idx]: _drop, ...rest } = p;
        return rest;
      });
    },
    [rows, persist],
  );

  const toggleExpanded = useCallback((idx: number) => {
    setExpanded((p) => ({ ...p, [idx]: !p[idx] }));
  }, []);

  const updatePermissionOverrides = useCallback(
    (idx: number, perms: PermissionRow[] | null) => {
      updateRow(idx, { permissionOverrides: perms });
    },
    [updateRow],
  );

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Roles &amp; Permissions</h1>
        <p className="text-sm text-slate-500">
          Capture each NetSuite custom role on its own row. The generator
          classifies the role by name (AP / AR / Sales / Finance / Inventory /
          Procurement / Manufacturing / Quality / Clinical / IT) and applies a
          permission starter set. Use the customization notes to add overlays
          like <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">read-only</code>,
          {' '}<code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">group-wide</code>,
          {' '}<code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">subsidiary-scoped</code>,
          {' '}<code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">remove Approve &lt;perm&gt; permission</code>.
          Use Advanced to override the center, permissions, or restriction
          when the classifier doesn&apos;t match your design. Total roles
          configured: <span className="font-semibold text-slate-700">{rows.length}</span>.
        </p>
      </div>

      {/* Empty state */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-sm text-slate-400 mb-4">No roles defined yet.</p>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add first role (pre-seeded sample)
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, idx) => {
            const rowErr = errors.find((e) => e.rowIndex === idx);
            const isExpanded = !!expanded[idx];
            const overrideCount =
              (row.centerOverride !== null ? 1 : 0) +
              (row.permissionOverrides !== null ? 1 : 0) +
              (row.restrictionOverride !== null ? 1 : 0);
            return (
              <div
                key={idx}
                className={cn(
                  'rounded-xl border bg-white p-4 transition-colors',
                  rowErr ? 'border-red-300 bg-red-50/30' : 'border-slate-200',
                )}
                data-testid={`role-row-${idx}`}
              >
                {/* Primary 2-column layout: Name | Customization Notes */}
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-4">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Role name *
                    </label>
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateRow(idx, { name: e.target.value })}
                      placeholder="e.g. AP Clerk - GCC"
                      className={cn(
                        'w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow',
                        rowErr?.field === 'name' ? 'border-red-300' : 'border-slate-200',
                      )}
                      data-testid={`role-name-${idx}`}
                    />
                    {rowErr?.field === 'name' && (
                      <p className="text-[10px] text-red-600 mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {rowErr.message}
                      </p>
                    )}
                  </div>

                  <div className="col-span-7">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Customization notes
                    </label>
                    <input
                      type="text"
                      value={row.customizationNotes}
                      onChange={(e) => updateRow(idx, { customizationNotes: e.target.value })}
                      placeholder="e.g. subsidiary-scoped, remove Approve Bills permission"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow"
                      data-testid={`role-notes-${idx}`}
                    />
                  </div>

                  <div className="col-span-1 flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      title="Remove role"
                      aria-label={`Remove role ${idx + 1}`}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      data-testid={`role-remove-${idx}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Advanced disclosure — center / permissions / restriction overrides */}
                <button
                  type="button"
                  onClick={() => toggleExpanded(idx)}
                  className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
                  data-testid={`role-toggle-advanced-${idx}`}
                >
                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  Advanced overrides
                  {overrideCount > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums bg-brand-100 text-brand-700">
                      {overrideCount}
                    </span>
                  )}
                </button>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                    {/* Center override */}
                    <div className="grid grid-cols-12 gap-3 items-end">
                      <div className="col-span-4">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                          Center override
                        </label>
                        <select
                          value={row.centerOverride ?? ''}
                          onChange={(e) =>
                            updateRow(idx, {
                              centerOverride:
                                e.target.value === '' ? null : (e.target.value as CenterId),
                            })
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                          data-testid={`role-center-${idx}`}
                        >
                          <option value="">— use classifier —</option>
                          {CENTER_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-4">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                          Restriction override
                        </label>
                        <select
                          value={row.restrictionOverride ?? ''}
                          onChange={(e) =>
                            updateRow(idx, {
                              restrictionOverride:
                                e.target.value === ''
                                  ? null
                                  : (e.target.value as SubsidiaryRestriction),
                            })
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                          data-testid={`role-restriction-${idx}`}
                        >
                          <option value="">— use classifier default —</option>
                          {RESTRICTION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Permission overrides */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Permission overrides
                        </label>
                        {row.permissionOverrides === null ? (
                          <button
                            type="button"
                            onClick={() => updatePermissionOverrides(idx, [])}
                            className="text-[11px] font-medium text-brand-600 hover:text-brand-700"
                            data-testid={`role-perms-enable-${idx}`}
                          >
                            Enable override
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => updatePermissionOverrides(idx, null)}
                            className="text-[11px] font-medium text-slate-500 hover:text-slate-700"
                            data-testid={`role-perms-disable-${idx}`}
                          >
                            Disable (use classifier)
                          </button>
                        )}
                      </div>
                      {row.permissionOverrides === null ? (
                        <p className="text-[11px] text-slate-400 italic">
                          Using classifier&apos;s starter set. Click &quot;Enable
                          override&quot; to specify permissions explicitly.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {row.permissionOverrides.map((p, pIdx) => (
                            <div
                              key={pIdx}
                              className="grid grid-cols-12 gap-2 items-center"
                              data-testid={`role-perm-${idx}-${pIdx}`}
                            >
                              <div className="col-span-7">
                                <input
                                  type="text"
                                  value={p.permkey}
                                  onChange={(e) => {
                                    const next = (row.permissionOverrides ?? []).map((q, k) =>
                                      k === pIdx ? { ...q, permkey: e.target.value } : q,
                                    );
                                    updatePermissionOverrides(idx, next);
                                  }}
                                  placeholder="e.g. LIST_CUSTOMER"
                                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                />
                              </div>
                              <div className="col-span-4">
                                <select
                                  value={p.permlevel}
                                  onChange={(e) => {
                                    const next = (row.permissionOverrides ?? []).map((q, k) =>
                                      k === pIdx
                                        ? { ...q, permlevel: e.target.value as PermLevel }
                                        : q,
                                    );
                                    updatePermissionOverrides(idx, next);
                                  }}
                                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                >
                                  {PERMLEVEL_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="col-span-1 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = (row.permissionOverrides ?? []).filter(
                                      (_, k) => k !== pIdx,
                                    );
                                    updatePermissionOverrides(idx, next);
                                  }}
                                  title="Remove permission"
                                  className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              updatePermissionOverrides(idx, [
                                ...(row.permissionOverrides ?? []),
                                { permkey: '', permlevel: 'VIEW' },
                              ])
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-[11px] font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 transition-colors"
                          >
                            <Plus className="h-3 w-3" />
                            Add permission
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 transition-colors"
            data-testid="role-add"
          >
            <Plus className="h-3.5 w-3.5" />
            Add role
          </button>
        </div>
      )}
    </div>
  );
}
