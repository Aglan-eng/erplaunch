import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, FileText, Plus } from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { EngagementDocumentsList } from '@/components/EngagementDocumentsList';
import { GenerateFromTemplateModal } from '@/components/GenerateFromTemplateModal';

/**
 * Phase 50.9.4 — pure helper for the auto-open contract. Extracted so
 * unit tests can pin the URL → modal-state mapping without needing a
 * DOM. The page's mount effect calls this against the URLSearchParams
 * and triggers `setModalOpen(true)` when it returns true.
 */
export function shouldAutoOpenGenerateModal(params: URLSearchParams): boolean {
  return params.get('action') === 'generate';
}

/**
 * Phase 50.5 — Engagement documents page.
 *
 * Standalone surface at `/engagements/:id/documents`. Hosts the list
 * of saved GeneratedDocument rows plus a "Generate from template"
 * button that opens the picker modal. The wizard sidebar can link
 * here in a future polish pass; for now consumers reach the page via
 * direct URL or a future engagement-detail page.
 *
 * Phase 50.9.4 — accepts `?action=generate` query param. When present
 * on mount, auto-opens the template-picker modal so the sidebar
 * "Generate Document" shortcut lands the user one click away from
 * generation instead of two. The query param is stripped after the
 * modal opens so a refresh doesn't re-open it on a stale page state.
 */
export function EngagementDocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const engagementId = id ?? '';
  const [modalOpen, setModalOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Auto-open modal when navigating from the sidebar shortcut.
  // Stripping the param after open keeps the URL clean — otherwise a
  // refresh would re-open the modal on top of whatever state the user
  // had landed on (e.g. mid-edit of a generated doc).
  useEffect(() => {
    if (shouldAutoOpenGenerateModal(searchParams)) {
      setModalOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('action');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const engagementQuery = useQuery({
    queryKey: ['engagement', engagementId],
    queryFn: () => engagementsApi.get(engagementId),
    enabled: !!engagementId,
  });

  const clientName = (engagementQuery.data as { clientName?: string } | undefined)?.clientName;

  return (
    <div className="min-h-screen bg-slate-50" data-testid="engagement-documents-page">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          to={`/customers/${engagementId}?tab=implementation`}
          data-testid="engagement-documents-back-to-customer"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-3"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to customer
        </Link>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-5 w-5 text-violet-600" />
              <h1 className="text-2xl font-bold text-slate-900">Documents</h1>
            </div>
            <p className="text-sm text-slate-500">
              {clientName ? `Generated documents for ${clientName}.` : 'Generated documents for this engagement.'}
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
            data-testid="open-generate-modal"
          >
            <Plus className="h-4 w-4" />
            Generate from template
          </button>
        </div>

        <EngagementDocumentsList engagementId={engagementId} />

        <GenerateFromTemplateModal
          engagementId={engagementId}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
        />
      </div>
    </div>
  );
}
