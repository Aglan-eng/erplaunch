import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  Save,
  Lock,
  Plus,
  FileText,
  Upload,
  CircleCheck,
  CircleAlert,
  Type,
  Palette,
  Pilcrow,
  Trash2,
} from 'lucide-react';
import {
  firmTemplateApi,
  type FirmTemplate,
  type CustomTemplate,
  type HeadlineCase,
} from '@/lib/api';
import {
  enforceHeadlineCaseOnMarkdown,
  stripNonThemeHexLiterals,
} from '@/lib/templateThemeLock';
import { cn } from '@/lib/utils';

/**
 * Phase 49.4 — Settings → Templates editor.
 *
 * Surfaces every editable Firm template field plus the CustomTemplate
 * CRUD. Theme controls (font family, headline case, accent color)
 * render as DISABLED inputs with a "Locked to firm theme" tooltip —
 * the lock is enforced visually here AND on the save path
 * (enforceHeadlineCaseOnMarkdown + stripNonThemeHexLiterals strip any
 * raw markdown that tries to bypass the lock).
 *
 * The page reuses `/settings/sales-templates` URL conventions but
 * sits at `/settings/templates` so both editors can coexist (this
 * one is the broader Brand Pack editor, the older one is focused on
 * pricing).
 */

const FIELD_DEFINITIONS: ReadonlyArray<{
  key: keyof FirmTemplate;
  label: string;
  description: string;
}> = [
  {
    key: 'tagline',
    label: 'Tagline',
    description: 'One-line headline used as the lead in cover letters and the Why Us proposal section.',
  },
  {
    key: 'subtitle',
    label: 'Subtitle',
    description: 'Supporting line that appears under the tagline on branded surfaces.',
  },
  {
    key: 'companyDescription',
    label: 'Company description',
    description: '2–3 paragraphs of markdown describing what the firm does and who it serves.',
  },
  {
    key: 'whyUs',
    label: 'Why Us',
    description: 'Direct override for the proposal Why Us section — when set, takes precedence over tagline + description.',
  },
  {
    key: 'voiceGuide',
    label: 'Voice guide',
    description: 'Internal reference: headline style, phrasing patterns, words to avoid.',
  },
];

