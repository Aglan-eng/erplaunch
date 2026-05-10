import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, FileText, Plus } from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { EngagementDocumentsList } from '@/components/EngagementDocumentsList';
import { GenerateFromTemplateModal } from '@/components/GenerateFromTemplateModal';

/**
 * Phase 50.5 — Engagement documents page.
 *
 * Standalone surface at `/engagements/:id/documents`. Hosts the list
 * of saved GeneratedDocument rows plus a "Generate from template"
 * button that opens the picker modal. The wizard sidebar can link
 * here in a future polish pass; for now consumers reach the page via
 * direct URL or a future engagement-detail page.
 */
export function EngagementDocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const engagementId = id ?? '';
  const [modalOpen, setModalOpen] = useState(false);

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
          to={`/engagements/${engagementId}/wizard`}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-3"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to engagement
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
