/**
 * Phase 55.1 — DashboardPage + ProjectsPage SSR tests.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DashboardPage } from '../src/pages/DashboardPage';
import { ProjectsPage } from '../src/pages/ProjectsPage';
import { AuthContext } from '../src/contexts/AuthContext';

function fakeAuth(role = 'APP_ADMIN') {
  return {
    user: { id: 'u-1', firmId: 'f-1', email: 't@x.io', name: 'Demo', role },
    loading: false,
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
}

function seedQc(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['report-pipeline'], {
    funnel: [{ stage: 'LEAD', count: 2, totalArr: 5_000_000 }],
    conversionRates: [],
    avgDaysInStage: [],
    stalledCount: 1,
  });
  qc.setQueryData(['report-delivery'], {
    activeProjects: 3,
    byStage: [
      { stage: 'BUILD', total: 3, onTrack: 2, slipping: 1 },
    ],
    slippingList: [],
    blockersByStage: [],
    forecastedGoLives: [],
  });
  qc.setQueryData(['report-health'], {
    totalManagedCustomers: 6,
    distribution: { red: 1, yellow: 2, green: 3 },
    redCustomers: [],
    churnRiskScore: 12,
    byStage: [],
  });
  qc.setQueryData(['report-renewals'], {
    next90Days: [
      {
        customerId: 'c-1',
        customerName: 'Mike Renewal',
        renewalDueDate: '2026-07-01',
        daysUntilDue: 30,
        arr: 200_000,
        healthBand: 'yellow',
        csmName: null,
      },
    ],
    byMonth: [],
    totalArrAtRisk: 50_000,
    riskBreakdown: { atRiskRenewals: 1, healthyRenewals: 0 },
  });
  qc.setQueryData(['report-utilization'], {
    byUser: [
      { userId: 'u-1', userName: 'A', salesCount: 1, projectLeadCount: 1, csmCount: 0, arCount: 0, totalActive: 2, isOverloaded: false },
    ],
    overloadedUsers: 0,
    unbalancedRoles: null,
  });
  qc.setQueryData(['inbox'], {
    forYou: [
      { id: 'i-1', itemType: 'STAGE_OVERDUE', customerId: 'c-1', customerName: 'Acme', currentStage: 'BUILD', severity: 'warning', summary: 'In Build 70 days', ageDays: 70, createdAt: new Date().toISOString() },
    ],
    watching: [],
    firmWide: null,
  });
  qc.setQueryData(['customers-projects'], {
    customers: [
      {
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
      },
    ],
  });
  return qc;
}

function render(node: React.ReactElement, initialEntry = '/dashboard'): string {
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={seedQc()}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="*" element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe('DashboardPage', () => {
  it('renders the AppShell + dashboard wrapper', () => {
    const html = render(<DashboardPage />);
    expect(html).toContain('data-testid="app-shell"');
    expect(html).toContain('data-testid="dashboard-page"');
    expect(html).toContain('data-testid="side-nav"');
  });

  it('renders the 6-tile KPI row', () => {
    const html = render(<DashboardPage />);
    expect(html).toContain('data-testid="dashboard-kpi-row"');
    for (const id of [
      'dash-kpi-pipeline',
      'dash-kpi-active',
      'dash-kpi-at-risk',
      'dash-kpi-renewal-exposure',
      'dash-kpi-total-arr',
      'dash-kpi-for-you',
    ]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
  });

  it('renders the 3 chart cards + the 2 lower-row panels', () => {
    const html = render(<DashboardPage />);
    expect(html).toContain('data-testid="dashboard-charts-row"');
    for (const id of ['dash-chart-pipeline', 'dash-chart-delivery', 'dash-chart-health']) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    expect(html).toContain('data-testid="dashboard-lower-row"');
    expect(html).toContain('data-testid="dash-needs-attention"');
    expect(html).toContain('data-testid="dash-utilization"');
  });
});

describe('ProjectsPage', () => {
  it('renders the AppShell + projects table for delivery-stage customers', () => {
    const html = render(<ProjectsPage />, '/projects');
    expect(html).toContain('data-testid="app-shell"');
    expect(html).toContain('data-testid="projects-page"');
    expect(html).toContain('data-testid="projects-table"');
    expect(html).toContain('data-testid="projects-row-c-1"');
  });

  it('row links to the customer\'s Implementation tab', () => {
    const html = render(<ProjectsPage />, '/projects');
    expect(html).toContain('href="/customers/c-1?tab=implementation"');
  });
});