export function SettingsTemplatesPage() {
  const qc = useQueryClient();
  const tplQuery = useQuery({
    queryKey: ['firm-template'],
    queryFn: () => firmTemplateApi.get(),
  });
  const customQuery = useQuery({
    queryKey: ['firm-custom-templates'],
    queryFn: () => firmTemplateApi.listCustom(),
  });

  const tpl = tplQuery.data ?? null;
  const customs = customQuery.data ?? [];
  const headlineCase = tpl?.themeHeadlineCase ?? null;
  const accentColor = tpl?.themeAccentColor ?? null;
  const fontFamily = tpl?.themeFontFamily ?? null;

  const [editingKey, setEditingKey] = useState<keyof FirmTemplate | null>(null);
  const [editorBody, setEditorBody] = useState('');
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [errorFlash, setErrorFlash] = useState<string | null>(null);

  const patchMutation = useMutation({
    mutationFn: (patch: Partial<FirmTemplate>) => firmTemplateApi.patch(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm-template'] });
      setSavedFlash('Template saved.');
      setEditingKey(null);
      setTimeout(() => setSavedFlash(null), 3000);
    },
    onError: (err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setErrorFlash(status === 400 ? 'Validation error — check inputs.' : 'Save failed.');
      setTimeout(() => setErrorFlash(null), 4000);
    },
  });

  function startEditing(key: keyof FirmTemplate, currentValue: unknown): void {
    setEditingKey(key);
    setEditorBody(typeof currentValue === 'string' ? currentValue : '');
  }

  function saveEditor(): void {
    if (editingKey === null) return;
    // Theme lock: enforce headline case on every markdown heading +
    // strip non-theme hex literals so a firm admin can't sneak a
    // different color into their template body.
    const cased = enforceHeadlineCaseOnMarkdown(editorBody, headlineCase);
    const cleaned = stripNonThemeHexLiterals(cased, accentColor);
    patchMutation.mutate({ [editingKey]: cleaned } as Partial<FirmTemplate>);
  }

  if (tplQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading templates…</p>
      </div>
    );
  }
  if (tplQuery.error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <CircleAlert className="h-7 w-7 text-slate-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700">
            Couldn't load firm templates.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Editing firm-wide templates is restricted to firm admins.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50" data-testid="settings-templates-page">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-3"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to settings
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <FileText className="h-5 w-5 text-violet-600" />
          <h1 className="text-2xl font-bold text-slate-900">Templates</h1>
          {tpl && (
            <span className="ml-2 text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
              v{tpl.templateVersion}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 mb-6">
          Edit the firm voice that powers proposals and other generated documents.
          Theme tokens — font family, headline case, accent color — are locked to
          the firm theme; change them in Settings → Branding if needed.
        </p>

        {savedFlash && (
          <div
            data-testid="save-flash"
            className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-center gap-2"
          >
            <CircleCheck className="h-4 w-4 text-emerald-700" />
            <p className="text-sm text-emerald-900">{savedFlash}</p>
          </div>
        )}
        {errorFlash && (
          <div
            data-testid="error-flash"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex items-center gap-2"
          >
            <CircleAlert className="h-4 w-4 text-red-700" />
            <p className="text-sm text-red-900">{errorFlash}</p>
          </div>
        )}

        <ThemeLockBanner
          headlineCase={headlineCase}
          accentColor={accentColor}
          fontFamily={fontFamily}
        />

        <BrandPackUploadBlock onIngested={() => {
          qc.invalidateQueries({ queryKey: ['firm-template'] });
          setSavedFlash('Brand pack ingested.');
          setTimeout(() => setSavedFlash(null), 3000);
        }} />

        <h2 className="mt-8 mb-3 text-base font-bold text-slate-900">Firm voice</h2>
        <ul className="space-y-2">
          {FIELD_DEFINITIONS.map((f) => (
            <FieldRow
              key={String(f.key)}
              label={f.label}
              description={f.description}
              value={tpl ? (tpl[f.key] as string | null) : null}
              isEditing={editingKey === f.key}
              onEdit={() => startEditing(f.key, tpl?.[f.key])}
              onCancel={() => setEditingKey(null)}
              editorBody={editorBody}
              setEditorBody={setEditorBody}
              onSave={saveEditor}
              isSaving={patchMutation.isPending}
              testIdSuffix={String(f.key)}
            />
          ))}
        </ul>

        <h2 className="mt-8 mb-3 text-base font-bold text-slate-900">Custom templates</h2>
        <CustomTemplateList templates={customs} />
      </div>
    </div>
  );
}

function ThemeLockBanner({
  headlineCase,
  accentColor,
  fontFamily,
}: {
  headlineCase: HeadlineCase | null;
  accentColor: string | null;
  fontFamily: string | null;
}) {
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5"
      data-testid="theme-lock-banner"
    >
      <div className="flex items-center gap-2 mb-3">
        <Lock className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-bold text-slate-900">Locked theme tokens</h3>
        <span className="text-xs text-slate-400 italic">
          change in Settings → Branding
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ThemeLockField
          icon={<Type className="h-3.5 w-3.5" />}
          label="Font family"
          value={fontFamily ?? '— not set —'}
          testId="theme-lock-font"
        />
        <ThemeLockField
          icon={<Pilcrow className="h-3.5 w-3.5" />}
          label="Headline case"
          value={headlineCase ?? '— not set —'}
          testId="theme-lock-case"
        />
        <ThemeLockField
          icon={<Palette className="h-3.5 w-3.5" />}
          label="Accent color"
          value={accentColor ?? '— not set —'}
          swatch={accentColor}
          testId="theme-lock-accent"
        />
      </div>
    </section>
  );
}

function ThemeLockField({
  icon,
  label,
  value,
  swatch,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  swatch?: string | null;
  testId: string;
}) {
  return (
    <label
      className="block rounded-lg border border-slate-200 bg-slate-50 p-3 cursor-not-allowed"
      title="Locked to firm theme — change in Settings → Branding"
      data-testid={testId}
    >
      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
        {icon}
        {label}
      </span>
      <input
        type="text"
        readOnly
        disabled
        value={value}
        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-600 cursor-not-allowed"
        data-testid={`${testId}-input`}
      />
      {swatch && /^#[0-9a-fA-F]{6}$/.test(swatch) && (
        <span
          className="inline-block mt-2 h-5 w-5 rounded border border-slate-300"
          style={{ backgroundColor: swatch }}
          data-testid={`${testId}-swatch`}
        />
      )}
    </label>
  );
}

