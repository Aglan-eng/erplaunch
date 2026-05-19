import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  ArrowLeft, Plus, Upload, Sparkles, CheckCircle2, AlertCircle, Archive,
  FileText, Loader2, Rocket, X, Trash2, Code2, Eye, Save,
} from 'lucide-react';
import { customAdaptorsApi, type CustomAdaptor, type CustomAdaptorStatus } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toSlug, resolveCreatePayload } from './customAdaptorsHelpers';

// Which draft field the JSON editor is focused on — mirrors the five (soon
// six, with rules) subtrees of PlatformAdaptor that PATCH /draft accepts.
type DraftField = 'manifest' | 'schema' | 'license' | 'phases' | 'generators' | 'rules';

/**
 * Custom Adaptor wizard — firms upload their ERP / system docs, Claude
 * drafts a PlatformAdaptor, the firm reviews + publishes. Published
 * adaptors surface in the engagement-create ERP picker under custom:<slug>.
 */
export function CustomAdaptorsPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['custom-adaptors'],
    queryFn: customAdaptorsApi.list,
  });

  // Auto-poll the active row while it's in PARSING so the UI reflects completion.
  const activeRow = (listQuery.data ?? []).find((r) => r.id === selectedId) ?? null;
  useEffect(() => {
    if (activeRow?.status !== 'PARSING') return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ['custom-adaptors'] }), 3000);
    return () => clearInterval(t);
  }, [activeRow?.status, qc]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <Link to="/settings" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" />
            Back to Settings
          </Link>
          <h1 className="text-sm font-bold text-gray-900">Custom Platform Adaptors</h1>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New adaptor
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-7 max-w-2xl">
          <h2 className="text-2xl font-bold text-gray-900">Bring your own ERP</h2>
          <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
            Upload your system's implementation guide, vendor docs, or in-house playbook.
            Claude reads them and drafts a scoping questionnaire, license model, and phase
            plan. Review, edit, publish — and it shows up in your ERP picker like any
            built-in platform.
          </p>
        </div>

        {listQuery.isLoading && (
          <div className="text-sm text-gray-400">Loading adaptors…</div>
        )}

        {!listQuery.isLoading && (listQuery.data ?? []).length === 0 && (
          <EmptyState onCreate={() => setCreating(true)} />
        )}

        {(listQuery.data ?? []).length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(listQuery.data ?? []).map((row) => (
              <AdaptorCard
                key={row.id}
                row={row}
                selected={selectedId === row.id}
                onOpen={() => setSelectedId(row.id)}
              />
            ))}
          </div>
        )}

        {activeRow && (
          <AdaptorDrawer
            row={activeRow}
            onClose={() => setSelectedId(null)}
          />
        )}

        {creating && (
          <CreateModal
            onClose={() => setCreating(false)}
            onCreated={(row) => {
              setCreating(false);
              setSelectedId(row.id);
            }}
          />
        )}
      </main>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-14 text-center">
      <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 mb-5">
        <Sparkles className="h-7 w-7 text-brand-500" />
      </div>
      <h3 className="text-lg font-bold text-gray-900">No custom adaptors yet</h3>
      <p className="text-sm text-gray-500 mt-1.5 mb-6 max-w-sm mx-auto">
        Create your first adaptor by giving it a name and uploading a few source
        documents — Claude handles the rest.
      </p>
      <Button onClick={onCreate}>
        <Plus className="h-4 w-4" />
        Create your first adaptor
      </Button>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

