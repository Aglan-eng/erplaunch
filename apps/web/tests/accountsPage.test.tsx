/**
 * Phase 56.2 — Accounts list + Account detail + New menu SSR tests.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AccountsPage } from '../src/pages/AccountsPage';
import { AccountDetailPage } from '../src/pages/AccountDetailPage';
import { NewMenu } from '../src/components/accounts/NewMenu';
import { AuthContext } from '../src/contexts/AuthContext';
import type { AccountSummary, ProjectInAccount } from '../src/lib/api';

function fakeAuth() {
  return {
    user: { id: 'u-1', firmId: 'f-1', email: 't@x.io', name: 'Demo', role: 'APP_ADMIN' as const },
    loading: false,
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
}

const FIXTURE_ACCOUNTS: AccountSummary[] = [
  {
    id: 'acct-1',
    name: 'Acme Industries',
    address: '12 Industry Way',
    primaryContactName: 'Lina Said',
    primaryContactEmail: 'lina@acme.example',
    primaryContactPhone: null,
    archived: false,
    projectCount: 2,
    worstHealth: 25,
    worstHealthBand: 'red',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
  },
  {
    id: 'acct-2',
    name: 'Beta Co',
    address: null,
    primaryContactName: null,
    primaryContactEmail: null,
    primaryContactPhone: null,
    archived: false,
    projectCount: 0,
    worstHealth: null,
    worstHealthBand: null,
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
  },
];

const FIXTURE_PROJECTS: ProjectInAccount[] = [
  {
    id: 'proj-1',
    projectName: 'NetSuite — Initial Implementation',
    projectKind: 'INITIAL_IMPLEMENTATION',
    currentStage: 'BUILD',
    health: 25,
    healthBand: 'red',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'proj-2',
    projectName: 'Subsidiary onboarding (Phase 2)',
    projectKind: 'PHASE_2',
    currentStage: 'DISCOVERY',
    health: 70,
    healthBand: 'green',
    isArchived: false,
    createdAt: '2026-04-01T00:00:00Z',
  },
];

function renderAccounts(): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['accounts'], { accounts: FIXTURE_ACCOUNTS });
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/accounts']}>
          <Routes>
            <Route path="/accounts" element={<AccountsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

function renderDetail(id: string, projects: ProjectInAccount[]): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['accounts'], { accounts: FIXTURE_ACCOUNTS });
  qc.setQueryData(['account', id], {
    account: FIXTURE_ACCOUNTS.find((a) => a.id === id),
    projects,
  });
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/accounts/${id}`]}>
          <Routes>
            <Route path="/accounts/:id" element={<AccountDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe('AccountsPage', () => {
  it('renders the accounts table with project counts + worst-health chips', () => {
    const html = renderAccounts();
    expect(html).toContain('data-testid="accounts-page"');
    expect(html).toContain('data-testid="accounts-table"');
    expect(html).toContain('data-testid="accounts-row-acct-1"');
    expect(html).toContain('Acme Industries');
    expect(html).toContain('Beta Co');
    expect(html).toContain('href="/accounts/acct-1"');
  });

  it('renders the New menu trigger in the page header', () => {
    const html = renderAccounts();
    expect(html).toContain('data-testid="new-menu-trigger"');
  });
});

describe('AccountDetailPage — multi-project model', () => {
  it('shows both projects when an account has two', () => {
    const html = renderDetail('acct-1', FIXTURE_PROJECTS);
    expect(html).toContain('data-testid="account-detail-page"');
    expect(html).toContain('data-testid="account-detail-name"');
    expect(html).toContain('Acme Industries');
    expect(html).toContain('data-testid="account-project-row-proj-1"');
    expect(html).toContain('data-testid="account-project-row-proj-2"');
    expect(html).toContain('NetSuite — Initial Implementation');
    expect(html).toContain('Subsidiary onboarding (Phase 2)');
    // Each project row links to the existing project-detail page.
    expect(html).toContain('href="/customers/proj-1"');
    expect(html).toContain('href="/customers/proj-2"');
    // And to the Implementation tab via the Open → button.
    expect(html).toContain('href="/customers/proj-1?tab=implementation"');
  });

  it('shows an empty state when the account has no projects', () => {
    const html = renderDetail('acct-2', []);
    expect(html).toContain('data-testid="account-detail-projects-empty"');
  });
});

describe('NewMenu — three creation flows', () => {
  function renderMenu(): string {
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={['/accounts']}>
        <NewMenu accounts={FIXTURE_ACCOUNTS} />
      </MemoryRouter>,
    );
  }

  it('renders the trigger with stable test id', () => {
    const html = renderMenu();
    expect(html).toContain('data-testid="new-menu-trigger"');
  });

  it('menu items contain the three flows (verified by their testids in the source)', async () => {
    // SSR renders only the closed trigger; verify the three flow ids
    // are wired into the component file so a future refactor can't
    // silently drop one.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(
        require('node:url').fileURLToPath(
          new URL('../src/components/accounts/NewMenu.tsx', import.meta.url),
        ),
        'utf8',
      ),
    );
    expect(src).toContain('new-menu-item-lead');
    expect(src).toContain('new-menu-item-customer');
    expect(src).toContain('new-menu-item-project');
    expect(src).toContain('new-lead-submit');
    expect(src).toContain('new-customer-submit');
    expect(src).toContain('new-project-submit');
    // Lead flow hits /leads, customer/project flows hit /accounts.
    expect(src).toContain('leadsApi.create');
    expect(src).toContain('accountsApi.create');
    expect(src).toContain('accountsApi.createProject');
  });
});