function FieldRow({
  label,
  description,
  value,
  isEditing,
  onEdit,
  onCancel,
  editorBody,
  setEditorBody,
  onSave,
  isSaving,
  testIdSuffix,
}: {
  label: string;
  description: string;
  value: string | null;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  editorBody: string;
  setEditorBody: (s: string) => void;
  onSave: () => void;
  isSaving: boolean;
  testIdSuffix: string;
}) {
  const preview = useMemo(() => {
    if (!value) return null;
    return value.length > 200 ? value.slice(0, 200) + '…' : value;
  }, [value]);
  return (
    <li
      className="rounded-2xl border border-slate-200 bg-white p-4"
      data-testid={`field-${testIdSuffix}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900">{label}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
          {!isEditing && preview && (
            <pre className="mt-2 text-xs text-slate-600 whitespace-pre-wrap font-sans bg-slate-50 rounded px-3 py-2">
              {preview}
            </pre>
          )}
          {!isEditing && !preview && (
            <p className="mt-2 text-xs text-slate-400 italic">— not set —</p>
          )}
        </div>
        {!isEditing && (
          <button
            onClick={onEdit}
            className="text-xs font-semibold text-violet-700 hover:text-violet-900"
            data-testid={`edit-${testIdSuffix}`}
          >
            Edit
          </button>
        )}
      </div>
      {isEditing && (
        <div className="mt-3" data-testid={`editor-${testIdSuffix}`}>
          <textarea
            value={editorBody}
            onChange={(e) => setEditorBody(e.target.value)}
            rows={10}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
            data-testid={`textarea-${testIdSuffix}`}
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Headlines (lines starting with #) will be auto-cased to the firm's
            theme on save. Hex literals will be replaced with the firm's accent
            color.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={onSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
              data-testid={`save-${testIdSuffix}`}
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onCancel}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function BrandPackUploadBlock({ onIngested }: { onIngested: () => void }) {
  const [pack, setPack] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const ingestMutation = useMutation({
    mutationFn: (pk: string) => firmTemplateApi.ingestPack(pk),
    onSuccess: () => {
      onIngested();
      setOpen(false);
      setPack('');
      setError(null);
    },
    onError: (err) => {
      const e = err as {
        response?: { data?: { error?: { message?: string; code?: string } } };
      };
      setError(e.response?.data?.error?.message ?? 'Ingest failed.');
    },
  });

  return (
    <section
      className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/50 p-4"
      data-testid="brand-pack-upload"
    >
      <div className="flex items-center gap-2 mb-2">
        <Upload className="h-4 w-4 text-violet-700" />
        <h3 className="text-sm font-bold text-slate-900">Brand pack ingest</h3>
      </div>
      <p className="text-xs text-slate-600 mb-3">
        Paste your 12-section markdown brand pack to populate every template at
        once. See <code className="bg-white border border-slate-200 rounded px-1">docs/firm-templates.md</code> for the contract.
      </p>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-xs font-semibold text-violet-700 hover:text-violet-900"
          data-testid="open-brand-pack-upload"
        >
          Open pack uploader
        </button>
      ) : (
        <div>
          <textarea
            value={pack}
            onChange={(e) => setPack(e.target.value)}
            rows={8}
            placeholder="# My Firm Brand Pack&#10;&#10;## 1. Tagline&#10;&#10;..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono"
            data-testid="brand-pack-textarea"
          />
          {error && (
            <p
              className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1"
              data-testid="brand-pack-error"
            >
              {error}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => ingestMutation.mutate(pack)}
              disabled={pack.trim().length === 0 || ingestMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
              data-testid="brand-pack-ingest"
            >
              {ingestMutation.isPending ? 'Ingesting…' : 'Ingest pack'}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function CustomTemplateList({ templates }: { templates: ReadonlyArray<CustomTemplate> }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState('CUSTOM');
  const [body, setBody] = useState('');
  const [creating, setCreating] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => firmTemplateApi.createCustom({ name, type, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm-custom-templates'] });
      setName('');
      setType('CUSTOM');
      setBody('');
      setCreating(false);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => firmTemplateApi.deleteCustom(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm-custom-templates'] });
    },
  });

  return (
    <div data-testid="custom-template-list">
      {templates.length === 0 && !creating ? (
        <p className="text-sm text-slate-400 italic">No custom templates yet.</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {templates.map((t) => (
            <li
              key={t.id}
              className="rounded-lg border border-slate-200 bg-white p-3 flex items-start justify-between gap-3"
              data-testid={`custom-template-${t.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  type: {t.type}
                  {t.themeLocked && (
                    <span className="ml-2 inline-flex items-center gap-0.5">
                      <Lock className="h-3 w-3" />
                      theme-locked
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => deleteMutation.mutate(t.id)}
                className="text-slate-400 hover:text-red-600"
                title="Delete template"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!creating ? (
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900"
          data-testid="create-custom-template"
        >
          <Plus className="h-3 w-3" />
          New custom template
        </button>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2" data-testid="create-custom-form">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name (e.g. Migration cutover memo)"
            className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
            data-testid="custom-template-name"
          />
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="Type (CUSTOM, BRD, SOLUTION_DOC, …)"
            className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
            data-testid="custom-template-type"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="# Template body…"
            className="w-full rounded border border-slate-200 px-2 py-1 text-sm font-mono"
            data-testid="custom-template-body"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={name.trim().length === 0 || createMutation.isPending}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700',
                (name.trim().length === 0 || createMutation.isPending) && 'opacity-40',
              )}
              data-testid="custom-template-save"
            >
              <Save className="h-3 w-3" />
              {createMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setCreating(false)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
