/**
 * Phase 52.4 — CustomerDetailPage SSR render tests.
 *
 * SSR-only per the established pattern. Interactive behaviour
 * (advance button click, settings submit, drag-drop in kanban, the
 * window.prompt fallback for the rollback reason) is e2e territory.
 * What we CAN pin in SSR:
 *
 *   - Loading + error states
 *   - All four tab buttons render + the correct one is active
 *     based on ?tab=…
 *   - Overview renders the health card + breakdown bars + stage
 *     history strip + owner badges
 *   - Documents renders both generate buttons
 *   - Settings renders the input fields + the save button
 *   - Activity (with no data) renders the empty state
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CustomerDetailPage } from '../src/pages/CustomerDetailPage';
import { AuthContext } from '../src/contexts/AuthContext';
import type { CustomerDetail } from '../src/lib/api';

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
    name: 'Acme Industries',
    currentStage: 'BUILD',
    primaryOwnerName: 'Karim Aglan',
    primaryOwnerId: 'u-pm',
    healthScore: 78,
    healthBand: 'green',
    renewalCount: 2,
    lastActivityAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    arr: 25000,
    customerAddress: '12 Industry Way, Dubai',
    primaryContactName: 'Lina Said',
    primaryContactEmail: 'lina@example.com',
    primaryContactPhone: '+971-50-1234567',
    salesOwner: { id: 'u-sales', name: 'Sales User' },
    projectLeadOwner: { id: 'u-pm', name: 'Karim Aglan' },
    csmOwner: null,
    arOwner: null,
    healthBreakdown: {
      score: 78,
      band: 'green',
      questionnaireCompletion: 21,
      blockersComponent: 22.5,
      overdueComponent: 25,
      pendingDecisionsComponent: 10,
      rawCounts: { blockers: 1, daysOverdue: 0, pendingDecisions: 1, questionnairePct: 0.7 },
    },
    stageHistory: [
      {
        id: 'hist-1',
        fromStage: 'PROPOSAL',
        toStage: 'WON',
        actorName: 'Karim Aglan',
        isRollback: false,
        reason: null,
        createdAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      },
      {
        id: 'hist-2',
        fromStage: 'WON',
        toStage: 'BUILD',
        actorName: 'Karim Aglan',
        isRollback: false,
        reason: 'Discovery complete',
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    ],
    stageWidget: {
      kind: 'BUILD',
      openBlockerCount: 1,
      openDecisionCount: 1,
      daysInStage: 12,
      targetDays: 60,
    },
    ...over,
  };
}

interface RenderOpts {
  customerId?: string;
  detail?: CustomerDetail | null;
  loading?: boolean;
  tab?: 'overview' | 'documents' | 'activity' | 'settings';
  activities?: Array<Record<string, unknown>>;
}

function render(opts: RenderOpts = {}): string {
  const customerId = opts.customerId ?? 'c-1';
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (!opts.loading && opts.detail !== null) {
    qc.setQueryData(['customer-detail', customerId], { customer: opts.detail ?? makeDetail() });
  }
  // Pre-seed the activity query when on the activity tab so the
  // empty/loaded states are deterministic.
  qc.setQueryData(['customer-activity', customerId, ''], {
    activities: opts.activities ?? [],
    limit: 200,
    offset: 0,
  });

  const path = opts.tab && opts.tab !== 'overview' ? `?tab=${opts.tab}` : '';
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/customers/${customerId}${path}`]}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

// ─── Loading + error ──────────────────────────────────────────────────────

describe('CustomerDetailPage — loading + error', () => {
  it('renders the loading state when no data is in the cache', () => {
    const html = render({ loading: true });
    expect(html).toContain('data-testid="customer-detail-loading"');
    expect(html).toContain('data-testid="side-nav"');
  });
});

// ─── Header ────────────────────────────────────────────────────────────────

describe('CustomerDetailPage — header', () => {
  it('renders the customer name + current stage badge', () => {
    const html = render({ detail: makeDetail({ name: 'Hyper Co', currentStage: 'BUILD' }) });
    expect(html).toContain('Hyper Co');
    expect(html).toContain('data-testid="customer-header-stage"');
    expect(html).toContain('Build');
  });

  it('renders the renewal badge when renewalCount > 0', () => {
    const html = render({ detail: makeDetail({ renewalCount: 3 }) });
    expect(html).toContain('data-testid="customer-header-renewals"');
    expect(html).toContain('3 renewal');
  });

  it('hides the renewal badge when renewalCount = 0', () => {
    const html = render({ detail: makeDetail({ renewalCount: 0 }) });
    expect(html).not.toContain('data-testid="customer-header-renewals"');
  });

  it('renders Advance + Rollback buttons for mid-journey stages', () => {
    const html = render({ detail: makeDetail({ currentStage: 'BUILD' }) });
    expect(html).toContain('data-testid="customer-header-advance"');
    expect(html).toContain('data-testid="customer-header-rollback"');
  });

  it('renders all four owner badges', () => {
    const html = render({ detail: makeDetail() });
    expect(html).toContain('data-testid="owner-badge-sales"');
    expect(html).toContain('data-testid="owner-badge-project-lead"');
    expect(html).toContain('data-testid="owner-badge-csm"');
    expect(html).toContain('data-testid="owner-badge-ar"');
  });

  it('marks the stage-canonical owner badge as active', () => {
    const html = render({ detail: makeDetail({ currentStage: 'BUILD', primaryOwnerId: 'u-pm' }) });
    expect(html).toMatch(
      /data-testid="owner-badge-project-lead"[^>]*data-active="true"/,
    );
  });
});

// ─── Tabs ─────────────────────────────────────────────────────────────────

describe('CustomerDetailPage — tabs', () => {
  it('renders all four tab buttons', () => {
    const html = render({ detail: makeDetail() });
    for (const t of ['overview', 'documents', 'activity', 'settings']) {
      expect(html).toContain(`data-testid="customer-detail-tab-${t}"`);
    }
  });

  it('marks Overview as the default active tab', () => {
    const html = render({ detail: makeDetail() });
    expect(html).toMatch(
      /<button[^>]*data-testid="customer-detail-tab-overview"[^>]*aria-current="page"/,
    );
    expect(html).toContain('data-testid="tab-overview"');
  });

  it('activates Documents tab on ?tab=documents', () => {
    const html = render({ detail: makeDetail(), tab: 'documents' });
    expect(html).toMatch(
      /<button[^>]*data-testid="customer-detail-tab-documents"[^>]*aria-current="page"/,
    );
    expect(html).toContain('data-testid="tab-documents"');
  });

  it('activates Activity tab on ?tab=activity', () => {
    const html = render({ detail: makeDetail(), tab: 'activity' });
    expect(html).toContain('data-testid="tab-activity"');
  });

  it('activates Settings tab on ?tab=settings', () => {
    const html = render({ detail: makeDetail(), tab: 'settings' });
    expect(html).toContain('data-testid="tab-settings"');
  });
});

// ─── Overview tab ──────────────────────────────────────────────────────────

describe('CustomerDetailPage — Overview tab', () => {
  it('renders the health card with score + band', () => {
    const html = render({ detail: makeDetail({ healthScore: 78, healthBand: 'green' }) });
    expect(html).toContain('data-testid="customer-health-card"');
    expect(html).toContain('data-testid="customer-health-score"');
    expect(html).toContain('data-testid="customer-health-band"');
    expect(html).toContain('78');
    expect(html).toContain('green');
  });

  it('renders all four health breakdown bars', () => {
    const html = render({ detail: makeDetail() });
    expect(html).toContain('data-testid="health-bar-questionnaire"');
    expect(html).toContain('data-testid="health-bar-blockers"');
    expect(html).toContain('data-testid="health-bar-overdue"');
    expect(html).toContain('data-testid="health-bar-decisions"');
  });

  it('renders the stage history strip with one entry per history row', () => {
    const html = render({ detail: makeDetail() });
    expect(html).toContain('data-testid="customer-stage-history-strip"');
    expect(html).toContain('data-testid="stage-history-entry-hist-1"');
    expect(html).toContain('data-testid="stage-history-entry-hist-2"');
  });

  it('marks rollback entries with data-rollback=true', () => {
    const html = render({
      detail: makeDetail({
        stageHistory: [
          {
            id: 'h-rb',
            fromStage: 'UAT',
            toStage: 'BUILD',
            actorName: 'Test',
            isRollback: true,
            reason: 'tests failing',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(html).toMatch(
      /data-testid="stage-history-entry-h-rb"[^>]*data-rollback="true"/,
    );
  });

  it('renders the empty stage history state when there are no transitions', () => {
    const html = render({ detail: makeDetail({ stageHistory: [] }) });
    expect(html).toContain('data-testid="customer-stage-history-empty"');
  });
});

// ─── Documents tab ─────────────────────────────────────────────────────────

describe('CustomerDetailPage — Documents tab', () => {
  // Phase 54.2 — Documents tab dropped the "All documents" dump in
  // favour of a "Previously generated for this customer" history.
  // Detailed assertions live in customerDetailDocuments.test.tsx.
  it('renders the stage-aware Documents tab shell', () => {
    const html = render({ detail: makeDetail(), tab: 'documents' });
    expect(html).toContain('data-testid="tab-documents"');
    expect(html).toContain('data-testid="documents-current-stage"');
    expect(html).toContain('data-testid="documents-history"');
  });

  it('shows the "Previously generated" history section', () => {
    const html = render({ detail: makeDetail(), tab: 'documents' });
    expect(html).toContain('Previously generated for this customer');
  });
});

// ─── Activity tab ─────────────────────────────────────────────────────────

describe('CustomerDetailPage — Activity tab', () => {
  it('renders activity type filter chips', () => {
    const html = render({ detail: makeDetail(), tab: 'activity' });
    expect(html).toContain('data-testid="activity-type-chip-STAGE_TRANSITION"');
    expect(html).toContain('data-testid="activity-type-chip-OWNER_HANDOFF"');
    expect(html).toContain('data-testid="activity-type-chip-CUSTOMER_EDITED"');
  });

  it('renders the empty state when no activity rows exist', () => {
    const html = render({ detail: makeDetail(), tab: 'activity', activities: [] });
    expect(html).toContain('data-testid="activity-empty"');
  });
});

// ─── Settings tab ─────────────────────────────────────────────────────────

describe('CustomerDetailPage — Settings tab', () => {
  it('renders the editable input fields seeded from the customer', () => {
    const html = render({ detail: makeDetail(), tab: 'settings' });
    expect(html).toContain('data-testid="settings-field-customerName"');
    expect(html).toContain('data-testid="settings-field-customerAddress"');
    expect(html).toContain('data-testid="settings-field-primaryContactName"');
    expect(html).toContain('data-testid="settings-field-primaryContactEmail"');
    expect(html).toContain('data-testid="settings-field-primaryContactPhone"');
    expect(html).toContain('data-testid="settings-field-arr"');
    expect(html).toContain('data-testid="settings-field-salesOwnerUserId"');
    expect(html).toContain('data-testid="settings-field-projectLeadUserId"');
    expect(html).toContain('data-testid="settings-field-csmUserId"');
    expect(html).toContain('data-testid="settings-field-arOwnerUserId"');
  });

  it('seeds the customer name input from the loaded customer', () => {
    const html = render({
      detail: makeDetail({ name: 'Pre-filled Co' }),
      tab: 'settings',
    });
    expect(html).toMatch(
      /<input[^>]*data-testid="settings-field-customerName"[^>]*value="Pre-filled Co"/,
    );
  });

  it('renders the Save button', () => {
    const html = render({ detail: makeDetail(), tab: 'settings' });
    expect(html).toContain('data-testid="settings-save"');
  });
});
