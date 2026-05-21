/**
 * Phase 52.8 — Cutover redirect + tabbed Settings tests.
 *
 * Redirects use react-router's `<Navigate>`, which fires via
 * useEffect — not visible to SSR `renderToStaticMarkup`. So we
 * verify the redirect mapping by reading `App.tsx` and asserting
 * each legacy URL points at the new destination. The Settings
 * tabbed shell + deleted-page assertions are exercised via SSR
 * since their output is purely synchronous.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SettingsPage } from '../src/pages/SettingsPage';
import { AuthContext } from '../src/contexts/AuthContext';

// Settings tab bodies hit the heavy CustomAdaptorsPage / SlaTicketsPage
// queries — short-circuit them so the SSR render doesn't blow up.
vi.mock('../src/lib/api', async (orig) => {
  const actual = await orig<typeof import('../src/lib/api')>();
  return {
    ...actual,
    api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
    customAdaptorsApi: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
    },
    ticketsApi: {
      listFirmTickets: vi.fn().mockResolvedValue({ tickets: [] }),
    },
  };
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_TSX = fs.readFileSync(
  path.resolve(__dirname, '../src/App.tsx'),
  'utf8',
);

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

function renderSettings(entry: string): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

// ─── Redirect mapping (via App.tsx source) ────────────────────────────────

describe('Phase 52.8 — legacy URL redirects (App.tsx route table)', () => {
  const cases: ReadonlyArray<{ from: string; to: string }> = [
    // Phase 53.3 — `/` now resolves via <RoleAwareHome /> so it can
    // route CEO users to /executive; the role-aware redirect is
    // covered in executiveDashboard.test.tsx. The redirect contract
    // for non-CEO users still lands on /inbox at runtime.
    { from: '/dashboard', to: '/inbox' },
    { from: '/dashboard/archived', to: '/customers?archived=true' },
    { from: '/archived', to: '/customers?archived=true' },
    { from: '/sales', to: '/reports?tab=pipeline' },
    { from: '/sales/pipeline', to: '/reports?tab=pipeline' },
    { from: '/sales/reports', to: '/reports?tab=pipeline' },
    { from: '/sla', to: '/reports?tab=health' },
    { from: '/sla/dashboard', to: '/reports?tab=health' },
    { from: '/tickets', to: '/settings?tab=tickets' },
    { from: '/sla/tickets', to: '/settings?tab=tickets' },
    { from: '/adaptors', to: '/settings?tab=adaptors' },
    { from: '/custom-adaptors', to: '/settings?tab=adaptors' },
  ];

  for (const c of cases) {
    it(`${c.from} → ${c.to}`, () => {
      // Build the literal Route declaration the test expects. The path
      // attribute exact-matches; the Navigate `to` exact-matches.
      const expected = new RegExp(
        `<Route\\s+path="${c.from.replace(/[/?=&]/g, (m) => `\\${m}`)}"\\s+element=\\{<Navigate\\s+to="${c.to.replace(/[/?=&]/g, (m) => `\\${m}`)}"\\s+replace\\s*\\/>\\}\\s*\\/>`,
      );
      expect(APP_TSX).toMatch(expected);
    });
  }

  it('legacy page imports are gone from App.tsx', () => {
    // Phase 55.1 re-introduced DashboardPage as a different,
    // sidebar-shell-aware home — so we cannot guard on the
    // "DashboardPage" substring anymore. The original 52.8 deletes
    // (Archived/SalesPipeline/SlaPortfolio) are still gone.
    expect(APP_TSX).not.toContain('ArchivedDashboardPage');
    expect(APP_TSX).not.toContain('SalesPipelinePage');
    expect(APP_TSX).not.toContain('SlaPortfolioPage');
  });
});

// ─── Deleted-file existence guards ────────────────────────────────────────

describe('Phase 52.8 — legacy files removed', () => {
  const removed = [
    // Phase 55.1 brought back a NEW DashboardPage at the same path —
    // the legacy one was deleted in 52.8 and this assertion is now
    // obsolete; the 52.8 cutover semantics are still satisfied by
    // the other deletions below.
    '../src/pages/ArchivedDashboardPage.tsx',
    '../src/pages/SalesPipelinePage.tsx',
    '../src/pages/SlaPortfolioPage.tsx',
    '../src/pages/PipelinePage.tsx',
    '../src/pages/SalesReportsPage.tsx',
    '../src/pages/archivedEngagements.ts',
    '../src/components/dashboard/EngagementCard.tsx',
    '../src/components/dashboard/NewEngagementModal.tsx',
    '../src/components/sla/RenewalPipelineWidget.tsx',
  ];
  for (const rel of removed) {
    it(`${rel} does not exist`, () => {
      expect(fs.existsSync(path.resolve(__dirname, rel))).toBe(false);
    });
  }
});

// ─── Settings tabbed shell ────────────────────────────────────────────────

describe('Phase 52.8 — Settings tabbed shell', () => {
  it('renders all five tab buttons', () => {
    const html = renderSettings('/settings');
    for (const key of ['firm', 'brand-pack', 'adaptors', 'tickets', 'email']) {
      expect(html).toContain(`data-testid="settings-tab-${key}"`);
    }
  });

  it('Firm tab is active by default', () => {
    const html = renderSettings('/settings');
    expect(html).toMatch(
      /<button[^>]*data-testid="settings-tab-firm"[^>]*aria-current="page"/,
    );
  });

  it('?tab=adaptors activates the Adaptors tab and renders its body', () => {
    const html = renderSettings('/settings?tab=adaptors');
    expect(html).toMatch(
      /<button[^>]*data-testid="settings-tab-adaptors"[^>]*aria-current="page"/,
    );
    expect(html).toContain('data-testid="settings-tab-body-adaptors"');
  });

  it('?tab=tickets activates the Tickets tab and renders its body', () => {
    const html = renderSettings('/settings?tab=tickets');
    expect(html).toContain('data-testid="settings-tab-body-tickets"');
  });

  it('?tab=brand-pack renders the Brand Pack body with editor link', () => {
    const html = renderSettings('/settings?tab=brand-pack');
    expect(html).toContain('data-testid="settings-tab-body-brand-pack"');
    expect(html).toContain('data-testid="settings-brand-pack-open"');
  });

  it('?tab=email activates the Email Domain tab', () => {
    const html = renderSettings('/settings?tab=email');
    expect(html).toContain('data-testid="settings-tab-body-email"');
  });

  it('renders the unified AppNav (Phase 52.2 chrome)', () => {
    const html = renderSettings('/settings');
    expect(html).toContain('data-testid="side-nav"');
  });
});
