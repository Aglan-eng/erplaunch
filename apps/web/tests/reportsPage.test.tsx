/**
 * Phase 52.6 — ReportsPage SSR render tests.
 *
 * Each dashboard component is pre-seeded with a mock query payload
 * so the page renders the data-side markup deterministically.
 * Recharts' SVG content depends on layout measurements that don't
 * exist under SSR; we test for the wrapper divs + headings + table
 * rows + callout numbers, not the inner chart geometry.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ReportsPage } from '../src/pages/ReportsPage';
import { AuthContext } from '../src/contexts/AuthContext';
import type {
  DeliveryReport,
  HealthReport,
  PipelineReport,
  RenewalsReport,
  UtilizationReport,
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

interface RenderOpts {
  tab?: 'pipeline' | 'delivery' | 'health' | 'renewals' | 'utilization';
  pipeline?: PipelineReport;
  delivery?: DeliveryReport;
  health?: HealthReport;
  renewals?: RenewalsReport;
  utilization?: UtilizationReport;
}

function render(opts: RenderOpts = {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (opts.pipeline) qc.setQueryData(['report-pipeline'], opts.pipeline);
  if (opts.delivery) qc.setQueryData(['report-delivery'], opts.delivery);
  if (opts.health) qc.setQueryData(['report-health'], opts.health);
  if (opts.renewals) qc.setQueryData(['report-renewals'], opts.renewals);
  if (opts.utilization) qc.setQueryData(['report-utilization'], opts.utilization);
  const path = opts.tab && opts.tab !== 'pipeline' ? `?tab=${opts.tab}` : '';
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/reports${path}`]}>
          <Routes>
            <Route path="/reports" element={<ReportsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

function pipelineFixture(): PipelineReport {
  return {
    funnel: [
      { stage: 'LEAD', count: 2, totalArr: 0 },
      { stage: 'QUALIFIED', count: 0, totalArr: 0 },
      { stage: 'PROPOSAL', count: 1, totalArr: 50_000 },
      { stage: 'NEGOTIATION', count: 0, totalArr: 0 },
      { stage: 'WON', count: 0, totalArr: 0 },
    ],
    conversionRates: [
      { from: 'LEAD', to: 'QUALIFIED', ratePct: 33 },
      { from: 'QUALIFIED', to: 'PROPOSAL', ratePct: 50 },
      { from: 'PROPOSAL', to: 'NEGOTIATION', ratePct: 75 },
      { from: 'NEGOTIATION', to: 'WON', ratePct: 60 },
    ],
    avgDaysInStage: [
      { stage: 'LEAD', days: 18 },
      { stage: 'QUALIFIED', days: 0 },
      { stage: 'PROPOSAL', days: 25 },
      { stage: 'NEGOTIATION', days: 0 },
      { stage: 'WON', days: 0 },
    ],
    stalledCount: 2,
  };
}

function deliveryFixture(): DeliveryReport {
  return {
    activeProjects: 1,
    byStage: [
      { stage: 'DISCOVERY', total: 0, onTrack: 0, slipping: 0 },
      { stage: 'SCOPING', total: 0, onTrack: 0, slipping: 0 },
      { stage: 'BUILD', total: 0, onTrack: 0, slipping: 0 },
      { stage: 'UAT', total: 1, onTrack: 0, slipping: 1 },
      { stage: 'GOLIVE', total: 0, onTrack: 0, slipping: 0 },
    ],
    slippingList: [
      {
        customerId: 'c-acme',
        customerName: 'Acme UAT',
        stage: 'UAT',
        daysOverdue: 14,
        projectLeadName: 'Karim',
      },
    ],
    blockersByStage: [
      { stage: 'DISCOVERY', openBlockers: 0 },
      { stage: 'SCOPING', openBlockers: 0 },
      { stage: 'BUILD', openBlockers: 0 },
      { stage: 'UAT', openBlockers: 2 },
      { stage: 'GOLIVE', openBlockers: 0 },
    ],
    forecastedGoLives: [
      { customerId: 'c-acme', customerName: 'Acme UAT', estimatedGoLiveDate: '2026-06-15' },
    ],
  };
}

function healthFixture(): HealthReport {
  return {
    totalManagedCustomers: 0,
    distribution: { red: 0, yellow: 0, green: 0 },
    redCustomers: [],
    churnRiskScore: 0,
    byStage: [
      { stage: 'HYPERCARE', red: 0, yellow: 0, green: 0 },
      { stage: 'LIVE_SLA', red: 0, yellow: 0, green: 0 },
      { stage: 'RENEWAL_DUE', red: 0, yellow: 0, green: 0 },
    ],
  };
}

function healthFixtureWithReds(): HealthReport {
  return {
    totalManagedCustomers: 3,
    distribution: { red: 2, yellow: 1, green: 0 },
    redCustomers: [
      {
        customerId: 'c-very-red',
        customerName: 'Very Red Co',
        healthScore: 10,
        lastActivityDaysAgo: 60,
        csmName: 'CSM User',
      },
      {
        customerId: 'c-warm-red',
        customerName: 'Warm Red Co',
        healthScore: 25,
        lastActivityDaysAgo: 20,
        csmName: null,
      },
    ],
    churnRiskScore: 67,
    byStage: [
      { stage: 'HYPERCARE', red: 0, yellow: 0, green: 0 },
      { stage: 'LIVE_SLA', red: 2, yellow: 1, green: 0 },
      { stage: 'RENEWAL_DUE', red: 0, yellow: 0, green: 0 },
    ],
  };
}

function renewalsFixture(): RenewalsReport {
  return {
    next90Days: [
      {
        customerId: 'c-renewal',
        customerName: 'Renewing Co',
        renewalDueDate: '2026-07-15',
        daysUntilDue: 60,
        arr: 25000,
        healthBand: 'yellow',
        csmName: 'CSM User',
      },
    ],
    totalArrAtRisk: 0,
    byMonth: [{ monthLabel: '2026-07', count: 1, arrAtRisk: 0 }],
    riskBreakdown: { healthyRenewals: 1, atRiskRenewals: 0 },
  };
}

function utilizationFixture(): UtilizationReport {
  return {
    byUser: [
      {
        userId: 'u-heavy',
        userName: 'Heavy User',
        salesCount: 6,
        projectLeadCount: 5,
        csmCount: 4,
        arCount: 2,
        totalActive: 17,
        isOverloaded: true,
      },
      {
        userId: 'u-light',
        userName: 'Light User',
        salesCount: 1,
        projectLeadCount: 0,
        csmCount: 0,
        arCount: 0,
        totalActive: 1,
        isOverloaded: false,
      },
    ],
    overloadedUsers: 1,
    unbalancedRoles: {
      role: 'projectLead',
      topUser: 'Heavy User',
      bottomUser: 'Light User',
      ratio: 5,
    },
  };
}

// ─── Tab bar ───────────────────────────────────────────────────────────────

describe('ReportsPage — tab bar', () => {
  it('renders all five tab buttons', () => {
    const html = render({ pipeline: pipelineFixture() });
    for (const t of ['pipeline', 'delivery', 'health', 'renewals', 'utilization']) {
      expect(html).toContain(`data-testid="reports-tab-${t}"`);
    }
  });

  it('defaults to the Pipeline tab', () => {
    const html = render({ pipeline: pipelineFixture() });
    expect(html).toMatch(
      /<button[^>]*data-testid="reports-tab-pipeline"[^>]*aria-current="page"/,
    );
    expect(html).toContain('data-testid="pipeline-dashboard"');
  });

  it('activates Delivery tab on ?tab=delivery', () => {
    const html = render({ tab: 'delivery', delivery: deliveryFixture() });
    expect(html).toMatch(
      /<button[^>]*data-testid="reports-tab-delivery"[^>]*aria-current="page"/,
    );
    expect(html).toContain('data-testid="delivery-dashboard"');
  });

  it('activates Customer Health tab on ?tab=health', () => {
    const html = render({ tab: 'health', health: healthFixture() });
    expect(html).toContain('data-testid="health-dashboard"');
  });

  it('activates Renewals tab on ?tab=renewals', () => {
    const html = render({ tab: 'renewals', renewals: renewalsFixture() });
    expect(html).toContain('data-testid="renewals-dashboard"');
  });

  it('activates Utilization tab on ?tab=utilization', () => {
    const html = render({ tab: 'utilization', utilization: utilizationFixture() });
    expect(html).toContain('data-testid="utilization-dashboard"');
  });
});

// ─── Pipeline ──────────────────────────────────────────────────────────────

describe('PipelineDashboard', () => {
  it('renders callouts + sections with fixture data', () => {
    const html = render({ pipeline: pipelineFixture() });
    expect(html).toContain('data-testid="pipeline-callout-stalled"');
    expect(html).toContain('data-testid="pipeline-callout-active"');
    expect(html).toContain('data-testid="pipeline-callout-arr"');
    expect(html).toContain('data-testid="pipeline-funnel-section"');
    expect(html).toContain('data-testid="pipeline-conversion-section"');
    expect(html).toContain('data-testid="pipeline-avgdays-section"');
  });

  it('renders a conversion-rate row per pair', () => {
    const html = render({ pipeline: pipelineFixture() });
    expect(html).toContain('data-testid="pipeline-conversion-row-LEAD-QUALIFIED"');
    expect(html).toContain('data-testid="pipeline-conversion-row-NEGOTIATION-WON"');
  });

  it('shows stalledCount in the callout', () => {
    const html = render({ pipeline: { ...pipelineFixture(), stalledCount: 7 } });
    // Inside the callout
    expect(html).toMatch(
      /data-testid="pipeline-callout-stalled"[^>]*>[\s\S]*?7[\s\S]*?<\/div>/,
    );
  });
});

// ─── Delivery ──────────────────────────────────────────────────────────────

describe('DeliveryDashboard', () => {
  it('renders the slipping table with one row per slipping customer', () => {
    const html = render({ tab: 'delivery', delivery: deliveryFixture() });
    expect(html).toContain('data-testid="delivery-slipping-table"');
    expect(html).toContain('data-testid="delivery-slipping-row-c-acme"');
    expect(html).toContain('Acme UAT');
  });

  it('links slipping rows to /customers/:id', () => {
    const html = render({ tab: 'delivery', delivery: deliveryFixture() });
    expect(html).toMatch(/href="\/customers\/c-acme"/);
  });

  it('renders a blockers-by-stage row per stage', () => {
    const html = render({ tab: 'delivery', delivery: deliveryFixture() });
    for (const s of ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GOLIVE']) {
      expect(html).toContain(`data-testid="delivery-blockers-row-${s}"`);
    }
  });

  it('renders the empty state when no slipping customers', () => {
    const fixture = deliveryFixture();
    fixture.slippingList = [];
    const html = render({ tab: 'delivery', delivery: fixture });
    expect(html).toContain('data-testid="delivery-slipping-empty"');
  });
});

// ─── Health ────────────────────────────────────────────────────────────────

describe('HealthDashboard', () => {
  it('shows the empty state when no managed customers', () => {
    const html = render({ tab: 'health', health: healthFixture() });
    expect(html).toContain('data-testid="health-callout-total"');
    expect(html).toContain('data-testid="health-redlist-empty"');
  });

  it('renders the red-list ordered as the API returned it', () => {
    const html = render({ tab: 'health', health: healthFixtureWithReds() });
    expect(html).toContain('data-testid="health-redlist-table"');
    expect(html).toContain('data-testid="health-redlist-row-c-very-red"');
    expect(html).toContain('data-testid="health-redlist-row-c-warm-red"');
    const firstIdx = html.indexOf('Very Red Co');
    const secondIdx = html.indexOf('Warm Red Co');
    expect(firstIdx).toBeGreaterThan(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });

  it('shows churnRiskScore in the callout', () => {
    const html = render({ tab: 'health', health: healthFixtureWithReds() });
    expect(html).toContain('67%');
  });
});

// ─── Renewals ──────────────────────────────────────────────────────────────

describe('RenewalsDashboard', () => {
  it('renders the renewals table with one row per customer', () => {
    const html = render({ tab: 'renewals', renewals: renewalsFixture() });
    expect(html).toContain('data-testid="renewals-list-table"');
    expect(html).toContain('data-testid="renewals-list-row-c-renewal"');
    expect(html).toContain('Renewing Co');
  });

  it('renders the by-month chart section', () => {
    const html = render({ tab: 'renewals', renewals: renewalsFixture() });
    expect(html).toContain('data-testid="renewals-bymonth-section"');
  });

  it('shows the empty state when no upcoming renewals', () => {
    const empty: RenewalsReport = {
      next90Days: [],
      totalArrAtRisk: 0,
      byMonth: [],
      riskBreakdown: { healthyRenewals: 0, atRiskRenewals: 0 },
    };
    const html = render({ tab: 'renewals', renewals: empty });
    expect(html).toContain('data-testid="renewals-list-empty"');
  });
});

// ─── Utilization ───────────────────────────────────────────────────────────

describe('UtilizationDashboard', () => {
  it('renders the detail table with one row per user', () => {
    const html = render({ tab: 'utilization', utilization: utilizationFixture() });
    expect(html).toContain('data-testid="utilization-detail-table"');
    expect(html).toContain('data-testid="utilization-detail-row-u-heavy"');
    expect(html).toContain('data-testid="utilization-detail-row-u-light"');
  });

  it('marks overloaded rows with data-overloaded=true', () => {
    const html = render({ tab: 'utilization', utilization: utilizationFixture() });
    expect(html).toMatch(
      /data-testid="utilization-detail-row-u-heavy"[^>]*data-overloaded="true"/,
    );
    expect(html).toMatch(
      /data-testid="utilization-detail-row-u-light"[^>]*data-overloaded="false"/,
    );
  });

  it('renders the overload count callout', () => {
    const html = render({ tab: 'utilization', utilization: utilizationFixture() });
    expect(html).toContain('data-testid="utilization-callout-overloaded"');
  });

  it('renders the unbalanced-role callout with the role + ratio', () => {
    const html = render({ tab: 'utilization', utilization: utilizationFixture() });
    expect(html).toContain('projectLead');
    expect(html).toContain('5×');
  });

  it('shows the empty state when no owners exist', () => {
    const empty: UtilizationReport = {
      byUser: [],
      overloadedUsers: 0,
      unbalancedRoles: null,
    };
    const html = render({ tab: 'utilization', utilization: empty });
    expect(html).toContain('data-testid="utilization-byuser-empty"');
  });
});
