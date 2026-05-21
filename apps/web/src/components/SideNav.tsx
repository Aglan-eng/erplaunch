/**
 * Phase 55.1 — Sidebar-only navigation.
 *
 * Replaces the Phase 52.2 horizontal `AppNav` with a single
 * persistent left rail. Layout is owned by `<AppShell>` which wraps
 * the sidebar + the content area on every authenticated page.
 *
 * - Fixed left, full height. 256px expanded; 64px icon rail when
 *   collapsed. The collapse state persists in localStorage.
 * - Top: brand + integrated search field.
 * - Middle: nav items with a clear active state (soft accent
 *   background + left accent bar).
 * - Settings is a nested expandable group with its 6 sub-tabs.
 * - Pinned bottom: user card (avatar, name, role, sign-out).
 *
 * No top bar exists in this design — every signed-in page is
 * `<AppShell>...children...</AppShell>` and the content area starts
 * immediately to the right of the sidebar.
 */
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  Inbox,
  Users,
  Briefcase,
  BarChart3,
  Settings as SettingsIcon,
  HelpCircle,
  LogOut,
  Search,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Palette,
  Plug,
  LifeBuoy,
  Mail,
  Building2,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { OnboardingTour } from './guidance/OnboardingTour';
import { AssistantProvider, AssistantTrigger } from './assistant/AssistantPanel';
import { cn } from '../lib/utils';

const COLLAPSE_KEY = 'erplaunch.sidenav.collapsed';
const SETTINGS_OPEN_KEY = 'erplaunch.sidenav.settingsOpen';

interface NavItem {
  label: string;
  to: string;
  matchPrefix: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { label: 'Dashboard', to: '/dashboard', matchPrefix: '/dashboard', icon: Home },
  { label: 'Inbox', to: '/inbox', matchPrefix: '/inbox', icon: Inbox },
  { label: 'Customers', to: '/customers', matchPrefix: '/customers', icon: Users },
  { label: 'Projects', to: '/projects', matchPrefix: '/projects', icon: Briefcase },
  { label: 'Reports', to: '/reports', matchPrefix: '/reports', icon: BarChart3 },
];

const SETTINGS_GROUP: ReadonlyArray<{ label: string; to: string; icon: React.ComponentType<{ className?: string }> }> = [
  { label: 'Firm', to: '/settings', icon: Building2 },
  { label: 'Brand Pack', to: '/settings?tab=brand-pack', icon: Palette },
  { label: 'Adaptors', to: '/settings?tab=adaptors', icon: Plug },
  { label: 'Tickets', to: '/settings?tab=tickets', icon: LifeBuoy },
  { label: 'Email Domain', to: '/settings?tab=email', icon: Mail },
  { label: 'Team', to: '/settings/team', icon: UserPlus },
];

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1';
  } catch {
    return fallback;
  }
}
function writeBool(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* no-op */
  }
}

