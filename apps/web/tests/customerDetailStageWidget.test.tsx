/**
 * Phase 52.7 — Stage-specific widget SSR render tests.
 *
 * Each widget gets a fixture mock of the matching StageWidget union
 * variant; we assert the kind-discriminator data-testid and the
 * key fields render. The dispatcher is verified to slot the right
 * component into the Overview tab.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CustomerDetailPage } from '../src/pages/CustomerDetailPage';
import { AuthContext } from '../src/contexts/AuthContext';
import { StageWidget } from '../src/components/customers/widgets';
import type { CustomerDetail, StageWidget as StageWidgetUnion } from '../src/lib/api';

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

function baseDetail(over: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: 'c-1',
    name: 'Acme',
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
    stageWidget: { kind: 'BUILD', openBlockerCount: 0, openDecisionCount: 0, daysInStage: 0, targetDays: 60 },
    ...over,
  };
}

function renderWidget(detail: CustomerDetail): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StageWidget detail={detail} />
    </MemoryRouter>,
  );
}

function renderPage(detail: CustomerDetail): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['customer-detail', detail.id], { customer: detail });
  qc.setQueryData(['customer-activity', detail.id, ''], {
    activities: [],
    limit: 200,
    offset: 0,
  });
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/customers/${detail.id}`]}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

// ─── Wrapper ──────────────────────────────────────────────────────────────

describe('StageWidget — wrapper + dispatcher', () => {
  it('renders a wrapper with the stage kind data-attribute', () => {
    const detail = baseDetail();
    const html = renderWidget(detail);
    expect(html).toContain('data-testid="stage-widget"');
    expect(html).toContain('data-stage-widget-kind="BUILD"');
  });

  it('slots into the Customer Detail Overview tab', () => {
    const detail = baseDetail();
    const html = renderPage(detail);
    expect(html).toContain('data-testid="tab-overview"');
    expect(html).toContain('data-testid="stage-widget"');
    expect(html).toContain('Stage focus');
  });
});

// ─── Each stage variant renders the right component ───────────────────────

describe('StageWidget — each kind renders the right component', () => {
  const cases: Array<{ widget: StageWidgetUnion; testid: string }> = [
    {
      widget: { kind: 'LEAD', daysInStage: 5, targetDays: 14, leadSource: 'Referral' },
      testid: 'widget-lead',
    },
    {
      widget: { kind: 'QUALIFIED', daysInStage: 3, targetDays: 14, leadSource: null },
      testid: 'widget-qualified',
    },
    {
      widget: {
        kind: 'PROPOSAL',
        daysInStage: 10,
        targetDays: 21,
        proposalGeneratedAt: null,
        arr: 25000,
      },
      testid: 'widget-proposal',
    },
    {
      widget: {
        kind: 'NEGOTIATION',
        daysInStage: 4,
        targetDays: 14,
        proposalGeneratedAt: new Date().toISOString(),
        arr: 50_000,
      },
      testid: 'widget-negotiation',
    },
    {
      widget: { kind: 'WON', sowGeneratedAt: null, kickoffScheduled: false },
      testid: 'widget-won',
    },
    {
      widget: {
        kind: 'DISCOVERY',
        questionnaireCompletionPct: 60,
        questionnaireSectionsComplete: 3,
        questionnaireSectionsTotal: 5,
        nextSectionName: 'Inventory',
      },
      testid: 'widget-discovery',
    },
    {
      widget: { kind: 'SCOPING', openDecisionsCount: 2, pendingScopeSignoff: true },
      testid: 'widget-scoping',
    },
    {
      widget: {
        kind: 'BUILD',
        openBlockerCount: 3,
        openDecisionCount: 1,
        daysInStage: 20,
        targetDays: 60,
      },
      testid: 'widget-build',
    },
    {
      widget: {
        kind: 'UAT',
        openBlockerCount: 0,
        daysInStage: 5,
        targetDays: 21,
        testsPassedPct: 88,
      },
      testid: 'widget-uat',
    },
    {
      widget: {
        kind: 'GOLIVE',
        daysUntilGoLive: 10,
        cutoverChecklistComplete: 2,
        cutoverChecklistTotal: 5,
      },
      testid: 'widget-golive',
    },
    {
      widget: {
        kind: 'HYPERCARE',
        openIncidentCount: 1,
        p1Count: 0,
        daysRemainingInHypercare: 14,
        hypercareStartDate: new Date().toISOString(),
      },
      testid: 'widget-hypercare',
    },
    {
      widget: {
        kind: 'LIVE_SLA',
        openTicketCount: 2,
        slaUptimePct: 99.95,
        lastIncidentDaysAgo: 7,
        nextRenewalDate: '2027-01-15T00:00:00.000Z',
      },
      testid: 'widget-live-sla',
    },
    {
      widget: {
        kind: 'RENEWAL_DUE',
        daysUntilRenewal: 30,
        renewalValueArr: 60_000,
        healthBand: 'yellow',
        quoteGenerated: false,
      },
      testid: 'widget-renewal-due',
    },
    {
      widget: {
        kind: 'RENEWED',
        renewalCount: 2,
        lastRenewalDate: '2026-01-10T00:00:00.000Z',
        nextRenewalDate: '2027-01-10T00:00:00.000Z',
      },
      testid: 'widget-renewed',
    },
    {
      widget: { kind: 'LOST', lostReason: 'Pricing', lostValue: 25_000 },
      testid: 'widget-lost',
    },
    {
      widget: {
        kind: 'CHURNED',
        churnReason: 'Switched ERP',
        churnedAt: '2026-04-01T00:00:00.000Z',
      },
      testid: 'widget-churned',
    },
  ];

  for (const c of cases) {
    it(`renders ${c.testid} for kind=${c.widget.kind}`, () => {
      const detail = baseDetail({
        currentStage: c.widget.kind === 'LEAD' || c.widget.kind === 'QUALIFIED' ? c.widget.kind : 'BUILD',
        stageWidget: c.widget,
      });
      const html = renderWidget(detail);
      expect(html).toContain(`data-testid="${c.testid}"`);
      expect(html).toContain(`data-stage-widget-kind="${c.widget.kind}"`);
    });
  }
});

// ─── Key field assertions ─────────────────────────────────────────────────

describe('StageWidget — key fields render correctly', () => {
  it('Discovery progress ring shows the correct %', () => {
    const detail = baseDetail({
      currentStage: 'DISCOVERY',
      stageWidget: {
        kind: 'DISCOVERY',
        questionnaireCompletionPct: 42,
        questionnaireSectionsComplete: 2,
        questionnaireSectionsTotal: 5,
        nextSectionName: 'Finance',
      },
    });
    const html = renderWidget(detail);
    expect(html).toContain('data-testid="widget-discovery-pct"');
    expect(html).toContain('42%');
    expect(html).toContain('Finance');
  });

  it('Build blocker chip surfaces the correct count', () => {
    const detail = baseDetail({
      stageWidget: {
        kind: 'BUILD',
        openBlockerCount: 7,
        openDecisionCount: 2,
        daysInStage: 12,
        targetDays: 60,
      },
    });
    const html = renderWidget(detail);
    expect(html).toContain('data-testid="widget-build-blockers"');
    expect(html).toContain('7 open');
    expect(html).toContain('data-testid="widget-build-decisions"');
    expect(html).toContain('2 open');
  });

  it('Renewal Due countdown shows daysUntilRenewal verbatim', () => {
    const detail = baseDetail({
      currentStage: 'RENEWAL_DUE',
      stageWidget: {
        kind: 'RENEWAL_DUE',
        daysUntilRenewal: 9,
        renewalValueArr: 75_000,
        healthBand: 'red',
        quoteGenerated: false,
      },
    });
    const html = renderWidget(detail);
    expect(html).toContain('data-testid="widget-renewaldue-countdown"');
    expect(html).toContain('9d');
    expect(html).toContain('data-testid="widget-renewaldue-generate-quote"');
  });

  it('Lead widget shows source and overdue tone when over target', () => {
    const detail = baseDetail({
      currentStage: 'LEAD',
      stageWidget: {
        kind: 'LEAD',
        daysInStage: 30,
        targetDays: 14,
        leadSource: 'Trade show',
      },
    });
    const html = renderWidget(detail);
    expect(html).toContain('Trade show');
    expect(html).toContain('30d / 14d');
  });
});
