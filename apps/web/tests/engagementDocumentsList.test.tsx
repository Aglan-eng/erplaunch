/**
 * Phase 50.5 — EngagementDocumentsList render test.
 *
 * Static markup pins the empty-state UI (rendered when no documents
 * are loaded yet — the disabled-query path) and the export URL
 * shape used by the download links.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EngagementDocumentsList } from '../src/components/EngagementDocumentsList';
import { generatedDocumentsApi } from '../src/lib/api';

function render(): string {
  // Disable the query so the loading state evaluates to !isLoading
  // and we land on the empty-or-list render path. With no data, the
  // empty state renders.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <EngagementDocumentsList engagementId="eng-1" />
    </QueryClientProvider>,
  );
}

describe('EngagementDocumentsList', () => {
  it('renders the empty state when no documents exist', () => {
    const html = render();
    expect(html).toContain('data-testid="engagement-documents-empty"');
    expect(html).toContain('No documents yet');
  });
});

describe('generatedDocumentsApi.exportUrl', () => {
  it('builds the right URL pattern for each format', () => {
    const pdf = generatedDocumentsApi.exportUrl('eng-1', 'doc-1', 'pdf');
    const docx = generatedDocumentsApi.exportUrl('eng-1', 'doc-1', 'docx');
    const pptx = generatedDocumentsApi.exportUrl('eng-1', 'doc-1', 'pptx');
    expect(pdf).toContain('/engagements/eng-1/documents/doc-1/export?format=pdf');
    expect(docx).toContain('/engagements/eng-1/documents/doc-1/export?format=docx');
    expect(pptx).toContain('/engagements/eng-1/documents/doc-1/export?format=pptx');
  });
});