function isItemActive(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function SideNav() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(() => readBool(COLLAPSE_KEY, false));
  const [settingsOpen, setSettingsOpen] = useState(() =>
    readBool(SETTINGS_OPEN_KEY, location.pathname.startsWith('/settings')),
  );

  useEffect(() => writeBool(COLLAPSE_KEY, collapsed), [collapsed]);
  useEffect(() => writeBool(SETTINGS_OPEN_KEY, settingsOpen), [settingsOpen]);

  const isSettingsActive = location.pathname.startsWith('/settings');
  const isHelpActive = location.pathname.startsWith('/help');

  return (
    <aside
      data-testid="side-nav"
      data-collapsed={collapsed}
      className={cn(
        'fixed top-0 left-0 z-30 h-screen border-r border-gray-200 bg-white flex flex-col transition-all duration-150',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      {/* ── Brand + collapse ─────────────────────────────────────── */}
      <div className="flex items-center justify-between h-14 px-3 border-b border-gray-100">
        <Link
          to="/dashboard"
          data-testid="side-nav-brand"
          className="flex items-center gap-2 min-w-0"
        >
          <div className="h-7 w-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-bold">E</span>
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold text-gray-900 truncate">ERPLaunch</span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          data-testid="side-nav-collapse-toggle"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded p-1 transition-colors"
        >
          <ChevronLeft
            className={cn(
              'h-3.5 w-3.5 transition-transform',
              collapsed ? 'rotate-180' : 'rotate-0',
            )}
          />
        </button>
      </div>

      {/* ── Search ───────────────────────────────────────────────── */}
      {!collapsed && (
        <div className="px-3 py-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="search"
              placeholder="Search…"
              disabled
              data-testid="side-nav-search"
              aria-label="Search"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-500 placeholder:text-gray-400 cursor-not-allowed"
            />
          </div>
        </div>
      )}

      {/* ── Primary nav ──────────────────────────────────────────── */}
      <nav
        className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5"
        aria-label="Primary"
        data-testid="side-nav-primary"
      >
        {NAV_ITEMS.map((item) => (
          <SideNavLink
            key={item.to}
            to={item.to}
            label={item.label}
            icon={item.icon}
            active={isItemActive(location.pathname, item.matchPrefix)}
            collapsed={collapsed}
            testid={`side-nav-link-${item.label.toLowerCase()}`}
          />
        ))}

        {/* Divider */}
        <div className="my-2 border-t border-gray-100" />

        {/* Settings — expandable group */}
        <div>
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            data-testid="side-nav-link-settings"
            aria-expanded={settingsOpen}
            className={cn(
              'w-full group relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors',
              isSettingsActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )}
            title={collapsed ? 'Settings' : undefined}
          >
            {isSettingsActive && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-brand-600" />
            )}
            <SettingsIcon className="h-4 w-4 flex-shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Settings</span>
                {settingsOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                )}
              </>
            )}
          </button>
          {!collapsed && settingsOpen && (
            <div className="mt-1 ml-2 pl-3 border-l border-gray-100 space-y-0.5" data-testid="side-nav-settings-group">
              {SETTINGS_GROUP.map((g) => {
                const active = location.pathname + location.search === g.to;
                const Icon = g.icon;
                return (
                  <Link
                    key={g.to}
                    to={g.to}
                    data-testid={`side-nav-settings-${g.label.toLowerCase().replace(/\s+/g, '-')}`}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1 rounded-md text-xs font-medium transition-colors',
                      active
                        ? 'text-brand-700 bg-brand-50'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                    )}
                  >
                    <Icon className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{g.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Help */}
        <SideNavLink
          to="/help"
          label="Help"
          icon={HelpCircle}
          active={isHelpActive}
          collapsed={collapsed}
          testid="side-nav-link-help"
        />

        {/* Phase 55.2 — AI assistant trigger. */}
        <AssistantTrigger collapsed={collapsed} />
      </nav>

      {/* ── User card ────────────────────────────────────────────── */}
      <div className="border-t border-gray-100 p-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex-shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-xs font-bold">
            {(user?.name ?? '?').slice(0, 1).toUpperCase()}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0" data-testid="side-nav-user">
                <p className="text-xs font-semibold text-gray-900 truncate">{user?.name ?? ''}</p>
                <p className="text-[10px] text-gray-500 truncate">{user?.role ?? ''}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                data-testid="side-nav-logout"
                title="Sign out"
                className="text-gray-400 hover:text-rose-600 p-1 rounded transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

interface SideNavLinkProps {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  testid: string;
}

function SideNavLink({ to, label, icon: Icon, active, collapsed, testid }: SideNavLinkProps) {
  return (
    <Link
      to={to}
      data-testid={testid}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'group relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors',
        active
          ? 'bg-brand-50 text-brand-700'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
      )}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-brand-600" />
      )}
      <Icon className="h-4 w-4 flex-shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
    </Link>
  );
}

/**
 * Page wrapper — every signed-in page lives inside this. The sidebar
 * is fixed, so the content offset matches the sidebar width. The
 * outer wrapper itself is responsive: the sidebar collapse just
 * narrows the rail; the content area's left padding is uniform via
 * `lg:pl-64 pl-16` because the sidebar's own width is collapse-aware
 * (always-rendered at 256/64).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const forceTour =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('welcome') === '1';
  const collapsed = readBool(COLLAPSE_KEY, false);
  return (
    <AssistantProvider>
      <div className="min-h-screen bg-gray-50" data-testid="app-shell">
        <OnboardingTour forceShow={forceTour} />
        <SideNav />
        <div
          className={cn(
            'transition-[padding] duration-150',
            collapsed ? 'pl-16' : 'pl-64',
          )}
          data-testid="app-shell-content"
        >
          {children}
        </div>
      </div>
    </AssistantProvider>
  );
}
