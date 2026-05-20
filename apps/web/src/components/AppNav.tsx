/**
 * Phase 52.2 — unified 4-link top navigation.
 *
 * Replaces the 7-link inline header from DashboardPage that mixed
 * Adaptors / Sales / SLA / Tickets / Archived / Settings into a flat
 * row with no hierarchy. New nav surfaces only the four routes that
 * map to the unified Customer IA:
 *
 *   - Inbox     → /inbox          (role-based home, Phase 52.5)
 *   - Customers → /customers      (kanban + list, Phase 52.3)
 *   - Reports   → /reports        (stub, real implementation in Phase 53)
 *   - Settings  → /settings       (existing page)
 *
 * Old routes (/dashboard, /sales/*, /sla/*, /custom-adaptors, etc.)
 * stay live until the Phase 52.6 cutover adds redirects. This
 * component is only mounted on the new pages (the stubs added in
 * this sub-phase) so the legacy dashboard chrome keeps working in
 * parallel during the transition window.
 *
 * Mobile breakpoint: links collapse into a hamburger menu below
 * 768px (a plain Tailwind `md:` switch — no drawer animation, no
 * fancy state machine). Search box placeholder stays visible at
 * all widths but is non-functional until Phase 53 wires the real
 * cross-customer search.
 */
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Inbox, Users, BarChart3, Settings, LogOut, Search, Menu, X, HelpCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/utils';
import { OnboardingTour } from './guidance/OnboardingTour';

interface NavLink {
  label: string;
  to: string;
  /** Path prefix that triggers active-state highlight. A click on
   *  /customers/abc-123 should still highlight "Customers". */
  matchPrefix: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_LINKS: ReadonlyArray<NavLink> = [
  { label: 'Inbox', to: '/inbox', matchPrefix: '/inbox', icon: Inbox },
  { label: 'Customers', to: '/customers', matchPrefix: '/customers', icon: Users },
  { label: 'Reports', to: '/reports', matchPrefix: '/reports', icon: BarChart3 },
  { label: 'Settings', to: '/settings', matchPrefix: '/settings', icon: Settings },
];

function isActive(pathname: string, link: NavLink): boolean {
  // Exact match OR pathname starts with `${matchPrefix}/`. The
  // trailing-slash check stops `/inboxx` from claiming `/inbox`.
  return pathname === link.matchPrefix || pathname.startsWith(`${link.matchPrefix}/`);
}

export function AppNav() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const forceTour =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('welcome') === '1';

  return (
    <>
    <OnboardingTour forceShow={forceTour} />
    <header
      className="bg-white border-b border-gray-200 sticky top-0 z-30"
      data-testid="app-nav"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-3">
          {/* Brand mark — links to /inbox (the new home). */}
          <Link to="/inbox" className="flex items-center gap-2 flex-shrink-0">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <span className="text-white text-sm font-bold">E</span>
            </div>
            <span className="text-sm font-semibold text-gray-900 hidden sm:inline">
              ERPLaunch
            </span>
          </Link>

          {/* Primary links — visible md+. Mobile uses the hamburger. */}
          <nav
            className="hidden md:flex items-center gap-1 flex-1 justify-center"
            aria-label="Primary"
          >
            {NAV_LINKS.map((link) => {
              const active = isActive(location.pathname, link);
              const Icon = link.icon;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  data-testid={`app-nav-link-${link.label.toLowerCase()}`}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                    active
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Search placeholder — real cross-customer search lands in Phase 53. */}
          <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                type="search"
                placeholder="Search…"
                disabled
                data-testid="app-nav-search"
                aria-label="Search"
                className="w-56 pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-500 placeholder:text-gray-400 cursor-not-allowed"
              />
            </div>
          </div>

          {/* Right-side: user identity + logout (md+) and hamburger (mobile). */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              to="/help"
              data-testid="app-nav-help"
              title="How ERPLaunch works"
              className="text-gray-500 hover:text-brand-700 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <HelpCircle className="h-4 w-4" />
            </Link>
            <span
              className="text-sm text-gray-600 hidden sm:inline font-medium"
              data-testid="app-nav-user"
            >
              {user?.name ?? ''}
            </span>
            <button
              type="button"
              onClick={logout}
              data-testid="app-nav-logout"
              title="Sign out"
              className="text-gray-500 hover:text-gray-900 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              data-testid="app-nav-mobile-toggle"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              className="md:hidden text-gray-600 hover:text-gray-900 p-1.5 rounded-lg hover:bg-gray-100"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile-collapsed link list. Plain display:none/block — no
            drawer animation per the spec ("keep simple"). */}
        {mobileOpen && (
          <nav
            className="md:hidden border-t border-gray-100 py-2 flex flex-col gap-0.5"
            aria-label="Primary mobile"
            data-testid="app-nav-mobile-links"
          >
            {NAV_LINKS.map((link) => {
              const active = isActive(location.pathname, link);
              const Icon = link.icon;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMobileOpen(false)}
                  data-testid={`app-nav-mobile-link-${link.label.toLowerCase()}`}
                  className={cn(
                    'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium',
                    active
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </header>
    </>
  );
}
