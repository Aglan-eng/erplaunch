/**
 * Phase 55.1 — Sidebar navigation tests (SSR).
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SideNav } from '../src/components/SideNav';
import { AuthContext } from '../src/contexts/AuthContext';

function fakeAuth(role = 'APP_ADMIN') {
  return {
    user: { id: 'u-1', firmId: 'f-1', email: 't@x.io', name: 'Demo User', role },
    loading: false,
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
}

function render(initialEntry = '/dashboard', role = 'APP_ADMIN'): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth(role)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <SideNav />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe('SideNav — primary navigation', () => {
  it('renders every primary nav link with stable test ids', () => {
    const html = render();
    for (const id of ['dashboard', 'inbox', 'customers', 'projects', 'reports', 'help']) {
      expect(html).toContain(`data-testid="side-nav-link-${id}"`);
    }
  });

  it('renders the brand + search + user card + collapse toggle', () => {
    const html = render();
    expect(html).toContain('data-testid="side-nav-brand"');
    expect(html).toContain('data-testid="side-nav-search"');
    expect(html).toContain('data-testid="side-nav-user"');
    expect(html).toContain('data-testid="side-nav-collapse-toggle"');
    expect(html).toContain('data-testid="side-nav-logout"');
  });

  it('marks the active route via aria-current=page', () => {
    const html = render('/customers');
    expect(html).toMatch(
      /<a[^>]*data-testid="side-nav-link-customers"[^>]*aria-current="page"/,
    );
  });
});

describe('SideNav — Settings expandable group', () => {
  it('expands to surface the 6 settings sub-tabs', () => {
    const html = render('/settings');
    expect(html).toContain('data-testid="side-nav-settings-group"');
    for (const sub of ['firm', 'brand-pack', 'adaptors', 'tickets', 'email-domain', 'team']) {
      expect(html).toContain(`data-testid="side-nav-settings-${sub}"`);
    }
  });

  it('chevron-toggles the settings group (aria-expanded reflects state)', () => {
    const html = render('/settings');
    // On /settings the group auto-opens (path-derived default).
    expect(html).toMatch(
      /<button[^>]*data-testid="side-nav-link-settings"[^>]*aria-expanded="true"/,
    );
  });
});
