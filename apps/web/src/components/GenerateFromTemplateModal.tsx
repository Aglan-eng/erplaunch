import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X,
  FileText,
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Loader2,
  CircleCheck,
} from 'lucide-react';
import {
  firmTemplateApi,
  generatedDocumentsApi,
  type CustomTemplate,
  type GeneratedDocument,
} from '@/lib/api';

/**
 * Phase 50.5 — Generate-from-template modal.
 *
 * Three-step flow:
 *   1. Pick a CustomTemplate from the firm's library
 *   2. Optionally override the document name (defaults to
 *      "{{template.name}} — {{today}}")
 *   3. POST /from-template/:templateId; show the rendered preview
 *      with any missing-token warnings; persist on confirm
 *
 * Closes on success and invalidates the documents list query so the
 * caller's DocumentsList re-fetches.
 */

interface Props {
  engagementId: string;
  open: boolean;
  onClose: () => void;
  /** Optional callback fired after a successful save — caller can
   *  navigate to the new doc or surface a toast. */
  onCreated?: (doc: GeneratedDocument) => void;
}

type Step = 'pick' | 'name' | 'preview';

export function GenerateFromTemplateModal({
  engagementId,
  open,
  onClose,
  onCreated,
}: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('pick');
  const [selected, setSelected] = useState<CustomTemplate | null>(null);
  const [name, setName] = useState('');
  const [createdDoc, setCreatedDoc] = useState<GeneratedDocument | null>(null);
  const [missingTokens, setMissingTokens] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reset to a clean state every time the modal opens.
  useEffect(() => {
    if (open) {
      setStep('pick');
      setSelected(null);
      setName('');
      setCreatedDoc(null);
      setMissingTokens([]);
      setError(null);
    }
  }, [open]);

  const templatesQuery = useQuery({
    queryKey: ['firm-custom-templates'],
    queryFn: () => firmTemplateApi.listCustom(),
    enabled: open,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('No template selected.');
      return generatedDocumentsApi.fromTemplate(engagementId, selected.id, {
        name: name.trim() || undefined,
      });
    },
    onSuccess: (result) => {
      setCreatedDoc(result.document);
      setMissingTokens(result.missingTokens);
      setStep('preview');
      setError(null);
      qc.invalidateQueries({ queryKey: ['engagement-documents', engagementId] });
      if (onCreated) onCreated(result.document);
    },
    onError: (err) => {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response
          ?.data?.error?.message ?? 'Generation failed.';
      setError(msg);
    },
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      data-testid="generate-from-template-modal"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <header className="border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-violet-600" />
            <h2 className="text-base font-bold text-slate-900">
              {step === 'pick'
                ? 'Pick a template'
                : step === 'name'
                  ? 'Name your document'
                  : 'Preview & save'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-slate-100 text-slate-500"
            aria-label="Close"
            data-testid="generate-modal-close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 'pick' && (
            <PickStep
              templates={templatesQuery.data ?? []}
              isLoading={templatesQuery.isLoading}
              isError={!!templatesQuery.error}
              selected={selected}
              onSelect={setSelected}
            />
          )}
          {step === 'name' && selected && (
            <NameStep
              template={selected}
              name={name}
              onChange={setName}
            />
          )}
          {step === 'preview' && createdDoc && (
            <PreviewStep
              doc={createdDoc}
              missingTokens={missingTokens}
            />
          )}
          {error && (
            <div
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex items-center gap-2"
              data-testid="generate-modal-error"
            >
              <CircleAlert className="h-4 w-4 text-red-700" />
              <p className="text-sm text-red-900">{error}</p>
            </div>
          )}
        </div>

        <footer className="border-t border-slate-100 px-5 py-3 flex items-center justify-between gap-2">
          {step !== 'pick' && step !== 'preview' && (
            <button
              onClick={() => setStep(step === 'name' ? 'pick' : 'name')}
              className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
              data-testid="generate-modal-back"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          )}
          <div className="flex-1" />
          {step === 'pick' && (
            <button
              disabled={!selected}
              onClick={() => {
                setName(`${selected?.name ?? 'Document'} — ${new Date().toISOString().slice(0, 10)}`);
                setStep('name');
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
              data-testid="generate-modal-next"
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {step === 'name' && (
            <button
              disabled={generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
              data-testid="generate-modal-generate"
            >
              {generateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Generate
            </button>
          )}
          {step === 'preview' && (
            <button
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              data-testid="generate-modal-done"
            >
              <CircleCheck className="h-4 w-4" />
              Done
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function PickStep({
  templates,
  isLoading,
  isError,
  selected,
  onSelect,
}: {
  templates: ReadonlyArray<CustomTemplate>;
  isLoading: boolean;
  isError: boolean;
  selected: CustomTemplate | null;
  onSelect: (t: CustomTemplate) => void;
}) {
  if (isLoading) {
    return <p className="text-sm text-slate-400">Loading templates…</p>;
  }
  if (isError) {
    return (
      <p className="text-sm text-red-600">
        Couldn't load templates. (Only firm admins can manage templates — ask
        yours if you can't see any here.)
      </p>
    );
  }
  if (templates.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText className="h-7 w-7 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-semibold text-slate-700">
          No custom templates yet
        </p>
        <p className="text-xs text-slate-400 mt-1">
          Author one at Settings → Templates → Custom templates.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-testid="template-pick-list">
      {templates.map((t) => (
        <li key={t.id}>
          <button
            onClick={() => onSelect(t)}
            data-testid={`template-pick-${t.id}`}
            className={`w-full text-left rounded-lg border p-3 transition-all ${
              selected?.id === t.id
                ? 'border-violet-300 ring-2 ring-violet-100 bg-violet-50/30'
                : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <p className="text-sm font-semibold text-slate-900">{t.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              type: <code>{t.type}</code>
            </p>
            {t.body && (
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                {t.body.slice(0, 200)}
                {t.body.length > 200 ? '…' : ''}
              </p>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function NameStep({
  template,
  name,
  onChange,
}: {
  template: CustomTemplate;
  name: string;
  onChange: (s: string) => void;
}) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">
        Picked template: <strong>{template.name}</strong>
      </p>
      <label
        className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1"
        htmlFor="document-name"
      >
        Document name
      </label>
      <input
        id="document-name"
        type="text"
        value={name}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Cutover Runbook — 2026-05-10"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        data-testid="generate-modal-name-input"
      />
      <p className="text-[11px] text-slate-400 mt-1">
        Defaults to "{template.name} — today's date" if left blank.
      </p>
    </div>
  );
}

function PreviewStep({
  doc,
  missingTokens,
}: {
  doc: GeneratedDocument;
  missingTokens: ReadonlyArray<string>;
}) {
  return (
    <div data-testid="generate-modal-preview">
      <p className="text-sm font-semibold text-slate-900 mb-2">{doc.name}</p>
      {missingTokens.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900 mb-1">
            Unknown tokens in the template:
          </p>
          <ul
            className="text-xs text-amber-800 list-disc list-inside"
            data-testid="generate-modal-missing-tokens"
          >
            {missingTokens.map((t) => (
              <li key={t}>
                <code>{`{{${t}}}`}</code>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-amber-700 mt-1">
            They render as <code>[missing: name]</code> in the body — fix the
            template if needed.
          </p>
        </div>
      )}
      <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 font-mono text-slate-700 max-h-[40vh] overflow-y-auto whitespace-pre-wrap">
        {doc.body}
      </pre>
    </div>
  );
}
