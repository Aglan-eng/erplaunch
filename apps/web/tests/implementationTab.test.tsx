/**
 * Phase 54.1 — Implementation tab on Customer Detail.
 *
 * Pins:
 *   - The tab is reachable via ?tab=implementation.
 *   - All five workspace entry points render with stable test ids.
 *   - Each entry's `to` route points at the matching
 *     /engagements/<customerId>/* surface — i.e. the existing
 *     engine is reused, not a re-implementation.
 *   - Pre-Won customers see the muted "implementation activates after
 *     Won" note but the cards are still rendered.
 *   - The Tabs bar surfaces the new "Implementation" tab.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CustomerDetailPage } from '../src/pages/CustomerDetailPage';
import { AuthContext } from '../src/contexts/AuthContext';
import type { CustomerDetail, CustomerStage } from '../src/lib/api';

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
    id: 'cust-impl-1',
    name: 'Acme Industries',
    currentStage: 'BUILD',
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
      kind: 'BUILD',
      openBlockerCount: 0,
      openDecisionCount: 0,
      daysInStage: 12,
      targetDays: 60,
    },
    ...over,
  };
}

function render(stage: CustomerStage = 'BUILD'): string {
  const customerId = 'cust-impl-1';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['customer-detail', customerId], {
    customer: makeDetail({ currentStage: stage }),
  });
  qc.setQueryData(['customer-activity', customerId, ''], {
    activities: [],
    limit: 200,
    offset: 0,
  });
  qc.setQueryData(['exports-catalog'], { documents: [] });
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/customers/${customerId}?tab=implementation`]}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe('CustomerDetailPage — Implementation tab', () => {
  it('exposes the Implementation tab in the tab bar', () => {
    const html = render();
    expect(html).toContain('data-testid="customer-detail-tab-implementation"');
  });

  it('?tab=implementation activates the Implementation tab body', () => {
    const html = render();
    expect(html).toMatch(
      /<button[^>]*data-testid="customer-detail-tab-implementation"[^>]*aria-current="page"/,
    );
    expect(html).toContain('data-testid="tab-implementation"');
  });

  it('renders all five workspace entry points', () => {
    const html = render();
    for (const id of [
      'data-collection',
      'documents',
      'status-report',
      'vertical-workspace',
      'jobs',
    ]) {
      expect(html).toContain(`data-testid="implementation-entry-${id}"`);
    }
  });

  it('entry-point links point at /engagements/<customerId>/* (Phase 52.1 id-preservation)', () => {
    const html = render();
    expect(html).toMatch(/href="\/engagements\/cust-impl-1\/data-collection/);
    expect(html).toMatch(/href="\/engagements\/cust-impl-1\/documents/);
    expect(html).toMatch(/href="\/engagements\/cust-impl-1\/status-report/);
    expect(html).toMatch(/href="\/engagements\/cust-impl-1\/vertical/);
    expect(html).toMatch(/href="\/engagements\/cust-impl-1\/jobs\/latest/);
  });

  it('pre-Won stages show the muted "activates after Won" note', () => {
    const html = render('PROPOSAL');
    expect(html).toContain('data-testid="implementation-prewon-note"');
    expect(html).toContain('unlocks fully once the deal moves to Won');
  });

  it('post-Won stages hide the pre-Won note but still render the entries', () => {
    const html = render('BUILD');
    expect(html).not.toContain('data-testid="implementation-prewon-note"');
    expect(html).toContain('data-testid="implementation-entries"');
  });
});
