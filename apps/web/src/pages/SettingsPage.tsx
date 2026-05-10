import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, authApi } from '../lib/api';
import { PortalPreviewPanel } from '../components/settings/PortalPreviewPanel';

interface FirmBranding {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string | null;
}

/**
 * Firm Settings — Branding slice (Phase 5A / Day 3).
 *
 * Two colors + logo URL + display name + support email. Deliberately
 * minimal: no theme editor, no typography options, no dark-mode toggle.
 * Logo uploads arrive in Day 4; for now a URL input is sufficient.
 */
export function SettingsPage() {
  const [branding, setBranding] = useState<FirmBranding | null>(null);
  const [form, setForm] = useState<{
    displayName: string;
    logoUrl: string;
    primaryColor: string;
    secondaryColor: string;
    supportEmail: string;
  }>({
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
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/firm/branding');
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
      setError('Could not load branding.');
    } finally {
      setLoading(false);
    }
  }

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
      if (status === 400) setError('One of the fields is invalid. Colors must be 6-digit hex (e.g. #4f46e5).');
      else setError('Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <Link to="/dashboard" className="text-sm text-slate-500 hover:text-slate-700">← Dashboard</Link>
            <h1 className="text-xl font-semibold text-slate-900 mt-1">Firm Settings</h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 grid lg:grid-cols-3 gap-8">
        <section className="lg:col-span-2 space-y-8">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-slate-900">Branding</h2>
              <p className="text-sm text-slate-500 mt-1">
                Your clients see this on their portal, not ours. Keep it brief.
              </p>
            </div>

            <form onSubmit={save} className="space-y-5">
              <Field label="Display name" hint="Shown in the portal header and outbound emails.">
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  placeholder="Acme Advisory"
                  maxLength={100}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </Field>

              <Field label="Logo" hint="PNG or JPEG, up to 2 MB. Or paste a public URL.">
                <LogoUploader
                  value={form.logoUrl}
                  onChange={(v) => setForm({ ...form, logoUrl: v })}
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

              <Field label="Support email" hint="Shown to clients who need help signing in.">
                <input
                  type="email"
                  value={form.supportEmail}
                  onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
                  placeholder="support@acme.example"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </Field>

              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-500">
                  {error && <span className="text-rose-600">{error}</span>}
                  {!error && savedAt && <>Saved at {savedAt}</>}
                </p>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-brand-600 text-white text-sm font-medium px-5 py-2 hover:bg-brand-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>

          {/* Phase 41.4 — entry point to the Email Domain DNS-setup page.
               Sits below the branding card because both touch "what
               your client sees" and the admin will likely visit them
               in the same session. */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-slate-900">Email Domain</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Verify your firm's domain so portal invites, password resets, and verification emails reach your clients reliably.
                </p>
              </div>
              <Link
                to="/settings/email-domain"
                className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 flex-shrink-0"
                data-testid="settings-email-domain-link"
              >
                Open
              </Link>
            </div>
          </div>

          {/* Phase 46.8.6 — Sales templates + pricing editor. */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-slate-900">Sales Templates</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Per-module pricing, geography multipliers, and the markdown templates that
                  drive every proposal and SOW your firm generates.
                </p>
              </div>
              <Link
                to="/settings/sales-templates"
                className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 flex-shrink-0"
                data-testid="settings-sales-templates-link"
              >
                Open
              </Link>
            </div>
          </div>

          {/* Phase 49.7 — Brand Pack template editor. Linked from
              Settings so firm admins can find it without knowing the
              URL. The card mentions the worked-example pack so a
              first-time visitor can copy and adapt rather than starting
              from a blank page. */}
          <div
            className="bg-white rounded-2xl border border-slate-200 p-6"
            data-testid="settings-templates-card"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-slate-900">Templates (Brand Pack)</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Tagline, why-us, methodology, industry verticals, voice guide, theme
                  tokens. Edit individually or paste a 12-section markdown pack to populate
                  everything at once. See the worked example at{' '}
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
              </div>
              <Link
                to="/settings/templates"
                className="rounded-lg bg-violet-700 text-white text-sm font-medium px-4 py-2 hover:bg-violet-800 flex-shrink-0"
                data-testid="settings-templates-link"
              >
                Open
              </Link>
            </div>
          </div>

          {/* Phase 43.4 — Team / role management. Only useful to App
               Admins; the page itself guards on permission and shows
               a friendly "admins only" panel for everyone else. */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-slate-900">Team</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Grant firm-level and per-engagement roles. Every change is auditable.
                </p>
              </div>
              <Link
                to="/settings/team"
                className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 flex-shrink-0"
                data-testid="settings-team-link"
              >
                Open
              </Link>
            </div>
          </div>

          <ChangePasswordCard />
        </section>

        <aside className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sticky top-6">
            <h3 className="text-xs font-semibold text-slate-500 tracking-wide uppercase mb-1">
              Portal preview
            </h3>
            <p className="text-[11px] text-slate-400 mb-3">
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
      </main>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

/**
 * Logo uploader (Phase 18). Two ways in:
 *   - Drop / pick a PNG or JPEG → POST /firm/branding/logo
 *   - Paste a public URL into the fallback text input (same as before)
 *
 * On successful upload, the API returns the absolute URL of the stored
 * logo; we push that into the form's logoUrl field so the parent's
 * portal preview updates immediately. Errors surface inline and don't
 * clear the pasted URL.
 */
function LogoUploader({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo must be under 2 MB.');
      return;
    }
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setError('Logo must be PNG or JPEG.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/firm/branding/logo', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const branding = data.data as { logoUrl: string | null };
      if (branding?.logoUrl) onChange(branding.logoUrl);
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error?: { code?: string; message?: string } } } }).response?.data?.error;
      setError(code?.message ?? 'Upload failed. Try again in a moment.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {/* Preview + dropzone */}
        <div className="relative h-16 w-16 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden flex-shrink-0">
          {value ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <img
              src={value}
              className="h-full w-full object-contain"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
            />
          ) : (
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">No logo</span>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : value ? 'Replace logo' : 'Upload logo'}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                disabled={uploading}
                className="rounded-lg border border-slate-300 text-slate-700 text-sm font-medium px-4 py-2 hover:bg-slate-50 disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              void handleFile(f);
              if (e.target) e.target.value = '';
            }}
          />
          {/* Fallback / manual URL paste — same field the PATCH expects */}
          <input
            type="url"
            value={value}
            onChange={(e) => { onChange(e.target.value); setError(null); }}
            placeholder="Or paste a public URL: https://cdn.example.com/logo.png"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          />
        </div>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
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
        className="h-10 w-10 rounded-lg border border-slate-300 cursor-pointer bg-white"
        aria-label="Color picker"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={7}
        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
        placeholder="#4f46e5"
      />
    </div>
  );
}

// PortalHeaderPreview was extracted to components/settings/PortalPreviewPanel
// in Phase 41.3 and replaced with a richer mock that mirrors PortalLayout
// (header + section list + CTA + support footer). Kept this comment as a
// landmark for `git log -p` archaeology.

/**
 * Change-password card (Phase 17). Sibling of the Branding section.
 * Self-contained state + validation + submission — mirrors the
 * ResetPasswordPage UX but re-auths against the current password
 * instead of a reset token.
 */
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
    if (ce) { setErrorMessage(ce); return; }

    setSaving(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      setOkMessage('Password updated. You\'ll use the new one next time you sign in.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error?: { code?: string; message?: string } } } }).response?.data?.error;
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
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-slate-900">Change password</h2>
        <p className="text-sm text-slate-500 mt-1">
          Rotates your sign-in password. You'll stay signed in on this device.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Current password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => { setCurrentPassword(e.target.value); setErrorMessage(null); setOkMessage(null); }}
            placeholder="••••••••"
            autoComplete="current-password"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setErrorMessage(null); setOkMessage(null); }}
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Confirm new password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setErrorMessage(null); setOkMessage(null); }}
            placeholder="••••••••"
            autoComplete="new-password"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          />
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
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
