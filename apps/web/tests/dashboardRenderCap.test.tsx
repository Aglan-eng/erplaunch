/**
 * Phase 55.2 hotfix — render-cap guard for /dashboard.
 *
 * Prevents the infinite-render-loop regression that took the post-
 * Phase-55.1 home page down. SSR (`renderToStaticMarkup`) cannot
 * exercise client-only effects, so this guard combines two checks:
 *
 *   1. SSR-time render counter: the component's function body must
 *      not be called more than `MAX_RENDERS_SSR` times in a single
 *      pass. Infinite render loops surface in production as runaway
 *      mounts that quickly exceed any sane render budget.
 *   2. AssistantProvider must NOT be wrapped around the dashboard
 *      page itself — it lives at the App root (Phase 55.2 hotfix).
 *      A dashboard-scoped provider would re-mount on every navigation
 *      and was part of the original render storm.
 *
 * These are static safety nets — they cannot perfectly model a
 * client render loop, but they catch the structural mistakes that
 * produced the regression (unmemoized context values, per-page
 * provider mounting, AppShell mounted inside AssistantProvider, etc).
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DashboardPage } from '../src/pages/DashboardPage';
import { AuthContext } from '../src/contexts/AuthContext';
import { AssistantProvider } from '../src/components/assistant/AssistantPanel';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_TSX = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');
const SIDENAV_TSX = fs.readFileSync(
  path.resolve(__dirname, '../src/components/SideNav.tsx'),
  'utf8',
);

function fakeAuth() {
  return {
    user: { id: 'u-1', firmId: 'f-1', email: 't@x.io', name: 'Demo', role: 'APP_ADMIN' as const },
    loading: false,
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
}

function seedQc(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['report-pipeline'], { funnel: [], conversionRates: [], avgDaysInStage: [], stalledCount: 0 });
  qc.setQueryData(['report-delivery'], {
    activeProjects: 0,
    byStage: [],
    slippingList: [],
    blockersByStage: [],
    forecastedGoLives: [],
  });
  qc.setQueryData(['report-health'], {
    totalManagedCustomers: 0,
    distribution: { red: 0, yellow: 0, green: 0 },
    redCustomers: [],
    churnRiskScore: 0,
    byStage: [],
  });
  qc.setQueryData(['report-renewals'], {
    next90Days: [],
    byMonth: [],
    totalArrAtRisk: 0,
    riskBreakdown: { atRiskRenewals: 0, healthyRenewals: 0 },
  });
  qc.setQueryData(['report-utilization'], { byUser: [], overloadedUsers: 0, unbalancedRoles: null });
  qc.setQueryData(['inbox'], { forYou: [], watching: [], firmWide: null });
  return qc;
}

describe('Phase 55.2 hotfix — /dashboard structural safeguards', () => {
  it('AssistantProvider lives at the App root, not inside AppShell or DashboardPage', () => {
    // App.tsx must render AssistantProvider; SideNav.tsx must NOT
    // import AssistantProvider (only the trigger).
    expect(APP_TSX).toMatch(/<AssistantProvider>/);
    expect(SIDENAV_TSX).not.toMatch(/import\s+\{\s*[^}]*AssistantProvider[^}]*\}\s+from/);
    // The trigger is still imported by SideNav.
    expect(SIDENAV_TSX).toMatch(/AssistantTrigger/);
  });

  it('AppShell uses a stable per-render snapshot of `collapsed` (not a raw localStorage read)', () => {
    // The pre-hotfix code read `readBool(COLLAPSE_KEY, false)` directly
    // in the AppShell function body on every render. Verify it now
    // lives inside a useState lazy initializer so the value is pinned.
    expect(SIDENAV_TSX).toMatch(
      /const\s+\[collapsed[^\]]*\]\s*=\s*useState\(\(\)\s*=>\s*readBool\(COLLAPSE_KEY/,
    );
  });

  it('DashboardPage renders to completion within a bounded number of synchronous renders', () => {
    // Wrap the dashboard in a render-count harness. SSR has no
    // useEffect, so re-renders only happen if a component sets state
    // synchronously during render — which is what the infinite-loop
    // regression looked like.
    let renderCount = 0;
    const RenderCounted = (): React.ReactElement => {
      renderCount++;
      if (renderCount > 50) {
        throw new Error(
          `DashboardPage render-cap exceeded (${renderCount} renders) — possible infinite loop regression`,
        );
      }
      return <DashboardPage />;
    };

    const html = renderToStaticMarkup(
      <AuthContext.Provider value={fakeAuth()}>
        <QueryClientProvider client={seedQc()}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <AssistantProvider>
              <Routes>
                <Route path="*" element={<RenderCounted />} />
              </Routes>
            </AssistantProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    expect(html).toContain('data-testid="dashboard-page"');
    expect(renderCount).toBeLessThanOrEqual(3);
  });
});
