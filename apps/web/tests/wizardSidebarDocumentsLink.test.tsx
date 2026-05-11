/**
 * Phase 50.8.1 — WizardSidebar Documents link render test.
 *
 * Pins:
 *   - Documents link renders inside the sidebar when an engagementId
 *     is supplied.
 *   - href points at /engagements/:id/documents.
 *   - data-testid="sidebar-link-documents" is present so e2e tests
 *     can target it.
 *   - Sidebar collapses the link cleanly when engagementId is empty
 *     (firm-level list views shouldn't get a dangling Documents
 *     entry).
 *   - Active-state highlight applies when the router location matches
 *     the documents URL.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WizardSidebar } from '../src/components/wizard/WizardSidebar';

function renderSidebar(opts: {
  engagementId: string;
  initialPath?: string;
}): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[opts.initialPath ?? `/engagements/${opts.engagementId}/wizard`]}>
        <WizardSidebar
          engagementId={opts.engagementId}
          sectionProgress={{}}
          licenseComplete={false}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WizardSidebar — Documents link (Phase 50.8.1)', () => {
  it('renders the Documents link with the engagement-scoped href', () => {
    const html = renderSidebar({ engagementId: 'eng-1' });
    expect(html).toContain('data-testid="sidebar-link-documents"');
    expect(html).toContain('href="/engagements/eng-1/documents"');
    expect(html).toContain('Documents');
  });

  it('does NOT render the Documents link when engagementId is empty', () => {
    const html = renderSidebar({ engagementId: '' });
    expect(html).not.toContain('data-testid="sidebar-link-documents"');
  });

  it('applies the active-state highlight when the router is on /documents', () => {
    const html = renderSidebar({
      engagementId: 'eng-1',
      initialPath: '/engagements/eng-1/documents',
    });
    expect(html).toContain('data-testid="sidebar-link-documents"');
    // The active item's left bar is rendered as an absolutely-
    // positioned <span> with the brand-500 background — pin its
    // presence on the active route.
    expect(html).toMatch(
      /<a[^>]*data-testid="sidebar-link-documents"[^>]*class="[^"]*bg-brand-50/,
    );
  });

  it('does NOT apply the active highlight when on a different route', () => {
    const html = renderSidebar({
      engagementId: 'eng-1',
      initialPath: '/engagements/eng-1/wizard',
    });
    expect(html).toContain('data-testid="sidebar-link-documents"');
    // Active highlight uses bg-brand-50; non-active uses text-gray-500.
    expect(html).toMatch(
      /<a[^>]*data-testid="sidebar-link-documents"[^>]*class="[^"]*text-gray-500/,
    );
  });
});

/**
 * Phase 50.9.4 — Generate Document sidebar shortcut.
 *
 * Pins:
 *   - The Generate Document link renders alongside Documents when an
 *     engagementId is set.
 *   - href targets the documents page with ?action=generate so the
 *     EngagementDocumentsPage auto-opens the template-picker modal.
 *   - Active state highlights correctly between the two related entries
 *     based on the presence of the action=generate query param.
 */
describe('WizardSidebar — Generate Document shortcut (Phase 50.9.4)', () => {
  it('renders the Generate Document link with the auto-open query param', () => {
    const html = renderSidebar({ engagementId: 'eng-1' });
    expect(html).toContain('data-testid="sidebar-link-generate-document"');
    // href should include the query param so the documents page mount
    // effect auto-opens the modal.
    expect(html).toMatch(
      /href="\/engagements\/eng-1\/documents\?action=generate"/,
    );
    expect(html).toContain('Generate Document');
  });

  it('does NOT render the Generate Document link when engagementId is empty', () => {
    const html = renderSidebar({ engagementId: '' });
    expect(html).not.toContain('data-testid="sidebar-link-generate-document"');
  });

  it('highlights Generate Document (not Documents) when ?action=generate is in the URL', () => {
    const html = renderSidebar({
      engagementId: 'eng-1',
      initialPath: '/engagements/eng-1/documents?action=generate',
    });
    // Generate Document gets the active highlight.
    expect(html).toMatch(
      /<a[^>]*data-testid="sidebar-link-generate-document"[^>]*class="[^"]*bg-brand-50/,
    );
    // Documents does NOT — both routes share the pathname but the
    // active-state matcher pivots on the query string.
    expect(html).toMatch(
      /<a[^>]*data-testid="sidebar-link-documents"[^>]*class="[^"]*text-gray-500/,
    );
  });

  it('highlights Documents (not Generate Document) on the plain documents URL', () => {
    const html = renderSidebar({
      engagementId: 'eng-1',
      initialPath: '/engagements/eng-1/documents',
    });
    expect(html).toMatch(
      /<a[^>]*data-testid="sidebar-link-documents"[^>]*class="[^"]*bg-brand-50/,
    );
    expect(html).toMatch(
      /<a[^>]*data-testid="sidebar-link-generate-document"[^>]*class="[^"]*text-gray-500/,
    );
  });
});
