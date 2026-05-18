/**
 * Phase 52.2 — AppNav render + active-state tests.
 *
 * Pins:
 *   - Four links render with the expected hrefs (Inbox · Customers ·
 *     Reports · Settings).
 *   - The hamburger toggle is present on the markup (mobile menu's
 *     real toggle interaction needs a DOM library, but SSR can pin
 *     the button + aria attributes).
 *   - Active-state highlight (bg-brand-50) on each link when the
 *     router is on the matching path. Tested for all four routes
 *     plus a path-prefix case (/customers/abc → Customers active).
 *   - data-testid hooks are present for e2e selectors.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AppNav } from '../src/components/AppNav';
import { AuthContext } from '../src/contexts/AuthContext';

function render(initialPath: string): string {
  const fakeAuth = {
    user: { id: 'u-1', firmId: 'f-1', email: 't@x.io', name: 'Test User', role: 'APP_ADMIN' as const },
    loading: false,
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppNav />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('AppNav — link presence (Phase 52.2)', () => {
  it('renders all four primary links', () => {
    const html = render('/inbox');
    expect(html).toContain('data-testid="app-nav-link-inbox"');
    expect(html).toContain('data-testid="app-nav-link-customers"');
    expect(html).toContain('data-testid="app-nav-link-reports"');
    expect(html).toContain('data-testid="app-nav-link-settings"');
  });

  it('points each link at its canonical href', () => {
    const html = render('/inbox');
    expect(html).toMatch(/href="\/inbox"/);
    expect(html).toMatch(/href="\/customers"/);
    expect(html).toMatch(/href="\/reports"/);
    expect(html).toMatch(/href="\/settings"/);
  });

  it('renders the brand mark + user name + logout button', () => {
    const html = render('/inbox');
    expect(html).toContain('ERPLaunch');
    expect(html).toContain('data-testid="app-nav-user"');
    expect(html).toContain('Test User');
    expect(html).toContain('data-testid="app-nav-logout"');
  });

  it('renders a disabled search placeholder (real search is Phase 53)', () => {
    const html = render('/inbox');
    expect(html).toContain('data-testid="app-nav-search"');
    expect(html).toContain('disabled');
  });

  it('renders the mobile hamburger toggle with aria-expanded=false by default', () => {
    const html = render('/inbox');
    expect(html).toContain('data-testid="app-nav-mobile-toggle"');
    expect(html).toMatch(/aria-expanded="false"/);
  });
});

describe('AppNav — active-state highlight (Phase 52.2)', () => {
  it('highlights Inbox on /inbox', () => {
    const html = render('/inbox');
    expect(html).toMatch(
      /<a[^>]*data-testid="app-nav-link-inbox"[^>]*class="[^"]*bg-brand-50/,
    );
    // The other three stay inactive (gray text).
    expect(html).toMatch(
      /<a[^>]*data-testid="app-nav-link-customers"[^>]*class="[^"]*text-gray-600/,
    );
  });

  it('highlights Customers on /customers', () => {
    const html = render('/customers');
    expect(html).toMatch(
      /<a[^>]*data-testid="app-nav-link-customers"[^>]*class="[^"]*bg-brand-50/,
    );
  });

  it('highlights Customers on /customers/:id (path-prefix match)', () => {
    const html = render('/customers/abc-123');
    expect(html).toMatch(
      /<a[^>]*data-testid="app-nav-link-customers"[^>]*class="[^"]*bg-brand-50/,
    );
  });

  it('highlights Reports on /reports', () => {
    const html = render('/reports');
    expect(html).toMatch(
      /<a[^>]*data-testid="app-nav-link-reports"[^>]*class="[^"]*bg-brand-50/,
    );
  });

  it('highlights Settings on /settings (and any /settings/* sub-route)', () => {
    expect(render('/settings')).toMatch(
      /<a[^>]*data-testid="app-nav-link-settings"[^>]*class="[^"]*bg-brand-50/,
    );
    expect(render('/settings/templates')).toMatch(
      /<a[^>]*data-testid="app-nav-link-settings"[^>]*class="[^"]*bg-brand-50/,
    );
  });

  it('treats /inboxx as NOT matching /inbox (defends against accidental prefix overlap)', () => {
    const html = render('/inboxx');
    expect(html).not.toMatch(
      /<a[^>]*data-testid="app-nav-link-inbox"[^>]*class="[^"]*bg-brand-50/,
    );
  });
});
