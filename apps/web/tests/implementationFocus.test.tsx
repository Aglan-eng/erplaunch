/**
 * Phase 54.3 — Stage-aware Implementation workspace tests.
 *
 * Pins:
 *   - STAGE_FOCUS_MAP has an entry for every CustomerStage (14 +
 *     LOST + CHURNED = 16).
 *   - The Implementation tab for a BUILD customer leads with the
 *     Build focus headline and surfaces "Generate Documents" as the
 *     primary action; the `documents` card is marked relevant.
 *   - The Implementation tab for a DISCOVERY customer leads with
 *     the Discovery focus headline and the `data-collection` card
 *     is marked relevant (and ordered first).
 *   - Pre-Won stages still surface the amber "implementation
 *     activates after Won" note from Phase 54.1.
 *   - SSR-compatible.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CustomerDetailPage } from '../src/pages/CustomerDetailPage';
import { AuthContext } from '../src/contexts/AuthContext';
import { STAGE_FOCUS_MAP } from '../src/components/customers/implementationFocus';
import {
  CUSTOMER_STAGES,
  type CustomerDetail,
  type CustomerStage,
} from '../src/lib/api';

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
    id: 'cust-focus-1',
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
  const customerId = 'cust-focus-1';
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
  qc.setQueryData(['customer-generated-documents', customerId], []);
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

// ─── Stage-focus map coverage ──────────────────────────────────────────────

describe('STAGE_FOCUS_MAP', () => {
  it('has an entry for every CustomerStage in the lifecycle', () => {
    for (const stage of CUSTOMER_STAGES) {
      const focus = STAGE_FOCUS_MAP[stage];
      expect(focus, `missing focus for ${stage}`).toBeTruthy();
      expect(focus.focusHeadline).toBeTruthy();
      expect(focus.focusBody).toBeTruthy();
      expect(focus.primaryAction.label).toBeTruthy();
    }
  });

  it('every primary action declares either targetTab or targetRoute', () => {
    for (const stage of CUSTOMER_STAGES) {
      const focus = STAGE_FOCUS_MAP[stage];
      const hasTarget =
        focus.primaryAction.targetTab !== undefined ||
        focus.primaryAction.targetRoute !== undefined;
      expect(hasTarget, `${stage} primary action has no target`).toBe(true);
    }
  });

  it('LOST and CHURNED are marked muted (terminal stages)', () => {
    expect(STAGE_FOCUS_MAP.LOST.tone).toBe('muted');
    expect(STAGE_FOCUS_MAP.CHURNED.tone).toBe('muted');
  });
});

// ─── Implementation tab — stage-aware rendering ───────────────────────────

describe('Implementation tab — stage-aware', () => {
  it('BUILD customer leads with the Build focus + Generate Documents action', () => {
    const html = render('BUILD');
    expect(html).toContain('data-testid="implementation-focus"');
    expect(html).toMatch(/data-testid="implementation-focus"[^>]*data-stage="BUILD"/);
    expect(html).toContain('data-testid="implementation-focus-headline"');
    expect(html).toContain('Build — configure the system');
    expect(html).toContain('data-testid="implementation-focus-primary-action"');
    expect(html).toContain('Generate Documents');
  });

  it('BUILD highlights the documents card as relevant + the jobs card', () => {
    const html = render('BUILD');
    expect(html).toMatch(
      /data-testid="implementation-entry-documents"[^>]*data-relevant="true"/,
    );
    expect(html).toMatch(
      /data-testid="implementation-entry-jobs"[^>]*data-relevant="true"/,
    );
    // Status report is NOT in BUILD's relevant set.
    expect(html).toMatch(
      /data-testid="implementation-entry-status-report"[^>]*data-relevant="false"/,
    );
  });

  it('DISCOVERY customer leads with Discovery focus + Data Collection action', () => {
    const html = render('DISCOVERY');
    expect(html).toMatch(/data-testid="implementation-focus"[^>]*data-stage="DISCOVERY"/);
    expect(html).toContain('Discovery — capture how the customer actually runs');
    // SSR escapes `&` to `&amp;`; match either form.
    expect(html).toMatch(/Open Discovery (?:&amp;|&) Data Collection/);
    // The data-collection card is marked relevant on DISCOVERY.
    expect(html).toMatch(
      /data-testid="implementation-entry-data-collection"[^>]*data-relevant="true"/,
    );
  });

  it('RENEWAL_DUE leads with renewal focus + Generate Renewal Documents action', () => {
    const html = render('RENEWAL_DUE');
    expect(html).toContain('Renewal — secure the next term');
    expect(html).toContain('Generate Renewal Documents');
  });

  it('pre-Won stages still show the amber "activates after Won" note', () => {
    const html = render('PROPOSAL');
    expect(html).toContain('data-testid="implementation-prewon-note"');
    expect(html).toContain('Still pre-sales');
  });

  it('post-Won stages hide the pre-Won note', () => {
    const html = render('BUILD');
    expect(html).not.toContain('data-testid="implementation-prewon-note"');
  });

  it('LOST customer renders the muted terminal focus', () => {
    const html = render('LOST');
    expect(html).toContain('Closed — deal lost');
  });

  it('all five workspace cards are still reachable regardless of stage', () => {
    const html = render('DISCOVERY');
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

  it('relevant cards render before non-relevant cards in the entry grid', () => {
    const html = render('DISCOVERY');
    const dataCollectionIdx = html.indexOf('implementation-entry-data-collection');
    const verticalIdx = html.indexOf('implementation-entry-vertical-workspace');
    // data-collection is in DISCOVERY's relevantTools; vertical isn't.
    // Sorted order must put data-collection first.
    expect(dataCollectionIdx).toBeGreaterThan(-1);
    expect(verticalIdx).toBeGreaterThan(-1);
    expect(dataCollectionIdx).toBeLessThan(verticalIdx);
  });
});
