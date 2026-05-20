/**
 * Phase 53.2 — Documents tab is stage-aware.
 *
 * Pins:
 *   - A GOLIVE customer surfaces Go-live documents (Cutover Plan,
 *     Go-Live Checklist, Go-Live Runbook, Data Migration Plan) as
 *     the current-stage group — NOT Proposal/SOW.
 *   - `available` docs render a working generate button.
 *   - `coming-soon` docs render a muted card with a "Coming soon"
 *     badge and no button.
 *   - The current-stage group has a HelpTip explaining the grouping.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CustomerDetailPage } from '../src/pages/CustomerDetailPage';
import { AuthContext } from '../src/contexts/AuthContext';
import type { CustomerDetail, CustomerStage, DocumentDefinition } from '../src/lib/api';

function fakeAuth() {
  return {
    user: {
      id: 'u-1',
      firmId: 'f-1',
      email: 't@x.io',
      name: 'Demo',
      role: 'APP_ADMIN' as const,
    },
    loading: false,
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
}

function makeDetail(over: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: 'c-1',
    name: 'Acme',
    currentStage: 'GOLIVE',
    primaryOwnerName: 'PM',
    primaryOwnerId: 'u-pm',
    healthScore: 70,
    healthBand: 'green',
    renewalCount: 0,
    lastActivityAt: null,
    arr: null,
    customerAddress: null,
    primaryContactName: null,
    primaryContactEmail: null,
    primaryContactPhone: null,
    salesOwner: null,
    projectLeadOwner: null,
    csmOwner: null,
    arOwner: null,
    healthBreakdown: {
      score: 70,
      band: 'green',
      questionnaireCompletion: 20,
      blockersComponent: 20,
      overdueComponent: 20,
      pendingDecisionsComponent: 10,
      rawCounts: { blockers: 0, daysOverdue: 0, pendingDecisions: 0, questionnairePct: 0.7 },
    },
    stageHistory: [],
    stageWidget: {
      kind: 'GOLIVE',
      daysUntilGoLive: 7,
      cutoverChecklistComplete: 3,
      cutoverChecklistTotal: 5,
    },
    ...over,
  };
}

const FIXTURE_CATALOG: DocumentDefinition[] = [
  // Proposal-stage
  {
    id: 'proposal',
    name: 'Proposal',
    description: 'Scope, deliverables, timeline, and commercials.',
    stage: 'PROPOSAL',
    category: 'sales',
    status: 'available',
    exportRoute: 'proposal',
  },
  // Won-stage
  {
    id: 'sow',
    name: 'Statement of Work',
    description: 'Binding scope, milestones, fees, acceptance criteria.',
    stage: 'WON',
    category: 'sales',
    status: 'available',
    exportRoute: 'sow',
  },
  {
    id: 'kickoff-deck',
    name: 'Kickoff Deck',
    description: 'Project introduction slides.',
    stage: 'WON',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  // Go-live docs — what should surface for a GOLIVE customer
  {
    id: 'cutover-plan',
    name: 'Cutover Plan',
    description: 'Week-by-week countdown to go-live.',
    stage: 'GOLIVE',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'golive-checklist',
    name: 'Go-Live Checklist',
    description: 'Every item before the cutover weekend.',
    stage: 'GOLIVE',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'golive-runbook',
    name: 'Go-Live Runbook',
    description: 'Hour-by-hour cutover-weekend plan.',
    stage: 'GOLIVE',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'data-migration-plan',
    name: 'Data Migration Plan',
    description: 'Legacy-to-new data flow with validation gates.',
    stage: 'GOLIVE',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
];

interface RenderOpts {
  stage?: CustomerStage;
}

function render(opts: RenderOpts = {}): string {
  const stage = opts.stage ?? 'GOLIVE';
  const customerId = 'c-1';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['customer-detail', customerId], {
    customer: makeDetail({ currentStage: stage }),
  });
  qc.setQueryData(['customer-activity', customerId, ''], {
    activities: [],
    limit: 200,
    offset: 0,
  });
  qc.setQueryData(['exports-catalog'], { documents: FIXTURE_CATALOG });

  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/customers/${customerId}?tab=documents`]}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe('CustomerDetailPage — Documents tab is stage-aware', () => {
  it('GOLIVE customer surfaces the four Go-live documents as the primary group', () => {
    const html = render({ stage: 'GOLIVE' });
    expect(html).toContain('data-testid="documents-current-stage"');
    expect(html).toContain('For this stage — Go-live');
    // All four GOLIVE doc cards are rendered as cards in the current-stage group.
    expect(html).toContain('data-testid="documents-card-cutover-plan"');
    expect(html).toContain('data-testid="documents-card-golive-checklist"');
    expect(html).toContain('data-testid="documents-card-golive-runbook"');
    expect(html).toContain('data-testid="documents-card-data-migration-plan"');
  });

  it('GOLIVE current-stage group does NOT lead with Proposal or SOW', () => {
    const html = render({ stage: 'GOLIVE' });
    // Extract just the current-stage section. Phase 54.2 dropped the
    // "All documents" dump — the next section after current-stage is
    // the "Previously generated" history.
    const match = html.match(
      /data-testid="documents-current-stage"[\s\S]*?data-testid="documents-history"/,
    );
    expect(match).not.toBeNull();
    const currentStageBlock = match![0];
    // Proposal and SOW must not appear anywhere on a GOLIVE customer's
    // Documents tab — they live on PROPOSAL / WON customers only.
    expect(currentStageBlock).not.toContain('data-testid="documents-card-proposal"');
    expect(currentStageBlock).not.toContain('data-testid="documents-card-sow"');
  });

  it('coming-soon documents render a badge and no Generate button', () => {
    const html = render({ stage: 'GOLIVE' });
    // Cutover Plan is coming-soon.
    expect(html).toContain('data-testid="documents-card-cutover-plan-badge"');
    expect(html).toContain('Coming soon');
    // No generate button for cutover-plan.
    expect(html).not.toContain('data-testid="documents-card-cutover-plan-generate"');
    // The card carries the doc-status attribute for downstream filtering.
    expect(html).toMatch(
      /data-testid="documents-card-cutover-plan"[^>]*data-doc-status="coming-soon"/,
    );
  });

  it('available documents render a working Generate button', () => {
    // PROPOSAL stage → proposal doc is available.
    const html = render({ stage: 'PROPOSAL' });
    expect(html).toContain('data-testid="documents-card-proposal-generate"');
    expect(html).toMatch(
      /data-testid="documents-card-proposal"[^>]*data-doc-status="available"/,
    );
  });

  it('"All documents" dump is gone; "Previously generated" history takes its place', () => {
    const html = render({ stage: 'GOLIVE' });
    expect(html).not.toContain('data-testid="documents-all-stages"');
    expect(html).not.toContain('data-testid="documents-stage-group-PROPOSAL"');
    expect(html).toContain('data-testid="documents-history"');
    expect(html).toContain('Previously generated for this customer');
  });

  it('current-stage group has a HelpTip explaining the grouping', () => {
    const html = render({ stage: 'GOLIVE' });
    expect(html).toContain('data-testid="documents-current-stage-help"');
    expect(html).toContain('Why these documents?');
  });
});
