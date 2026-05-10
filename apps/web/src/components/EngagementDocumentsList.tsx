import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Download,
  Trash2,
  ChevronDown,
  Eye,
  Loader2,
} from 'lucide-react';
import {
  generatedDocumentsApi,
  type GeneratedDocument,
} from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Phase 50.5 — Documents list for an engagement.
 *
 * Renders saved GeneratedDocument rows newest-first with per-row
 * actions: View / Download (PDF | DOCX | PPTX dropdown) / Delete.
 * Empty state shown when no docs exist yet.
 */

interface Props {
  engagementId: string;
  /** Optional callback when a row is opened — caller can route to
   *  a viewer if it has one; otherwise we open a simple modal. */
  onView?: (doc: GeneratedDocument) => void;
}

export function EngagementDocumentsList({ engagementId, onView }: Props) {
  const qc = useQueryClient();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const docsQuery = useQuery({
    queryKey: ['engagement-documents', engagementId],
    queryFn: () => generatedDocumentsApi.list(engagementId),
    refetchInterval: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) =>
      generatedDocumentsApi.remove(engagementId, docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engagement-documents', engagementId] });
      setConfirmDeleteId(null);
    },
  });

  const docs = docsQuery.data ?? [];

  if (docsQuery.isLoading) {
    return (
      <div className="text-center py-8 text-sm text-slate-400">
        Loading documents…
      </div>
    );
  }
  if (docsQuery.error) {
    return (
      <div className="text-center py-8 text-sm text-red-600">
        Couldn't load documents.
      </div>
    );
  }
  if (docs.length === 0) {
    return (
      <div
        className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center"
        data-testid="engagement-documents-empty"
      >
        <FileText className="h-7 w-7 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-semibold text-slate-700">No documents yet</p>
        <p className="text-xs text-slate-400 mt-1">
          Generated documents from a template will appear here, with download
          options for PDF / DOCX / PPTX.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-2" data-testid="engagement-documents-list">
        {docs.map((doc) => (
          <DocumentRow
            key={doc.id}
            engagementId={engagementId}
            doc={doc}
            onView={onView}
            onRequestDelete={() => setConfirmDeleteId(doc.id)}
          />
        ))}
      </ul>

      {confirmDeleteId && (
        <ConfirmDeleteDialog
          docName={docs.find((d) => d.id === confirmDeleteId)?.name ?? 'document'}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => deleteMutation.mutate(confirmDeleteId)}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </>
  );
}

function DocumentRow({
  engagementId,
  doc,
  onView,
  onRequestDelete,
}: {
  engagementId: string;
  doc: GeneratedDocument;
  onView?: (doc: GeneratedDocument) => void;
  onRequestDelete: () => void;
}) {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const createdLabel = new Date(doc.createdAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return (
    <li
      className="rounded-2xl border border-slate-200 bg-white p-4 flex items-start justify-between gap-3"
      data-testid={`document-row-${doc.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 truncate">{doc.name}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Created {createdLabel}
          {doc.sourceTemplateId ? (
            <>
              {' '}· from template <code>{doc.sourceTemplateId.slice(0, 8)}…</code>
            </>
          ) : doc.sourceGeneratorId ? (
            <>
              {' '}· from generator <code>{doc.sourceGeneratorId}</code>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 relative">
        {onView && (
          <button
            onClick={() => onView(doc)}
            className="rounded-md p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            title="View"
            data-testid={`document-view-${doc.id}`}
          >
            <Eye className="h-4 w-4" />
          </button>
        )}
        <div className="relative">
          <button
            onClick={() => setDownloadOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            data-testid={`document-download-${doc.id}`}
          >
            <Download className="h-3.5 w-3.5" />
            Download
            <ChevronDown className="h-3 w-3" />
          </button>
          {downloadOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-10 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden"
              data-testid={`document-download-menu-${doc.id}`}
            >
              {(['pdf', 'docx', 'pptx'] as const).map((fmt) => (
                <a
                  key={fmt}
                  href={generatedDocumentsApi.exportUrl(engagementId, doc.id, fmt)}
                  className="block px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  onClick={() => setDownloadOpen(false)}
                  data-testid={`document-download-${doc.id}-${fmt}`}
                >
                  {fmt.toUpperCase()}
                </a>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onRequestDelete}
          className="rounded-md p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50"
          title="Delete"
          data-testid={`document-delete-${doc.id}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function ConfirmDeleteDialog({
  docName,
  onCancel,
  onConfirm,
  isDeleting,
}: {
  docName: string;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      role="dialog"
      data-testid="document-delete-confirm"
    >
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <p className="text-sm font-semibold text-slate-900">Delete document?</p>
        <p className="text-xs text-slate-500 mt-1">
          "{docName}" will be removed permanently. You can regenerate it from
          the source template if needed.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-sm font-semibold text-slate-500 hover:text-slate-700 px-3 py-2"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700',
              isDeleting && 'opacity-50',
            )}
            data-testid="document-delete-confirm-yes"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
