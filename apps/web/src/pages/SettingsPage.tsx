/**
 * Phase 52.8 — Settings as a tabbed shell.
 *
 * Five tabs (URL-state via `?tab=`):
 *   - firm        — branding, sales templates, team, change password
 *   - brand-pack  — link to the Brand Pack template editor
 *   - adaptors    — custom-ERP-adaptor wizard (formerly /custom-adaptors)
 *   - tickets     — SLA ticket queue (formerly /sla/tickets)
 *   - email       — Email Domain DNS setup (formerly /settings/email-domain)
 *
 * Each tab body is a self-contained component. For the heavy
 * formerly-top-level pages (Adaptors, Tickets) we render their
 * existing components inline — they keep their own internal chrome
 * but the outer AppNav lives only here.
 */
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Building2,
  Palette,
  Plug,
  LifeBuoy,
  Mail,
} from 'lucide-react';

import { AppShell } from '../components/SideNav';
import { api, authApi } from '../lib/api';
import { PortalPreviewPanel } from '../components/settings/PortalPreviewPanel';
import { CustomAdaptorsPage } from './CustomAdaptorsPage';
import { SlaTicketsPage } from './SlaTicketsPage';
import { EmailDomainPage } from './EmailDomainPage';
import { cn } from '@/lib/utils';

type Tab = 'firm' | 'brand-pack' | 'adaptors' | 'tickets' | 'email';

function readTab(params: URLSearchParams): Tab {
  const raw = params.get('tab');
  if (raw === 'brand-pack' || raw === 'adaptors' || raw === 'tickets' || raw === 'email') {
    return raw;
  }
  return 'firm';
}