function AdaptorCard({ row, onOpen, selected }: { row: CustomAdaptor; onOpen: () => void; selected: boolean }) {
  return (
    <button
      onClick={onOpen}
      className={[
        'text-left bg-white rounded-xl border p-5 transition-all hover:shadow-md',
        selected ? 'border-brand-500 ring-1 ring-brand-500' : 'border-gray-100',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-gray-900 truncate">{row.name}</p>
          <p className="text-xs text-gray-400 font-mono truncate">custom:{row.slug}</p>
        </div>
        <StatusBadge status={row.status} />
      </div>
      <div className="text-xs text-gray-500 flex items-center gap-4">
        <span className="inline-flex items-center gap-1">
          <FileText className="h-3 w-3" />
          {row.sourceDocuments.length} source doc{row.sourceDocuments.length === 1 ? '' : 's'}
        </span>
      </div>
    </button>
  );
}

function StatusBadge({ status }: { status: CustomAdaptorStatus }) {
  const config: Record<CustomAdaptorStatus, { label: string; cls: string; icon?: React.ReactNode }> = {
    DRAFT:     { label: 'Draft',     cls: 'bg-gray-100 text-gray-700' },
    PARSING:   { label: 'Parsing',   cls: 'bg-blue-100 text-blue-700', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    READY:     { label: 'Ready',     cls: 'bg-amber-100 text-amber-700' },
    PUBLISHED: { label: 'Published', cls: 'bg-green-100 text-green-700', icon: <CheckCircle2 className="h-3 w-3" /> },
    FAILED:    { label: 'Failed',    cls: 'bg-red-100 text-red-700', icon: <AlertCircle className="h-3 w-3" /> },
    ARCHIVED:  { label: 'Archived',  cls: 'bg-gray-100 text-gray-400' },
  };
  const c = config[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded ${c.cls}`}>
      {c.icon}
      {c.label}
    </span>
  );
}

// ─── Drawer (per-adaptor upload/parse/publish) ───────────────────────────────

function AdaptorDrawer({ row, onClose }: { row: CustomAdaptor; onClose: () => void }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => customAdaptorsApi.uploadDocument(row.id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-adaptors'] }),
  });

  const parseMutation = useMutation({
    mutationFn: () => customAdaptorsApi.parse(row.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-adaptors'] }),
  });

  const publishMutation = useMutation({
    mutationFn: () => customAdaptorsApi.publish(row.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-adaptors'] }),
  });

  const archiveMutation = useMutation({
    mutationFn: () => customAdaptorsApi.archive(row.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-adaptors'] });
      onClose();
    },
  });

  const parsedStats = useMemo(() => {
    const schema = row.parsedSchema as { flows?: Array<{ sections?: Array<{ questions?: unknown[] }> }> } | null;
    if (!schema || !Array.isArray(schema.flows)) return null;
    const flowCount = schema.flows.length;
    const questionCount = schema.flows.reduce((sum, f) => sum + (Array.isArray(f.sections) ? f.sections.reduce((s, sec) => s + (Array.isArray(sec.questions) ? sec.questions.length : 0), 0) : 0), 0);
    const license = row.parsedLicense as { editions?: unknown[]; modules?: unknown[] } | null;
    return {
      flowCount,
      questionCount,
      editionCount: license && Array.isArray(license.editions) ? license.editions.length : 0,
      moduleCount: license && Array.isArray(license.modules) ? license.modules.length : 0,
    };
  }, [row.parsedSchema, row.parsedLicense]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onMouseDown={onClose}>
      <div className="fixed inset-0 bg-black/20" />
      <div
        className="relative ml-auto h-full w-full max-w-xl bg-white shadow-xl overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <p className="text-xs text-gray-400 font-mono">custom:{row.slug}</p>
            <h2 className="text-lg font-bold text-gray-900">{row.name}</h2>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={row.status} />
            <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Source documents */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Source documents</h3>
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">PDF / DOCX / TXT / MD, 5 MB each</span>
            </div>

            {row.sourceDocuments.length === 0 ? (
              <div className="border border-dashed border-gray-200 rounded-xl p-6 text-center">
                <Upload className="h-5 w-5 text-gray-300 mx-auto mb-2" />
                <p className="text-xs text-gray-500">No documents uploaded yet.</p>
              </div>
            ) : (
              <ul className="space-y-2 mb-3">
                {row.sourceDocuments.map((doc, idx) => (
                  <li key={idx} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-900 truncate">{doc.originalName}</p>
                        <p className="text-[10px] text-gray-400">{prettyBytes(doc.size)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending || row.status === 'ARCHIVED'}
            >
              <Upload className="h-4 w-4" />
              {uploadMutation.isPending ? 'Uploading…' : 'Add document'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.md"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadMutation.mutate(f);
                if (e.target) e.target.value = '';
              }}
            />
          </section>

          {/* Parse controls */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">AI parse</h3>
            {row.status === 'FAILED' && row.parseError && (
              <div className="mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                <p className="text-xs text-red-700"><strong>Parse failed:</strong> {row.parseError}</p>
              </div>
            )}
            {row.status === 'PARSING' ? (
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                <p className="text-xs text-blue-700">Claude is reading your documents and drafting the adaptor…</p>
              </div>
            ) : (
              <Button
                onClick={() => parseMutation.mutate()}
                disabled={parseMutation.isPending || row.sourceDocuments.length === 0 || row.status === 'ARCHIVED'}
              >
                <Sparkles className="h-4 w-4" />
                {row.status === 'READY' || row.status === 'PUBLISHED' ? 'Re-parse' : 'Run AI parse'}
              </Button>
            )}
          </section>

          {/* Parsed preview */}
          {parsedStats && (
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Parsed adaptor</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Flows" value={parsedStats.flowCount} />
                <Stat label="Questions" value={parsedStats.questionCount} />
                <Stat label="Editions" value={parsedStats.editionCount} />
                <Stat label="Modules" value={parsedStats.moduleCount} />
              </div>
              {row.parsedManifest && typeof row.parsedManifest === 'object' && 'tagline' in row.parsedManifest ? (
                <p className="mt-3 text-xs text-gray-500 italic">
                  "{String((row.parsedManifest as { tagline: unknown }).tagline)}"
                </p>
              ) : null}
            </section>
          )}

          {/* JSON draft editor — hand-edit any subtree the AI parse produced */}
          {(row.status === 'READY' || row.status === 'PUBLISHED' || row.status === 'FAILED') && (
            <DraftEditor row={row} />
          )}

          {/* Publish + archive */}
          <section className="border-t border-gray-100 pt-5 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm(`Archive custom adaptor "${row.name}"? It will no longer appear in the ERP picker.`)) {
                  archiveMutation.mutate();
                }
              }}
              disabled={archiveMutation.isPending}
            >
              <Archive className="h-4 w-4" />
              Archive
            </Button>
            {row.status === 'PUBLISHED' ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                Published — selectable in the ERP picker
              </span>
            ) : (
              <Button
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending || row.status !== 'READY'}
              >
                <Rocket className="h-4 w-4" />
                {publishMutation.isPending ? 'Publishing…' : 'Publish'}
              </Button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2.5">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-bold text-gray-900 tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Per-field JSON editor. Loads the current value for the active tab, lets
 * the firm hand-edit, validates parseability on save, PATCHes the server.
 * Only touches one subtree per save so a botched edit to schema doesn't
 * wipe the license.
 */
function DraftEditor({ row }: { row: CustomAdaptor }) {
  const qc = useQueryClient();
  const [field, setField] = useState<DraftField>('manifest');
  const [text, setText] = useState<string>(() => prettyPrint(draftValue(row, 'manifest')));
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // When the user switches tabs or the row refreshes after a save, snap the
  // textarea to the current persisted value for that field. We DON'T force-
  // refresh while dirty — otherwise a slow network roundtrip would clobber
  // whatever they were in the middle of typing.
  useEffect(() => {
    if (!dirty) {
      setText(prettyPrint(draftValue(row, field)));
      setError(null);
    }
  }, [row, field, dirty]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let parsed: unknown;
      try {
        parsed = text.trim() === '' ? null : JSON.parse(text);
      } catch (err) {
        throw new Error(`Invalid JSON: ${(err as Error).message}`);
      }
      return customAdaptorsApi.updateDraft(row.id, { [field]: parsed } as Record<DraftField, unknown>);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-adaptors'] });
      setDirty(false);
      setError(null);
    },
    onError: (err: unknown) => {
      const response = (err as { response?: { data?: { error?: { message?: string } } } }).response;
      setError(response?.data?.error?.message ?? (err as { message?: string }).message ?? 'Save failed.');
    },
  });

  const tabs: Array<{ field: DraftField; label: string }> = [
    { field: 'manifest', label: 'Manifest' },
    { field: 'schema', label: 'Schema' },
    { field: 'license', label: 'License' },
    { field: 'phases', label: 'Phases' },
    { field: 'generators', label: 'Generators' },
    { field: 'rules', label: 'Rules' },
  ];

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Code2 className="h-4 w-4 text-gray-400" />
          Edit draft
        </h3>
        <span className="text-[10px] text-gray-400 uppercase tracking-wider">
          Raw JSON · PATCH /draft
        </span>
      </div>

      <div className="flex flex-wrap gap-1 mb-3 border-b border-gray-100">
        {tabs.map((t) => {
          const active = field === t.field;
          return (
            <button
              key={t.field}
              onClick={() => setField(t.field)}
              className={[
                'text-xs font-semibold px-2.5 py-1.5 rounded-t border-b-2 transition-colors',
                active
                  ? 'text-brand-700 border-brand-500 bg-brand-50'
                  : 'text-gray-500 border-transparent hover:text-gray-800',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setDirty(true); setError(null); }}
        spellCheck={false}
        className="w-full h-64 font-mono text-[11px] leading-5 p-3 border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-400"
      />

      {error && (
        <div className="mt-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          <p className="text-xs text-red-700 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {error}
          </p>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="text-[11px] text-gray-400">
          {dirty ? <span className="text-amber-600 font-semibold">Unsaved changes</span> : <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" /> Up to date</span>}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => { setText(prettyPrint(draftValue(row, field))); setDirty(false); setError(null); }}
          >
            Revert
          </Button>
          <Button
            size="sm"
            loading={saveMutation.isPending}
            disabled={!dirty}
            onClick={() => saveMutation.mutate()}
          >
            <Save className="h-4 w-4" />
            Save {tabs.find((t) => t.field === field)?.label}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Grab the current persisted value for a given draft tab. */
function draftValue(row: CustomAdaptor, field: DraftField): unknown {
  switch (field) {
    case 'manifest':   return row.parsedManifest;
    case 'schema':     return row.parsedSchema;
    case 'license':    return row.parsedLicense;
    case 'phases':     return row.parsedPhases;
    case 'generators': return row.parsedGenerators;
    case 'rules':      return row.parsedRules;
  }
}

function prettyPrint(v: unknown): string {
  if (v === null || v === undefined) return '';
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Create modal ────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (row: CustomAdaptor) => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugDirty, setSlugDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Take name + slug as mutate variables instead of reading them from
  // closure. The previous shape `mutationFn: () => create({ slug })` closed
  // over the React `slug` state, which was empty when the user relied on the
  // auto-derived slug (slugDirty=false) — the API got `{ slug: '' }` and
  // 400'd on the SlugRegex Zod check, showing a "slug must be 3-40 chars"
  // error for a field the user could plainly see was filled.
  const createMutation = useMutation({
    mutationFn: (vars: { name: string; slug: string }) => customAdaptorsApi.create(vars),
    onSuccess: (row) => onCreated(row),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } }; message?: string }).response?.data?.error?.message ?? (err as { message?: string }).message ?? 'Could not create adaptor.';
      setError(msg);
    },
  });

  // Auto-derive slug from name until the user edits it manually
  const displaySlug = slugDirty ? slug : toSlug(name);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">New custom adaptor</h3>
          <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            // Resolve {name, slug} synchronously from the inputs we already
            // have — never read `slug` from React state closure here, that
            // was the bug.
            const payload = resolveCreatePayload({ name, slug, slugDirty });
            if (!payload) return;
            // Keep local state aligned with what we just sent so a
            // subsequent re-render shows the auto-derived slug as committed.
            if (!slugDirty) setSlug(payload.slug);
            createMutation.mutate(payload);
          }}
          className="space-y-4"
        >
          <Input
            label="Display name"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. MyFactory ERP"
            autoFocus
          />

          <div>
            <Input
              label="Slug"
              id="slug"
              value={displaySlug}
              onChange={(e) => { setSlugDirty(true); setSlug(e.target.value.toLowerCase()); }}
              placeholder="e.g. myfactory"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Used as the adaptor id <span className="font-mono">custom:{displaySlug || '…'}</span>.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
            <Button type="button" variant="secondary" onClick={onClose}>
              <Trash2 className="h-4 w-4" />
              Cancel
            </Button>
            <Button type="submit" loading={createMutation.isPending} disabled={!name.trim() || !displaySlug}>
              <Plus className="h-4 w-4" />
              Create adaptor
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// toSlug now lives in ./customAdaptorsHelpers — imported at the top.
