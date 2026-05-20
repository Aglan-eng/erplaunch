/**
 * Phase 53.3 — Executive Dashboard + nav-visibility tests.
 *
 * SSR-only per the repo convention. Pins:
 *   - The dashboard renders the 5-tile KPI strip + 5 report
 *     roll-ups + the firm-wide activity card.
 *   - The "Executive" AppNav link appears for CEO and APP_ADMIN
 *     only; SALES_MANAGER / CONSULTANT do not see it.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ExecutiveDashboardPage } from '../src/pages/ExecutiveDashboardPage';
import { AppNav } from '../src/components/AppNav';
import { AuthContext } from '../src/contexts/AuthContext';

function authFor(role: string) {
  return {
    user: {
      id: 'u-1',
      firmId: 'f-1',
      email: 't@x.io',
      name: role + ' User',
      role,
    },
    loading: false,
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
}

function renderExec(role: string): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['report-pipeline'], {
    funnel: [
      { stage: 'LEAD', count: 2, totalArr: 5_000_000 },
      { stage: 'PROPOSAL', count: 3, totalArr: 12_000_000 },
    ],
    conversionRates: [],
    avgDaysInStage: [],
    stalledCount: 1,
  });
  qc.setQueryData(['report-delivery'], {
    activeProjects: 4,
    byStage: [],
    slippingList: [{ customerId: 'c-1', customerName: 'X', stage: 'BUILD', daysOverdue: 2, projectLeadName: null }],
    blockersByStage: [],
    forecastedGoLives: [{ customerId: 'c-2', customerName: 'Y', estimatedGoLiveDate: '2026-09-01' }],
  });
  qc.setQueryData(['report-health'], {
    totalManagedCustomers: 6,
    distribution: { red: 1, yellow: 2, green: 3 },
    redCustomers: [],
    churnRiskScore: 12,
    byStage: [],
  });
  qc.setQueryData(['report-renewals'], {
    next90Days: [{ customerName: 'Z' }],
    byMonth: [],
    totalArrAtRisk: 50_000,
    riskBreakdown: { atRiskRenewals: 1, healthyRenewals: 0 },
  });
  qc.setQueryData(['report-utilization'], {
    byUser: [{ userId: 'u-1', userName: 'A', salesCount: 1, projectLeadCount: 1, csmCount: 0, arCount: 0, totalActive: 2, isOverloaded: false }],
    overloadedUsers: 0,
    unbalancedRoles: null,
  });

  return renderToStaticMarkup(
    <AuthContext.Provider value={authFor(role)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/executive']}>
          <ExecutiveDashboardPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

function renderNav(role: string): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <AuthContext.Provider value={authFor(role)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/inbox']}>
          <AppNav />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe('ExecutiveDashboardPage', () => {
  it('renders the page wrapper + 5 KPI tiles', () => {
    const html = renderExec('CEO');
    expect(html).toContain('data-testid="executive-dashboard-page"');
    expect(html).toContain('data-testid="executive-kpi-strip"');
    for (const id of [
      'exec-kpi-pipeline-value',
      'exec-kpi-active-impl',
      'exec-kpi-at-risk',
      'exec-kpi-renewal-exposure',
      'exec-kpi-overloaded',
    ]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
  });

  it('renders all five report roll-up cards + firm-wide activity', () => {
    const html = renderExec('CEO');
    expect(html).toContain('data-testid="executive-rollups"');
    for (const id of [
      'exec-rollup-pipeline',
      'exec-rollup-delivery',
      'exec-rollup-health',
      'exec-rollup-renewals',
      'exec-rollup-utilization',
      'exec-rollup-activity',
    ]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
  });

  it('roll-up cards deep-link to the matching /reports tab', () => {
    const html = renderExec('CEO');
    expect(html).toMatch(/href="\/reports\?tab=pipeline"/);
    expect(html).toMatch(/href="\/reports\?tab=delivery"/);
    expect(html).toMatch(/href="\/reports\?tab=health"/);
    expect(html).toMatch(/href="\/reports\?tab=renewals"/);
    expect(html).toMatch(/href="\/reports\?tab=utilization"/);
  });
});

describe('AppNav — Executive link visibility', () => {
  it('CEO sees the Executive nav link', () => {
    const html = renderNav('CEO');
    expect(html).toContain('data-testid="app-nav-link-executive"');
  });

  it('APP_ADMIN sees the Executive nav link', () => {
    const html = renderNav('APP_ADMIN');
    expect(html).toContain('data-testid="app-nav-link-executive"');
  });

  it('SALES_MANAGER does NOT see the Executive nav link', () => {
    const html = renderNav('SALES_MANAGER');
    expect(html).not.toContain('data-testid="app-nav-link-executive"');
  });

  it('CONSULTANT (default) does NOT see the Executive nav link', () => {
    const html = renderNav('CONSULTANT');
    expect(html).not.toContain('data-testid="app-nav-link-executive"');
  });
});