const TABS: ReadonlyArray<{ key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'firm', label: 'Firm', icon: Building2 },
  { key: 'brand-pack', label: 'Brand Pack', icon: Palette },
  { key: 'adaptors', label: 'Adaptors', icon: Plug },
  { key: 'tickets', label: 'Tickets', icon: LifeBuoy },
  { key: 'email', label: 'Email Domain', icon: Mail },
];

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = readTab(searchParams);

  const setTab = (next: Tab): void => {
    const np = new URLSearchParams(searchParams);
    if (next === 'firm') np.delete('tab');
    else np.set('tab', next);
    setSearchParams(np, { replace: true });
  };

  return (
    <AppShell>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6" data-testid="settings-page">
        <header className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Firm branding, ERP adaptors, support tickets, and email-domain configuration.
          </p>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-gray-200 mb-4 overflow-x-auto"
          aria-label="Settings tabs"
          data-testid="settings-tabs"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                data-testid={`settings-tab-${t.key}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  active
                    ? 'text-brand-700 border-brand-500'
                    : 'text-gray-500 border-transparent hover:text-gray-900',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </nav>

        {tab === 'firm' && <FirmTab />}
        {tab === 'brand-pack' && <BrandPackTab />}
        {tab === 'adaptors' && (
          <div data-testid="settings-tab-body-adaptors">
            <CustomAdaptorsPage />
          </div>
        )}
        {tab === 'tickets' && (
          <div data-testid="settings-tab-body-tickets">
            <SlaTicketsPage />
          </div>
        )}
        {tab === 'email' && (
          <div data-testid="settings-tab-body-email">
            <EmailDomainPage />
          </div>
        )}
      </main>
    </AppShell>
  );
}

// ─── Brand Pack tab ───────────────────────────────────────────────────────

function BrandPackTab() {
  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-5 max-w-3xl"
      data-testid="settings-tab-body-brand-pack"
    >
      <h2 className="text-base font-semibold text-gray-900">Brand Pack</h2>
      <p className="text-sm text-gray-600 mt-1">
        Tagline, why-us, methodology, industry verticals, voice guide, theme tokens.
        Edit individually or paste a 12-section markdown pack to populate everything at
        once.
      </p>
      <p className="text-xs text-gray-500 mt-2">
        See the worked example at{' '}
        <a
          href="https://github.com/Aglan-eng/erplaunch/blob/main/XELERATE_BRAND_PACK.md"
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-violet-700 hover:text-violet-900"
          data-testid="brand-pack-example-link"
        >
          XELERATE_BRAND_PACK.md
        </a>
        .
      </p>
      <Link
        to="/settings/templates"
        className="mt-4 inline-flex items-center rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800"
        data-testid="settings-brand-pack-open"
      >
        Open the Brand Pack editor →
      </Link>
    </div>
  );
}

// ─── Firm tab (extracted from the old SettingsPage body) ──────────────────

interface FirmBranding {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string | null;
}

function FirmTab() {
  const [branding, setBranding] = useState<FirmBranding | null>(null);
  const [form, setForm] = useState({
    displayName: '',
    logoUrl: '',
    primaryColor: '#4f46e5',
    secondaryColor: '#818cf8',
    supportEmail: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/firm/branding');
        if (cancelled) return;
        const b: FirmBranding = data.data;
        setBranding(b);
        setForm({
          displayName: b.displayName ?? '',
          logoUrl: b.logoUrl ?? '',
          primaryColor: b.primaryColor,
          secondaryColor: b.secondaryColor,
          supportEmail: b.supportEmail ?? '',
        });
      } catch {
        if (!cancelled) setError('Could not load branding.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.patch('/firm/branding', {
        displayName: form.displayName.trim() || null,
        logoUrl: form.logoUrl.trim() || null,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        supportEmail: form.supportEmail.trim() || null,
      });
      setBranding(data.data);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 400) {
        setError('One of the fields is invalid. Colors must be 6-digit hex (e.g. #4f46e5).');
      } else {
        setError('Could not save. Try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-16"
        data-testid="settings-firm-loading"
      >
        <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div
      className="grid lg:grid-cols-3 gap-6"
      data-testid="settings-tab-body-firm"
    >
      <section className="lg:col-span-2 space-y-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-gray-900">Branding</h2>
            <p className="text-sm text-gray-500 mt-1">
              Your clients see this on their portal, not ours. Keep it brief.
            </p>
          </div>

          <form onSubmit={save} className="space-y-5">
            <Field label="Display name">
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="Acme Advisory"
                maxLength={100}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
            </Field>

            <Field label="Logo URL" hint="Paste a public URL — PNG or JPEG.">
              <input
                type="url"
                value={form.logoUrl}
                onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                placeholder="https://cdn.example.com/logo.png"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Primary color">
                <ColorInput
                  value={form.primaryColor}
                  onChange={(v) => setForm({ ...form, primaryColor: v })}
                />
              </Field>
              <Field label="Secondary color">
                <ColorInput
                  value={form.secondaryColor}
                  onChange={(v) => setForm({ ...form, secondaryColor: v })}
                />
              </Field>
            </div>

            <Field label="Support email">
              <input
                type="email"
                value={form.supportEmail}
                onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
                placeholder="support@acme.example"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
            </Field>

            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                {error && <span className="text-rose-600">{error}</span>}
                {!error && savedAt && <>Saved at {savedAt}</>}
              </p>
              <button
                type="submit"
                disabled={saving}
                data-testid="settings-firm-save"
                className="rounded-lg bg-brand-600 text-white text-sm font-medium px-5 py-2 hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>

        <SubSettingsLink
          to="/settings/sales-templates"
          title="Sales Templates"
          body="Per-module pricing, geography multipliers, and the markdown templates that drive every proposal and SOW your firm generates."
          testid="settings-sales-templates-link"
        />
        <SubSettingsLink
          to="/settings/team"
          title="Team"
          body="Grant firm-level and per-engagement roles. Every change is auditable."
          testid="settings-team-link"
        />

        <ChangePasswordCard />
      </section>

      <aside className="lg:col-span-1">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 sticky top-20">
          <h3 className="text-xs font-semibold text-gray-500 tracking-wide uppercase mb-1">
            Portal preview
          </h3>
          <p className="text-[11px] text-gray-400 mb-3">
            This is what your client sees when they sign in.
          </p>
          <PortalPreviewPanel
            displayName={form.displayName || branding?.displayName || 'Your Firm'}
            logoUrl={form.logoUrl || branding?.logoUrl || null}
            primaryColor={form.primaryColor}
            secondaryColor={form.secondaryColor}
            supportEmail={form.supportEmail || branding?.supportEmail || null}
          />
        </div>
      </aside>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-10 rounded-lg border border-gray-300 cursor-pointer bg-white"
        aria-label="Color picker"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={7}
        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
        placeholder="#4f46e5"
      />
    </div>
  );
}

function SubSettingsLink({
  to,
  title,
  body,
  testid,
}: {
  to: string;
  title: string;
  body: string;
  testid: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500 mt-1">{body}</p>
        </div>
        <Link
          to={to}
          className="rounded-lg bg-gray-900 text-white text-sm font-medium px-4 py-2 hover:bg-gray-800 flex-shrink-0"
          data-testid={testid}
        >
          Open
        </Link>
      </div>
    </div>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clientSideError = (): string | null => {
    if (!currentPassword) return 'Enter your current password.';
    if (newPassword.length < 8) return 'New password must be at least 8 characters.';
    if (newPassword === currentPassword) return 'New password must differ from your current one.';
    if (newPassword !== confirm) return 'New password and confirmation do not match.';
    return null;
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOkMessage(null);
    setErrorMessage(null);
    const ce = clientSideError();
    if (ce) {
      setErrorMessage(ce);
      return;
    }
    setSaving(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      setOkMessage("Password updated. You'll use the new one next time you sign in.");
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      const code = (err as { response?: { data?: { error?: { code?: string; message?: string } } } })
        .response?.data?.error;
      if (code?.code === 'WRONG_PASSWORD') {
        setErrorMessage('Current password is incorrect.');
      } else if (code?.code === 'SAME_PASSWORD') {
        setErrorMessage('New password must differ from your current one.');
      } else {
        setErrorMessage(code?.message ?? 'Could not update the password. Try again in a moment.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900">Change password</h2>
        <p className="text-sm text-gray-500 mt-1">
          Rotates your sign-in password. You'll stay signed in on this device.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <Field label="Current password">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setErrorMessage(null);
              setOkMessage(null);
            }}
            placeholder="••••••••"
            autoComplete="current-password"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          />
        </Field>

        <Field label="New password">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setErrorMessage(null);
              setOkMessage(null);
            }}
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          />
        </Field>

        <Field label="Confirm new password">
          <input
            type="password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setErrorMessage(null);
              setOkMessage(null);
            }}
            placeholder="••••••••"
            autoComplete="new-password"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          />
        </Field>

        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          <p className="text-xs">
            {errorMessage && <span className="text-rose-600">{errorMessage}</span>}
            {!errorMessage && okMessage && <span className="text-green-600">{okMessage}</span>}
          </p>
          <button
            type="submit"
            disabled={saving || !currentPassword || !newPassword || !confirm}
            className="rounded-lg bg-brand-600 text-white text-sm font-medium px-5 py-2 hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </form>
    </div>
  );
}
