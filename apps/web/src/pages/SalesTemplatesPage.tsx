import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Sparkles, Save, Loader2, Plus, Trash2, AlertTriangle, CheckCircle2,
  DollarSign, Globe, FileText, Eye,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Phase 46.8.6 — Firm sales templates + pricing editor.
 *
 * Lives at /settings/sales-templates. Restricted to APP_ADMIN
 * (server-side gate via the matrix's ROLES WRITE). Edits per-module
 * pricing + geography multipliers + three markdown templates that
 * the proposal/SOW generators read at generation time.
 *
 * Live preview pane on the right shows how the cover letter renders
 * with placeholders substituted; the markdown templates support the
 * same {{decisionMaker}} / {{firmName}} / etc. tokens the
 * proposalGenerator uses.
 */

interface SalesTemplates {
  perModulePricing: Record<string, number>;
  defaultPerUserPrice: number | null;
  geographyMultipliers: Record<string, number>;
  whyUsTemplate: string | null;
  coverLetterTemplate: string | null;
  sowTermsTemplate: string | null;
}

const DEFAULT_COVER_TEMPLATE = `Dear {{decisionMaker}},

Thank you for considering {{firmName}} as your implementation partner for
{{adaptorName}}. We've built this proposal around the priorities you
shared with us — particularly {{topPain}} — and tailored the scope and
investment to your team size and timeline.

You'll find everything you need to make a decision in the documents
attached, including a detailed pricing schedule and a 5-phase
implementation approach designed to get you live {{goLiveLabel}}.

This proposal is valid through {{validUntil}}.

We're ready to start as soon as you give the go-ahead.

Sincerely,
{{preparedBy}}
{{firmName}}{{contactLine}}`;

export function SalesTemplatesPage() {
  const qc = useQueryClient();
  const [permissionDenied, setPermissionDenied] = useState(false);
  const query = useQuery({
    queryKey: ['firm-sales-templates'],
    queryFn: async (): Promise<SalesTemplates> => {
      try {
        const { data } = await api.get('/firm/sales-templates');
        return data.data as SalesTemplates;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 403) {
          setPermissionDenied(true);
        }
        throw err;
      }
    },
    retry: (count, err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) return false;
      return count < 3;
    },
  });

  const [form, setForm] = useState<SalesTemplates | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setForm(query.data);
    }
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: async (next: SalesTemplates): Promise<SalesTemplates> => {
      const { data } = await api.patch('/firm/sales-templates', next);
      return data.data as SalesTemplates;
    },
    onSuccess: (data) => {
      setForm(data);
      setSavedAt(new Date().toLocaleTimeString());
      setErrorMsg(null);
      qc.invalidateQueries({ queryKey: ['firm-sales-templates'] });
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setErrorMsg(status === 400 ? 'One of the fields is invalid — check pricing values are non-negative.' : 'Save failed. Try again.');
    },
  });

  if (permissionDenied) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <Sparkles className="h-7 w-7 text-slate-400" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900 mb-1">Sales templates</h1>
          <p className="text-sm text-slate-500">
            Editing firm-wide sales templates is restricted to APP_ADMIN. Ask your firm admin if
            you need to update pricing or boilerplate.
          </p>
        </div>
      </div>
    );
  }

  if (query.isLoading || !form) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-3"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to settings
        </Link>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-5 w-5 text-violet-600" />
              <h1 className="text-2xl font-bold text-slate-900">Sales Templates</h1>
            </div>
            <p className="text-sm text-slate-500">
              Per-module pricing, geography multipliers, and the markdown templates that drive
              every proposal and SOW your firm generates.
            </p>
          </div>
          <button
            type="button"
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-40"
            data-testid="sales-templates-save"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save changes
          </button>
        </div>

        {/* Status line */}
        <div className="mb-4 min-h-[24px]">
          {errorMsg ? (
            <p className="text-xs text-rose-600 inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {errorMsg}
            </p>
          ) : savedAt ? (
            <p className="text-xs text-emerald-600 inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Saved at {savedAt}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Form column (2/3) */}
          <div className="lg:col-span-2 space-y-4">
            <PricingCard form={form} setForm={setForm} />
            <GeographyCard form={form} setForm={setForm} />
            <TemplateCard
              title="Why Us pitch"
              hint="Markdown. Inserted as the entire body of the Why_Us.docx file in every proposal."
              value={form.whyUsTemplate ?? ''}
              onChange={(v) => setForm({ ...form, whyUsTemplate: v || null })}
              testId="template-why-us"
            />
            <TemplateCard
              title="Cover letter template"
              hint="Markdown. Supports {{decisionMaker}}, {{firmName}}, {{adaptorName}}, {{topPain}}, {{goLiveLabel}}, {{validUntil}}, {{preparedBy}}, {{contactLine}} placeholders."
              value={form.coverLetterTemplate ?? ''}
              onChange={(v) => setForm({ ...form, coverLetterTemplate: v || null })}
              placeholder={DEFAULT_COVER_TEMPLATE}
              testId="template-cover-letter"
            />
            <TemplateCard
              title="SOW Terms & Conditions"
              hint="Markdown. Inserted as the body of the Terms_and_Conditions.docx in every proposal AND the equivalent section of the SOW PDF."
              value={form.sowTermsTemplate ?? ''}
              onChange={(v) => setForm({ ...form, sowTermsTemplate: v || null })}
              testId="template-sow-terms"
            />
          </div>

          {/* Preview column (1/3) */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sticky top-4">
              <p className="text-xs uppercase tracking-wider font-bold text-slate-500 mb-2 inline-flex items-center gap-1">
                <Eye className="h-3 w-3" />
                Cover letter preview
              </p>
              <pre
                className="whitespace-pre-wrap font-mono text-[11px] text-slate-700 leading-relaxed"
                data-testid="cover-letter-preview"
              >
                {previewCoverLetter(form.coverLetterTemplate || DEFAULT_COVER_TEMPLATE)}
              </pre>
              <p className="text-[10px] text-slate-400 mt-3">
                Sample data: Acme Industries (NetSuite, single-entity, 6-12m timeline).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

interface FormProps {
  form: SalesTemplates;
  setForm: (next: SalesTemplates) => void;
}

function PricingCard({ form, setForm }: FormProps) {
  const [moduleId, setModuleId] = useState('');
  const [price, setPrice] = useState('');
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-bold text-slate-900">Pricing defaults</h2>
      </div>
      <div className="mb-4">
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Default per-user price (USD/year)
        </label>
        <input
          type="number"
          min={0}
          step={50}
          value={form.defaultPerUserPrice ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            setForm({
              ...form,
              defaultPerUserPrice: v === '' ? null : Number(v),
            });
          }}
          placeholder="1200"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          data-testid="default-per-user-price"
        />
        <p className="text-[10px] text-slate-400 mt-1">
          Used when a module isn't in the per-module table below. Leave blank for the platform
          default ($1,200).
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-700 mb-1">Per-module overrides</p>
        {Object.keys(form.perModulePricing).length === 0 ? (
          <p className="text-[11px] text-slate-400 italic mb-2">
            No per-module overrides yet. The default per-user price applies to every module.
          </p>
        ) : (
          <ul className="space-y-1 mb-2" data-testid="per-module-pricing-list">
            {Object.entries(form.perModulePricing).map(([id, p]) => (
              <li key={id} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-xs text-slate-600 flex-1 truncate">{id}</span>
                <span className="tabular-nums text-slate-700">${p.toLocaleString()}</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...form.perModulePricing };
                    delete next[id];
                    setForm({ ...form, perModulePricing: next });
                  }}
                  className="text-slate-400 hover:text-rose-600"
                  aria-label={`Remove ${id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
            placeholder="module id (e.g. inventory)"
            className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          <input
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="price"
            className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          <button
            type="button"
            onClick={() => {
              const id = moduleId.trim();
              const v = Number(price);
              if (!id || !Number.isFinite(v) || v < 0) return;
              setForm({
                ...form,
                perModulePricing: { ...form.perModulePricing, [id]: v },
              });
              setModuleId('');
              setPrice('');
            }}
            disabled={!moduleId.trim() || !price}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 disabled:opacity-40"
            data-testid="add-module-price"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function GeographyCard({ form, setForm }: FormProps) {
  const [country, setCountry] = useState('');
  const [mult, setMult] = useState('');
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Globe className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-bold text-slate-900">Geography multipliers</h2>
      </div>
      <p className="text-xs text-slate-500 mb-2">
        Per-country pricing modifiers. Used for prospects with explicit geography on their
        Discovery Lite — falls back to 1.0 (single-entity), 1.15 (multi-entity-same-country),
        1.30 (multi-country) when no override exists.
      </p>
      {Object.keys(form.geographyMultipliers).length === 0 ? (
        <p className="text-[11px] text-slate-400 italic mb-2">
          No country-specific multipliers yet.
        </p>
      ) : (
        <ul className="space-y-1 mb-2" data-testid="geography-multipliers-list">
          {Object.entries(form.geographyMultipliers).map(([country, m]) => (
            <li key={country} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs text-slate-600 flex-1 truncate">{country}</span>
              <span className="tabular-nums text-slate-700">{m.toFixed(2)}×</span>
              <button
                type="button"
                onClick={() => {
                  const next = { ...form.geographyMultipliers };
                  delete next[country];
                  setForm({ ...form, geographyMultipliers: next });
                }}
                className="text-slate-400 hover:text-rose-600"
                aria-label={`Remove ${country}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={country}
          onChange={(e) => setCountry(e.target.value.toUpperCase())}
          placeholder="country (e.g. US, UK)"
          className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          maxLength={3}
        />
        <input
          type="number"
          min={0}
          step={0.05}
          value={mult}
          onChange={(e) => setMult(e.target.value)}
          placeholder="1.00"
          className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
        <button
          type="button"
          onClick={() => {
            const c = country.trim().toUpperCase();
            const v = Number(mult);
            if (!c || !Number.isFinite(v) || v < 0) return;
            setForm({
              ...form,
              geographyMultipliers: { ...form.geographyMultipliers, [c]: v },
            });
            setCountry('');
            setMult('');
          }}
          disabled={!country.trim() || !mult}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 disabled:opacity-40"
          data-testid="add-geography-multiplier"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>
    </div>
  );
}

interface TemplateCardProps {
  title: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testId?: string;
}

function TemplateCard({ title, hint, value, onChange, placeholder, testId }: TemplateCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-1">
        <FileText className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      </div>
      <p className="text-xs text-slate-500 mb-2">{hint}</p>
      <textarea
        rows={8}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Leave blank to use the platform default.'}
        className={cn(
          'w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/40',
          value ? 'text-slate-800' : 'text-slate-400',
        )}
        data-testid={testId}
      />
    </div>
  );
}

/**
 * Pure helper exported for tests — substitutes the same placeholders
 * the proposalGenerator's coverTemplate substitution uses, with a
 * fixed sample-prospect payload.
 */
export function previewCoverLetter(template: string): string {
  return template
    .replace(/\{\{decisionMaker\}\}/g, 'Jane Tate')
    .replace(/\{\{firmName\}\}/g, 'Your Firm')
    .replace(/\{\{adaptorName\}\}/g, 'NetSuite')
    .replace(/\{\{topPain\}\}/g, 'multi-entity consolidation pain')
    .replace(/\{\{goLiveLabel\}\}/g, 'in 6 to 12 months')
    .replace(/\{\{validUntil\}\}/g, '2026-07-01')
    .replace(/\{\{preparedBy\}\}/g, 'Sales team')
    .replace(/\{\{contactLine\}\}/g, '\nsales@yourfirm.example');
}
